/**
 * Online play (designer, 2026-11-13): a turn that runs out of time is missed,
 * a player who misses too many turns in a row is removed, the host can remove
 * a player, and the last player left wins. The server decides when; these are
 * the rules for what happens (system actions `missTurn` and `removePlayer`).
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { replay } from "./replay";
import { randomInt, seedRng } from "./rng";
import { createGame } from "./setup";
import { compiledContent, rawContent } from "./testContent";
import {
  act,
  actor,
  clone,
  content,
  deepFreeze,
  id,
  invariantProblems,
  roll,
  START_LEFT,
  START_RIGHT,
  started,
  tile,
  types,
  withPlayer,
  withShips,
} from "./testHelpers";
import type { Action, GameState, PlayerId } from "./types";

const LIMIT = content.rules.missedTurnsBeforeRemoval;
const SEA = tile(3, 15);

const miss = (state: GameState, player: PlayerId = actor(state)) =>
  act(state, { type: "missTurn", player, reason: "timeout" });
const missAway = (state: GameState, player: PlayerId = actor(state)) =>
  act(state, { type: "missTurn", player, reason: "away" });
const remove = (state: GameState, player: PlayerId) => act(state, { type: "removePlayer", player });

const reject = (state: GameState, action: Action) => {
  const result = applyAction(content, deepFreeze(clone(state)), action);
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
};

const player = (state: GameState, p: PlayerId) => state.players.find((x) => x.id === p)!;

/** Plays the current turn to its end with the first legal choices. */
function playOn(state: GameState): GameState {
  const p = actor(state);
  let next = state;
  for (let guard = 0; actor(next) === p && next.phase.kind !== "gameOver"; guard += 1) {
    if (guard > 20) throw new Error("turn did not end");
    const legal = getLegalActions(content, next, p);
    const end = legal.find((a) => a.type === "endTurn");
    next = act(next, end ?? legal[0]!).state;
  }
  return next;
}

describe("a missed turn", () => {
  it("before the roll: the turn ends, the ship stays, play passes on", () => {
    const state = started(3);
    const p = actor(state);
    const before = player(state, p).position;
    const { state: next, events } = miss(state);
    expect(types(events).slice(0, 3)).toEqual(["turnMissed", "turnEnded", "turnStarted"]);
    expect(events[0]).toEqual({ type: "turnMissed", player: p, reason: "timeout", counted: true });
    expect(player(next, p).position).toBe(before);
    expect(player(next, p).missedTurns).toBe(1);
    expect(actor(next)).toBe(id(state, 1));
    expect(next.actionCount).toBe(state.actionCount + 1);
  });

  it("after the roll: the ship does not move and no card is drawn", () => {
    const rolled = roll(started(2), 3).state;
    expect(rolled.phase.kind).toBe("move");
    const p = actor(rolled);
    const { state: next, events } = miss(rolled);
    expect(types(events)).not.toContain("moved");
    expect(types(events)).not.toContain("cardDrawn");
    expect(player(next, p).position).toBe(START_LEFT);
    expect(next.decks).toEqual(rolled.decks);
  });

  it("in the shop: nothing is bought and the shop closes", () => {
    const state = clone(withPlayer(started(2), 0, { cash: 1000 }));
    const p = id(state, 0);
    state.phase = { kind: "dockShop", reason: "docked", dock: "start-left", actors: [p] };
    const { state: next, events } = miss(state);
    expect(types(events)).not.toContain("upgradeBought");
    expect(player(next, p)).toMatchObject({ cash: 1000, upgrades: { speed: false } });
    expect(actor(next)).toBe(id(state, 1));
  });

  it("at the end of the turn: the Helicopter is not used", () => {
    const state = clone(withPlayer(started(2), 0, { cash: 500, fish: [100, 100] }));
    state.activeEvent = { card: "helicopter", drawnAfterRound: 5 };
    const p = id(state, 0);
    state.phase = { kind: "turnEnd", actors: [p] };
    const { state: next, events } = miss(state);
    expect(types(events)).not.toContain("helicopterUsed");
    expect(player(next, p)).toMatchObject({ cash: 500, fish: [100, 100] });
    expect(actor(next)).toBe(id(state, 1));
  });

  it("when placing a ship at setup: placed on the first dock offered, and it counts", () => {
    const { state } = createGame(content, { seed: "miss", players: ["a", "b", "c"] });
    const p = actor(state);
    const { state: next, events } = miss(state);
    expect(types(events).slice(0, 2)).toEqual(["turnMissed", "shipPlaced"]);
    expect(events[1]).toMatchObject({ player: p, dock: "start-left", reason: "setup" });
    expect(player(next, p)).toMatchObject({ position: START_LEFT, missedTurns: 1 });
    // Setup goes on as usual: the second ship takes the last starting dock, round 1 starts.
    expect(types(events)).toContain("roundStarted");
    expect(next.phase.kind).toBe("roll");
  });

  it("when entering late: placed on the first free dock, and the turn is missed", () => {
    const state = clone(withShips(started(3), { 0: SEA, 1: tile(4, 15) }));
    const p = id(state, 2);
    state.turn.playerIndex = 2;
    state.phase = {
      kind: "placeShip",
      reason: "entry",
      docks: ["start-left", "start-right"],
      actors: [p],
    };
    const { state: next, events } = miss(state);
    expect(types(events).slice(0, 3)).toEqual(["turnMissed", "shipPlaced", "turnEnded"]);
    expect(player(next, p).position).toBe(START_LEFT);
    expect(next.phase.kind).toBe("roll");
    expect(actor(next)).toBe(id(state, 0));
  });

  it("after a Sinking Boat: the ship goes to the first dock offered, no shop, the turn ends", () => {
    const state = clone(
      withPlayer(withShips(started(2), { 0: SEA, 1: tile(4, 15) }), 0, { cash: 1000 }),
    );
    const p = id(state, 0);
    state.phase = {
      kind: "placeShip",
      reason: "sinking-boat",
      docks: ["start-left", "start-right"],
      actors: [p],
    };
    const { state: next, events } = miss(state);
    expect(types(events)).toContain("shipRelocated");
    expect(player(next, p).position).toBe(START_LEFT);
    expect(next.phase.kind).not.toBe("dockShop");
    expect(actor(next)).toBe(id(state, 1));
  });

  it("is a system action: only for the deciding player, and never offered as a legal action", () => {
    const state = started(3);
    expect(reject(state, { type: "missTurn", player: id(state, 1), reason: "timeout" })).toBe(
      "not-your-turn",
    );
    expect(reject(state, { type: "missTurn", player: "zz", reason: "away" })).toBe(
      "unknown-player",
    );
    // A reason is required (an old saved log without one does not replay).
    expect(reject(state, { type: "missTurn", player: actor(state) } as unknown as Action)).toBe(
      "illegal-action",
    );
    for (const p of state.players) {
      const legal = getLegalActions(content, state, p.id).map((a) => a.type as string);
      expect(legal).not.toContain("missTurn");
      expect(legal).not.toContain("removePlayer");
    }
  });
});

