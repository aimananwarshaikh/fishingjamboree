import { describe, expect, it } from "vitest";
import type { AwardsContent, PlayerStats } from "@fishingjamboree/engine";
import { evaluateAwards, validSets } from "./awardsEval";
import type { GameRecord, PlayerRecord } from "./play";
import { runSpecs, makeSpecs } from "./batch";
import { fileURLToPath } from "node:url";
import { readRawContent } from "./content";
import { content, raw } from "./testContent";

// Each test award looks at its own stat, so a test can say who wins it.
const STAT_OF: Record<string, keyof PlayerStats> = {
  a: "fishCaught",
  b: "tilesMoved",
  c: "bootDraws",
};
const noStats = (): PlayerStats => ({
  fishCaught: 0,
  fishLostToCapacity: 0,
  fishLostToShark: 0,
  tilesMoved: 0,
  riskDraws: 0,
  sharkDraws: 0,
  bootDraws: 0,
  dockVisits: 0,
  finesPaid: 0,
  goldenFishTaken: 0,
  turnsBlocked: 0,
});
const player = (seat: string, base: number, winning: string[]): PlayerRecord => {
  const stats = noStats();
  for (const id of winning) stats[STAT_OF[id]!] = 1;
  return {
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
    removed: false,
    missedLastTurn: false,
    stats,
  };
};
/** `winners`: award id to the seats that win it (a stat of 1; everyone else 0). */
const record = (bases: number[], winners: Record<string, string[]>): GameRecord => {
  const seats = bases.map((_, i) => `p${i + 1}`);
  return {
    seed: "x",
    players: bases.length,
    actions: 0,
    scores: seats.map((seat, i) =>
      player(
        seat,
        bases[i]!,
        Object.keys(winners).filter((id) => winners[id]!.includes(seat)),
      ),
    ),
    winners: [],
    baseWinners: [],
    drawn: [],
    goldenFish: { placed: 0, taken: 0, lost: 0, expired: 0 },
    events: {},
  };
};
const awards = (amounts: Record<string, number>, budget: number, perGame = 2): AwardsContent => ({
  perGame: { "2": perGame, "3": perGame },
  budget,
  awards: Object.entries(amounts).map(([id, amount]) => ({
    id,
    name: id,
    text: id,
    kind: "most",
    stat: STAT_OF[id]!,
    amount,
  })),
});

describe("validSets", () => {
  it("matches the engine's count for the pre-B6 pool (review P2-4: 364 sets of 3, 101 pairs)", () => {
    const original = readRawContent(
      fileURLToPath(new URL("../../../docs/balance/original-content", import.meta.url)),
    );
    expect(validSets(original.awards, 3)).toHaveLength(364);
    expect(validSets(original.awards, 2)).toHaveLength(101);
  });

  it("every set the engine draws for the real content is one of them", () => {
    const sets = new Set(
      validSets(raw.awards, 3).map((s) =>
        s
          .map((a) => a.id)
          .sort()
          .join(),
      ),
    );
    for (const r of runSpecs(
      content,
      makeSpecs({ seed: "drawn", players: [3], games: 40, bots: ["random"] }),
    )) {
      expect(sets.has([...r.drawn].sort().join())).toBe(true);
    }
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

  it("re-resolves a changed definition from the recorded stats", () => {
    // p1 has the stat at 1, p2 at 0: "most" pays p1; "least" pays nobody (0 never wins); a condition max 0 pays p2.
    const r = record([0, 0], { a: ["p1"], b: [] });
    const base = awards({ a: 100, b: 100 }, 1000, 1);
    const def = base.awards[0]!;
    const pays = (d: typeof def) =>
      evaluateAwards([r], { ...base, awards: [d] }).lines[0]!.paidRate;
    expect(pays(def)).toBe(1);
    expect(pays({ ...def, kind: "least" })).toBe(0);
    expect(pays({ ...def, kind: "condition", max: 0 })).toBe(1);
    expect(
      evaluateAwards([r], { ...base, awards: [{ ...def, kind: "condition", max: 0 }] }).lines[0]!
        .meanPayoutWhenPaid,
    ).toBe(100);
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
