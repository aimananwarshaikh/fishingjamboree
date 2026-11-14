/** Connects the socket to the store: one hook that gives the UI state and commands. */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Action } from "@fishingjamboree/engine";
import { PROTOCOL_VERSION } from "../../../packages/server/src/protocol";
import type {
  ClientAction,
  ClientMessage,
  SeatId,
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
import { loadSavedSeats, parseRejoinFragment, removeSeat, saveSeat } from "./savedSeats";
import type { RejoinTarget, SavedSeat, StorageLike } from "./savedSeats";

type Step =
  | { t: "server"; msg: ServerMessage }
  | { t: "connection"; c: Connection }
  | { t: "sent"; id: string }
  | { t: "reset"; notice: string | null }
  | { t: "dismiss" };

const STORAGE_KEY = "fishingjamboree.session";

// sessionStorage, not localStorage: every tab is its own player, so two tabs of
// one browser can sit at the same table. A refresh rejoins from here by itself.
// Seats are also kept in localStorage (savedSeats.ts), but only offered on the
// start screen, never rejoined without a click.
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

function shared(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const savedSeats = (): SavedSeat[] => {
  const s = shared();
  return s ? loadSavedSeats(s, Date.now()) : [];
};

/** A rejoin link the page was opened with (`#rejoin=CODE.TOKEN`), if any. */
function linkInAddress(): RejoinTarget | null {
  return parseRejoinFragment(window.location.hash);
}
/** Takes the seat token out of the address bar (and so out of history and bookmarks). */
function clearLinkFromAddress() {
  if (!window.location.hash) return;
  try {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  } catch {
    window.location.hash = "";
  }
}

/** A seat the start screen can offer to rejoin. */
export interface RejoinOffer {
  code: string;
  seatToken: string;
  /** The player's name, when this browser has seen it (a link alone does not carry it). */
  name: string | null;
  /** Where it came from: this browser's saved seats, or a rejoin link. */
  from: "saved" | "link";
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
    cardName: (card) => content.cards.cards[card]?.name ?? card,
    rounds: content.rules.rounds,
    now: () => Date.now(),
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
  /** The `rejoin` in flight, so a refused token can be forgotten. */
  const attempt = useRef<RejoinTarget | null>(null);
  const [saved, setSaved] = useState<SavedSeat[]>(savedSeats);
  const [link, setLink] = useState<RejoinTarget | null>(linkInAddress);

  const open = useCallback((first: ClientMessage) => {
    socket.current?.close();
    retry.current.stop = false;
    dispatch({ t: "connection", c: "connecting" });
    attempt.current =
      first.type === "rejoin" ? { code: first.code, seatToken: first.seatToken } : null;
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
        if (msg.code === "kicked" || msg.code === "room-closed") {
          // Removed from the room, or the room was closed after a server
          // error: the seat is gone for good. Forget it and do not retry.
          saveSession(null);
          const store = shared();
          const s = stateRef.current.session ?? attempt.current;
          if (s && store) setSaved(removeSeat(store, s.code, s.seatToken, Date.now()));
          retry.current.stop = true;
        }
        if (msg.code === "bad-token" || msg.code === "room-not-found") {
          // The saved seat is gone (room deleted or seat freed): start over,
          // and stop offering it.
          saveSession(null);
          const tried = attempt.current;
          const store = shared();
          if (tried && store)
            setSaved(
              removeSeat(
                store,
                tried.code,
                msg.code === "bad-token" ? tried.seatToken : null,
                Date.now(),
              ),
            );
          retry.current.stop = true;
          dispatch({ t: "reset", notice: msg.message });
          return;
        }
        if (msg.code === "replaced") {
          // The seat was opened in another tab or on another device. Let it go:
          // no retry, and a refresh of this tab will not take it back by itself
          // (the saved seat stays offered on the start screen).
          retry.current.stop = true;
          saveSession(null);
          setSaved(savedSeats());
        }
      }
      if (msg.type === "welcome") {
        saveSession({ code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken });
        const name = msg.room.seats.find((s) => s.seat === msg.seat)?.name ?? msg.seat;
        const store = shared();
        if (store)
          setSaved(
            saveSeat(
              store,
              { code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken, name },
              Date.now(),
            ),
          );
      }
      if (msg.type === "left") {
        const session = stateRef.current.session;
        const store = shared();
        if (session && store)
          setSaved(removeSeat(store, session.code, session.seatToken, Date.now()));
        saveSession(null);
      }
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

  // Pick up this tab's seat when the page loads (a refresh keeps the player's
  // seat). A rejoin link in the address wins: it is only offered, not followed.
  useEffect(() => {
    const session = linkInAddress() ? null : loadSession();
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

  const rejoin = useCallback(
    (offer: RejoinTarget) => {
      if (offer.code === link?.code && offer.seatToken === link.seatToken) {
        clearLinkFromAddress();
        setLink(null);
      }
      open({ type: "rejoin", v: PROTOCOL_VERSION, code: offer.code, seatToken: offer.seatToken });
    },
    [open, link],
  );

  // Offered on the start screen only: a link first, then saved seats, newest
  // first. Nothing is offered while this tab is rejoining its own seat.
  const offers: RejoinOffer[] = [];
  if (link) {
    const known = saved.find((s) => s.code === link.code && s.seatToken === link.seatToken);
    offers.push({ ...link, name: known?.name ?? null, from: "link" });
  }
  if (!state.session && !loadSession()) {
    for (const s of saved)
      if (!offers.some((o) => o.seatToken === s.seatToken))
        offers.push({ code: s.code, seatToken: s.seatToken, name: s.name, from: "saved" });
  }

  return {
    state,
    offers,
    rejoin,
    create: (name: string) => open({ type: "create", v: PROTOCOL_VERSION, name }),
    join: (code: string, name: string) => open({ type: "join", v: PROTOCOL_VERSION, code, name }),
    start: () => send({ type: "start" }),
    /** Host only: removes a player from the room (for good, in a game). */
    kick: (seat: SeatId) => send({ type: "kick", seat }),
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