describe("missed turns in a row", () => {
  it("are counted, and any action of the player's own resets the count", () => {
    let state = started(2);
    const p = actor(state);
    state = miss(state).state; // p misses
    state = playOn(state); // the other plays
    expect(player(state, p).missedTurns).toBe(1);
    state = act(state, { type: "roll", player: p }).state;
    expect(player(state, p).missedTurns).toBe(0);
  });

  it(`remove the player after ${LIMIT}: ship off the board, skipped from then on`, () => {
    let state = started(3);
    const p = actor(state);
    for (let n = 1; n <= LIMIT; n += 1) {
      expect(actor(state)).toBe(p);
      const { state: next, events } = miss(state);
      state = next;
      if (n < LIMIT) {
        expect(types(events)).not.toContain("playerRemoved");
        state = playOn(playOn(state));
      } else {
        expect(events.find((e) => e.type === "playerRemoved")).toEqual({
          type: "playerRemoved",
          player: p,
          reason: "missed-turns",
        });
      }
    }
    expect(player(state, p)).toMatchObject({ removed: true, position: null });
    expect(invariantProblems(state)).toEqual([]);
    // Two whole rounds: p never gets a turn again.
    const round = state.round;
    for (let guard = 0; state.round < round + 2; guard += 1) {
      if (guard > 50) throw new Error("rounds did not pass");
      expect(actor(state)).not.toBe(p);
      state = playOn(state);
    }
  });
});

