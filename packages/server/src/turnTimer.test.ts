/**
 * Review P1-2 and the designer's answers (2026-11-13): a player who does not
 * act cannot stall a game (a turn that runs out of time is missed; three
 * missed in a row and the player is removed), the host can remove a player,
 * and a flaky connection cannot restart the reconnect grace for ever (grace
 * budget). docs/protocol.md §7.
 */
import { describe, expect, it } from "vitest";
import * as engine from "@fishingjamboree/engine";
import { redactForClient, replay } from "@fishingjamboree/engine";
import { DEFAULT_CONFIG } from "./core";
import { connOf, content, harness, SEED, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

const TURN = DEFAULT_CONFIG.turnTimeoutMs!;
const GRACE = DEFAULT_CONFIG.reconnectGraceMs;
const BUDGET = DEFAULT_CONFIG.reconnectBudgetMs;
const DELAY = DEFAULT_CONFIG.autoActionDelayMs;
const FLOOR = DEFAULT_CONFIG.disconnectFloorMs;
const LOBBY_GRACE = DEFAULT_CONFIG.lobbyGraceMs;
const LIMIT = content.rules.missedTurnsBeforeRemoval;

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

/** Plays (first legal actions) until a player has rolled and still has to move. */
function playUntilMove(h: Harness) {
  for (let guard = 0; h.view("c1").phase.kind !== "move"; guard += 1) {
    if (guard > 200) throw new Error("never reached a move");
    act(h);
  }
}

const eventTypes = (h: Harness, conn: string) => h.last(conn, "update").events.map((e) => e.type);

describe("the defaults", () => {
  it("give a whole turn 90 s, no more than the ~90 s per decision the review measured", () => {
    expect(TURN).toBe(90_000);
    expect(FLOOR).toBe(10_000);
    expect(GRACE).toBeLessThanOrEqual(BUDGET);
    expect(LIMIT).toBe(3);
  });
});

describe("turn timer", () => {
  it("misses the turn of a connected player who does not act; they stay present", () => {
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
    expect(eventTypes(h, watcher)[0]).toBe("turnMissed");
    expect(h.core.replayLog(code)?.actions).toEqual([
      { type: "missTurn", player: seat, reason: "timeout" },
    ]);
    // Still connected and not away; the next turn gets a fresh turn time.
    expect(h.room(code).seats[seatIndex(seat)]).toMatchObject({ connected: true, away: false });
    expect(eventTypes(h, watcher)).toContain("turnStarted");
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
  });

  it("counts the whole turn, not each decision: a roll does not restart it", () => {
    const h = harness();
    h.started(3);
    playUntilMove(h);
    const seat = h.actor("c1")!;
    // The turn started with the roll that was just made; take one step back in time.
    const deadline = h.core.nextDeadline()!;
    expect(deadline).toBe(h.now() + TURN);
    h.advance(TURN - 1);
    expect(h.actor("c1")).toBe(seat);
    h.clear();
    h.advance(1);
    expect(h.last("c1", "update")).toMatchObject({ by: seat, auto: true });
    expect(eventTypes(h, "c1")).not.toContain("moved");
    expect(h.actor("c1")).not.toBe(seat);
  });

  it("starts again when the next turn starts", () => {
    const h = harness();
    h.started(3);
    h.advance(TURN - 1_000);
    act(h); // the setup placement: the last setup ship goes on the other dock, round 1 starts
    expect(eventTypes(h, "c1")).toContain("turnStarted");
    expect(h.core.nextDeadline()).toBe(h.now() + TURN);
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

  it("shows no turn time while the deciding player is away; their turn is missed after the short delay", () => {
    const h = harness();
    h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.send(connOf(seat), { type: "leave" });
    h.send(watcher, { type: "sync" });
    expect(h.last(watcher, "snapshot").game?.turnTimeLeftMs).toBeNull();
    h.advance(DELAY);
    const update = h.last(watcher, "update");
    expect(update).toMatchObject({ by: seat, auto: true });
    expect(update.events[0]).toEqual({
      type: "turnMissed",
      player: seat,
      reason: "away",
      counted: false,
    });
    expect(update.turnTimeLeftMs).toBe(h.actor(watcher) === seat ? null : TURN);
  });

  it("keeps running when the deciding player drops: a locked phone costs at most one turn time", () => {
    const h = harness();
    h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    // The heartbeat notices a locked phone up to 30 s late; the grace does not extend the turn.
    h.advance(30_000);
    h.drop(connOf(seat));
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
    h.clear();
    h.advance(TURN - 30_000);
    expect(h.got(watcher, "update")).toEqual([
      expect.objectContaining({ seq: 1, by: seat, auto: true }),
    ]);
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
});

describe("time running out after the move (review P2-3)", () => {
  it("in the shop or the Helicopter choice: the turn ends, not missed, and the next turn starts", () => {
    // Everyone starts rich, so docking opens the shop.
    const createGame: typeof engine.createGame = (c, setup) => {
      const created = engine.createGame(c, setup);
      for (const p of created.state.players) p.cash = 5_000;
      return created;
    };
    const h = harness({}, [], { engine: { createGame } });
    const { code } = h.started(3);
    // First legal choices, but never buy or fly: wait for a prompt after the move.
    for (let guard = 0; !["dockShop", "turnEnd"].includes(h.view("c1").phase.kind); guard += 1) {
      if (guard > 3_000) throw new Error("never reached a prompt after the move");
      const seat = h.actor("c1")!;
      const legal = h.legal(connOf(seat), seat);
      const choice = legal.find((a) => a.type !== "buyUpgrade" && a.type !== "useHelicopter");
      h.intent(connOf(seat), strip(choice!));
    }
    const seat = h.actor("c1")!;
    const left = h.last("c1", "update").turnTimeLeftMs!;
    expect(left).toBeGreaterThan(0);
    h.clear();
    h.advance(left);
    expect(h.got("c1", "update").length).toBeGreaterThan(0);
    const update = h.last("c1", "update");
    expect(update.events[0]).toEqual({ type: "turnTimedOut", player: seat, reason: "timeout" });
    expect(update.view.players.find((p) => p.id === seat)).toMatchObject({
      missedTurns: 0,
      missedLastTurn: false,
    });
    expect(h.core.replayLog(code)!.actions.at(-1)).toEqual({
      type: "missTurn",
      player: seat,
      reason: "timeout",
    });
  });
});

describe("missed turns in a row", () => {
  it(`remove a silent player after ${LIMIT}; the last player left wins; replay matches; nothing private is sent`, () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    let misses = 0;
    for (let guard = 0; h.actor("c1") !== undefined; guard += 1) {
      if (guard > 5_000) throw new Error("the game did not end");
      if (h.actor("c1") === "p1") {
        act(h);
        continue;
      }
      const seq = h.view("c1").actionCount;
      h.advance(TURN);
      expect(h.last("c1", "update")).toMatchObject({ seq: seq + 1, auto: true });
      misses += 1;
    }
    expect(misses).toBe(2 * LIMIT);
    expect(h.room(code)).toMatchObject({ status: "finished", host: "p1" });
    expect(h.room(code).seats.map((s) => [s.removed, s.connected])).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
    const result = h.view("c1").result!;
    expect(result).toMatchObject({ winners: ["p1"], reason: "last-player" });
    // The removed players were told, and their connections have no seat any more.
    for (const conn of ["c2", "c3"]) {
      expect(h.got(conn, "error").map((m) => m.code)).toContain("kicked");
      h.send(conn, { type: "sync" });
      expect(h.last(conn, "error").code).toBe("not-seated");
    }
    // Their tokens no longer work.
    h.send("x", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("x", "error").code).toBe("kicked");
    expect(h.core.nextDeadline()).toBeNull();

    const replayed = replay(content, h.core.replayLog(code)!);
    expect(h.view("c1")).toEqual(redactForClient(replayed.state, "p1"));
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

  it("a host whose turns run out is removed in the end, and the host role passes on", () => {
    const h = harness();
    const { code } = h.started(3);
    for (let guard = 0; !h.room(code).seats[0]!.removed; guard += 1) {
      if (guard > 500) throw new Error("p1 was never removed");
      if (h.actor("c2") === "p1") h.advance(TURN);
      else act(h, "c2");
    }
    expect(h.room(code)).toMatchObject({ status: "playing", host: "p2" });
    expect(h.last("c2", "room").room.host).toBe("p2");
  });
});

describe("a dropout (designer, 2026-11-14: review P1-1)", () => {
  /**
   * p2 drops at the start of the game and stays away; the others take 5 s per
   * action (the review's measurement). Only a turn that ran the whole timer
   * counts towards removal, so p2 is never removed by the server.
   */
  function dropout(n: number) {
    const h = harness();
    const { code, tokens } = h.started(n);
    const start = h.now();
    h.drop("c2");
    let awayAt: number | null = null;
    let missed = 0;
    const play = (until: () => boolean) => {
      for (let guard = 0; !until(); guard += 1) {
        if (guard > 20_000) throw new Error("the game did not end");
        const seat = h.actor("c1")!;
        if (seat === "p2" && h.room(code).seats[1]!.connected === false) {
          const seq = h.view("c1").actionCount;
          h.advance(1_000);
          if (h.view("c1").actionCount > seq) missed += 1;
        } else {
          h.advance(5_000);
          if (h.actor("c1") === seat) act(h);
        }
        if (awayAt === null && h.room(code).seats[1]!.away) awayAt = h.now() - start;
      }
    };
    return { h, code, tokens, start, play, awayAt: () => awayAt, missed: () => missed };
  }

  for (const n of [2, 3, 4]) {
    it(`${n} players: away after the grace, turns missed, never removed; can come back after 4 minutes`, () => {
      const d = dropout(n);
      const { h, code } = d;
      d.play(() => h.now() - d.start >= 4 * 60_000);
      expect(d.awayAt()).toBeGreaterThanOrEqual(GRACE);
      expect(d.awayAt()).toBeLessThan(GRACE + 5_000);
      expect(d.missed()).toBeGreaterThan(LIMIT);
      expect(h.room(code).seats[1]).toMatchObject({ removed: false, away: true });
      expect(h.room(code).status).toBe("playing");

      h.send("back", { type: "rejoin", v: V, code, seatToken: d.tokens[1] });
      expect(h.last("back", "welcome").seat).toBe("p2");
      // From now on p2 plays from the new connection.
      for (let guard = 0; h.actor("c1") !== undefined; guard += 1) {
        if (guard > 20_000) throw new Error("the game did not end");
        const seat = h.actor("c1")!;
        const conn = seat === "p2" ? "back" : connOf(seat);
        h.intent(conn, strip(h.legal(conn, seat)[0]!));
      }
      expect(h.view("c1").result).toMatchObject({ reason: "rounds" });
      const replayed = replay(content, h.core.replayLog(code)!);
      expect(h.view("c1")).toEqual(redactForClient(replayed.state, "p1"));
    });
  }

  it("the host can still remove an away player at any time", () => {
    const d = dropout(3);
    const { h, code } = d;
    d.play(() => h.room(code).seats[1]!.away);
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.last("c1", "update").events[0]).toEqual({
      type: "playerRemoved",
      player: "p2",
      reason: "kicked",
    });
    expect(h.room(code).seats[1]!.removed).toBe(true);
  });
});

describe("a removed seat after an empty room (review P3)", () => {
  it("gets no grace and never becomes away when the room is rejoined", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    h.send("c1", { type: "kick", seat: "p3" });
    h.drop("c1");
    h.drop("c2");
    h.advance(5_000);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.last("back", "welcome").room.seats[2]).toMatchObject({
      removed: true,
      away: false,
      awayInMs: null,
    });
    const rev = h.room(code).rev;
    h.clear();
    h.advance(GRACE);
    expect(h.got("back", "room")).toHaveLength(1); // p2's grace only
    expect(h.room(code).seats[2]).toMatchObject({ removed: true, away: false });
    expect(h.room(code).rev).toBe(rev + 1);
  });
});

describe("the host removes a player", () => {
  it("who is not deciding: the turn goes on, everyone is told, the player loses the seat", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    const target = bystander(h, 3) === "p1" ? "p2" : bystander(h, 3);
    const actor = h.actor("c1");
    h.clear();
    h.send("c1", { type: "kick", seat: target });
    const update = h.last("c1", "update");
    expect(update).toMatchObject({ by: "p1", auto: false });
    expect(update.events).toEqual([{ type: "playerRemoved", player: target, reason: "kicked" }]);
    expect(h.actor("c1")).toBe(actor);
    expect(h.last("c1", "room").room.seats[seatIndex(target)]).toMatchObject({
      removed: true,
      connected: false,
    });
    // They see the update that removes them, then `kicked`, then nothing more.
    expect(h.take(connOf(target)).map((m) => m.type)).toEqual(["update", "error"]);
    act(h);
    expect(h.take(connOf(target))).toEqual([]);
    h.send("y", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(target)] });
    expect(h.last("y", "error").code).toBe("kicked");
  });

  it("who is deciding: their turn ends and play passes on", () => {
    const h = harness();
    h.started(3);
    for (let guard = 0; h.actor("c1") === "p1"; guard += 1) {
      if (guard > 50) throw new Error("p1 kept the turn");
      act(h);
    }
    const victim = h.actor("c1")!;
    expect(victim).not.toBe("p1");
    h.send("c1", { type: "kick", seat: victim });
    expect(h.actor("c1")).not.toBe(victim);
  });

  it("in a two-player game: the game ends and the host wins", () => {
    const h = harness();
    const { code } = h.started(2);
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.room(code).status).toBe("finished");
    expect(h.view("c1").result).toMatchObject({ winners: ["p1"], reason: "last-player" });
    expect(h.last("c1", "room").room.status).toBe("finished");
  });

  it("only the host, never themselves, an unknown or a removed seat, or after the game", () => {
    const h = harness();
    const { code } = h.started(3);
    h.send("c2", { type: "kick", seat: "p3" });
    expect(h.last("c2", "error").code).toBe("not-host");
    for (const seat of ["p1", "p9"]) {
      h.send("c1", { type: "kick", seat });
      expect(h.last("c1", "error").code).toBe("cannot-kick");
    }
    h.send("c1", { type: "kick", seat: "p3" });
    h.send("c1", { type: "kick", seat: "p3" });
    expect(h.last("c1", "error").code).toBe("cannot-kick");
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.room(code).status).toBe("finished");
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.last("c1", "error").code).toBe("cannot-kick");
    expect(h.core.replayLog(code)?.actions.filter((a) => a.type === "removePlayer")).toHaveLength(
      2,
    );
  });

  it("in the lobby: the seat is freed and the token stops working", () => {
    const h = harness();
    const { code, tokens } = h.lobby(3);
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p3"]);
    expect(h.last("c3", "room").room.seats).toHaveLength(2);
    expect(h.last("c2", "error").code).toBe("kicked");
    h.send("c2", { type: "sync" });
    expect(h.last("c2", "error").code).toBe("not-seated");
    h.send("z", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("z", "error").code).toBe("bad-token");
    // The freed seat can be taken by someone new.
    h.send("c4", { type: "join", v: V, code, name: "Dee" });
    expect(h.last("c4", "welcome").seat).toBe("p2");
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

  it("with no budget left, a blip on the player's own turn does not lose it (review P2-2)", () => {
    const h = harness({ reconnectBudgetMs: 0 });
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    const i = seatIndex(seat);
    h.advance(5_000); // thinking
    h.clear();
    h.drop(connOf(seat));
    // Away at once (no budget), but the turn is not missed for FLOOR.
    expect(h.last(watcher, "room").room.seats[i]).toMatchObject({ away: true });
    expect(h.core.nextDeadline()).toBe(h.now() + FLOOR);
    h.advance(FLOOR - 1_000);
    expect(h.got(watcher, "update")).toHaveLength(0);
    // Back after 9 s: the turn goes on, on the same turn timer (5 + 9 s used).
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[i] });
    expect(h.last("back", "welcome").game?.turnTimeLeftMs).toBe(TURN - 5_000 - (FLOOR - 1_000));
    h.advance(60_000);
    expect(h.got(watcher, "update")).toHaveLength(0);
    expect(h.actor("back")).toBe(seat);
    h.intent("back", strip(h.legal("back", seat)[0]!));
    expect(h.last(watcher, "update")).toMatchObject({ by: seat, auto: false });
  });

  it("with no budget left, a drop that lasts is missed FLOOR after the disconnect", () => {
    const h = harness({ reconnectBudgetMs: 0 });
    const { code } = h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.advance(5_000);
    h.drop(connOf(seat));
    h.clear();
    h.advance(FLOOR - 1);
    expect(h.got(watcher, "update")).toHaveLength(0);
    h.advance(1);
    expect(h.last(watcher, "update").events[0]).toMatchObject({
      type: "turnMissed",
      player: seat,
      reason: "away",
    });
    expect(h.core.replayLog(code)?.actions).toHaveLength(1);
    // Later turns of theirs: the floor has passed, so the short delay applies.
    for (let guard = 0; h.actor(watcher) !== seat; guard += 1) {
      if (guard > 50) throw new Error("never their turn again");
      act(h, watcher);
    }
    expect(h.core.nextDeadline()).toBe(h.now() + DELAY);
  });

  it("the floor is not given after leave, and never holds back the turn timer", () => {
    const h = harness({ reconnectBudgetMs: 0 });
    h.started(3);
    const seat = h.actor("c1")!;
    h.send(connOf(seat), { type: "leave" });
    expect(h.core.nextDeadline()).toBe(h.now() + DELAY);

    // A player with budget who drops 2 s before the turn timer runs out: missed on time.
    const g = harness();
    g.started(3);
    const actor = g.actor("c1")!;
    g.advance(TURN - 2_000);
    g.drop(connOf(actor));
    expect(g.core.nextDeadline()).toBe(g.now() + 2_000);
    g.advance(2_000);
    const watcher = actor === "p1" ? "c2" : "c1";
    expect(g.last(watcher, "update").events[0]).toMatchObject({
      type: "turnMissed",
      reason: "timeout",
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
