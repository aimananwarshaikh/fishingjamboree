/**
 * Review P2-5: a server restart does not end every game. The core gives out
 * snapshots of changed rooms (`takeChanges`) and takes them back
 * (`restoreRoom`); a "restart" here is a second core, on a fresh harness,
 * restoring the first one's snapshots after a JSON round trip (as on disk).
 * docs/protocol.md §9; notes log "Saving rooms".
 */
import { describe, expect, it } from "vitest";
import { redactForClient, replay } from "@fishingjamboree/engine";
import { DEFAULT_CONFIG } from "./core";
import type { CoreConfig } from "./core";
import type { RoomSnapshot } from "./snapshot";
import { content, harness, SEED, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

const TURN = DEFAULT_CONFIG.turnTimeoutMs!;
const GRACE = DEFAULT_CONFIG.reconnectGraceMs;
const LOBBY_GRACE = DEFAULT_CONFIG.lobbyGraceMs;
const IDLE = DEFAULT_CONFIG.roomIdleTtlMs;

/** The deciding seat plays its first legal action over its own connection (`cN` or `prefix`N). */
function act(h: Harness, watcher: string, prefix = "c") {
  const seat = h.actor(watcher)!;
  const conn = `${prefix}${seat.slice(1)}`;
  h.intent(conn, strip(h.legal(conn, seat)[0]!));
}

/** What the core would write to disk for `code`, read back as JSON. */
function saved(h: Harness, code: string): unknown {
  const snap = h.core.snapshotRoom(code);
  if (!snap) throw new Error(`no room ${code}`);
  return JSON.parse(JSON.stringify(snap));
}

/** A new core (a restarted server) with `snapshot` restored. */
function restart(snapshot: unknown, config: Partial<CoreConfig> = {}) {
  const h = harness(config);
  const result = h.core.restoreRoom(snapshot);
  expect(result).toMatchObject({ ok: true });
  return h;
}

/** Every seat comes back over connection `rN`. */
function rejoinAll(h: Harness, code: string, tokens: string[]) {
  tokens.forEach((seatToken, i) => h.send(`r${i + 1}`, { type: "rejoin", v: V, code, seatToken }));
}

/** No message to any client holds the seed, an RNG state or a draw pile's order. */
function nothingPrivate(h: Harness) {
  const text = JSON.stringify(h.sent);
  expect(text).not.toContain(SEED);
  expect(text).not.toContain('"rng"');
}

describe("takeChanges", () => {
  it("reports rooms that changed, and rooms that are gone", () => {
    const h = harness();
    const { code } = h.lobby(2);
    const first = h.core.takeChanges();
    expect(first.save.map((s) => s.code)).toEqual([code]);
    expect(first.remove).toEqual([]);
    expect(h.core.takeChanges()).toEqual({ save: [], remove: [], broken: [] });
    h.send("c2", { type: "leave" });
    expect(h.core.takeChanges().save[0]!.seats.map((s) => s.id)).toEqual(["p1"]);
    h.send("c1", { type: "leave" });
    expect(h.core.takeChanges()).toEqual({ save: [], remove: [code], broken: [] });
  });

  it("covers timers: a turn missed by the timer and an idle room deleted", () => {
    const h = harness();
    const { code } = h.started(2);
    h.core.takeChanges();
    h.advance(TURN);
    const snap = h.core.takeChanges().save[0]!;
    expect(snap.game!.log.actions.map((a) => a.type)).toEqual(["missTurn"]);
    h.drop("c1");
    h.drop("c2");
    h.core.takeChanges();
    h.advance(IDLE);
    expect(h.core.takeChanges()).toEqual({ save: [], remove: [code], broken: [] });
  });

  it("a snapshot holds no connection ids or clock times", () => {
    const h = harness();
    const { code } = h.started(3);
    h.drop("c2");
    const snap = h.core.snapshotRoom(code)!;
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/"c[0-9]"/);
    expect(text).not.toContain(String(h.now()));
    expect(Object.keys(snap.seats[0]!).sort()).toEqual(
      ["away", "graceLeftMs", "id", "left", "name", "removed", "token"].sort(),
    );
  });
});

