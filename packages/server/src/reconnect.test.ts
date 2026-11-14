import { describe, expect, it } from "vitest";
import { redactForClient, replay } from "@fishingjamboree/engine";
import type { GameEvent } from "@fishingjamboree/engine";
import { DEFAULT_CONFIG } from "./core";
import { connOf, content, harness, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

const GRACE = DEFAULT_CONFIG.reconnectGraceMs;
const DELAY = DEFAULT_CONFIG.autoActionDelayMs;
const LOBBY_GRACE = DEFAULT_CONFIG.lobbyGraceMs;
const IDLE = DEFAULT_CONFIG.roomIdleTtlMs;
/** These tests are about the reconnect grace alone; the turn timer has its own (turnTimer.test.ts). */
const NO_TIMER = { turnTimeoutMs: null };

const seatIndex = (seat: string) => Number(seat.slice(1)) - 1;

/** The deciding seat plays its first legal action over its connection `conn`. */
function act(h: Harness, conn: string) {
  const seat = h.actor(conn)!;
  h.intent(conn, strip(h.legal(conn, seat)[0]!));
}

/** Connected seats play (first legal action) until `seat` has to decide. */
function playUntilTurnOf(h: Harness, seat: string, watcher: string) {
  for (let guard = 0; h.actor(watcher) !== seat; guard += 1) {
    if (guard > 200) throw new Error(`${seat} never got a turn`);
    act(h, connOf(h.actor(watcher)!));
  }
}

describe("reconnecting", () => {
  it("tells the room when a player drops and when they are back", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    const rev = h.room(code).rev;
    expect(h.drop("c2").map((o) => o.to)).toEqual(["c1", "c3"]);
    expect(h.last("c1", "room").room).toMatchObject({
      rev: rev + 1,
      seats: [{ connected: true }, { seat: "p2", connected: false }, { connected: true }],
    });
    h.clear();
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("c3", "room").room).toMatchObject({
      rev: rev + 2,
      seats: [{ connected: true }, { seat: "p2", connected: true }, { connected: true }],
    });
    expect(h.got("n2", "room")).toHaveLength(0);
  });

  it("gives the returning player their seat, the same token and the current game", () => {
    const h = harness();
    const { code, tokens } = h.started(3);
    h.drop("c2");
    playUntilTurnOf(h, "p2", "c1");
    const seq = h.view("c1").actionCount;
    expect(seq).toBeGreaterThan(0);
    h.send("n2", { type: "rejoin", v: V, code: code.toLowerCase(), seatToken: tokens[1] });
    const welcome = h.last("n2", "welcome");
    expect(welcome).toMatchObject({
      seat: "p2",
      seatToken: tokens[1],
      room: { status: "playing" },
    });
    expect(welcome.game?.seq).toBe(seq);
    expect(welcome.game?.view).toEqual({ ...h.view("c1"), viewer: "p2" });

    // The new connection plays on; the old one is no longer known.
    act(h, "n2");
    expect(h.last("c1", "update")).toMatchObject({ seq: seq + 1, by: "p2", auto: false });
    expect(h.last("n2", "update").seq).toBe(seq + 1);
    h.send("c2", { type: "sync" });
    expect(h.last("c2", "error").code).toBe("not-seated");
  });

  it("refuses a wrong token, another room's token and an unknown room", () => {
    const h = harness();
    const a = h.started(2);
    h.send("b1", { type: "create", v: V, name: "Other" });
    const other = h.last("b1", "welcome");
    h.drop("c2");
    h.send("x", { type: "rejoin", v: V, code: a.code, seatToken: "guess" });
    expect(h.last("x", "error").code).toBe("bad-token");
    h.send("x", { type: "rejoin", v: V, code: a.code, seatToken: other.seatToken });
    expect(h.last("x", "error").code).toBe("bad-token");
    h.send("x", { type: "rejoin", v: V, code: "ZZZZ", seatToken: a.tokens[1] });
    expect(h.last("x", "error").code).toBe("room-not-found");
    expect(h.room(a.code).seats[1]?.connected).toBe(false);
  });

  it("lets the newest connection take over a seat that is still connected", () => {
    const h = harness();
    const { code, tokens } = h.started(2);
    h.clear();
    const out = h.send("n1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(out.slice(0, 2)).toEqual([
      {
        kind: "send",
        to: "c1",
        message: { type: "error", code: "replaced", message: expect.any(String) },
      },
      { kind: "close", to: "c1", reason: "replaced" },
    ]);
    expect(h.last("n1", "welcome").seat).toBe("p1");
    expect(h.room(code).seats[0]?.connected).toBe(true);

    // The old socket closing afterwards must not mark the seat as disconnected.
    expect(h.drop("c1")).toEqual([]);
    expect(h.room(code).seats[0]?.connected).toBe(true);
    h.send("c1", { type: "sync" });
    expect(h.last("c1", "error").code).toBe("not-seated");
  });

  it("works in the lobby and after the game has finished", () => {
    const h = harness();
    const { code, tokens } = h.lobby(2);
    h.drop("c2");
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("n2", "welcome")).toMatchObject({ seat: "p2", game: null });

    h.send("c1", { type: "start" });
    for (let guard = 0; h.actor("c1") !== undefined && guard < 5_000; guard += 1) {
      const seat = h.actor("c1")!;
      act(h, seat === "p2" ? "n2" : "c1");
    }
    h.drop("n2");
    h.send("m2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    const welcome = h.last("m2", "welcome");
    expect(welcome.room.status).toBe("finished");
    expect(welcome.game?.view.result).not.toBeNull();
  });
});

