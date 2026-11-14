/**
 * Whole 20-round games, start to result. A simple greedy policy plays every
 * seat: sail home or call the Helicopter once the catch is worth $400, buy
 * any upgrade offered, otherwise take a move chosen by a fixed rotation.
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { scoreGame } from "./economy";
import { getLegalActions } from "./legal";
import { createGame } from "./setup";
import {
  board,
  clone,
  content,
  deepFreeze,
  id,
  invariantProblems,
  roll,
  START_LEFT,
  started,
  tile,
  withPlayer,
  withShips,
} from "./testHelpers";
import type { Action, GameEvent, GameResult, GameState, PlayerId } from "./types";

const isDockTile = (t: number) => board.tiles[t]?.terrain === "dock";
const catchValue = (state: GameState, player: PlayerId) =>
  state.players.find((p) => p.id === player)!.fish.reduce((a, b) => a + b, 0);

function choose(state: GameState, legal: Action[]): Action {
  const player = legal[0]!.player;
  const rich = catchValue(state, player) >= 400;
  const pick = (pred: (a: Action) => boolean) => legal.find(pred);
  // Plain sea moves rotate with the action count so the ships spread out.
  const sea = legal.filter((a) => a.type === "move" && !isDockTile(a.to));
  return (
    pick((a) => a.type === "buyUpgrade") ??
    (rich ? pick((a) => a.type === "useHelicopter") : undefined) ??
    (rich ? pick((a) => a.type === "move" && isDockTile(a.to)) : undefined) ??
    sea[state.actionCount % Math.max(sea.length, 1)] ??
    pick((a) => a.type === "endTurn") ??
    legal[state.actionCount % legal.length]!
  );
}

function playGame(seed: string, players: PlayerId[]) {
  const created = createGame(content, { seed, players });
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  let guard = 0;
  while (state.phase.kind !== "gameOver") {
    if (++guard > 10_000) throw new Error("game did not end");
    const legal = getLegalActions(content, state, state.phase.actors[0]!);
    const result = applyAction(content, deepFreeze(state), choose(state, legal));
    if (!result.ok) throw new Error(`legal action rejected: ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
    expect(invariantProblems(state)).toEqual([]);
  }
  return { state, events };
}

const count = (events: GameEvent[], type: GameEvent["type"]) =>
  events.filter((e) => e.type === type).length;

/** Each player's cash, rebuilt from the money events alone. */
function cashFromEvents(events: GameEvent[], player: PlayerId): number {
  let cash = content.rules.startingCash;
  for (const e of events) {
    if (!("player" in e) || e.player !== player) continue;
    if (e.type === "fishSold") cash += e.total;
    if (e.type === "upgradeBought") cash -= e.price;
    if (e.type === "helicopterUsed") cash -= e.fee;
    if (e.type === "fined") cash -= e.paid;
    if (e.type === "fineTokensPaid") cash -= e.amount;
  }
  return cash;
}

