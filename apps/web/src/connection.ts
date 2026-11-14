/**
 * The tab's connection to the game server: one socket at a time, rejoin with
 * backoff after a drop, the tab's own seat (`sessionStorage`) and the
 * browser's saved seats (`localStorage`, savedSeats.ts). No React and no
 * browser globals: the socket, timers and storage are passed in, so it can be
 * tested (connection.test.ts). `useGame.ts` wraps it for the UI.
 */
import { PROTOCOL_VERSION } from "../../../packages/server/src/protocol";
import type { ClientMessage, ServerMessage } from "../../../packages/server/src/protocol";
import { loadSavedSeats, removeSeat, saveSeat } from "./savedSeats";
import type { RejoinTarget, SavedSeat, StorageLike } from "./savedSeats";
import type { ClientState, Connection, Session } from "./store";

/** What the connection asks the state reducer to do. */
export type Step =
  | { t: "server"; msg: ServerMessage }
  | { t: "connection"; c: Connection }
  | { t: "sent"; id: string }
  | { t: "reset"; notice: string | null }
  | { t: "dismiss" };

/** The parts of a browser `WebSocket` used here. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

/** `WebSocket.OPEN`. */
export const SOCKET_OPEN = 1;

/** The tab's own seat, kept so a refresh rejoins it. */
export interface SessionStore {
  load(): Session | null;
  save(session: Session | null): void;
}

export interface ConnectionDeps {
  url: () => string;
  createSocket: (url: string) => SocketLike;
  setTimer: (run: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  now: () => number;
  session: SessionStore;
  /** The browser's saved seats (`localStorage`), or `null` when storage is unavailable. */
  seats: StorageLike | null;
  dispatch: (step: Step) => void;
  getState: () => ClientState;
  /** The saved seats changed (to update the start screen's offers). */
  savedChanged: (seats: SavedSeat[]) => void;
}

/** The most a rejoin waits after a drop, doubling from 0.5 s. */
export const MAX_RETRY_MS = 5_000;

/** Errors after which the tab's seat is gone for good: forget it, do not retry. */
const SEAT_GONE = new Set(["kicked", "room-closed"]);

export class GameConnection {
  private socket: SocketLike | null = null;
  private timer: number | null = null;
  private attempts = 0;
  /** No more automatic rejoins (left, removed, replaced, refused, or disposed). */
  private stopped = false;
  /** The `rejoin` in flight on the current socket, until its `welcome` (or refusal). */
  private rejoining: RejoinTarget | null = null;

  constructor(private readonly deps: ConnectionDeps) {}

  savedSeats(): SavedSeat[] {
    return this.deps.seats ? loadSavedSeats(this.deps.seats, this.deps.now()) : [];
  }

  /** On page load: rejoin the tab's own seat, if it has one. */
  resume(): void {
    const session = this.deps.session.load();
    if (session) this.rejoin(session);
  }

  rejoin(target: RejoinTarget): void {
    this.open({
      type: "rejoin",
      v: PROTOCOL_VERSION,
      code: target.code,
      seatToken: target.seatToken,
    });
  }

  /** Opens a new socket (closing any other) and sends `first` on it. */
  open(first: ClientMessage): void {
    this.cancelRetry();
    this.dropSocket();
    this.stopped = false;
    this.deps.dispatch({ t: "connection", c: "connecting" });
    this.rejoining =
      first.type === "rejoin" ? { code: first.code, seatToken: first.seatToken } : null;
    const ws = this.deps.createSocket(this.deps.url());
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.attempts = 0;
      this.deps.dispatch({ t: "connection", c: "open" });
      ws.send(JSON.stringify(first));
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return; // an older socket
      this.socket = null;
      this.deps.dispatch({ t: "connection", c: "closed" });
      this.scheduleRejoin();
    };
  }

