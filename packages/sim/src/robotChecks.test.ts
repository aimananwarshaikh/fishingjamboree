import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalActions, redactForClient } from "@fishingjamboree/engine";
import type { Action, GameState, MissReason, PlayerId, ReplayLog } from "@fishingjamboree/engine";
import { botByName } from "./bots";
import { auditGame, compareShownResult } from "./robotChecks";
import { content } from "./testContent";

/** Plays a bot game where `miss(player, actionCount)` can make the server miss a turn instead. */
function playWithMisses(
  seed: string,
  count: number,
  miss: (player: PlayerId, n: number) => MissReason | null,
  kick?: { player: PlayerId; at: number },
): { log: ReplayLog; state: GameState } {
  const players = ["p1", "p2", "p3", "p4"].slice(0, count) as PlayerId[];
  const setup = { seed, players };
  let state = createGame(content, setup).state;
  const actions: Action[] = [];
  const bot = botByName("greedy");
  while (state.phase.kind !== "gameOver" && actions.length < 5000) {
    let action: Action;
    if (
      kick &&
      actions.length === kick.at &&
      !state.players.find((p) => p.id === kick.player)!.removed
    ) {
      action = { type: "removePlayer", player: kick.player };
    } else {
      const actor = state.phase.actors[0] as PlayerId;
      const reason = miss(actor, actions.length);
      const legal = getLegalActions(content, state, actor);
      action =
        reason !== null
          ? { type: "missTurn", player: actor, reason }
          : bot.choose({ content, view: redactForClient(state, actor), legal, seed });
    }
    const r = applyAction(content, state, action);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
    actions.push(action);
  }
  return { log: { schemaVersion: 1, contentHash: content.hash, setup, actions }, state };
}

describe("robot playtest checks (B7)", () => {
  it("a plain bot game passes every check", () => {
    for (const count of [2, 3, 4]) {
      const game = playWithMisses(`plain-${count}`, count, () => null);
      const audit = auditGame(content, game);
      expect(audit.problems).toEqual([]);
      expect(audit.result).not.toBeNull();
      expect(audit.result!.awards).toHaveLength(count === 2 ? 2 : 3);
      expect(compareShownResult(audit.result!, game.state.result, "tab")).toEqual([]);
    }
  });

  it("three timed-out turns in a row remove the player, and the audit agrees", () => {
    const game = playWithMisses("idle", 3, (p, n) => (p === "p2" && n > 20 ? "timeout" : null));
    const audit = auditGame(content, game);
    expect(audit.problems).toEqual([]);
    expect(audit.players.p2).toMatchObject({ removed: "missed-turns", longestRun: 3 });
    expect(audit.players.p2!.timeoutMisses).toBeGreaterThanOrEqual(3);
  });

  it("away misses do not count and do not break the run", () => {
    let k = 0;
    // p3 alternates: timeout, away, timeout, away, timeout → removed on the third timeout.
    const game = playWithMisses("mixed", 3, (p, n) => {
      if (p !== "p3" || n < 20) return null;
      return k++ % 2 === 0 ? "timeout" : "away";
    });
    const audit = auditGame(content, game);
    expect(audit.problems).toEqual([]);
    expect(audit.players.p3).toMatchObject({ removed: "missed-turns", timeoutMisses: 3 });
    expect(audit.players.p3!.awayMisses).toBeGreaterThanOrEqual(2);
  });

  it("away only: never removed", () => {
    const game = playWithMisses("away", 3, (p, n) => (p === "p1" && n > 10 ? "away" : null));
    const audit = auditGame(content, game);
    expect(audit.problems).toEqual([]);
    expect(audit.players.p1!.removed).toBeNull();
    expect(audit.players.p1!.awayMisses).toBeGreaterThan(10);
  });

  it("a host kick is reported as kicked; the last player left wins", () => {
    const game = playWithMisses("kick", 2, () => null, { player: "p2", at: 30 });
    const audit = auditGame(content, game);
    expect(audit.problems).toEqual([]);
    expect(audit.players.p2!.removed).toBe("kicked");
    expect(audit.result!.reason).toBe("last-player");
    expect(audit.result!.winners).toEqual(["p1"]);
  });

  it("finds a saved state the log does not give, and a tab that shows another result", () => {
    const game = playWithMisses("tamper", 2, () => null);
    const bad = { ...game, state: { ...game.state, round: game.state.round + 1 } };
    expect(auditGame(content, bad).problems).toContain(
      "the replay of the saved log differs from the saved state",
    );
    const result = game.state.result!;
    const shown = { ...result, winners: ["p9" as PlayerId] };
    expect(compareShownResult(result, shown, "Ann")[0]).toMatch(/^Ann: winners p9/);
    expect(compareShownResult(result, null, "Ann")).toEqual(["Ann: no result shown"]);
  });

  it("finds a removal that came too early", () => {
    const game = playWithMisses("early", 3, (p, n) => (p === "p2" && n > 20 ? "timeout" : null));
    // Pretend the engine had removed p2 after one counted miss: drop two misses before the removal.
    const i = game.log.actions.findIndex((a) => a.type === "missTurn");
    const tampered = {
      ...game,
      log: { ...game.log, actions: game.log.actions.filter((_, j) => j !== i) },
    };
    const audit = auditGame(content, tampered);
    // The replay changes (two misses then removal is not what the engine does), so something is reported.
    expect(audit.problems.length).toBeGreaterThan(0);
  });
});
