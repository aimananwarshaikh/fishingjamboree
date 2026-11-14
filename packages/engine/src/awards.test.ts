/**
 * Golden Hook Awards (docs/bonus-awards.md; rulebook "End of the game"):
 * the stats, the secret draw, the resolution and payout, and secrecy until
 * the result.
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import {
  countStats,
  drawAwards,
  emptyStats,
  resolveAward,
  STAT_KEYS,
  validAwardSets,
} from "./awards";
import { compileContent } from "./content";
import { getLegalActions } from "./legal";
import { replay } from "./replay";
import { createGame } from "./setup";
import { compiledContent, rawContent } from "./testContent";
import {
  act,
  clone,
  content,
  id,
  land,
  roll,
  START_LEFT,
  started,
  tile,
  withEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import { redactForClient } from "./view";
import type {
  AwardDef,
  Content,
  GameEvent,
  GameState,
  PlayerState,
  PlayerStats,
  RawContent,
} from "./types";

/** Player 0 to act; player 1 parked out of the way in zone 2. */
const base = withShips(started(2), { 1: tile(7, 8) });
const p0 = id(base, 0);
const ZONE1 = [tile(3, 17), tile(3, 16)] as const;
const BAY = [tile(0, 8), tile(0, 9)] as const;
const LOCKER = [tile(2, 2), tile(3, 2)] as const;

const statsOf = (state: GameState, index = 0): PlayerStats =>
  state.awards.stats[id(state, index)] as PlayerStats;
const changed = (before: GameState, after: GameState, index = 0) => {
  const a = statsOf(before, index);
  const b = statsOf(after, index);
  return Object.fromEntries(STAT_KEYS.filter((k) => a[k] !== b[k]).map((k) => [k, b[k] - a[k]]));
};

function contentWith(edit: (raw: RawContent) => void): Content {
  const raw = rawContent();
  edit(raw);
  return compiledContent(raw);
}

/** Plays a whole game with the first legal action each time. */
function playOut(c: Content, seed: string, players: string[]) {
  const created = createGame(c, { seed, players });
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  const states: GameState[] = [state];
  const actions = [];
  for (let guard = 0; state.phase.kind !== "gameOver"; guard += 1) {
    if (guard > 20_000) throw new Error("game did not end");
    const action = getLegalActions(c, state, state.phase.actors[0]!)[0]!;
    actions.push(action);
    const result = applyAction(c, state, action);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    events.push(...result.events);
    states.push(state);
  }
  return { state, events, states, actions };
}

// ---------------------------------------------------------------------------