  /** Sends if the socket is open; returns whether it was sent. */
  send(msg: ClientMessage): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== SOCKET_OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * The player leaves the room. Sent if the socket is open (the server's
   * `left` reply then clears the seat). While reconnecting it cannot be sent:
   * the pending rejoin is cancelled and the tab forgets the seat at once, so
   * nothing reopens it; the server then treats the seat as disconnected (its
   * usual grace rules apply).
   */
  leave(): void {
    this.stopped = true;
    this.cancelRetry();
    if (this.send({ type: "leave" })) return;
    this.forgetSeat(this.deps.getState().session ?? this.deps.session.load());
    this.dropSocket();
    this.deps.dispatch({ t: "connection", c: "idle" });
    this.deps.dispatch({ t: "reset", notice: null });
  }

  /** The page is going away: stop everything. */
  dispose(): void {
    this.stopped = true;
    this.cancelRetry();
    this.dropSocket();
  }

  // ---------------------------------------------------------------------------

  private onMessage(msg: ServerMessage): void {
    const { deps } = this;
    if (msg.type === "error") {
      const tried = this.rejoining;
      if (SEAT_GONE.has(msg.code)) {
        // Removed from the room, or the room was closed after a server error.
        this.stopped = true;
        this.forgetSeat(deps.getState().session ?? tried);
      } else if (msg.code === "bad-token" || msg.code === "room-not-found") {
        // The saved seat is gone (room deleted or seat freed): start over, and
        // stop offering it (the whole room, when the room is gone).
        this.stopped = true;
        deps.session.save(null);
        if (tried && deps.seats) {
          const token = msg.code === "bad-token" ? tried.seatToken : null;
          deps.savedChanged(removeSeat(deps.seats, tried.code, token, deps.now()));
        }
        this.rejoining = null;
        deps.dispatch({ t: "reset", notice: msg.message });
        return;
      } else if (msg.code === "replaced") {
        // The seat was opened in another tab or on another device. Let it go:
        // no retry, and a refresh will not take it back by itself (the saved
        // seat stays offered on the start screen).
        this.stopped = true;
        deps.session.save(null);
        deps.savedChanged(this.savedSeats());
      } else if (tried && msg.code === "server-error") {
        // A passing server problem: try the rejoin again, with backoff.
        this.dropSocket();
        deps.dispatch({ t: "connection", c: "closed" });
        this.scheduleRejoin(tried);
        return;
      } else if (tried) {
        // Any other refusal of a rejoin (for example `unsupported-version`)
        // means this socket has no seat: back to the start screen with the
        // message instead of a table that does nothing. The tab's seat is
        // kept, so a reload (a new version of the page) can rejoin it.
        this.stopped = true;
        this.rejoining = null;
        deps.dispatch({ t: "reset", notice: msg.message });
        return;
      }
    }
    if (msg.type === "welcome") {
      this.rejoining = null;
      deps.session.save({ code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken });
      const name = msg.room.seats.find((s) => s.seat === msg.seat)?.name ?? msg.seat;
      if (deps.seats) {
        deps.savedChanged(
          saveSeat(
            deps.seats,
            { code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken, name },
            deps.now(),
          ),
        );
      }
    }
    if (msg.type === "left") {
      this.stopped = true;
      this.forgetSeat(deps.getState().session);
    }
    deps.dispatch({ t: "server", msg });
  }

  /** After a drop: rejoin the tab's seat (or the rejoin that was tried) with backoff. */
  private scheduleRejoin(target?: RejoinTarget): void {
    const session = target ?? this.deps.getState().session ?? this.deps.session.load();
    if (!session || this.stopped) return;
    const delay = Math.min(MAX_RETRY_MS, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.cancelRetry();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.stopped) return;
      this.rejoin(session);
    }, delay);
  }

  private cancelRetry(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Closes the current socket without its close counting as a drop. */
  private dropSocket(): void {
    const ws = this.socket;
    this.socket = null;
    ws?.close();
  }

  /** Forgets a seat everywhere: the tab's own and the browser's saved seats. */
  private forgetSeat(seat: RejoinTarget | null | undefined): void {
    const { deps } = this;
    deps.session.save(null);
    if (seat && deps.seats) {
      deps.savedChanged(removeSeat(deps.seats, seat.code, seat.seatToken, deps.now()));
    }
  }
}
