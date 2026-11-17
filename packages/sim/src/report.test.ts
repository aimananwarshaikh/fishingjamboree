import { describe, expect, it } from "vitest";
import { makeSpecs, runSpecs } from "./batch";
import { buildReport, formatReport, spread } from "./report";
import { content, raw } from "./testContent";

describe("report", () => {
  it("spread", () => {
    expect(spread([5, 1, 3, 2, 4])).toEqual({ mean: 3, p10: 1, median: 3, p90: 5, min: 1, max: 5 });
    expect(spread([]).mean).toBe(0);
  });

  it("covers each player count, and win shares add up to the games", () => {
    const records = runSpecs(
      content,
      makeSpecs({
        seed: "rep",
        players: [2, 3, 4],
        games: 12,
        bots: ["greedy", "cautious", "risk-taker", "random"],
      }),
    );
    const report = buildReport(records, raw.awards, "mix");
    expect(report.groups.map((g) => g.players)).toEqual([2, 3, 4]);
    for (const g of report.groups) {
      expect(g.games).toBe(12);
      const seatWins = g.winBySeat.reduce((a, l) => a + l.wins, 0);
      const botWins = g.winByBot.reduce((a, l) => a + l.wins, 0);
      expect(seatWins).toBeCloseTo(12);
      expect(botWins).toBeCloseTo(12);
      expect(g.winBySeat.map((l) => l.key)).toEqual(
        Array.from({ length: g.players }, (_, i) => `turn ${i + 1}`),
      );
      expect(g.awards.lines).toHaveLength(raw.awards.awards.length);
    }
    const text = formatReport(report);
    expect(text).toContain("## 4 players (12 games)");
    expect(text).toContain("Golden Hook Awards");
  });
});