describe("stats are counted where they happen", () => {
  it("start at zero for every player and are not public", () => {
    for (const p of base.players) expect(base.awards.stats[p.id]).toEqual(emptyStats());
    expect(Object.keys(base.awards.stats)).toEqual(base.players.map((p) => p.id));
  });

  it("fish caught: each token that goes onto the ship, bonus fish included", () => {
    const { state } = land(withTopCard(base, "safe", "fish+3"), ZONE1[0], ZONE1[1]);
    expect(changed(base, state)).toEqual({ fishCaught: 3, tilesMoved: 1 });
    const bonus = withEvent(base, "catch-bonus-1");
    const after = land(withTopCard(bonus, "safe", "fish+1"), ZONE1[0], ZONE1[1]).state;
    const gained = after.players[0]!.fish.length;
    expect(gained).toBeGreaterThan(1);
    expect(changed(bonus, after)).toEqual({ fishCaught: gained, tilesMoved: 1 });
  });

  it("fish that do not fit count as lost to capacity, not caught", () => {
    const full = withPlayer(base, 0, { fish: [100, 100, 100, 100] }); // room for 1
    const { state } = land(withTopCard(full, "safe", "fish+3"), ZONE1[0], ZONE1[1]);
    expect(changed(full, state)).toEqual({ fishCaught: 1, fishLostToCapacity: 2, tilesMoved: 1 });
  });

  it("a Shark: drawn and the fish it takes; drawn even when repelled", () => {
    const loaded = withPlayer(base, 0, { fish: [100, 300, 500] });
    const bitten = land(withTopCard(loaded, "risk", "shark"), LOCKER[0], LOCKER[1]).state;
    const lost = 3 - bitten.players[0]!.fish.length;
    expect(lost).toBeGreaterThan(0);
    expect(changed(loaded, bitten)).toEqual({
      riskDraws: 1,
      sharkDraws: 1,
      fishLostToShark: lost,
      tilesMoved: 1,
    });
    const repelled = withEvent(loaded, "shark-repellent");
    const safe = land(withTopCard(repelled, "risk", "shark"), BAY[0], BAY[1]);
    expect(safe.events.map((e) => e.type)).toContain("sharkRepelled");
    expect(changed(repelled, safe.state)).toEqual({ riskDraws: 1, sharkDraws: 1, tilesMoved: 1 });
  });

  it("Boots from either deck", () => {
    const a = land(withTopCard(base, "safe", "boot"), ZONE1[0], ZONE1[1]).state;
    expect(changed(base, a)).toEqual({ bootDraws: 1, tilesMoved: 1 });
    const b = land(withTopCard(base, "risk", "boot"), LOCKER[0], LOCKER[1]).state;
    expect(changed(base, b)).toEqual({ bootDraws: 1, riskDraws: 1, tilesMoved: 1 });
  });

  it("fines: the whole amount, the part that became fine tokens included", () => {
    const poor = withPlayer(base, 0, { cash: 100 });
    const { state } = land(withTopCard(poor, "risk", "fine-200"), LOCKER[0], LOCKER[1]);
    expect(state.players[0]).toMatchObject({ cash: 0, fineTokens: 1 });
    expect(changed(poor, state)).toEqual({ finesPaid: 200, riskDraws: 1, tilesMoved: 1 });
  });

  it("tiles moved: the tiles actually sailed", () => {
    let state = base;
    for (let guard = 0; state.phase.kind !== "move"; guard += 1) {
      if (guard > 20) throw new Error("no move");
      state = roll(state, 4).state;
    }
    const target = getLegalActions(content, state, p0).find((a) => a.type === "move")!;
    const moved = act(state, target);
    const ev = moved.events.find((e) => e.type === "moved")!;
    expect(ev.type === "moved" && ev.path.length - 1).toBe(state.phase.kind === "move" && 4);
    expect(changed(state, moved.state).tilesMoved).toBe(4);
  });

  it("dock visits: a chosen docking only", () => {
    const loaded = withPlayer(base, 0, { fish: [300] });
    const docked = land(loaded, tile(3, 18), START_LEFT).state;
    expect(changed(loaded, docked)).toEqual({ dockVisits: 1, tilesMoved: 1 });
    // A Sinking Boat arrival is not a visit.
    let sunk = land(withTopCard(base, "risk", "sinking-boat"), LOCKER[0], LOCKER[1]).state;
    if (sunk.phase.kind === "placeShip") {
      sunk = act(sunk, { type: "placeShip", player: p0, dock: sunk.phase.docks[0]! }).state;
    }
    expect(sunk.players[0]!.position).not.toBe(LOCKER[1]);
    expect(changed(base, sunk).dockVisits ?? 0).toBe(0);
    // Nor is a Helicopter sale.
    const heli = withPlayer(withEvent(base, "helicopter"), 0, { fish: [300], cash: 300 });
    const flown = act(heli, { type: "useHelicopter", player: p0 });
    expect(flown.events.map((e) => e.type)).toContain("fishSold");
    expect(changed(heli, flown.state)).toEqual({});
  });

  it("the Golden Fish: taken, or lost to a full ship", () => {
    const golden = withEvent(base, "golden-fish-1");
    golden.goldenFish = { spot: 1, tile: ZONE1[1], value: 1000 };
    const taken = land(golden, ZONE1[0], ZONE1[1]).state;
    expect(changed(golden, taken)).toEqual({ goldenFishTaken: 1, tilesMoved: 1 });
    const full = withPlayer(golden, 0, { fish: [100, 100, 100, 100, 100] });
    const lost = land(full, ZONE1[0], ZONE1[1]).state;
    expect(changed(full, lost)).toEqual({ fishLostToCapacity: 1, tilesMoved: 1 });
  });

  it("blocked turns are counted for the simulator", () => {
    const boxed = withShips(base, { 0: START_LEFT, 1: tile(3, 18) });
    const { state, events } = roll(boxed, 1);
    expect(events.map((e) => e.type)).toContain("blocked");
    expect(changed(boxed, state)).toEqual({ turnsBlocked: 1 });
  });

  it("only the player in the event is counted", () => {
    const stats = { a: emptyStats(), b: emptyStats() };
    countStats(content, stats, [
      { type: "cardDrawn", player: "b", deck: "risk", card: "shark" },
      { type: "roundStarted", round: 2 },
      { type: "cardDrawn", player: "zz", deck: "risk", card: "shark" },
    ]);
    expect(stats.a).toEqual(emptyStats());
    expect(stats.b).toEqual({ ...emptyStats(), riskDraws: 1, sharkDraws: 1 });
  });

  it("over a whole game, the stats match the event log", () => {
    const { state, events } = playOut(content, "stats-check", ["a", "b", "c"]);
    const fromEvents = Object.fromEntries(state.players.map((p) => [p.id, emptyStats()]));
    countStats(content, fromEvents, events);
    expect(state.result!.stats).toEqual(fromEvents);
    expect(state.awards.stats).toEqual(fromEvents);
    const s = Object.values(fromEvents);
    expect(s.reduce((n, x) => n + x.tilesMoved, 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("the secret draw", () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => `draw-${i}`);
  const def = (awardId: string) => content.awards.awards.find((a) => a.id === awardId)!;

  it("draws 2 awards for 2 players and 3 for 3 or 4, all different", () => {
    for (const [n, k] of [
      [2, 2],
      [3, 3],
      [4, 3],
    ] as const) {
      for (const seed of SEEDS.slice(0, 50)) {
        const chosen = drawAwards(content, seed, n);
        expect(chosen).toHaveLength(k);
        expect(new Set(chosen).size).toBe(k);
      }
    }
  });

  it("never two conflicting awards, and never over the budget", () => {
    for (const seed of SEEDS) {
      const chosen = drawAwards(content, seed, 3).map(def);
      expect(chosen.reduce((n, a) => n + a.amount, 0)).toBeLessThanOrEqual(content.awards.budget);
      for (const a of chosen) {
        for (const b of chosen) {
          expect(a.conflicts ?? []).not.toContain(b.id);
        }
      }
    }
  });

  it("every award in the pool can come up", () => {
    const seen = new Set(SEEDS.flatMap((s) => drawAwards(content, s, 3)));
    expect([...seen].sort()).toEqual(content.awards.awards.map((a) => a.id).sort());
  });

  it("the same seed draws the same awards; createGame stores them", () => {
    expect(drawAwards(content, "x", 3)).toEqual(drawAwards(content, "x", 3));
    const a = createGame(content, { seed: "x", players: ["a", "b", "c"] }).state;
    expect(a.awards.chosen).toEqual(drawAwards(content, "x", 3));
  });

  it("does not change the dice, decks or turn order: own RNG stream", () => {
    const none = contentWith((r) => (r.awards.perGame = { "2": 0, "3": 0, "4": 0 }));
    const setup = { seed: "same-game", players: ["a", "b", "c"] };
    const withAwards = createGame(content, setup).state;
    const without = createGame(none, setup).state;
    expect(without.awards.chosen).toEqual([]);
    const rest = (s: GameState) => ({ ...s, awards: null, contentHash: null });
    expect(rest(withAwards)).toEqual(rest(without));
  });

  it("the valid sets respect the budget and conflicts", () => {
    const tight = contentWith((r) => (r.awards.budget = 500));
    for (const set of validAwardSets(tight, 3)) {
      const total = set.map(def).reduce((n, a) => n + a.amount, 0);
      expect(total).toBeLessThanOrEqual(500);
    }
    expect(validAwardSets(content, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("resolution", () => {
  const players = (...upgrades: number[]): PlayerState[] =>
    upgrades.map((n, i) => ({
      ...clone(base.players[0]!),
      id: `p${i + 1}`,
      upgrades: { speed: n >= 1, capacity: n >= 2 },
    }));
  const stats = (...values: Partial<PlayerStats>[]) =>
    Object.fromEntries(values.map((v, i) => [`p${i + 1}`, { ...emptyStats(), ...v }]));
  const award = (d: Partial<AwardDef>): AwardDef => ({
    id: "t",
    name: "T",
    text: "t",
    kind: "most",
    stat: "riskDraws",
    amount: 200,
    ...d,
  });

  it("most: the highest value wins; every tied player is paid in full", () => {
    const ps = players(0, 0, 0);
    expect(
      resolveAward(award({}), ps, stats({ riskDraws: 3 }, { riskDraws: 5 }, { riskDraws: 5 })),
    ).toEqual({
      award: "t",
      amount: 200,
      value: 5,
      qualified: ["p2", "p3"],
      winners: ["p2", "p3"],
    });
  });

  it("least: the lowest value wins", () => {
    const r = resolveAward(
      award({ kind: "least" }),
      players(0, 0, 0),
      stats({ riskDraws: 3 }, { riskDraws: 1 }, { riskDraws: 2 }),
    );
    expect(r).toMatchObject({ value: 1, winners: ["p2"] });
  });

  it("a stat of 0 never wins, most or least", () => {
    const ps = players(0, 0);
    expect(resolveAward(award({}), ps, stats({}, {}))).toMatchObject({
      value: null,
      qualified: [],
      winners: [],
    });
    expect(
      resolveAward(award({ kind: "least" }), ps, stats({ riskDraws: 0 }, { riskDraws: 4 })),
    ).toMatchObject({ value: null, winners: [] });
  });

  it("conditions: upgrades bought (0, 1, 2), fine tokens, the Golden Fish", () => {
    const ps = players(0, 1, 2);
    const s = stats({}, { goldenFishTaken: 1 }, {});
    const run = (d: Partial<AwardDef>) =>
      resolveAward(award({ kind: "condition", ...d }), ps, s).winners;
    expect(run({ stat: "upgradesBought", max: 0 })).toEqual(["p1"]);
    expect(run({ stat: "upgradesBought", min: 1, max: 1 })).toEqual(["p2"]);
    expect(run({ stat: "upgradesBought", min: 2 })).toEqual(["p3"]);
    expect(run({ stat: "goldenFishTaken", min: 1 })).toEqual(["p2"]);
    ps[2]!.fineTokens = 2;
    expect(run({ stat: "fineTokens", max: 0 })).toEqual(["p1", "p2"]);
    expect(
      resolveAward(award({ kind: "condition", stat: "upgradesBought", max: 0 }), ps, s).value,
    ).toBeNull();
  });

  it("a removed player, or one who missed their last turn, qualifies but is not paid; no second place", () => {
    const ps = players(0, 0, 0);
    const s = stats({ riskDraws: 5 }, { riskDraws: 5 }, { riskDraws: 2 });
    ps[0]!.removed = true;
    expect(resolveAward(award({}), ps, s)).toMatchObject({
      qualified: ["p1", "p2"],
      winners: ["p2"],
    });
    ps[1]!.missedLastTurn = true;
    expect(resolveAward(award({}), ps, s)).toMatchObject({
      value: 5,
      qualified: ["p1", "p2"],
      winners: [],
    });
  });
});

// ---------------------------------------------------------------------------

describe("the payout at the end of the game", () => {
  /** Round 20, the last player boxed in on a starting dock: any roll ends the game. */
  function finalTurn(): GameState {
    const state = clone(withShips(started(2), { 0: tile(3, 18), 1: START_LEFT }));
    state.round = content.rules.rounds;
    state.turn = { playerIndex: 1, helicopterUsed: false };
    state.phase = { kind: "roll", actors: [id(state, 1)] };
    return state;
  }

  it("reveals each award with awardGiven before gameEnded, and adds it to the total", () => {
    let s = finalTurn();
    s.awards.chosen = ["daredevil", "stripped-down"];
    s = withPlayer(s, 0, { cash: 400 });
    s = withPlayer(s, 1, { cash: 300, upgrades: { speed: true, capacity: false } });
    s.awards.stats[id(s, 1)]!.riskDraws = 4;
    s.awards.stats[id(s, 0)]!.riskDraws = 1;
    const { state, events } = roll(s, 3);
    const [a, b] = [id(s, 0), id(s, 1)];
    expect(events.slice(-3)).toEqual([
      {
        type: "awardGiven",
        award: "daredevil",
        amount: 500,
        value: 4,
        qualified: [b],
        winners: [b],
      },
      {
        type: "awardGiven",
        award: "stripped-down",
        amount: 500,
        value: null,
        qualified: [a],
        winners: [a],
      },
      { type: "gameEnded", result: state.result },
    ]);
    expect(state.result!.scores).toEqual([
      { player: a, cash: 400, fineTokens: 0, awards: 500, total: 900, removed: false },
      { player: b, cash: 300, fineTokens: 0, awards: 500, total: 800, removed: false },
    ]);
    expect(state.result!.winners).toEqual([a]);
    // Cash itself is not changed: the awards are part of the score.
    expect(state.players.map((p) => p.cash)).toEqual([400, 300]);
  });

  it("an award can decide a close game", () => {
    let s = finalTurn();
    s.awards.chosen = ["boot-lord"];
    s = withPlayer(s, 0, { cash: 500 });
    s = withPlayer(s, 1, { cash: 450 });
    s.awards.stats[id(s, 1)]!.bootDraws = 2;
    expect(roll(s, 3).state.result!.winners).toEqual([id(s, 1)]);
  });

  it("fine tokens are not paid off by award money", () => {
    let s = finalTurn();
    s.awards.chosen = ["fine-print"];
    s = withPlayer(s, 0, { cash: 0, fineTokens: 2 });
    s.awards.stats[id(s, 0)]!.finesPaid = 300;
    const score = roll(s, 3).state.result!.scores[0]!;
    expect(score).toMatchObject({ cash: 0, fineTokens: 2, awards: 200, total: 0 });
  });

  it("the last turn's own stats count", () => {
    let s = finalTurn();
    s.awards.chosen = ["sea-legs"];
    s = withShips(s, { 1: tile(3, 16) });
    const moves = roll(s, 2);
    const to = getLegalActions(content, moves.state, id(s, 1)).find((x) => x.type === "move")!;
    const end = act(withTopCard(moves.state, "safe", "boot"), to);
    expect(end.state.phase.kind).toBe("gameOver");
    expect(end.state.result!.awards[0]).toMatchObject({ value: 2, winners: [id(s, 1)] });
  });

  it("the last player left also gets the awards they qualify for", () => {
    let s = clone(started(2));
    s.awards.chosen = ["stripped-down"];
    s = withPlayer(s, 0, { cash: 100 });
    const kicked = act(s, { type: "removePlayer", player: id(s, 1) }).state;
    expect(kicked.result).toMatchObject({
      reason: "last-player",
      winners: [id(s, 0)],
      awards: [{ award: "stripped-down", qualified: [id(s, 0), id(s, 1)], winners: [id(s, 0)] }],
    });
  });
});

// ---------------------------------------------------------------------------

describe("secret until the result", () => {
  it("no view and no event before the end shows the awards or the stats", () => {
    const { state, events, states } = playOut(content, "secret", ["a", "b", "c"]);
    const chosen = state.awards.chosen;
    expect(chosen).toHaveLength(3);
    const lastIndex = events.findIndex((e) => e.type === "awardGiven");
    expect(lastIndex).toBeGreaterThan(0);
    const before = JSON.stringify(events.slice(0, lastIndex));
    for (const awardId of chosen) expect(before).not.toContain(`"${awardId}"`);
    for (const s of states.slice(0, -1)) {
      for (const viewer of ["a", "b", "c", "spectator"]) {
        const view = redactForClient(s, viewer);
        expect(view).not.toHaveProperty("awards");
        const text = JSON.stringify(view);
        for (const awardId of chosen) expect(text).not.toContain(`"${awardId}"`);
        expect(text).not.toContain("fishCaught");
      }
    }
    // At the end the result carries them.
    const final = redactForClient(state, "a");
    expect(final.result!.awards.map((a) => a.award)).toEqual(chosen);
    expect(final.result!.stats).toEqual(state.awards.stats);
  });

  it("a replay shows the same awards and the same result", () => {
    const { state, actions } = playOut(content, "replayed", ["a", "b"]);
    const again = replay(content, {
      schemaVersion: 1,
      contentHash: content.hash,
      setup: { seed: "replayed", players: ["a", "b"] },
      actions,
    });
    expect(again.state).toEqual(state);
  });
});

// ---------------------------------------------------------------------------

describe("content/awards.json is checked", () => {
  const issues = (edit: (raw: RawContent) => void) => {
    const raw = rawContent();
    edit(raw);
    const result = compileContent(raw);
    return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
  };
  const first = (raw: RawContent) => raw.awards.awards[0]!;

  it("the real pool compiles, with a valid draw for every player count", () => {
    expect(issues(() => {})).toEqual([]);
    for (let n = content.rules.minPlayers; n <= content.rules.maxPlayers; n += 1) {
      expect(validAwardSets(content, content.awards.perGame[String(n)]!).length).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      "not an object",
      (r: RawContent) => ((r as { awards: unknown }).awards = []),
      /awards: must be an object/,
    ],
    ["a repeated id", (r: RawContent) => (r.awards.awards[1]!.id = first(r).id), /used twice/],
    ["an unknown kind", (r: RawContent) => ((first(r) as { kind: string }).kind = "best"), /kind/],
    ["an unknown stat", (r: RawContent) => ((first(r) as { stat: string }).stat = "luck"), /stat/],
    ["a negative amount", (r: RawContent) => (first(r).amount = -1), /amount: must be at least 0/],
    ["a race with min", (r: RawContent) => (first(r).min = 1), /only a condition/],
    [
      "a condition with neither min nor max",
      (r: RawContent) => Object.assign(first(r), { kind: "condition" }),
      /needs min or max/,
    ],
    [
      "min above max",
      (r: RawContent) => Object.assign(first(r), { kind: "condition", min: 3, max: 1 }),
      /min must not exceed max/,
    ],
    ["an unknown conflict", (r: RawContent) => (first(r).conflicts = ["nope"]), /unknown award/],
    ["a self conflict", (r: RawContent) => (first(r).conflicts = [first(r).id]), /itself/],
    ["a missing player count", (r: RawContent) => delete r.awards.perGame["3"], /perGame\.3/],
    [
      "a draw that cannot fit the budget",
      (r: RawContent) => (r.awards.budget = 100),
      /fit the budget/,
    ],
    [
      "more awards than the pool",
      (r: RawContent) => (r.awards.perGame["4"] = 99),
      /fit the budget/,
    ],
  ])("refuses %s", (_name, edit, message) => {
    expect(issues(edit).join("\n")).toMatch(message);
  });

  it("the content hash covers the awards", () => {
    expect(contentWith((r) => (first(r).amount = 250)).hash).not.toBe(content.hash);
  });
});
