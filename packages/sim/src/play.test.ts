import { describe, expect, it } from "vitest";
import { replay } from "@fishingjamboree/engine";
import { playGame } from "./play";
import { content } from "./testContent";

describe("playGame", () => {
  it("records the engine's result", () => {
    const { state, record, actions } = playGame(content, {
      seed: "rec",
      bots: ["greedy", "cautious", "risk-taker", "random"],
    });
    const result = state.result!;
    expect(record.winners).toEqual(result.winners);
    expect(record.actions).toBe(actions.length);
    expect(record.scores.map((s) => s.seat)).toEqual(state.players.map((p) => p.id));
    for (const s of record.scores) {
      const score = result.scores.find((x) => x.player === s.seat)!;
      expect(s.total).toBe(score.total);
      expect(s.base + s.awards).toBe(s.total);
      expect(s.base).toBe(score.cash - score.fineTokens * content.rules.fineTokenValue);
    }
    // Seats keep their bots: p1 is the first bot in the spec, whatever the turn order.
    expect(record.scores.find((s) => s.seat === "p3")!.bot).toBe("risk-taker");
  });

  it("resolves every award the same way the engine does for the drawn ones", () => {
    for (let g = 0; g < 20; g += 1) {
      const { state, record } = playGame(content, {
        seed: `aw-${g}`,
        bots: ["greedy", "risk-taker", "cautious"],
      });
      expect(record.drawn).toHaveLength(3);
      expect(Object.keys(record.awardWinners).sort()).toEqual(
        content.awards.awards.map((a) => a.id).sort(),
      );
      for (const a of state.result!.awards) expect(record.awardWinners[a.award]).toEqual(a.winners);
      const paid = record.scores.reduce((sum, s) => sum + s.awards, 0);
      const expected = state.result!.awards.reduce(
        (sum, a) => sum + a.amount * a.winners.length,
        0,
      );
      expect(paid).toBe(expected);
    }
  });

  it("a bot game replays to the same state", () => {
    const { state, actions } = playGame(content, { seed: "replay", bots: ["greedy", "random"] });
    const again = replay(content, {
      schemaVersion: 1,
      contentHash: content.hash,
      setup: { seed: "replay", players: ["p1", "p2"] },
      actions,
    });
    expect(again.state).toEqual(state);
  });
});
