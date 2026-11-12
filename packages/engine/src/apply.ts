/**
 * applyAction: validates one action, applies it, then runs every automatic
 * step up to the next decision (docs/architecture.md sections 3 and 4).
 *
 * This file owns the turn flow: placement, the roll, the move, the shop and
 * Helicopter decisions, and the turn/round advance. What a landing does is in
 * `landing.ts`; event cards are in `eventCards.ts`.
 */
import type { Ctx } from "./ctx";
import { relocateTo } from "./dock";
import { sellFish } from "./economy";
import { nextEvent } from "./eventCards";
import { resolveLanding } from "./landing";
import { getLegalActions } from "./legal";
import { affordableUpgrades, helicopterFee, helicopterUsable } from "./modifiers";
import { computeRoll, destinationsFor, freeStartingDocks } from "./movement";
import { rollDie } from "./rng";
import type {
  Action,
  ActionErrorCode,
  ActionType,
  ApplyResult,
  DockId,
  Engine,
  GameState,
  PhaseKind,
  PlaceShipReason,
  PlayerState,
} from "./types";

/** Only two ships are placed before round 1 (rulebook setup steps 6 and 7). */
const SETUP_SHIPS = 2;

const PHASE_ACTIONS: Record<PhaseKind, readonly ActionType[]> = {
  placeShip: ["placeShip"],
  roll: ["roll", "useHelicopter"],
  move: ["move"],
  dockShop: ["buyUpgrade", "endTurn"],
  turnEnd: ["useHelicopter", "endTurn"],
  gameOver: [],
};

const fail = (code: ActionErrorCode, message: string): ApplyResult => ({
  ok: false,
  error: { code, message },
});

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;
  if (a.type === "placeShip") return a.dock === (b as typeof a).dock;
  if (a.type === "move") return a.to === (b as typeof a).to;
  if (a.type === "buyUpgrade") return a.upgrade === (b as typeof a).upgrade;
  return true;
}

function placeOnDock(ctx: Ctx, player: PlayerState, dockId: DockId, reason: PlaceShipReason): void {
  const dock = ctx.content.board.docks.find((d) => d.id === dockId);
  if (!dock) throw new Error(`placeOnDock: unknown dock ${dockId}`);
  player.position = dock.tile;
  ctx.events.push({
    type: "shipPlaced",
    player: player.id,
    dock: dock.id,
    tile: dock.tile,
    reason,
  });
}

/** Places the remaining setup ships, then starts round 1. */
function continueSetup(ctx: Ctx): void {
  const { state } = ctx;
  for (const player of state.players.slice(0, SETUP_SHIPS)) {
    if (player.position !== null) continue;
    const free = freeStartingDocks(ctx.content, state);
    if (free.length > 1) {
      state.phase = { kind: "placeShip", reason: "setup", docks: free, actors: [player.id] };
      return;
    }
    // compileContent guarantees two starting docks, so one is always left here.
    placeOnDock(ctx, player, free[0] as DockId, "setup");
  }
  ctx.events.push({ type: "roundStarted", round: state.round });
  startTurn(ctx, 0);
}

/**
 * Moves on from `index`'s finished turn. Ends the round after the last
 * player. Returns the next player's index, or `null` when the game is over.
 */
function advance(ctx: Ctx, index: number): number | null {
  const { state, content } = ctx;
  if (index + 1 < state.players.length) return index + 1;
  ctx.events.push({ type: "roundEnded", round: state.round });
  if (state.round >= content.rules.rounds) {
    // TODO(4b): end of game. Remove an unclaimed Golden Fish (`goldenFishRemoved`, reason
    // "game-end"), compute `state.result` (total = cash - fineTokens * fineTokenValue; every
    // player with the highest total is a winner: a tie is a tie) and emit `gameEnded`.
    state.phase = { kind: "gameOver", actors: [] };
    return null;
  }
  if (content.rules.eventAfterRounds.includes(state.round)) nextEvent(ctx, state.round);
  state.round += 1;
  ctx.events.push({ type: "roundStarted", round: state.round });
  return 0;
}

/**
 * Starts `index`'s turn and stops at their first decision. A player waiting
 * off the board enters on a free starting dock (their choice if several are
 * free) or, with none free, misses the turn and play passes on.
 */
function startTurn(ctx: Ctx, index: number): void {
  const { state } = ctx;
  let current: number | null = index;
  while (current !== null) {
    const player = state.players[current] as PlayerState;
    state.turn = { playerIndex: current, helicopterUsed: false };
    ctx.events.push({ type: "turnStarted", player: player.id, round: state.round });

    if (player.position === null) {
      const free = freeStartingDocks(ctx.content, state);
      if (free.length === 0) {
        ctx.events.push({
          type: "turnSkipped",
          player: player.id,
          reason: "no-free-starting-dock",
        });
        ctx.events.push({ type: "turnEnded", player: player.id });
        current = advance(ctx, current);
        continue;
      }
      if (free.length > 1) {
        state.phase = { kind: "placeShip", reason: "entry", docks: free, actors: [player.id] };
        return;
      }
      placeOnDock(ctx, player, free[0] as DockId, "entry");
    }
    state.phase = { kind: "roll", actors: [player.id] };
    return;
  }
}

