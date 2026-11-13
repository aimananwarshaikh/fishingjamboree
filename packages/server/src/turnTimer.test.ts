/**
 * Review P1-2: a connected player who does not act cannot stall a game (turn
 * timer), and a flaky connection cannot restart the reconnect grace for ever
 * (grace budget). docs/protocol.md §7.
 */
import { describe, expect, it } from "vitest";
import { redactForClient, replay } from "@fishingjamboree/engine";
import { DEFAULT_CONFIG } from "./core";
import { connOf, content, harness, SEED, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

const TURN = DEFAULT_CONFIG.turnTimeoutMs!;
const GRACE = DEFAULT_CONFIG.reconnectGraceMs;
const BUDGET = DEFAULT_CONFIG.reconnectBudgetMs;
const DELAY = DEFAULT_CONFIG.autoActionDelayMs;
const LOBBY_GRACE = DEFAULT_CONFIG.lobbyGraceMs;

const seatIndex = (seat: string) => Number(seat.slice(1)) - 1;

/** The deciding seat plays its first legal action over its own connection. */
function act(h: Harness, watcher = "c1") {
  const seat = h.actor(watcher)!;
  h.intent(connOf(seat), strip(h.legal(connOf(seat), seat)[0]!));
}

/** A seat that is not deciding now. */
function bystander(h: Harness, n: number): string {
  const actor = h.actor("c1");
  for (let i = 1; i <= n; i += 1) if (`p${i}` !== actor) return `p${i}`;
  throw new Error("no bystander");
}

describe("the defaults", () => {
  it("bound a decision to about a minute, below the 90 s the review measured", () => {
    expect(TURN).toBeGreaterThan(0);
    expect(TURN).toBeLessThan(90_000);
    expect(GRACE).toBeLessThanOrEqual(BUDGET);
  });
});

describe("turn timer", () => {
  it("plays once for a connected player who does not act, and they stay present", () => {
    const h = harness();
    const { code } = h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
    h.advance(TURN - 1);
    expect(h.got(watcher, "update")).toHaveLength(0);
    h.advance(1);
    expect(h.got(watcher, "update")).toEqual([
      expect.objectContaining({ seq: 1, by: seat, auto: true }),
    ]);
    // Still connected, not away, and nobody was told about the room.
    expect(h.room(code).seats[seatIndex(seat)]).toMatchObject({ connected: true, away: false });
    expect(h.got(watcher, "room")).toHaveLength(0);
    // The next decision gets a fresh timer, not the short away delay.
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
    h.advance(DELAY);
    expect(h.view(watcher).actionCount).toBe(1);
    // The player can act again as usual.
    act(h, watcher);
    expect(h.last(watcher, "update")).toMatchObject({ seq: 2, by: seat, auto: false });
  });

  it("starts again on every action", () => {
    const h = harness();
    h.started(3);
    h.advance(TURN - 1_000);
    act(h);
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
    h.clear();
    h.advance(TURN - 1);
    expect(h.got("c1", "update")).toHaveLength(0);
    h.advance(1);
    expect(h.last("c1", "update")).toMatchObject({ seq: 2, auto: true });
  });

  it("tells clients how long the deciding player has left", () => {
    const h = harness();
    const { code, tokens } = h.lobby(3);
    expect(h.last("c1", "welcome").room.timers).toEqual({
      turnTimeoutMs: TURN,
      reconnectGraceMs: GRACE,
      reconnectBudgetMs: BUDGET,
    });
    expect(h.last("c1", "welcome").game).toBeNull();
    h.send("c1", { type: "start" });
    expect(h.last("c2", "update").turnTimeLeftMs).toBe(TURN);
    h.advance(10_000);
    h.send("c2", { type: "sync" });
    expect(h.last("c2", "snapshot").game?.turnTimeLeftMs).toBe(TURN - 10_000);
    h.send("n3", { type: "rejoin", v: V, code, seatToken: tokens[2] });
    expect(h.last("n3", "welcome").game?.turnTimeLeftMs).toBe(TURN - 10_000);
    act(h);
    expect(h.last("c2", "update").turnTimeLeftMs).toBe(TURN);
  });

  it("shows no turn time while the deciding player is away, or once the game is over", () => {
    const h = harness();
    h.started(2);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.send(connOf(seat), { type: "leave" });
    h.send(watcher, { type: "sync" });
    expect(h.last(watcher, "snapshot").game?.turnTimeLeftMs).toBeNull();
    h.advance(DELAY);
    const update = h.last(watcher, "update");
    expect(update).toMatchObject({ by: seat, auto: true });
    expect(update.turnTimeLeftMs).toBe(h.actor(watcher) === seat ? null : TURN);
  });

  it("keeps running when the deciding player drops: a locked phone costs one turn time", () => {
    const h = harness();
    h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    // The heartbeat notices a locked phone up to 30 s late.
    h.advance(30_000);
    h.drop(connOf(seat));
    expect(h.core.nextDeadline()).toBe(h.now() + TURN - 30_000);
    h.clear();
    h.advance(TURN - 30_000);
    expect(h.got(watcher, "update")).toEqual([
      expect.objectContaining({ seq: 1, by: seat, auto: true }),
    ]);
    // The next decision ends with the grace (60 s from the drop), before a new turn time.
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE - (TURN - 30_000));
  });

  it("can be switched off", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code } = h.started(3);
    expect(h.core.nextDeadline()).toBeNull();
    h.advance(TURN * 10);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    expect(h.room(code).timers.turnTimeoutMs).toBeNull();
    h.send("c1", { type: "sync" });
    expect(h.last("c1", "snapshot").game?.turnTimeLeftMs).toBeNull();
  });

  it("does nothing while nobody is connected, and counts from the moment someone returns", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    h.advance(TURN - 1_000);
    for (const conn of ["c1", "c2", "c3"]) h.drop(conn);
    h.advance(TURN * 10);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(seat)] });
    expect(h.last("back", "welcome").game?.turnTimeLeftMs).toBe(TURN);
    h.advance(TURN - 1);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    h.advance(1);
    expect(h.last("back", "update")).toMatchObject({ seq: 1, by: seat, auto: true });
  });

  it("finishes a game whose other players never act; the replay matches; nothing private is sent", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    let autos = 0;
    for (let guard = 0; h.actor("c1") !== undefined; guard += 1) {
      if (guard > 5_000) throw new Error("the game did not end");
      if (h.actor("c1") === "p1") {
        act(h);
        continue;
      }
      const seq = h.view("c1").actionCount;
      h.advance(TURN);
      expect(h.last("c1", "update")).toMatchObject({ seq: seq + 1, auto: true });
      autos += 1;
    }
    expect(autos).toBeGreaterThan(20);
    expect(h.room(code).status).toBe("finished");
    expect(h.room(code).seats.every((s) => s.connected && !s.away)).toBe(true);
    expect(h.core.nextDeadline()).toBeNull();
    expect(h.last("c1", "update").turnTimeLeftMs).toBeNull();

    const replayed = replay(content, h.core.replayLog(code)!);
    for (let i = 1; i <= 3; i += 1) {
      expect(h.view(`c${i}`)).toEqual(redactForClient(replayed.state, `p${i}`));
    }
    for (const o of h.sent) {
      if (o.kind !== "send") continue;
      const json = JSON.stringify(o.message);
      expect(json).not.toContain(SEED);
      expect(json).not.toContain('"rng"');
      expect(json).not.toContain('"draw"');
      tokens.forEach((token, i) => {
        if (i !== seatIndex(`p${o.to.slice(1)}`)) expect(json).not.toContain(`"${token}"`);
      });
    }
  });
});

