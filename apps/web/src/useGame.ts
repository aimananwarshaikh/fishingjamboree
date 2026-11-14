/** Connects the socket to the store: one hook that gives the UI state and commands. */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Action } from "@fishingjamboree/engine";
import { PROTOCOL_VERSION } from "../../../packages/server/src/protocol";
import type { ClientAction, ClientMessage, SeatId } from "../../../packages/server/src/protocol";
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
import type { ClientState, Context, Session } from "./store";
import { GameConnection } from "./connection";
import type { SocketLike, Step } from "./connection";
import { loadSavedSeats, parseRejoinFragment } from "./savedSeats";
import type { RejoinTarget, SavedSeat, StorageLike } from "./savedSeats";
import { parseAllowList, resolveServerUrl } from "./serverUrl";

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

/** The game server: `?server=` only in a dev build or for an allowed server (serverUrl.ts). */
export function serverUrl(): string {
  const resolved = resolveServerUrl(window.location, {
    dev: import.meta.env.DEV,
    allowed: parseAllowList(import.meta.env.VITE_ALLOWED_SERVERS as string | undefined),
  });
  if (resolved.ignored) console.warn(resolved.ignored);
  return resolved.url;
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

  const stateRef = useRef(state);
  stateRef.current = state;
  const counter = useRef(0);
  const [saved, setSaved] = useState<SavedSeat[]>(savedSeats);
  const [link, setLink] = useState<RejoinTarget | null>(linkInAddress);

  // One connection for the life of the page (connection.ts holds the logic).
  const connection = useMemo(
    () =>
      new GameConnection({
        url: serverUrl,
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        setTimer: (run, ms) => window.setTimeout(run, ms),
        clearTimer: (id) => window.clearTimeout(id),
        now: () => Date.now(),
        session: { load: loadSession, save: saveSession },
        seats: shared(),
        dispatch,
        getState: () => stateRef.current,
        savedChanged: setSaved,
      }),
    [],
  );

  // Pick up this tab's seat when the page loads (a refresh keeps the player's
  // seat). A rejoin link in the address wins: it is only offered, not followed.
  useEffect(() => {
    if (!linkInAddress()) connection.resume();
    return () => connection.dispose();
  }, [connection]);

  const send = useCallback((msg: ClientMessage) => connection.send(msg), [connection]);

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
      connection.rejoin(offer);
    },
    [connection, link],
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
    create: (name: string) => connection.open({ type: "create", v: PROTOCOL_VERSION, name }),
    join: (code: string, name: string) =>
      connection.open({ type: "join", v: PROTOCOL_VERSION, code, name }),
    start: () => send({ type: "start" }),
    /** Host only: removes a player from the room (for good, in a game). */
    kick: (seat: SeatId) => send({ type: "kick", seat }),
    leave: () => connection.leave(),
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