/** Ends the current player's turn for good and moves play on. */
function closeTurn(ctx: Ctx): void {
  const index = ctx.state.turn.playerIndex;
  ctx.events.push({ type: "turnEnded", player: (ctx.state.players[index] as PlayerState).id });
  const next = advance(ctx, index);
  if (next !== null) startTurn(ctx, next);
}

/**
 * Every turn comes through here once its tile, card and shop are done. The
 * turn waits in `turnEnd` only if the player could still use the Helicopter.
 */
function finishTurn(ctx: Ctx): void {
  const { state, content } = ctx;
  const player = state.players[state.turn.playerIndex] as PlayerState;
  if (helicopterUsable(content, state, player)) {
    state.phase = { kind: "turnEnd", actors: [player.id] };
    return;
  }
  closeTurn(ctx);
}

function applyLegal(ctx: Ctx, action: Action, player: PlayerState): void {
  const { state, content } = ctx;
  const phase = state.phase;
  switch (action.type) {
    case "placeShip": {
      if (phase.kind !== "placeShip") return;
      if (phase.reason === "sinking-boat") {
        // The victim chose between the free starting docks.
        const dock = content.board.docks.find((d) => d.id === action.dock);
        if (!dock) return;
        if (!relocateTo(ctx, player, dock)) finishTurn(ctx);
        return;
      }
      placeOnDock(ctx, player, action.dock, phase.reason);
      if (phase.reason === "setup") continueSetup(ctx);
      else state.phase = { kind: "roll", actors: [player.id] };
      return;
    }
    case "roll": {
      const [die, rng] = rollDie(state.rng, content.rules.dieSides);
      state.rng = rng;
      const roll = computeRoll(content, state, player, die);
      ctx.events.push({ type: "rolled", player: player.id, roll });
      if (roll.steps === 0) {
        ctx.events.push({ type: "blocked", player: player.id, reason: "zero-steps" });
        finishTurn(ctx);
      } else if (destinationsFor(content, state, player, roll.steps).length === 0) {
        // The ship stays where it is. On a dock it stays docked and does not dock again.
        ctx.events.push({ type: "blocked", player: player.id, reason: "no-legal-move" });
        finishTurn(ctx);
      } else {
        state.phase = { kind: "move", roll, actors: [player.id] };
      }
      return;
    }
    case "move": {
      if (phase.kind !== "move" || player.position === null) return;
      const from = player.position;
      const dest = destinationsFor(content, state, player, phase.roll.steps).find(
        (d) => d.to === action.to,
      );
      if (!dest) return;
      player.position = dest.to;
      ctx.events.push({ type: "moved", player: player.id, from, to: dest.to, path: dest.path });
      if (!resolveLanding(ctx)) finishTurn(ctx);
      return;
    }
    case "buyUpgrade": {
      const { price } = content.rules.upgrades[action.upgrade];
      player.cash -= price;
      player.upgrades[action.upgrade] = true;
      ctx.events.push({
        type: "upgradeBought",
        player: player.id,
        upgrade: action.upgrade,
        price,
      });
      // The shop stays open only while there is still something to buy.
      if (affordableUpgrades(content, player).length === 0) finishTurn(ctx);
      return;
    }
    case "useHelicopter": {
      const fee = helicopterFee(content, state);
      if (fee === null) return;
      // The fee comes out of cash on hand before anything is sold.
      player.cash -= fee;
      state.turn.helicopterUsed = true;
      ctx.events.push({ type: "helicopterUsed", player: player.id, fee });
      sellFish(ctx, player, "helicopter");
      // Before the roll the turn carries on; at the end of the turn it is over.
      if (phase.kind === "turnEnd") closeTurn(ctx);
      return;
    }
    case "endTurn": {
      if (phase.kind === "turnEnd") closeTurn(ctx);
      else finishTurn(ctx);
      return;
    }
  }
}

export const applyAction: Engine["applyAction"] = (content, state, action) => {
  const phase = state.phase;
  if (phase.kind === "gameOver") return fail("game-over", "the game is over");
  if (!state.players.some((p) => p.id === action.player)) {
    return fail("unknown-player", `no player "${action.player}" in this game`);
  }
  if (!phase.actors.includes(action.player)) {
    return fail("not-your-turn", `it is not ${action.player}'s decision`);
  }
  if (!PHASE_ACTIONS[phase.kind].includes(action.type)) {
    return fail("wrong-phase", `"${action.type}" is not possible in the ${phase.kind} phase`);
  }
  if (!getLegalActions(content, state, action.player).some((a) => sameAction(a, action))) {
    return fail("illegal-action", `that "${action.type}" is not legal now`);
  }

  const draft = JSON.parse(JSON.stringify(state)) as GameState;
  const ctx: Ctx = { content, state: draft, events: [] };
  const player = draft.players.find((p) => p.id === action.player) as PlayerState;
  applyLegal(ctx, action, player);
  draft.actionCount += 1;
  return { ok: true, state: draft, events: ctx.events };
};
