/** Connects the socket to the store: one hook that gives the UI state and commands. */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Action } from "@fishingjamboree/engine";
import { PROTOCOL_VERSION } from "../../../packages/server/src/protocol";
import type {
  ClientAction,
  ClientMessage,
  ServerMessage,
} from "../../../packages/server/src/protocol";
import { describeEvent } from "./describe";
import type { Content } from "@fishingjamboree/engine";
import {
  connectionChanged,
  dismissNotice,
  initialState,
  intentSent,
  onServerMessage,
  resetSession,
} from "./store";
import type { ClientState, Connection, Context, Session } from "./store";

type Step =
  | { t: "server"; msg: ServerMessage }
  | { t: "connection"; c: Connection }
  | { t: "sent"; id: string }
  | { t: "reset"; notice: string | null }
  | { t: "dismiss" };

const STORAGE_KEY = "fishingjamboree.session";

// sessionStorage, not localStorage: every tab is its own player, so two tabs of
// one browser can sit at the same table.
function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: reconnecting by hand still works */
  }
}

export function serverUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("server");
  if (fromQuery) return fromQuery;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname || "localhost"}:8787`;
}

function makeContext(content: Content): Context {
  return {
    contentHash: content.hash,
    describe: (events, room) => {
      const name = (p: string) => room?.seats.find((s) => s.seat === p)?.name ?? p;
      return events
        .map((e) => describeEvent(e, content, name))
        .filter((t): t is string => t !== null);
    },
  };
}

export function useGame(content: Content) {
  const ctx = useMemo(() => makeContext(content), [content]);
  const [state, dispatch] = useReducer((s: ClientState, step: Step): ClientState => {
    switch (step.t) {
      case "server":
        return onServerMessage(s, step.msg, ctx);
      case "connection":
        return connectionChanged(s, step.c);
      case "sent":
        return intentSent(s, step.id);
      case "reset":
        return resetSession(s, step.notice);
      case "dismiss":
        return dismissNotice(s);
    }
  }, initialState);

  const socket = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const retry = useRef<{ timer: number | null; attempts: number; stop: boolean }>({
    timer: null,
    attempts: 0,
    stop: false,
  });
  const counter = useRef(0);

  const open = useCallback((first: ClientMessage) => {
    socket.current?.close();
    retry.current.stop = false;
    dispatch({ t: "connection", c: "connecting" });
    const ws = new WebSocket(serverUrl());
    socket.current = ws;
    ws.onopen = () => {
      retry.current.attempts = 0;
      dispatch({ t: "connection", c: "open" });
      ws.send(JSON.stringify(first));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "error") {
        if (msg.code === "bad-token" || msg.code === "room-not-found") {
          // The saved seat is gone (room deleted or seat freed): start over.
          saveSession(null);
          retry.current.stop = true;
          dispatch({ t: "reset", notice: msg.message });
          return;
        }
        if (msg.code === "replaced") retry.current.stop = true;
      }
      if (msg.type === "welcome")
        saveSession({ code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken });
      if (msg.type === "left") saveSession(null);
      dispatch({ t: "server", msg });
    };
    ws.onclose = () => {
      if (socket.current !== ws) return; // an older socket
      dispatch({ t: "connection", c: "closed" });
      const session = stateRef.current.session ?? loadSession();
      if (!session || retry.current.stop) return;
      const delay = Math.min(5000, 500 * 2 ** retry.current.attempts++);
      retry.current.timer = window.setTimeout(
        () =>
          open({
            type: "rejoin",
            v: PROTOCOL_VERSION,
            code: session.code,
            seatToken: session.seatToken,
          }),
        delay,
      );
    };
  }, []);

  // Pick up a saved seat when the page loads (a refresh keeps the player's seat).
  useEffect(() => {
    const session = loadSession();
    if (session) {
      open({
        type: "rejoin",
        v: PROTOCOL_VERSION,
        code: session.code,
        seatToken: session.seatToken,
      });
    }
    const timers = retry.current;
    return () => {
      timers.stop = true;
      if (timers.timer !== null) window.clearTimeout(timers.timer);
      const ws = socket.current;
      socket.current = null;
      ws?.close();
    };
  }, [open]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // A gap in `seq`: ask for the current game.
  useEffect(() => {
    if (state.needsSync) send({ type: "sync" });
  }, [state.needsSync, send]);

  return {
    state,
    create: (name: string) => open({ type: "create", v: PROTOCOL_VERSION, name }),
    join: (code: string, name: string) => open({ type: "join", v: PROTOCOL_VERSION, code, name }),
    start: () => send({ type: "start" }),
    leave: () => {
      retry.current.stop = true;
      send({ type: "leave" });
    },
    /** Sends an engine action (its `player` is replaced by the server). */
    act: (action: Action) => {
      const game = stateRef.current.game;
      if (!game) return;
      const { player: _player, ...rest } = action;
      void _player;
      const id = `c-${++counter.current}`;
      dispatch({ t: "sent", id });
      send({ type: "intent", clientActionId: id, seq: game.seq, action: rest as ClientAction });
    },
    dismiss: () => dispatch({ t: "dismiss" }),
  };
}
