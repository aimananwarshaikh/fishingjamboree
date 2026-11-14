/**
 * applyAction: validates one action, applies it, then runs every automatic
 * step up to the next decision (docs/architecture.md sections 3 and 4).
 *
 * This file owns the turn flow: placement, the roll, the move, the shop and
 * Helicopter decisions, and the turn/round advance. What a landing does is in
 * `landing.ts`; event cards are in `eventCards.ts`. Online play adds two
 * system actions the server decides: a missed turn and removing a player.
 */
import { resolveAwards, syncStats } from "./awards";
import type { Ctx } from "./ctx";
import { relocateTo } from "./dock";
import { scoreGame, sellFish } from "./economy";
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
  GameEndReason,
  GameState,
  PhaseKind,
  PlaceShipReason,
  PlayerState,
  MissReason,
  RemovalReason,
} from "./types";

const PHASE_ACTIONS: Record<PhaseKind, readonly ActionType[]> = {
  placeShip: ["placeShip"],
  roll: ["roll", "useHelicopter"],
  move: ["move"],
  dockShop: ["buyUpgrade", "endTurn"],
  turnEnd: ["useHelicopter", "endTurn"],
  gameOver: [],
};

/**
 * `applyAction` checks legality first, so these cannot happen; if one does,
 * it is a bug, and failing loudly beats quietly ending the turn.
 */
const impossible = (what: string) => new Error(`applyAction: impossible: ${what}`);

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

/** The first player at or after `from` (in turn order) who is still in the game, or `null`. */
function nextInGame(state: GameState, from: number): number | null {
  for (let i = from; i < state.players.length; i += 1) {
    if (!(state.players[i] as PlayerState).removed) return i;
  }
  return null;
}

/** Places the remaining setup ships, then starts round 1. */
function continueSetup(ctx: Ctx): void {
  const { state } = ctx;
  // The first players in turn order who are still in the game place the setup ships.
  const setupShips = ctx.content.rules.setupShips;
  for (const player of state.players.filter((p) => !p.removed).slice(0, setupShips)) {
    if (player.position !== null) continue;
    const free = freeStartingDocks(ctx.content, state);
    if (free.length > 1) {
      state.phase = { kind: "placeShip", reason: "setup", docks: free, actors: [player.id] };
      return;
    }
    // compileContent keeps setupShips within the starting docks, so one is always left here.
    placeOnDock(ctx, player, free[0] as DockId, "setup");
  }
  ctx.events.push({ type: "roundStarted", round: state.round });
  startTurn(ctx, nextInGame(state, 0) as number);
}

/**
 * After the last turn of the last round: an unclaimed Golden Fish is removed,
 * the Golden Hook Awards are revealed and paid (one `awardGiven` each), the
 * scores are counted and the game is over. The last event card stays active
 * (it lasts until the end of the game) and is not discarded.
 */
function endGame(ctx: Ctx, reason: GameEndReason = "rounds"): void {
  const { state, content } = ctx;
  if (state.goldenFish) {
    ctx.events.push({ type: "goldenFishRemoved", spot: state.goldenFish.spot, reason: "game-end" });
    state.goldenFish = null;
  }
  syncStats(ctx); // the last turn counts
  const stats = JSON.parse(JSON.stringify(state.awards.stats)) as typeof state.awards.stats;
  const awards = resolveAwards(content, state.awards.chosen, state.players, stats);
  for (const award of awards) ctx.events.push({ type: "awardGiven", ...award });
  state.result = scoreGame(content, state.players, reason, awards, stats);
  state.phase = { kind: "gameOver", actors: [] };
  ctx.events.push({ type: "gameEnded", result: state.result });
}

/**
 * Moves on from `index`'s finished turn, skipping removed players. Ends the
 * round after the last player. Returns the next player's index, or `null`
 * when the game is over.
 */
