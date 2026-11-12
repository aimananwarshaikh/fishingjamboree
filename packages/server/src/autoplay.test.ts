import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalActions, redactForClient } from "@fishingjamboree/engine";
import type { GameState, PhaseKind } from "@fishingjamboree/engine";
import { chooseAutoAction } from "./autoplay";
import { content } from "./testHarness";

/**
 * Plays whole games in which seat "a" picks varied legal actions (so it buys
 * upgrades and reaches every phase) and checks `chooseAutoAction` at every
 * decision of every seat. Seed "auto-15" is the one where the Helicopter comes up.
 */
describe("chooseAutoAction", () => {
  const seen = new Set<PhaseKind>();
  let helicopterOffered = 0;
  let shopOffered = 0;

  it.each(["auto-1", "auto-2", "auto-3", "auto-15"])(
    "always picks a legal, cautious action (%s)",
    (seed) => {
      let state: GameState = createGame(content, { seed, players: ["a", "b", "c"] }).state;
      for (let guard = 0; state.phase.kind !== "gameOver"; guard += 1) {
        if (guard > 5_000) throw new Error("the game did not end");
        const player = state.phase.actors[0]!;
        const view = redactForClient(state, player);
        const legal = getLegalActions(content, view, player);
        const auto = chooseAutoAction(content, view, player);
        seen.add(state.phase.kind);

        expect(legal).toContainEqual(auto);
        expect(chooseAutoAction(content, state, player)).toEqual(auto);
        if (legal.some((a) => a.type === "useHelicopter")) helicopterOffered += 1;
        if (legal.some((a) => a.type === "buyUpgrade")) shopOffered += 1;
        expect(auto?.type).not.toBe("useHelicopter");
        expect(auto?.type).not.toBe("buyUpgrade");
        if (state.phase.kind === "roll") expect(auto?.type).toBe("roll");
        if (state.phase.kind === "dockShop" || state.phase.kind === "turnEnd") {
          expect(auto?.type).toBe("endTurn");
        }
        if (auto?.type === "move") {
          const risky = (to: number) => content.board.tiles[to]?.terrain === "risk";
          const calmExists = legal.some((a) => a.type === "move" && !risky(a.to));
          expect(risky(auto.to)).toBe(!calmExists);
        }

        const pick = player === "a" ? legal[(guard * 3) % legal.length]! : legal[0]!;
        const result = applyAction(content, state, pick);
        if (!result.ok) throw new Error(result.error.message);
        state = result.state;
      }
    },
  );

  it("was checked in every phase, with the Helicopter and the shop on offer", () => {
    expect([...seen].sort()).toEqual(["dockShop", "move", "placeShip", "roll", "turnEnd"]);
    expect(helicopterOffered).toBeGreaterThan(0);
    expect(shopOffered).toBeGreaterThan(0);
  });

  it("returns null for a player who has nothing to decide", () => {
    const { state } = createGame(content, { seed: "auto-1", players: ["a", "b", "c"] });
    const idle = state.players.map((p) => p.id).find((id) => !state.phase.actors.includes(id))!;
    expect(chooseAutoAction(content, state, idle)).toBeNull();
  });
});
