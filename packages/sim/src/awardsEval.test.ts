import { describe, expect, it } from "vitest";
import type { AwardsContent, PlayerStats } from "@fishingjamboree/engine";
import { evaluateAwards, validSets } from "./awardsEval";
import type { GameRecord, PlayerRecord } from "./play";
import { runSpecs, makeSpecs } from "./batch";
import { content, raw } from "./testContent";

const stats = {} as PlayerStats;
const player = (seat: string, base: number): PlayerRecord => ({
  seat,
  bot: "greedy",
  turnIndex: Number(seat.slice(1)) - 1,
  cash: base,
  fineTokens: 0,
  base,
  awards: 0,
  total: base,
  speed: false,
  capacity: false,
  helicopterUses: 0,
  sinkingBoats: 0,
  stats,
});
const record = (bases: number[], awardWinners: Record<string, string[]>): GameRecord => ({
  seed: "x",
  players: bases.length,
  actions: 0,
  scores: bases.map((b, i) => player(`p${i + 1}`, b)),
  winners: [],
  baseWinners: [],
  drawn: [],
  awardWinners,
  goldenFish: { placed: 0, taken: 0, lost: 0, expired: 0 },
  events: {},
});
const awards = (amounts: Record<string, number>, budget: number, perGame = 2): AwardsContent => ({
  perGame: { "2": perGame, "3": perGame },
  budget,
  awards: Object.entries(amounts).map(([id, amount]) => ({
    id,
    name: id,
    text: id,
    kind: "most",
    stat: "fishCaught",
    amount,
  })),
});

describe("validSets", () => {
  it("matches the engine's count for the real content (review P2-4: 364 sets of 3, 101 pairs)", () => {
    expect(validSets(raw.awards, 3)).toHaveLength(364);
    expect(validSets(raw.awards, 2)).toHaveLength(101);
  });

  it("respects the budget and the conflicts", () => {
    const a: AwardsContent = {
      ...awards({ a: 300, b: 300, c: 500 }, 700),
      awards: [
        {
          id: "a",
          name: "a",
          text: "a",
          kind: "most",
          stat: "fishCaught",
          amount: 300,
          conflicts: ["b"],
        },
        { id: "b", name: "b", text: "b", kind: "most", stat: "fishCaught", amount: 300 },
        { id: "c", name: "c", text: "c", kind: "most", stat: "fishCaught", amount: 400 },
      ],
    };
    expect(validSets(a, 2).map((s) => s.map((x) => x.id))).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });
});

describe("evaluateAwards", () => {
  it("averages exactly over the valid sets", () => {
    // Sets: {a,b}, {a,c}, {b,c}. p2 trails by $200; a pays p2 $300, b and c pay p1 $100.
    const r = record([1000, 800], { a: ["p2"], b: ["p1"], c: ["p1"] });
    const s = evaluateAwards([r], awards({ a: 300, b: 100, c: 100 }, 1000));
    // {a,b}: 1100 vs 1100, tie (changed). {a,c}: same. {b,c}: 1200 vs 800 (same winner).
    expect(s.flipRate).toBeCloseTo(2 / 3);
    expect(s.meanPaidPerGame).toBeCloseTo((400 + 400 + 200) / 3);
    expect(s.oneTakesAll).toBeCloseTo(1 / 3);
    const a = s.lines.find((l) => l.id === "a")!;
    expect(a.drawRate).toBeCloseTo(2 / 3);
    expect(a.paidRate).toBe(1);
    expect(a.meanPayoutWhenPaid).toBe(300);
    expect(s.flipByGap.find((b) => b.label === "$100-$200")).toEqual({
      label: "$100-$200",
      games: 1,
      flips: 2 / 3,
    });
  });

  it("a tied award pays each winner", () => {
    const s = evaluateAwards(
      [record([0, 0], { a: ["p1", "p2"], b: [] })],
      awards({ a: 200, b: 100 }, 1000),
    );
    expect(s.lines[0]!.meanPayoutWhenPaid).toBe(400);
    expect(s.lines[1]!.paidRate).toBe(0);
  });

  it("agrees with the money the engine paid, on average over many games", () => {
    // Over 200 real games the evaluator's mean must be close to the money actually paid.
    const records = runSpecs(
      content,
      makeSpecs({
        seed: "eval",
        players: [3],
        games: 200,
        bots: ["greedy", "cautious", "risk-taker"],
      }),
    );
    const actual =
      records.reduce((a, r) => a + r.scores.reduce((b, s) => b + s.awards, 0), 0) / records.length;
    const expected = evaluateAwards(records, raw.awards).meanPaidPerGame;
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.15);
  }, 30_000);
});