describe("a full 20-round game", () => {
  it.each([
    ["full-a", ["ann", "bob", "cy"]],
    ["full-b", ["ann", "bob", "cy", "di"]],
    ["full-c", ["ann", "bob"]],
  ] as const)("seed %s runs to a scored result", (seed, seats) => {
    const { state, events } = playGame(seed, [...seats]);
    const n = seats.length;

    // Twenty rounds, every player has a turn in each of them.
    expect(state.phase).toEqual({ kind: "gameOver", actors: [] });
    expect(state.round).toBe(20);
    expect(count(events, "roundStarted")).toBe(20);
    expect(count(events, "roundEnded")).toBe(20);
    expect(count(events, "turnStarted")).toBe(20 * n);
    expect(count(events, "turnEnded")).toBe(20 * n);
    expect(count(events, "eventDrawn")).toBe(3);
    expect(state.goldenFish).toBeNull();

    // The game produced real money.
    expect(count(events, "fishSold")).toBeGreaterThan(0);
    expect(state.players.some((p) => p.cash > 0)).toBe(true);

    // The result: in turn order, total = cash - $100 per fine token + awards won, best total wins.
    const result = state.result!;
    expect(result.scores.map((s) => s.player)).toEqual(state.players.map((p) => p.id));
    expect(result.awards.map((a) => a.award)).toEqual(state.awards.chosen);
    expect(result.awards).toHaveLength(n === 2 ? 2 : 3);
    for (const [i, p] of state.players.entries()) {
      const won = result.awards
        .filter((a) => a.winners.includes(p.id))
        .reduce((sum, a) => sum + a.amount, 0);
      expect(result.scores[i]).toEqual({
        player: p.id,
        cash: p.cash,
        fineTokens: p.fineTokens,
        awards: won,
        total: p.cash - 100 * p.fineTokens + won,
        removed: false,
      });
      expect(p.cash).toBe(cashFromEvents(events, p.id));
    }
    const best = Math.max(...result.scores.map((s) => s.total));
    expect(result.winners).toEqual(
      result.scores.filter((s) => s.total === best).map((s) => s.player),
    );
    expect(result.winners.length).toBeGreaterThan(0);

    // One awardGiven per drawn award, just before gameEnded, which is the last event.
    const reveal = events.slice(-1 - result.awards.length, -1);
    expect(reveal).toEqual(result.awards.map((a) => ({ type: "awardGiven", ...a })));
    expect(events.at(-1)).toEqual({ type: "gameEnded", result });
    expect(count(events, "gameEnded")).toBe(1);

    // Nothing more can happen.
    for (const p of state.players) expect(getLegalActions(content, state, p.id)).toEqual([]);
    const after = applyAction(content, state, { type: "endTurn", player: state.players[0]!.id });
    expect(after).toMatchObject({ ok: false, error: { code: "game-over" } });
  });

  // Pinned outcomes for the seeds above, with the real content. A change to the
  // rules or to content/*.json may move these; update them only after checking why.
  // `base` is cash minus fines: the same as before the Golden Hook Awards (they
  // draw from their own RNG stream, so the play is unchanged); `totals` add them.
  it.each([
    [
      "full-a",
      ["ann", "bob", "cy"],
      { cy: 600, ann: 600, bob: 0 },
      // The awards break the shared win: Ann takes Boot Lord alone.
      {
        awards: [
          ["fully-loaded", ["cy", "ann", "bob"]],
          ["shark-bait", ["cy", "ann"]],
          ["boot-lord", ["ann"]],
        ],
        totals: { ann: 1100, bob: 200, cy: 1000 },
        winners: ["ann"],
      },
    ],
    [
      "full-b",
      ["ann", "bob", "cy", "di"],
      { di: 600, bob: 900, cy: 500, ann: 500 },
      // Landlubber goes to nobody: the fewest Risk cards drawn is 0, and 0 never wins.
      {
        awards: [
          ["landlubber", []],
          ["fine-print", ["di", "cy"]],
          ["big-haul", ["bob"]],
        ],
        totals: { ann: 500, bob: 1200, cy: 700, di: 800 },
        winners: ["bob"],
      },
    ],
    [
      "full-c",
      ["ann", "bob"],
      { bob: -400, ann: 2300 },
      {
        awards: [
          ["clean-hands", ["ann"]],
          ["fully-loaded", ["ann"]],
        ],
        totals: { ann: 2700, bob: -400 },
        winners: ["ann"],
      },
    ],
  ] as const)("seed %s: pinned totals and winners", (seed, seats, base, pinned) => {
    const result = playGame(seed, [...seats]).state.result!;
    expect(Object.fromEntries(result.scores.map((s) => [s.player, s.total - s.awards]))).toEqual(
      base,
    );
    expect({
      awards: result.awards.map((a) => [a.award, a.winners]),
      totals: Object.fromEntries(result.scores.map((s) => [s.player, s.total])),
      winners: result.winners,
    }).toEqual(pinned);
  });

  it("is deterministic: the same seed and policy give the same result", () => {
    const a = playGame("full-a", ["ann", "bob", "cy"]);
    const b = playGame("full-a", ["ann", "bob", "cy"]);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe("final scores", () => {
  /** Round 20, the last player boxed in on a starting dock: any roll ends the game. */
  function finalTurn(players: number): GameState {
    const last = players - 1;
    const state = clone(
      withShips(started(players), { 0: tile(3, 18), 1: tile(7, 8), [last]: START_LEFT }),
    );
    // The base scoring alone: no Golden Hook Awards in play (awards.test.ts has those).
    state.awards.chosen = [];
    state.round = content.rules.rounds;
    state.turn = { playerIndex: last, helicopterUsed: false };
    state.phase = { kind: "roll", actors: [id(state, last)] };
    return state;
  }
  const endWith = (state: GameState): GameResult => roll(state, 3).state.result!;

  it("a tie is a tie: every player on the best total wins", () => {
    let s = finalTurn(3);
    s = withPlayer(s, 0, { cash: 900 });
    s = withPlayer(s, 1, { cash: 400 });
    s = withPlayer(s, 2, { cash: 900 });
    expect(endWith(s).winners).toEqual([id(s, 0), id(s, 2)]);
  });

  it("fine tokens come off the total and are not a tie-break", () => {
    let s = finalTurn(2);
    s = withPlayer(s, 0, { cash: 300 });
    // $500 cash but 2 tokens: $300, level with player 0.
    s = withPlayer(s, 1, { cash: 500, fineTokens: 2 });
    const result = endWith(s);
    expect(result.scores.map((x) => x.total)).toEqual([300, 300]);
    expect(result.winners).toEqual([id(s, 0), id(s, 1)]);
  });

  it("fish still on a ship count for nothing", () => {
    let s = finalTurn(2);
    s = withPlayer(s, 0, { cash: 100, fish: [700, 500] });
    s = withPlayer(s, 1, { cash: 200 });
    expect(endWith(s)).toMatchObject({
      scores: [{ total: 100 }, { total: 200 }],
      winners: [id(s, 1)],
    });
  });

  it("everyone on $0 shares the win; negative totals are allowed", () => {
    const zero = finalTurn(3);
    expect(endWith(zero).winners).toEqual(zero.players.map((p) => p.id));
    const owing = withPlayer(finalTurn(2), 0, { fineTokens: 3 });
    expect(endWith(owing)).toMatchObject({
      scores: [{ total: -300 }, { total: 0 }],
      winners: [id(owing, 1)],
    });
  });

  it("scoreGame works on any list of players", () => {
    const players = started(2).players.map((p, i) => ({ ...p, cash: i * 100 }));
    expect(scoreGame(content, players).winners).toEqual([players[1]!.id]);
  });
});