describe("disconnect policy: lobby", () => {
  it("keeps a dropped player's seat for the lobby grace, then frees it", () => {
    const h = harness();
    const { code, tokens } = h.lobby(3);
    h.drop("c2");
    expect(h.core.nextDeadline()).toBe(h.now() + LOBBY_GRACE);
    h.advance(LOBBY_GRACE - 1);
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p2", "p3"]);
    h.clear();
    h.advance(1);
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p3"]);
    expect(h.last("c1", "room").room.seats).toHaveLength(2);
    expect(h.core.nextDeadline()).toBeNull();
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("n2", "error").code).toBe("bad-token");
  });

  it("keeps the seat when the player is back in time", () => {
    const h = harness();
    const { code, tokens } = h.lobby(2);
    h.drop("c2");
    h.advance(LOBBY_GRACE - 1);
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    h.advance(LOBBY_GRACE * 2);
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p2"]);
  });

  it("moves the host role on when the host's seat is freed", () => {
    const h = harness();
    const { code } = h.lobby(3);
    h.drop("c1");
    expect(h.room(code).host).toBe("p1");
    h.advance(LOBBY_GRACE);
    expect(h.room(code).host).toBe("p2");
    h.send("c2", { type: "start" });
    expect(h.room(code).status).toBe("playing");
  });

  it("keeps a lobby that a new player joins while everyone else is disconnected", () => {
    const h = harness();
    const { code } = h.lobby(1);
    h.drop("c1");
    h.send("c2", { type: "join", v: V, code, name: "Bob" });
    h.advance(LOBBY_GRACE);
    expect(h.room(code)).toMatchObject({ host: "p2", seats: [{ seat: "p2", connected: true }] });
    h.advance(IDLE * 2);
    expect(h.core.roomCodes()).toEqual([code]);
    expect(h.core.nextDeadline()).toBeNull();
  });

  it("deletes a lobby once its last seat is freed", () => {
    const h = harness();
    h.lobby(2);
    h.drop("c1");
    h.advance(1_000);
    h.drop("c2");
    h.advance(LOBBY_GRACE - 1_000);
    expect(h.core.roomCodes()).toHaveLength(1);
    h.advance(1_000);
    expect(h.core.roomCodes()).toEqual([]);
    expect(h.core.nextDeadline()).toBeNull();
  });
});

