/**
 * The tab's connection (connection.ts) with a fake socket, timers and storage:
 * rejoin with backoff, the saved seats, each refusal, and leaving. Review P3:
 * `leave` while reconnecting used to be lost (the retry reopened the socket),
 * and a rejoin refused for another reason (e.g. `unsupported-version`) left a
 * table that did nothing.
 */
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION as V } from "../../../packages/server/src/protocol";
import type { RoomInfo, ServerMessage } from "../../../packages/server/src/protocol";
import { GameConnection, MAX_RETRY_MS, SOCKET_OPEN } from "./connection";
import type { SocketLike, Step } from "./connection";
import { loadSavedSeats, saveSeat } from "./savedSeats";
import type { SavedSeat, StorageLike } from "./savedSeats";
import { initialState } from "./store";
import type { ClientState, Session } from "./store";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
    this.onclose?.();
  }
  // What the server does:
  accept() {
    this.readyState = SOCKET_OPEN;
    this.onopen?.();
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

class MemoryStorage implements StorageLike {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const ROOM = "KTBM";
const room = (seat = "p1", name = "Ann"): RoomInfo => ({
  code: ROOM,
  status: "playing",
  host: "p1",
  seats: [{ seat, name, connected: true, away: false, removed: false, awayInMs: null }],
  minPlayers: 2,
  maxPlayers: 4,
  timers: { turnTimeoutMs: 90_000, reconnectGraceMs: 60_000, reconnectBudgetMs: 120_000 },
  rev: 1,
});
const welcome = (token = "tok-1"): ServerMessage => ({
  type: "welcome",
  v: V,
  seat: "p1",
  seatToken: token,
  contentHash: "h",
  room: room(),
  game: null,
});
const error = (code: string, message = code): ServerMessage =>
  ({ type: "error", code, message }) as ServerMessage;

function setup(session: Session | null = null) {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  let stored = session;
  const seats = new MemoryStorage();
  const steps: Step[] = [];
  let state: ClientState = { ...initialState, session };
  let saved: SavedSeat[] = [];
  const conn = new GameConnection({
    url: () => "ws://test:8787",
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimer: (run, ms) => {
      timers.set(nextTimer, { run, ms });
      return nextTimer++;
    },
    clearTimer: (id) => void timers.delete(id),
    now: () => 1_000,
    session: { load: () => stored, save: (s) => void (stored = s) },
    seats,
    dispatch: (step) => {
      steps.push(step);
      // Just enough of the reducer: the session follows welcome / reset / left.
      if (step.t === "server" && step.msg.type === "welcome") {
        state = {
          ...state,
          session: { code: step.msg.room.code, seat: step.msg.seat, seatToken: step.msg.seatToken },
        };
      }
      if (step.t === "reset" || (step.t === "server" && step.msg.type === "left")) {
        state = { ...state, session: null };
      }
    },
    getState: () => state,
    savedChanged: (s) => void (saved = s),
  });
  const h = {
    conn,
    sockets,
    timers,
    seats,
    steps,
    stored: () => stored,
    saved: () => saved,
    last: () => sockets[sockets.length - 1]!,
    /** Runs the one pending timer, returning its delay. */
    fire: () => {
      const [id, t] = [...timers.entries()][0] ?? [];
      if (id === undefined || !t) throw new Error("no timer pending");
      timers.delete(id);
      t.run();
      return t.ms;
    },
    resets: () => steps.filter((s): s is Extract<Step, { t: "reset" }> => s.t === "reset"),
  };
  return h;
}

const SESSION: Session = { code: ROOM, seat: "p1", seatToken: "tok-1" };
const rejoinMsg = { type: "rejoin", v: V, code: ROOM, seatToken: "tok-1" };

describe("opening and resuming", () => {
  it("resume rejoins the tab's own seat; without one it does nothing", () => {
    const none = setup();
    none.conn.resume();
    expect(none.sockets).toHaveLength(0);
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    expect(h.last().sent).toEqual([rejoinMsg]);
  });

  it("welcome saves the tab's seat and the browser's saved seat", () => {
    const h = setup();
    h.conn.open({ type: "create", v: V, name: "Ann" });
    h.last().accept();
    h.last().receive(welcome());
    expect(h.stored()).toEqual(SESSION);
    expect(loadSavedSeats(h.seats, 1_000).map((s) => [s.code, s.seatToken, s.name])).toEqual([
      [ROOM, "tok-1", "Ann"],
    ]);
  });

  it("send only goes out on an open socket", () => {
    const h = setup();
    expect(h.conn.send({ type: "sync" })).toBe(false);
    h.conn.open({ type: "create", v: V, name: "Ann" });
    expect(h.conn.send({ type: "sync" })).toBe(false);
    h.last().accept();
    expect(h.conn.send({ type: "sync" })).toBe(true);
  });
});

describe("after a drop", () => {
  it("rejoins with backoff (0.5 s doubling, at most 5 s), reset once a socket opens", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(welcome());
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      h.last().drop();
      delays.push(h.fire());
      expect(h.last().url).toBe("ws://test:8787");
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, MAX_RETRY_MS, MAX_RETRY_MS]);
    h.last().accept();
    h.last().drop();
    expect(h.fire()).toBe(500);
    expect(h.last().sent).toEqual([]);
    h.last().accept();
    expect(h.last().sent).toEqual([rejoinMsg]);
  });

  it("a socket closed by the tab itself (a new open) is not a drop", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.conn.open({ type: "create", v: V, name: "Bob" });
    expect(h.sockets[0]!.closedByClient).toBe(true);
    expect(h.timers.size).toBe(0);
  });
});