describe("an away player's missed turns (designer, 2026-11-14: review P1-1)", () => {
  it("are missed but do not count towards removal", () => {
    let state = started(2);
    const p = actor(state);
    for (let n = 0; n < LIMIT + 3; n += 1) {
      const { state: next, events } = missAway(state);
      expect(events[0]).toEqual({ type: "turnMissed", player: p, reason: "away", counted: false });
      expect(types(events)).not.toContain("playerRemoved");
      state = playOn(next);
    }
    expect(player(state, p)).toMatchObject({ removed: false, missedTurns: 0 });
    expect(player(state, p).missedLastTurn).toBe(true);
  });

  it("neither count nor break a run of timed-out turns", () => {
    let state = started(2);
    const p = actor(state);
    state = playOn(miss(state).state); // 1 counted
    state = playOn(missAway(state).state); // not counted, run kept
    expect(player(state, p).missedTurns).toBe(1);
    for (let n = 2; n < LIMIT; n += 1) state = playOn(miss(state).state);
    expect(player(state, p).missedTurns).toBe(LIMIT - 1);
    state = playOn(missAway(state).state);
    const { events } = miss(state);
    expect(events.find((e) => e.type === "playerRemoved")).toMatchObject({
      player: p,
      reason: "missed-turns",
    });
  });

  it("an away player at setup is placed on the first dock and setup goes on", () => {
    const { state } = createGame(content, { seed: "miss", players: ["a", "b", "c"] });
    const p = actor(state);
    const { state: next, events } = missAway(state);
    expect(types(events).slice(0, 2)).toEqual(["turnMissed", "shipPlaced"]);
    expect(player(next, p)).toMatchObject({ position: START_LEFT, missedTurns: 0 });
    expect(next.phase.kind).toBe("roll");
  });

  it("missedLastTurn is set by either kind of miss and cleared by the player's own action", () => {
    let state = started(2);
    const p = actor(state);
    expect(player(state, p).missedLastTurn).toBe(false);
    state = playOn(missAway(state).state);
    expect(player(state, p).missedLastTurn).toBe(true);
    state = act(state, { type: "roll", player: p }).state;
    expect(player(state, p).missedLastTurn).toBe(false);
    state = playOn(playOn(state));
    state = playOn(miss(state).state);
    expect(player(state, p).missedLastTurn).toBe(true);
  });
});

describe("removing a player (host kick)", () => {
  it("of a player who is not deciding: their ship leaves the board, the turn goes on", () => {
    const rolled = roll(started(3), 3).state;
    const gone = id(rolled, 1);
    const { state, events } = remove(rolled, gone);
    expect(events).toEqual([{ type: "playerRemoved", player: gone, reason: "kicked" }]);
    expect(player(state, gone)).toMatchObject({ removed: true, position: null });
    expect(state.phase).toEqual(rolled.phase);
    // Their dock is free again.
    expect(state.players.some((x) => x.position === START_RIGHT)).toBe(false);
  });

  it("of the deciding player: their turn ends and play passes on", () => {
    const state = started(3);
    const gone = actor(state);
    const { state: next, events } = remove(state, gone);
    expect(types(events).slice(0, 3)).toEqual(["playerRemoved", "turnEnded", "turnStarted"]);
    expect(actor(next)).toBe(id(state, 1));
  });

  it("of the last player in turn order ends the round; of the first, the next round skips them", () => {
    let state = started(4);
    state = remove(state, id(state, 0)).state;
    expect(actor(state)).toBe(id(state, 1));
    for (let n = 0; n < 3; n += 1) state = playOn(state); // the last player: round 1 ends
    expect(state.round).toBe(2);
    expect(actor(state)).toBe(id(state, 1));
    state = remove(state, id(state, 3)).state;
    state = playOn(playOn(state));
    expect(state.round).toBe(3);
    expect(actor(state)).toBe(id(state, 1));
  });

  it("during setup: the next setup ship is placed by the next player", () => {
    const { state } = createGame(content, { seed: "kick", players: ["a", "b", "c"] });
    const first = actor(state);
    const { state: next } = remove(state, first);
    expect(next.phase).toMatchObject({ kind: "placeShip", reason: "setup" });
    expect(actor(next)).toBe(next.players[1]!.id);
  });

  it("leaves one player: the game ends at once and they win", () => {
    const state = withPlayer(started(2), 1, { cash: 900 });
    const stays = id(state, 0);
    const { state: next, events } = remove(state, id(state, 0) === stays ? id(state, 1) : stays);
    expect(next.phase).toEqual({ kind: "gameOver", actors: [] });
    expect(next.result).toMatchObject({ winners: [stays], reason: "last-player" });
    expect(next.result?.scores.find((s) => s.player === id(state, 1))).toMatchObject({
      removed: true,
    });
    expect(types(events).slice(-1)).toEqual(["gameEnded"]);
    expect(reject(next, { type: "missTurn", player: stays, reason: "timeout" })).toBe("game-over");
  });

  it("cannot remove a player twice, an unknown player, or after the game", () => {
    const state = started(3);
    const gone = remove(state, id(state, 2)).state;
    expect(reject(gone, { type: "removePlayer", player: id(state, 2) })).toBe("illegal-action");
    expect(reject(state, { type: "removePlayer", player: "zz" })).toBe("unknown-player");
  });

  it("a removed player cannot win, whatever their total", () => {
    let state = withPlayer(started(3), 2, { cash: 5000 });
    state = remove(state, id(state, 2)).state;
    for (let guard = 0; state.phase.kind !== "gameOver"; guard += 1) {
      if (guard > 2000) throw new Error("the game did not end");
      state = playOn(state);
    }
    expect(state.result?.reason).toBe("rounds");
    expect(state.result?.winners).not.toContain(id(state, 2));
    expect(state.result?.scores.find((s) => s.player === id(state, 2))).toMatchObject({
      total: 5000,
      removed: true,
    });
  });
});