describe("disconnect policy: in a game", () => {
  it("waits the reconnect grace for the deciding player, then misses their turns", () => {
    const h = harness(NO_TIMER);
    const { code } = h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.drop(connOf(seat));
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
    h.clear();
    h.advance(GRACE - 1);
    expect(h.got(watcher, "update")).toHaveLength(0);
    h.advance(1);
    expect(h.got(watcher, "update")).toEqual([
      expect.objectContaining({ seq: 1, by: seat, auto: true }),
    ]);
    expect(h.core.replayLog(code)?.actions).toHaveLength(1);

    // Still away and deciding again (the first turn of round 1): missed after the short delay.
    expect(h.actor(watcher)).toBe(seat);
    expect(h.core.nextDeadline()).toBe(h.now() + DELAY);
    h.advance(DELAY - 1);
    expect(h.view(watcher).actionCount).toBe(1);
    h.advance(1);
    expect(h.last(watcher, "update")).toMatchObject({ seq: 2, by: seat, auto: true });
    expect(h.last(watcher, "update").events[0]).toEqual({
      type: "turnMissed",
      player: seat,
      reason: "away",
      counted: false,
    });
  });

  it("takes one automatic action per delay, however late the tick is", () => {
    const h = harness(NO_TIMER);
    h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.drop(connOf(seat));
    h.clear();
    h.advance(GRACE + 10 * DELAY);
    expect(h.got(watcher, "update")).toHaveLength(1);
  });

  it("does nothing while the disconnected player is not the one deciding", () => {
    const h = harness(NO_TIMER);
    const { code } = h.started(3);
    const actor = h.actor("c1")!;
    const idle = ["p1", "p2", "p3"].find((s) => s !== actor)!;
    h.drop(connOf(idle));
    // The only thing due is marking the seat away when its grace ends.
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
    h.advance(GRACE * 5);
    expect(h.core.nextDeadline()).toBeNull();
    expect(h.core.replayLog(code)?.actions).toEqual([]);
  });

  it("plays after the short delay for a player whose grace ran out before their turn", () => {
    const h = harness(NO_TIMER);
    h.started(3);
    const first = h.actor("c1")!;
    const away = ["p1", "p2", "p3"].find((s) => s !== first)!;
    const watcher = connOf(first);
    h.drop(connOf(away));
    h.advance(GRACE * 3);
    playUntilTurnOf(h, away, watcher);
    const seq = h.view(watcher).actionCount;
    expect(h.core.nextDeadline()).toBe(h.now() + DELAY);
    h.advance(DELAY);
    expect(h.last(watcher, "update")).toMatchObject({ seq: seq + 1, by: away, auto: true });
  });

  it("gives a player who drops during their own turn the full grace (no turn timer)", () => {
    const h = harness(NO_TIMER);
    h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    act(h, connOf(seat));
    h.advance(GRACE * 2);
    h.drop(connOf(seat));
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
    h.advance(GRACE - 1);
    expect(h.view(watcher).actionCount).toBe(1);
  });

  it("cancels the automatic action when the player is back in time", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    h.drop(connOf(seat));
    h.advance(GRACE - 1);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(seat)] });
    expect(h.core.nextDeadline()).toBeNull();
    h.advance(GRACE * 10);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    act(h, "back");
    expect(h.last("back", "update")).toMatchObject({ seq: 1, by: seat, auto: false });
  });

  it("stops playing for a player the moment they are back", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    h.drop(connOf(seat));
    h.advance(GRACE);
    expect(h.core.replayLog(code)?.actions).toHaveLength(1);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(seat)] });
    h.advance(GRACE * 10);
    expect(h.core.replayLog(code)?.actions).toHaveLength(1);
    // A later drop starts a fresh grace period.
    h.drop("back");
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
  });

  it("gives no grace to a player who chose to leave, and keeps their seat for a rejoin", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    const watcher = seat === "p1" ? "c2" : "c1";
    h.advance(10_000);
    h.clear();
    h.send(connOf(seat), { type: "leave" });
    expect(h.take(connOf(seat))).toEqual([{ type: "left" }]);
    expect(h.last(watcher, "room").room.seats[seatIndex(seat)]).toMatchObject({ connected: false });
    expect(h.room(code).seats).toHaveLength(3);
    // The last action was long ago, so the first automatic action is due at once.
    expect(h.core.nextDeadline()).toBeLessThanOrEqual(h.now());
    h.advance(0);
    expect(h.last(watcher, "update")).toMatchObject({ seq: 1, by: seat, auto: true });
    expect(h.core.nextDeadline()).toBe(h.now() + DELAY);

    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(seat)] });
    expect(h.last("back", "welcome").game?.seq).toBe(1);
    expect(h.core.nextDeadline()).toBeNull();
  });

  it("pauses while nobody is connected, and restarts the grace when someone returns", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    const seat = h.actor("c1")!;
    const other = ["p1", "p2", "p3"].find((s) => s !== seat)!;
    for (const conn of ["c1", "c2", "c3"]) h.drop(conn);
    // Only the idle-room deadline is pending: nobody is played for.
    expect(h.core.nextDeadline()).toBe(h.now() + IDLE);
    h.advance(GRACE * 10);
    expect(h.core.replayLog(code)?.actions).toEqual([]);

    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[seatIndex(other)] });
    expect(h.core.nextDeadline()).toBe(h.now() + GRACE);
    h.advance(GRACE - 1);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    h.advance(1);
    expect(h.last("back", "update")).toMatchObject({ seq: 1, by: seat, auto: true });
  });

  it("tells everyone when a dropped player becomes away, and when they are back", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    h.drop("c2");
    expect(h.last("c1", "room").room.seats[1]).toMatchObject({ connected: false, away: false });
    h.clear();
    h.advance(GRACE - 1);
    expect(h.got("c1", "room")).toHaveLength(0);
    h.advance(1);
    const rev = h.room(code).rev;
    expect(h.last("c1", "room").room).toMatchObject({ rev });
    expect(h.last("c3", "room").room.seats[1]).toMatchObject({ connected: false, away: true });
    h.send("n2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("c1", "room").room.seats[1]).toMatchObject({ connected: true, away: false });
    expect(h.last("n2", "welcome").room.seats[1]).toMatchObject({ away: false });
  });

  it("marks a player who leaves a game away at once, but never in the lobby", () => {
    const h = harness(NO_TIMER);
    const { code } = h.started(3);
    h.send("c3", { type: "leave" });
    expect(h.last("c1", "room").room.seats[2]).toMatchObject({ connected: false, away: true });
    expect(h.room(code).seats[2]).toMatchObject({ away: true });

    const lobby = harness();
    const { code: lobbyCode } = lobby.lobby(2);
    lobby.drop("c2");
    lobby.advance(LOBBY_GRACE - 1);
    expect(lobby.room(lobbyCode).seats[1]).toMatchObject({ connected: false, away: false });
  });

  it("clears away for every disconnected player when an empty room is joined again", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(3);
    h.drop("c2");
    h.advance(GRACE);
    expect(h.room(code).seats[1]).toMatchObject({ away: true });
    h.drop("c1");
    h.drop("c3");
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    // p2's grace starts again (docs/protocol.md §7), so p2 is not away for now.
    expect(h.last("back", "welcome").room.seats[1]).toMatchObject({ away: false });
    h.advance(GRACE);
    expect(h.last("back", "room").room.seats[1]).toMatchObject({ away: true });
  });

  it("deletes a room nobody has been connected to for the idle time", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(2);
    h.drop("c1");
    h.advance(5_000);
    h.drop("c2");
    h.advance(IDLE - 1);
    expect(h.core.roomCodes()).toEqual([code]);
    h.advance(1);
    expect(h.core.roomCodes()).toEqual([]);
    expect(h.core.nextDeadline()).toBeNull();
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.last("back", "error").code).toBe("room-not-found");
  });

  it("keeps an idle room when someone reconnects in time", () => {
    const h = harness(NO_TIMER);
    const { code, tokens } = h.started(2);
    h.drop("c1");
    h.drop("c2");
    h.advance(IDLE - 1);
    h.send("back", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    h.advance(IDLE * 2);
    expect(h.core.roomCodes()).toEqual([code]);
  });

  it("finishes a game for players who never come back: their turns are missed but never remove them", () => {
    const h = harness(NO_TIMER);
    const { code } = h.started(3);
    h.send("c2", { type: "leave" });
    h.send("c3", { type: "leave" });
    const autoEvents: GameEvent[] = [];
    for (let guard = 0; h.actor("c1") !== undefined; guard += 1) {
      if (guard > 5_000) throw new Error("the game did not end");
      const seat = h.actor("c1")!;
      if (seat === "p1") {
        const legal = h.legal("c1", "p1");
        h.intent("c1", strip(legal[(guard * 5) % legal.length]!));
        continue;
      }
      const before = h.view("c1");
      h.advance(DELAY);
      const update = h.last("c1", "update");
      expect(update).toMatchObject({ seq: before.actionCount + 1, by: seat, auto: true });
      autoEvents.push(...update.events.filter((e) => "player" in e && e.player === seat));
      h.clear();
    }
    expect(h.room(code).status).toBe("finished");
    // The server never plays for them: no roll, no move, no purchase, no Helicopter.
    const kinds = new Set(autoEvents.map((e) => e.type));
    for (const never of ["rolled", "moved", "upgradeBought", "helicopterUsed", "cardDrawn"]) {
      expect(kinds.has(never as GameEvent["type"])).toBe(false);
    }
    // An away player's missed turns do not count towards removal (review P1-1):
    // the game runs its 20 rounds, and only the host could remove them.
    expect(autoEvents.filter((e) => e.type === "playerRemoved")).toHaveLength(0);
    expect(autoEvents.filter((e) => e.type === "turnMissed").length).toBeGreaterThan(30);
    expect(h.view("c1").result).toMatchObject({ reason: "rounds" });

    // Missed turns and removals are ordinary logged actions: the replay matches.
    const replayed = replay(content, h.core.replayLog(code)!);
    expect(h.view("c1")).toEqual(redactForClient(replayed.state, "p1"));
  });
});