describe("refusals", () => {
  it("bad-token: back to the start screen, the seat forgotten, no retry", () => {
    const h = setup(SESSION);
    saveSeat(h.seats, { code: ROOM, seat: "p1", seatToken: "tok-1", name: "Ann" }, 1_000);
    h.conn.resume();
    h.last().accept();
    h.last().receive(error("bad-token", "that seat token is not valid here"));
    expect(h.resets()).toEqual([{ t: "reset", notice: "that seat token is not valid here" }]);
    expect(h.stored()).toBeNull();
    expect(loadSavedSeats(h.seats, 1_000)).toEqual([]);
    h.last().drop();
    expect(h.timers.size).toBe(0);
  });

  it("room-not-found forgets every saved seat of that room", () => {
    const h = setup(SESSION);
    saveSeat(h.seats, { code: ROOM, seat: "p1", seatToken: "tok-1", name: "Ann" }, 1_000);
    saveSeat(h.seats, { code: ROOM, seat: "p2", seatToken: "tok-2", name: "Bob" }, 1_000);
    saveSeat(h.seats, { code: "BCDF", seat: "p1", seatToken: "tok-3", name: "Cy" }, 1_000);
    h.conn.resume();
    h.last().accept();
    h.last().receive(error("room-not-found"));
    expect(loadSavedSeats(h.seats, 1_000).map((s) => s.code)).toEqual(["BCDF"]);
  });

  it("another refusal of a rejoin (unsupported-version): start screen with the message, seat kept for a reload", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(error("unsupported-version", "reload the page"));
    expect(h.resets()).toEqual([{ t: "reset", notice: "reload the page" }]);
    expect(h.stored()).toEqual(SESSION);
    h.last().drop();
    expect(h.timers.size).toBe(0);
  });

  it("server-error on a rejoin is passing: it retries with backoff", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(error("server-error"));
    expect(h.resets()).toEqual([]);
    expect(h.fire()).toBe(500);
    h.last().accept();
    expect(h.last().sent).toEqual([rejoinMsg]);
  });

  it("an error after the welcome (e.g. a refused start) changes nothing about the seat", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(welcome());
    h.last().receive(error("not-host"));
    expect(h.resets()).toEqual([]);
    expect(h.stored()).toEqual(SESSION);
  });

  it("kicked or room-closed: the seat is forgotten and nothing retries", () => {
    for (const code of ["kicked", "room-closed"]) {
      const h = setup(SESSION);
      saveSeat(h.seats, { code: ROOM, seat: "p1", seatToken: "tok-1", name: "Ann" }, 1_000);
      h.conn.resume();
      h.last().accept();
      h.last().receive(welcome());
      h.last().receive(error(code));
      expect(h.stored()).toBeNull();
      expect(loadSavedSeats(h.seats, 1_000)).toEqual([]);
      h.last().drop();
      expect(h.timers.size).toBe(0);
    }
  });

  it("replaced: let the seat go (no retry), but keep offering it", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(welcome());
    h.last().receive(error("replaced"));
    h.last().drop();
    expect(h.timers.size).toBe(0);
    expect(h.stored()).toBeNull();
    expect(h.saved().map((s) => s.seatToken)).toEqual(["tok-1"]);
  });
});

describe("leaving", () => {
  it("on an open socket: sends leave; the reply forgets the seat; no retry after", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(welcome());
    h.conn.leave();
    expect(h.last().sent.at(-1)).toEqual({ type: "leave" });
    h.last().receive({ type: "left" });
    expect(h.stored()).toBeNull();
    expect(loadSavedSeats(h.seats, 1_000)).toEqual([]);
    h.last().drop();
    expect(h.timers.size).toBe(0);
  });

  it("while reconnecting: the pending rejoin is cancelled and nothing reopens the seat", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().receive(welcome());
    h.last().drop();
    expect(h.timers.size).toBe(1);
    h.conn.leave();
    expect(h.timers.size).toBe(0);
    expect(h.sockets).toHaveLength(1);
    expect(h.stored()).toBeNull();
    expect(loadSavedSeats(h.seats, 1_000)).toEqual([]);
    expect(h.resets()).toEqual([{ t: "reset", notice: null }]);
    // A refresh would not rejoin either.
    h.conn.resume();
    expect(h.sockets).toHaveLength(1);
  });

  it("while a rejoin socket is still connecting: it is closed and not retried", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.conn.leave();
    expect(h.sockets[0]!.closedByClient).toBe(true);
    expect(h.timers.size).toBe(0);
    expect(h.stored()).toBeNull();
  });
});

describe("dispose", () => {
  it("stops the retry and closes the socket", () => {
    const h = setup(SESSION);
    h.conn.resume();
    h.last().accept();
    h.last().drop();
    h.conn.dispose();
    expect(h.timers.size).toBe(0);
  });
});