function advance(ctx: Ctx, index: number): number | null {
  const { state, content } = ctx;
  const next = nextInGame(state, index + 1);
  if (next !== null) return next;
  ctx.events.push({ type: "roundEnded", round: state.round });
  if (state.round >= content.rules.rounds) {
    endGame(ctx);
    return null;
  }
  if (content.rules.eventAfterRounds.includes(state.round)) nextEvent(ctx, state.round);
  state.round += 1;
  ctx.events.push({ type: "roundStarted", round: state.round });
  return nextInGame(state, 0);
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

/**
 * The deciding player ran out of time or is away (online play). After the
 * move the turn just ends (`endAfterTheMove`). Before it, the turn is missed:
 * nothing more happens; a ship that has to be placed goes on the first dock
 * offered. Only a turn that ran the whole timer counts towards removal; too
 * many of those in a row remove the player.
 */
function missTurn(ctx: Ctx, player: PlayerState, reason: MissReason): void {
  const { state, content } = ctx;
  const phase = state.phase;
  if (afterTheMove(phase)) {
    endAfterTheMove(ctx, player, reason);
    return;
  }
  const counted = reason === "timeout";
  ctx.events.push({ type: "turnMissed", player: player.id, reason, counted });
  player.missedLastTurn = true;
  if (counted) player.missedTurns += 1;
  if (phase.kind === "placeShip") {
    // Setup or late entry (a Sinking Boat dock is after the move, above).
    if (phase.reason === "sinking-boat") throw impossible("missTurn on a Sinking Boat dock");
    placeOnDock(ctx, player, phase.docks[0] as DockId, phase.reason);
  }
  if (counted && player.missedTurns >= content.rules.missedTurnsBeforeRemoval) {
    removePlayer(ctx, player, "missed-turns");
  } else if (phase.kind === "placeShip" && phase.reason === "setup") {
    continueSetup(ctx);
  } else {
    closeTurn(ctx);
  }
}

/**
 * The decisions left once the ship has moved (or tried to): the dock shop,
 * the end-of-turn Helicopter choice, and the dock after a Sinking Boat.
 * Running out of time there is not a missed turn (designer, 2026-11-14).
 */
function afterTheMove(phase: GameState["phase"]): boolean {
  return (
    phase.kind === "dockShop" ||
    phase.kind === "turnEnd" ||
    (phase.kind === "placeShip" && phase.reason === "sinking-boat")
  );
}

/**
 * The server ends a turn after the move: everything done so far stands,
 * nothing more is bought or used, and the turn ends as if the player had
 * ended it (a Sinking Boat ship goes on the first dock offered, no shop).
 * It is not a missed turn: it counts towards neither removal nor the awards.
 */
function endAfterTheMove(ctx: Ctx, player: PlayerState, reason: MissReason): void {
  const { state, content } = ctx;
  const phase = state.phase;
  ctx.events.push({ type: "turnTimedOut", player: player.id, reason });
  if (phase.kind === "placeShip") {
    const dock = content.board.docks.find((d) => d.id === phase.docks[0]);
    if (!dock) throw impossible(`turnTimedOut: unknown dock ${String(phase.docks[0])}`);
    relocateTo(ctx, player, dock); // the shop it may open is closed at once
  }
  closeTurn(ctx);
}

/**
 * `player` leaves the game for good (online play): their ship leaves the
 * board, they get no more turns and cannot win. If it was their decision,
 * play moves on; with one player left, the game ends and that player wins.
 */
function removePlayer(ctx: Ctx, player: PlayerState, reason: RemovalReason): void {
  const { state } = ctx;
  const phase = state.phase;
  const deciding = phase.actors.includes(player.id);
  player.removed = true;
  player.position = null;
  ctx.events.push({ type: "playerRemoved", player: player.id, reason });
  if (state.players.filter((p) => !p.removed).length <= 1) {
    endGame(ctx, "last-player");
    return;
  }
  if (!deciding) return;
  if (phase.kind === "placeShip" && phase.reason === "setup") continueSetup(ctx);
  else closeTurn(ctx);
}

function applyLegal(ctx: Ctx, action: Action, player: PlayerState): void {
  const { state, content } = ctx;
  const phase = state.phase;
  if (action.type !== "missTurn" && action.type !== "removePlayer") {
    player.missedTurns = 0;
    player.missedLastTurn = false;
  }
  switch (action.type) {
    case "missTurn":
      missTurn(ctx, player, action.reason);
      return;
    case "removePlayer":
      removePlayer(ctx, player, "kicked");
      return;
    case "placeShip": {
      if (phase.kind !== "placeShip") throw impossible("placeShip outside a placeShip phase");
      if (phase.reason === "sinking-boat") {
        // The victim chose between the free starting docks.
        const dock = content.board.docks.find((d) => d.id === action.dock);
        if (!dock) throw impossible(`placeShip on an unknown dock ${action.dock}`);
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
      if (phase.kind !== "move" || player.position === null) {
        throw impossible("move outside a move phase or with no ship on the board");
      }
      const from = player.position;
      const dest = destinationsFor(content, state, player, phase.roll.steps).find(
        (d) => d.to === action.to,
      );
      if (!dest) throw impossible(`move to ${action.to}, which is not a destination`);
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
      if (fee === null) throw impossible("useHelicopter with no Helicopter event");
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
  if (action.type === "removePlayer") {
    // The host may remove any player still in the game, at any time.
    if (state.players.some((p) => p.id === action.player && p.removed)) {
      return fail("illegal-action", `${action.player} has already been removed`);
    }
  } else if (!phase.actors.includes(action.player)) {
    return fail("not-your-turn", `it is not ${action.player}'s decision`);
  } else if (action.type === "missTurn") {
    if (action.reason !== "timeout" && action.reason !== "away") {
      return fail("illegal-action", `"missTurn" needs a reason ("timeout" or "away")`);
    }
  } else {
    if (!PHASE_ACTIONS[phase.kind].includes(action.type)) {
      return fail("wrong-phase", `"${action.type}" is not possible in the ${phase.kind} phase`);
    }
    if (!getLegalActions(content, state, action.player).some((a) => sameAction(a, action))) {
      return fail("illegal-action", `that "${action.type}" is not legal now`);
    }
  }

  const draft = JSON.parse(JSON.stringify(state)) as GameState;
  const ctx: Ctx = { content, state: draft, events: [] };
  const player = draft.players.find((p) => p.id === action.player) as PlayerState;
  applyLegal(ctx, action, player);
  syncStats(ctx);
  draft.actionCount += 1;
  return { ok: true, state: draft, events: ctx.events };
};
