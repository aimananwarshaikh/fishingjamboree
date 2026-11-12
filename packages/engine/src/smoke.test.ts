import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { actor, content, deepFreeze, invariantProblems, started } from "./testHelpers";
import type { GameEvent } from "./types";

// A light check that no phase can stall and the state stays sound. The real
// fuzz test (1,000 games, random bot) is stage 4c.
describe("whole games with cards, events, docks and the shop", () => {
  const games: [number, string, number][] = [
    [2, "smoke-a", 1],
    [3, "smoke-b", 3],
    [4, "smoke-c", 5],
    [4, "smoke-d", 7],
    [3, "smoke-e", 11],
    [2, "smoke-f", 13],
  ];

  it.each(games)("%i players, seed %s", (players, seed, stride) => {
    let state = started(players, seed);
    const seen = new Set<GameEvent["type"]>();
    let guard = 0;
    while (state.phase.kind !== "gameOver") {
      if (++guard > 5000) throw new Error("game did not end");
      const legal = getLegalActions(content, state, actor(state));
      expect(legal.length).toBeGreaterThan(0);
      const action = legal[(state.actionCount * stride) % legal.length]!;
      const result = applyAction(content, deepFreeze(state), action);
      if (!result.ok) throw new Error(`legal action rejected: ${result.error.message}`);
      state = result.state;
      for (const e of result.events) seen.add(e.type);
      expect(invariantProblems(state)).toEqual([]);
    }
    expect(state.round).toBe(content.rules.rounds);
    expect(state.activeEvent?.drawnAfterRound).toBe(15);
    expect(state.decks.event.discard).toHaveLength(2);
    for (const type of ["cardDrawn", "fishGained", "eventDrawn", "eventExpired"] as const) {
      expect(seen).toContain(type);
    }
  });
});