describe("restoring a lobby", () => {
  it("brings back seats, names, tokens and host; everyone starts disconnected", () => {
    const h1 = harness();
    const { code, tokens } = h1.lobby(3);
    h1.send("c1", { type: "leave" }); // p2 becomes host
    const h = restart(saved(h1, code));
    const info = h.room(code);
    expect(info.status).toBe("lobby");
    expect(info.host).toBe("p2");
    expect(info.seats.map((s) => [s.seat, s.name, s.connected])).toEqual([
      ["p2", "Player 2", false],
      ["p3", "Player 3", false],
    ]);
    expect(info.rev).toBeGreaterThan(h1.room(code).rev);
    rejoinAll(h, code, tokens.slice(1));
    expect(h.last("r1", "welcome").seat).toBe("p2");
    expect(h.last("r2", "welcome").seat).toBe("p3");
    // The old p1 token is gone with the seat.
    h.send("x", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.last("x", "error").code).toBe("bad-token");
    // Everyone back: the host can start.
    h.send("r1", { type: "start" });
    expect(h.room(code).status).toBe("playing");
  });

  it("a seat nobody reclaims is freed after the lobby grace, counted from the restart", () => {
    const h1 = harness();
    const { code, tokens } = h1.lobby(2);
    const h = restart(saved(h1, code));
    h.send("r1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    h.advance(LOBBY_GRACE - 1);
    expect(h.room(code).seats).toHaveLength(2);
    h.advance(1);
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1"]);
  });

  it("a room nobody comes back to is deleted after the idle time", () => {
    const h1 = harness();
    const { code } = h1.lobby(2);
    const h = restart(saved(h1, code));
    expect(h.core.nextDeadline()).toBe(h.now() + LOBBY_GRACE);
    h.advance(IDLE);
    expect(h.core.roomCodes()).toEqual([]);
  });
});

describe("restoring a game mid-turn", () => {
  /** A 3-player game played until someone has rolled and has to move. */
  function midTurn(config: Partial<CoreConfig> = {}) {
    const h1 = harness(config);
    const { code, tokens } = h1.started(3);
    for (let guard = 0; h1.view("c1").phase.kind !== "move"; guard += 1) {
      if (guard > 200) throw new Error("no move");
      act(h1, "c1");
    }
    return { h1, code, tokens };
  }

  it("rebuilds the same game; everyone rejoins and sees it; the turn timer starts again", () => {
    const { h1, code, tokens } = midTurn();
    const before = h1.core.replayLog(code)!;
    const h = restart(saved(h1, code));
    expect(h.core.replayLog(code)).toEqual(before);
    expect(h.room(code)).toMatchObject({ status: "playing", host: "p1" });
    expect(h.room(code).seats.every((s) => !s.connected && !s.away)).toBe(true);
    // Nothing happens while nobody is connected.
    expect(h.core.nextDeadline()).toBe(h.now() + IDLE);
    h.advance(TURN * 3);
    expect(h.core.replayLog(code)!.actions).toHaveLength(before.actions.length);
    rejoinAll(h, code, tokens);
    const state = replay(content, before).state;
    for (const [i, seat] of (["p1", "p2", "p3"] as const).entries()) {
      const w = h.last(`r${i + 1}`, "welcome");
      expect(w.seat).toBe(seat);
      expect(w.game!.view).toEqual(redactForClient(state, seat));
      expect(w.game!.seq).toBe(before.actions.length);
    }
    expect(h.view("r1").phase.kind).toBe("move");
    // The whole turn again, from the first rejoin.
    expect(h.last("r3", "welcome").game!.turnTimeLeftMs).toBe(TURN);
    nothingPrivate(h);
  });

  it("plays on to the end; the replay of the whole game matches; nothing private is sent", () => {
    const { h1, code, tokens } = midTurn();
    const h = restart(saved(h1, code));
    rejoinAll(h, code, tokens);
    for (let guard = 0; h.room(code).status === "playing"; guard += 1) {
      if (guard > 5_000) throw new Error("the game never ended");
      act(h, "r1", "r");
    }
    const log = h.core.replayLog(code)!;
    const final = replay(content, log).state;
    expect(final.phase.kind).toBe("gameOver");
    expect(h.view("r2")).toEqual(redactForClient(final, "p2"));
    // The restored game is the same game: its first actions are the ones played before.
    expect(log.actions.slice(0, h1.core.replayLog(code)!.actions.length)).toEqual(
      h1.core.replayLog(code)!.actions,
    );
    nothingPrivate(h);
  });

  it("only one seat comes back: the others' graces start then, from what is left of their budget", () => {
    const budget = GRACE + 20_000;
    const { h1, code, tokens } = midTurn({ turnTimeoutMs: null, reconnectBudgetMs: budget });
    // p3 drops and uses 30 s of grace before the restart.
    h1.drop("c3");
    h1.advance(30_000);
    const snap = saved(h1, code) as RoomSnapshot;
    expect(snap.seats.map((s) => s.graceLeftMs)).toEqual([budget, budget, budget - 30_000]);
    const h = restart(snap);
    h.send("r1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    const seats = h.last("r1", "welcome").room.seats;
    expect(seats.map((s) => s.awayInMs)).toEqual([null, GRACE, budget - 30_000]);
    h.advance(budget - 30_000);
    expect(h.room(code).seats.map((s) => s.away)).toEqual([false, false, true]);
    h.advance(GRACE - (budget - 30_000));
    expect(h.room(code).seats.map((s) => s.away)).toEqual([false, true, true]);
  });

  it("a player who had sent leave is away at once when the room is rejoined", () => {
    const { h1, code, tokens } = midTurn();
    h1.send("c2", { type: "leave" });
    const h = restart(saved(h1, code));
    h.send("r1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.room(code).seats.map((s) => s.away)).toEqual([false, true, false]);
  });

  it("a removed player stays removed; their token answers kicked", () => {
    const h1 = harness();
    const { code, tokens } = h1.started(3);
    h1.send("c1", { type: "kick", seat: "p3" });
    const h = restart(saved(h1, code));
    expect(h.room(code).seats[2]).toMatchObject({ seat: "p3", removed: true });
    h.send("r3", { type: "rejoin", v: V, code, seatToken: tokens[2] });
    expect(h.last("r3", "error").code).toBe("kicked");
  });

  it("keeps the room's own timers, even if the new server's defaults differ", () => {
    const h1 = harness({ turnTimeoutMs: 30_000 });
    const { code, tokens } = h1.started(2);
    const h = restart(saved(h1, code), { turnTimeoutMs: 90_000 });
    expect(h.room(code).timers.turnTimeoutMs).toBe(30_000);
    rejoinAll(h, code, tokens);
    expect(h.last("r1", "welcome").game!.turnTimeLeftMs).toBe(30_000);
  });
});

describe("restoring a finished game", () => {
  it("shows the result to those who come back, then is deleted when idle", () => {
    const h1 = harness();
    const { code, tokens } = h1.started(2);
    h1.send("c1", { type: "kick", seat: "p2" }); // last player left: the game ends
    expect(h1.room(code).status).toBe("finished");
    const h = restart(saved(h1, code));
    expect(h.room(code).status).toBe("finished");
    h.send("r1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    const view = h.last("r1", "welcome").game!.view;
    expect(view.phase.kind).toBe("gameOver");
    h.drop("r1");
    h.advance(IDLE);
    expect(h.core.roomCodes()).toEqual([]);
  });
});

describe("refusing a snapshot", () => {
  /** A valid mid-game snapshot to break. */
  function good(): RoomSnapshot {
    const h1 = harness();
    const { code } = h1.started(3);
    for (let i = 0; i < 4; i += 1) act(h1, "c1");
    return saved(h1, code) as RoomSnapshot;
  }
  const refused = (raw: unknown) => {
    const h = harness();
    const result = h.core.restoreRoom(raw);
    expect(result.ok).toBe(false);
    expect(h.core.roomCodes()).toEqual([]);
    return result.ok ? "" : result.reason;
  };
  const edit = (f: (s: RoomSnapshot) => void) => {
    const s = good();
    f(s);
    return s;
  };

  it("anything that is not a snapshot", () => {
    for (const raw of [null, 42, "x", [], {}, { kind: "fishingjamboree-room", version: 9 }]) {
      refused(raw);
    }
  });

  it("a malformed one", () => {
    expect(refused(edit((s) => (s.code = "../etc")))).toMatch(/code/);
    expect(refused(edit((s) => (s.seats = [])))).toMatch(/seats/);
    expect(refused(edit((s) => (s.host = "p9")))).toMatch(/host/);
    expect(refused(edit((s) => (s.seats[1]!.token = s.seats[0]!.token)))).toMatch(/token/);
    expect(refused(edit((s) => (s.seats[0]!.graceLeftMs = -1)))).toMatch(/seat/);
    expect(refused(edit((s) => (s.game = null)))).toMatch(/game/);
    expect(refused(edit((s) => ((s as { status: string }).status = "paused")))).toMatch(/status/);
  });

  it("one whose game does not replay to the saved state", () => {
    expect(refused(edit((s) => (s.game!.state.players[0]!.cash += 100)))).toMatch(/match/);
    expect(refused(edit((s) => s.game!.log.actions.pop()))).toMatch(/match/);
    expect(refused(edit((s) => (s.game!.log.actions[0]!.player = "p9")))).toMatch(/replay/);
    expect(refused(edit((s) => (s.game!.log.setup.seed = "other")))).toMatch(/match|replay/);
    expect(refused(edit((s) => (s.status = "finished")))).toMatch(/status/);
    expect(refused(edit((s) => (s.seats[1]!.removed = true)))).toMatch(/removed/);
    expect(refused(edit((s) => s.seats.pop()))).toMatch(/players/);
  });

  it("one saved with other content", () => {
    expect(refused(edit((s) => (s.game!.log.contentHash = "other")))).toMatch(/content/);
  });

  it("one whose code is already in use", () => {
    const snap = good();
    const h = harness();
    expect(h.core.restoreRoom(snap)).toMatchObject({ ok: true });
    expect(h.core.restoreRoom(snap)).toMatchObject({ ok: false, reason: /exists/ });
  });

  it("restoring never throws, whatever the input", () => {
    const h = harness();
    const base = JSON.stringify(good());
    // Cut the snapshot at many places and flip characters: parse what is valid JSON.
    for (let i = 1; i < base.length; i += Math.ceil(base.length / 200)) {
      for (const text of [base.slice(0, i), base.slice(0, i) + "0" + base.slice(i + 1)]) {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          continue;
        }
        expect(() => h.core.restoreRoom(raw)).not.toThrow();
      }
    }
  });
});

describe("a restored room is like any other", () => {
  it("new rooms never take a restored room's code", () => {
    const h1 = harness({}, ["KTBM"]);
    const { code } = h1.lobby(2);
    expect(code).toBe("KTBM");
    const h = harness({}, ["KTBM", "KTBN"]);
    h.core.restoreRoom(saved(h1, code));
    h.send("n1", { type: "create", v: V, name: "New" });
    expect(h.last("n1", "welcome").room.code).toBe("KTBN");
    expect(h.core.roomCodes().sort()).toEqual(["KTBM", "KTBN"]);
  });

  it("is saved again after the next change", () => {
    const h1 = harness();
    const { code, tokens } = h1.started(2);
    const h = restart(saved(h1, code));
    expect(h.core.takeChanges()).toEqual({ save: [], remove: [], broken: [] });
    h.send("r1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.core.takeChanges().save.map((s) => s.code)).toEqual([code]);
  });
});