describe("reconnect grace budget", () => {
  it("tells everyone how long a dropped player has to come back", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code } = h.started(3);
    h.drop("c2");
    expect(h.last("c1", "room").room.seats[1]).toMatchObject({
      connected: false,
      away: false,
      awayInMs: GRACE,
    });
    h.advance(10_000);
    expect(h.room(code).seats[1]?.awayInMs).toBe(GRACE - 10_000);
    expect(h.room(code).seats[0]?.awayInMs).toBeNull();
    h.advance(GRACE);
    expect(h.last("c1", "room").room.seats[1]).toMatchObject({ away: true, awayInMs: null });
  });

  it("spends the budget over repeated drops; then a drop means away at once", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code, tokens } = h.started(3);
    const seat = bystander(h, 3);
    const watcher = seat === "p1" ? "c2" : "c1";
    const i = seatIndex(seat);
    let conn = connOf(seat);
    const bounce = (ms: number) => {
      h.drop(conn);
      h.advance(ms);
      conn = `${conn}x`;
      h.send(conn, { type: "rejoin", v: V, code, seatToken: tokens[i] });
    };
    bounce(GRACE - 10_000); // 50 s spent
    bounce(GRACE - 10_000); // 100 s spent
    expect(h.room(code).seats[i]).toMatchObject({ connected: true, away: false });

    // 20 s are left: this drop gets only those.
    h.drop(conn);
    expect(h.room(code).seats[i]?.awayInMs).toBe(BUDGET - 2 * (GRACE - 10_000));
    h.advance(BUDGET - 2 * (GRACE - 10_000) - 1);
    expect(h.room(code).seats[i]?.away).toBe(false);
    h.advance(1);
    expect(h.room(code).seats[i]?.away).toBe(true);

    // Back, then gone again: no grace is left.
    conn = `${conn}x`;
    h.send(conn, { type: "rejoin", v: V, code, seatToken: tokens[i] });
    expect(h.room(code).seats[i]).toMatchObject({ connected: true, away: false });
    h.clear();
    h.drop(conn);
    expect(h.last(watcher, "room").room.seats[i]).toMatchObject({
      connected: false,
      away: true,
      awayInMs: null,
    });
  });

  it("charges a drop no more than one grace, however late it is noticed", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code, tokens } = h.started(3);
    h.drop("c2");
    h.advance(GRACE * 5); // away after 60 s; the rest is not grace
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    h.drop("n2");
    expect(h.room(code).seats[1]?.awayInMs).toBe(BUDGET - GRACE);
  });

  it("is not spent while nobody is connected, and the room's return is capped by it", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code, tokens } = h.started(3);
    h.drop("c2");
    h.advance(GRACE - 10_000); // 50 s of p2's budget spent
    h.drop("c1");
    h.drop("c3");
    h.advance(GRACE * 20);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    // p2's grace starts again, as before, but from what is left of the budget.
    expect(h.last("back", "welcome").room.seats[1]).toMatchObject({
      away: false,
      awayInMs: GRACE,
    });
    h.advance(GRACE);
    expect(h.room(code).seats[1]?.away).toBe(true);
    // 110 s spent: a second empty-room return gives p2 only the last 10 s.
    h.drop("back");
    h.send("back2", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.room(code).seats[1]).toMatchObject({ away: false, awayInMs: BUDGET - 110_000 });
    h.advance(BUDGET - 110_000);
    h.drop("back2");
    h.send("back3", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    // Nothing left: p2 stays away.
    expect(h.room(code).seats[1]).toMatchObject({ away: true, awayInMs: null });
  });

  it("starts full for every player when the game starts, whatever happened in the lobby", () => {
    const h = harness({ turnTimeoutMs: null });
    const { code, tokens } = h.lobby(3);
    for (let n = 0; n < 5; n += 1) {
      h.drop(n === 0 ? "c2" : `l${n}`);
      h.advance(LOBBY_GRACE - 1);
      h.send(`l${n + 1}`, { type: "rejoin", v: V, code, seatToken: tokens[1] });
    }
    h.send("c1", { type: "start" });
    h.drop("l5");
    expect(h.room(code).seats[1]?.awayInMs).toBe(GRACE);
  });
});

describe("the lobby", () => {
  it("has no turn timer and no budget: only the lobby grace", () => {
    const h = harness();
    const { code } = h.lobby(3);
    expect(h.core.nextDeadline()).toBeNull();
    h.clear();
    h.advance(TURN * 10);
    expect(h.got("c1", "room")).toHaveLength(0);
    expect(h.room(code).seats.every((s) => s.awayInMs === null)).toBe(true);
    h.drop("c3");
    expect(h.room(code).seats[2]).toMatchObject({ connected: false, away: false, awayInMs: null });
    expect(h.core.nextDeadline()).toBe(h.now() + LOBBY_GRACE);
  });
});