describe("replay and content", () => {
  it("replays a game with missed turns and removals exactly", () => {
    const setup = { seed: "replay-miss", players: ["a", "b", "c", "d"] };
    let { state } = createGame(content, setup);
    const actions: Action[] = [];
    const push = (a: Action) => {
      actions.push(a);
      state = act(state, a).state;
    };
    for (let n = 0; state.phase.kind !== "gameOver"; n += 1) {
      if (n > 3000) throw new Error("the game did not end");
      const p = actor(state);
      if (n === 40) push({ type: "removePlayer", player: state.players[3]!.id });
      else if (n % 7 === 0) push({ type: "missTurn", player: p, reason: "timeout" });
      else if (n % 11 === 0) push({ type: "missTurn", player: p, reason: "away" });
      else push(getLegalActions(content, state, p)[0]!);
      expect(invariantProblems(state)).toEqual([]);
    }
    const replayed = replay(content, {
      schemaVersion: 1,
      contentHash: content.hash,
      setup,
      actions,
    });
    expect(replayed.state).toEqual(state);
  });

  it("missedTurnsBeforeRemoval must be a whole number of at least 1", () => {
    const raw = rawContent();
    (raw.rules as unknown as Record<string, unknown>).missedTurnsBeforeRemoval = 0;
    expect(() => compiledContent(raw)).toThrow(/missedTurnsBeforeRemoval/);
  });
});

describe("random games with missed turns and removals", () => {
  it("300 games: invariants hold, the right players win, replays match", () => {
    for (let g = 0; g < 300; g += 1) {
      const players = ["a", "b", "c", "d"].slice(0, 2 + (g % 3));
      const setup = { seed: `miss-fuzz-${g}`, players };
      let { state } = createGame(content, setup);
      let rng = seedRng(`bot-${g}`);
      const pick = (n: number) => {
        const [i, next] = randomInt(rng, n);
        rng = next;
        return i;
      };
      const actions: Action[] = [];
      while (state.phase.kind !== "gameOver") {
        if (actions.length > 5000) throw new Error(`game ${g}: stuck`);
        const p = actor(state);
        const roll100 = pick(100);
        let action: Action;
        if (roll100 < 15) action = { type: "missTurn", player: p, reason: "timeout" };
        else if (roll100 < 25) action = { type: "missTurn", player: p, reason: "away" };
        else if (roll100 === 99) {
          const left = state.players.filter((x) => !x.removed);
          action = { type: "removePlayer", player: left[pick(left.length)]!.id };
        } else {
          const legal = getLegalActions(content, state, p);
          action = legal[pick(legal.length)]!;
        }
        const result = applyAction(content, deepFreeze(state), action);
        if (!result.ok)
          throw new Error(`game ${g}: ${action.type} rejected: ${result.error.message}`);
        actions.push(action);
        state = result.state;
        const problems = invariantProblems(state);
        if (problems.length > 0) throw new Error(`game ${g}: ${problems.join("; ")}`);
      }
      const result = state.result!;
      const inGame = state.players.filter((p) => !p.removed).map((p) => p.id);
      if (result.reason === "last-player") {
        expect(inGame).toHaveLength(1);
        expect(result.winners).toEqual(inGame);
      } else {
        expect(state.round).toBe(content.rules.rounds);
        const best = Math.max(...result.scores.filter((s) => !s.removed).map((s) => s.total));
        expect(result.winners).toEqual(
          result.scores.filter((s) => !s.removed && s.total === best).map((s) => s.player),
        );
      }
      if (g % 25 === 0) {
        const replayed = replay(content, {
          schemaVersion: 1,
          contentHash: content.hash,
          setup,
          actions,
        });
        expect(replayed.state).toEqual(state);
      }
    }
  }, 120_000);
});
