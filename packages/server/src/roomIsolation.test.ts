/**
 * Review P2-4: rooms are independent. An intent or a timer in one room never
 * touches another, and one room that throws (a bug) neither stops `tick` for
 * the others nor leaves the sender's buttons waiting (docs/protocol.md §5, §9;
 * notes log "Server errors: one room cannot stop the others").
 *
 * Rooms are made to throw with a stubbed engine (`CoreDeps.engine`, test only):
 * the engine itself is not changed. Room A has 2 players, room B has 3; the
 * stub throws only for 3-player games.
 */
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "@fishingjamboree/engine";
import { DEFAULT_CONFIG } from "./core";
import type { CoreDeps } from "./core";
import { harness, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

const TURN = DEFAULT_CONFIG.turnTimeoutMs!;

/** A switchable fault: while `on`, the engine throws for 3-player games. */
function faulty() {
  const fault = { on: false, calls: 0 };
  const engine: CoreDeps["engine"] = {
    applyAction: (content, state, action) => {
      if (fault.on && state.players.length === 3) {
        fault.calls += 1;
        throw new Error("boom: stubbed engine failure");
      }
      return applyAction(content, state, action);
    },
    createGame: (content, setup) => {
      if (fault.on && setup.players.length === 3) throw new Error("boom: createGame");
      return createGame(content, setup);
    },
  };
  const lines: string[] = [];
  return { fault, engine, lines, log: (line: string) => lines.push(line) };
}

/** Room A: connections a1, a2. Room B: b1, b2, b3. Both lobbies, inboxes emptied. */
function twoLobbies(h: Harness) {
  h.send("a1", { type: "create", v: V, name: "Ann" });
  const a = h.last("a1", "welcome").room.code;
  h.send("a2", { type: "join", v: V, code: a, name: "Abe" });
  h.send("b1", { type: "create", v: V, name: "Bea" });
  const b = h.last("b1", "welcome").room.code;
  h.send("b2", { type: "join", v: V, code: b, name: "Bob" });
  h.send("b3", { type: "join", v: V, code: b, name: "Bo" });
  expect(a).not.toBe(b);
  h.clear();
  return { a, b };
}

const A = ["a1", "a2"];
const B = ["b1", "b2", "b3"];

/** The deciding seat in the room watched by `conns[0]` plays its first legal action. */
function act(h: Harness, conns: string[]) {
  const seat = h.actor(conns[0]!)!;
  const conn = conns[Number(seat.slice(1)) - 1]!;
  h.intent(conn, strip(h.legal(conn, seat)[0]!));
}

const nothingFor = (h: Harness, conns: string[]) => {
  for (const c of conns) expect(h.take(c)).toEqual([]);
};

describe("two rooms at once", () => {
  it("an intent in one room sends nothing to the other and leaves its game alone", () => {
    const h = harness();
    const { a, b } = twoLobbies(h);
    h.send("a1", { type: "start" });
    h.send("b1", { type: "start" });
    h.clear();
    const bSeq = h.view("b1").actionCount;
    const bRev = h.room(b).rev;
    for (let i = 0; i < 10; i += 1) act(h, A);
    expect(h.view("a1").actionCount).toBe(10);
    nothingFor(h, B);
    expect(h.view("b1").actionCount).toBe(bSeq);
    expect(h.room(b).rev).toBe(bRev);
    expect(h.core.replayLog(b)!.actions).toEqual([]);
    expect(h.core.replayLog(a)!.actions).toHaveLength(10);
  });

  it("a turn timer in one room misses that room's turn only", () => {
    const h = harness();
    const { a, b } = twoLobbies(h);
    h.send("a1", { type: "start" });
    h.advance(TURN / 2);
    h.send("b1", { type: "start" });
    h.clear();
    h.advance(TURN / 2);
    expect(h.last("a1", "update").events.map((e) => e.type)).toContain("turnMissed");
    nothingFor(h, B);
    expect(h.core.replayLog(b)!.actions).toEqual([]);
    h.clear();
    h.advance(TURN / 2);
    expect(h.last("b1", "update").events.map((e) => e.type)).toContain("turnMissed");
    nothingFor(h, A);
    expect(h.core.replayLog(a)!.actions).toHaveLength(1);
  });
});

describe("a room that throws in tick", () => {
  it("is closed and its players told; the other room gets its update on the same tick and later", () => {
    const f = faulty();
    const h = harness({}, [], { engine: f.engine, log: f.log });
    const { a, b } = twoLobbies(h);
    h.send("b1", { type: "start" });
    h.send("a1", { type: "start" });
    h.clear();
    f.fault.on = true;
    // Both turn timers run out on this tick; B's `missTurn` throws.
    h.advance(TURN);
    expect(h.last("a1", "update").events.map((e) => e.type)).toContain("turnMissed");
    expect(h.last("a2", "update").events.map((e) => e.type)).toContain("turnMissed");
    for (const c of B) {
      const got = h.take(c);
      // Nothing half-built from the failed step, only the notice.
      expect(got.map((m) => m.type)).toEqual(["error"]);
      expect(got[0]).toMatchObject({ type: "error", code: "room-closed" });
    }
    expect(h.core.roomCodes()).toEqual([a]);
    expect(f.lines.some((l) => l.includes(`room ${b}`) && l.includes("boom"))).toBe(true);
    // No tight loop: the next deadline is room A's next turn, not "now".
    expect(f.fault.calls).toBe(1);
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
    // B's players have no seat any more; their token no longer works.
    h.send("b1", { type: "sync" });
    expect(h.last("b1", "error").code).toBe("not-seated");
    // Later ticks keep serving room A.
    h.clear();
    h.advance(TURN);
    expect(h.last("a1", "update").events.map((e) => e.type)).toContain("turnMissed");
    expect(f.fault.calls).toBe(1);
    expect(h.core.replayLog(a)!.actions).toHaveLength(2);
  });

  it("keeps what reproduces the bug: the replay log is logged, the room is marked broken, not removed (review P2-5)", () => {
    const f = faulty();
    const h = harness({}, [], { engine: f.engine, log: f.log });
    const { a, b } = twoLobbies(h);
    h.send("b1", { type: "start" });
    h.clear();
    for (let i = 0; i < 4; i += 1) act(h, B);
    const log = h.core.replayLog(b)!;
    h.core.takeChanges();
    f.fault.on = true;
    h.advance(TURN);
    expect(h.core.roomCodes()).toEqual([a]);
    const line = f.lines.find((l) => l.startsWith(`room ${b}: replay log: `))!;
    expect(JSON.parse(line.slice(`room ${b}: replay log: `.length))).toEqual(log);
    // The log line has the seed and the actions, and no seat token.
    expect(line).not.toMatch(/"token"|seatToken/);
    const changes = h.core.takeChanges();
    expect(changes.remove).not.toContain(b);
    expect(changes.save.map((x) => x.code)).not.toContain(b);
    expect(changes.broken).toHaveLength(1);
    expect(changes.broken[0]!.code).toBe(b);
    expect(changes.broken[0]!.snapshot!.game!.log).toEqual(log);
    // Reported once.
    expect(h.core.takeChanges().broken).toEqual([]);
  });

  it("after a room is closed, players in the other room keep playing", () => {
    const f = faulty();
    const h = harness({}, [], { engine: f.engine, log: f.log });
    const { a } = twoLobbies(h);
    h.send("b1", { type: "start" });
    h.send("a1", { type: "start" });
    h.clear();
    f.fault.on = true;
    h.advance(TURN);
    h.clear();
    for (let i = 0; i < 5; i += 1) act(h, A);
    expect(h.core.replayLog(a)!.actions).toHaveLength(6);
    expect(h.core.roomCodes()).toEqual([a]);
  });
});

describe("handleMessage throwing", () => {
  it("answers the sender with server-error; nobody else is sent anything; the room stays", () => {
    const f = faulty();
    const h = harness({}, [], { engine: f.engine, log: f.log });
    const { a, b } = twoLobbies(h);
    h.send("a1", { type: "start" });
    h.send("b1", { type: "start" });
    h.clear();
    const seat = h.actor("b1")!;
    const conn = B[Number(seat.slice(1)) - 1]!;
    const action = strip(h.legal(conn, seat)[0]!);
    f.fault.on = true;
    h.intent(conn, action);
    expect(h.take(conn)).toEqual([
      { type: "error", code: "server-error", message: expect.any(String) },
    ]);
    nothingFor(
      h,
      B.filter((c) => c !== conn),
    );
    nothingFor(h, A);
    expect(f.lines.some((l) => l.includes(conn) && l.includes(b) && l.includes("boom"))).toBe(true);
    expect(h.core.roomCodes().sort()).toEqual([a, b].sort());
    // Once the fault is gone, the same choice is accepted.
    f.fault.on = false;
    h.intent(conn, action);
    expect(h.last(conn, "update").seq).toBe(1);
    expect(h.core.replayLog(b)!.actions).toHaveLength(1);
  });

  it("a failed start leaves the lobby as it was, and it can start later", () => {
    const f = faulty();
    const h = harness({}, [], { engine: f.engine, log: f.log });
    const { b } = twoLobbies(h);
    f.fault.on = true;
    h.send("b1", { type: "start" });
    expect(h.take("b1")).toEqual([
      { type: "error", code: "server-error", message: expect.any(String) },
    ]);
    nothingFor(h, ["b2", "b3"]);
    expect(h.room(b).status).toBe("lobby");
    f.fault.on = false;
    h.send("b1", { type: "start" });
    expect(h.room(b).status).toBe("playing");
  });
});
