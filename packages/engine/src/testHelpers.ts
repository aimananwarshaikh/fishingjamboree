/**
 * Test helpers for the movement and turn-flow tests. Only tests import this.
 * Coordinates are (x, y) on the real board, x from the left, y from the top.
 */
import { applyAction } from "./apply";
import type { Ctx } from "./ctx";
import { expandDeckList } from "./decks";
import { getLegalActions } from "./legal";
import { rollDie, seedRng } from "./rng";
import { createGame } from "./setup";
import { compiledContent } from "./testContent";
import type {
  Action,
  CardId,
  Content,
  DeckId,
  GameEvent,
  GameState,
  GameUpdate,
  PlayerId,
  PlayerState,
  RngState,
  TileId,
} from "./types";

export const content = compiledContent();
export const { board } = content;

export const tile = (x: number, y: number): TileId => y * board.width + x;

export const isDock = (t: TileId): boolean => board.tiles[t]?.terrain === "dock";

/**
 * Brute force: walk every legal route (no step back, no ships, a dock ends
 * the move and is never entered from a dock) and collect where it may end.
 * Sea and risk tiles count at exactly `steps`; a free dock counts at any depth.
 */
export function oracle(from: TileId, steps: number, occupied: ReadonlySet<TileId>): TileId[] {
  const out = new Set<TileId>();
  const walk = (at: TileId, prev: TileId, left: number): void => {
    for (const nb of board.neighbours[at]!) {
      if (nb === prev || occupied.has(nb)) continue;
      if (isDock(nb)) {
        if (!isDock(at) && nb !== from) out.add(nb);
      } else if (left === 1) {
        if (nb !== from) out.add(nb);
      } else {
        walk(nb, at, left - 1);
      }
    }
  };
  if (steps > 0) walk(from, -1, steps);
  return [...out].sort((a, b) => a - b);
}

export const START_LEFT = tile(3, 19);
export const START_RIGHT = tile(4, 19);
export const CRUISE = tile(7, 1);

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** An RNG state whose next die roll (of `sides`) is `die`. */
export function rngForDie(die: number, sides = content.rules.dieSides): RngState {
  for (let i = 0; i < 10_000; i++) {
    const rng = seedRng(`die-${i}`);
    if (rollDie(rng, sides)[0] === die) return rng;
  }
  throw new Error(`no seed found for die ${die}`);
}

/** Applies a legal action to a frozen state (so any mutation of the input throws). */
export function act(state: GameState, action: Action, c: Content = content): GameUpdate {
  const result = applyAction(c, deepFreeze(clone(state)), action);
  if (!result.ok) throw new Error(`rejected: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

export const actor = (state: GameState): PlayerId => state.phase.actors[0] as PlayerId;
export const id = (state: GameState, index: number): PlayerId =>
  (state.players[index] as GameState["players"][number]).id;
export const types = (events: GameEvent[]): string[] => events.map((e) => e.type);

/**
 * A game after setup: player 0 on the left starting dock, player 1 on the
 * right one, any others waiting. Phase: player 0 to roll, round 1.
 */
export function started(players: number, seed = "movement", c: Content = content): GameState {
  const ids = ["a", "b", "c", "d"].slice(0, players);
  const { state } = createGame(c, { seed, players: ids });
  return act(state, { type: "placeShip", player: actor(state), dock: "start-left" }, c).state;
}

/** Copy of `state` with ships moved; `positions[i]` is player i's tile (or null). */
export function withShips(state: GameState, positions: Record<number, TileId | null>): GameState {
  const next = clone(state);
  for (const [index, position] of Object.entries(positions)) {
    (next.players[Number(index)] as GameState["players"][number]).position = position;
  }
  return next;
}

export function withDie(state: GameState, die: number): GameState {
  return { ...clone(state), rng: rngForDie(die) };
}

export function withEvent(state: GameState, card: CardId): GameState {
  return { ...clone(state), activeEvent: { card, drawnAfterRound: 5 } };
}

/** The current actor rolls `die`. */
export function roll(state: GameState, die: number, c: Content = content): GameUpdate {
  return act(withDie(state, die), { type: "roll", player: actor(state) }, c);
}

export function moveTargets(state: GameState, c: Content = content): TileId[] {
  return getLegalActions(c, state, actor(state)).flatMap((a) => (a.type === "move" ? [a.to] : []));
}

/**
 * The current actor rolls `die` and takes the first legal move, if there is
 * one. Any decision the landing opens for them is settled the simplest way:
 * the first dock offered, nothing bought, no Helicopter.
 */
export function playTurn(state: GameState, die: number): GameState {
  const player = actor(state);
  let next = roll(state, die).state;
  if (next.phase.kind !== "move") return next;
  const to = moveTargets(next)[0] as TileId;
  next = act(next, { type: "move", player, to }).state;
  while (actor(next) === player && next.turn.playerIndex === state.turn.playerIndex) {
    const phase = next.phase;
    if (phase.kind === "placeShip" && phase.reason === "sinking-boat") {
      next = act(next, { type: "placeShip", player, dock: phase.docks[0] as string }).state;
    } else if (phase.kind === "dockShop" || phase.kind === "turnEnd") {
      next = act(next, { type: "endTurn", player }).state;
    } else break;
  }
  return next;
}

// --- Session 4 helpers ------------------------------------------------------

/** Copy of `state` with `patch` applied to player `index`. */
export function withPlayer(
  state: GameState,
  index: number,
  patch: Partial<PlayerState>,
): GameState {
  const next = clone(state);
  Object.assign(next.players[index] as PlayerState, patch);
  return next;
}

/**
 * Copy of `state` with one copy of `card` moved to the top of `deck`'s draw
 * pile (taken from lower in the pile, or from the discard pile). The deck's
 * contents do not change.
 */
export function withTopCard(state: GameState, deck: DeckId, card: CardId): GameState {
  const next = clone(state);
  const { draw, discard } = next.decks[deck];
  const from = draw.includes(card) ? draw : discard;
  const at = from.indexOf(card);
  if (at < 0) throw new Error(`withTopCard: no ${card} in the ${deck} deck`);
  from.splice(at, 1);
  draw.unshift(card);
  return next;
}

/**
 * Like `withEvent`, but takes the card out of the event deck as a real draw
 * would, so the deck contents stay right.
 */
export function withActiveEvent(state: GameState, card: CardId, afterRound = 5): GameState {
  const next = clone(state);
  const { draw, discard } = next.decks.event;
  const from = draw.includes(card) ? draw : discard;
  const at = from.indexOf(card);
  if (at < 0) throw new Error(`withActiveEvent: no ${card} in the event deck`);
  from.splice(at, 1);
  next.activeEvent = { card, drawnAfterRound: afterRound };
  return next;
}

/**
 * The player whose turn it is stands on `from` and moves one step to the
 * neighbouring tile `to` (the roll is skipped: the state is put straight into
 * the move phase with 1 step).
 */
export function land(state: GameState, from: TileId, to: TileId, c: Content = content): GameUpdate {
  const next = clone(state);
  const player = next.players[next.turn.playerIndex] as PlayerState;
  player.position = from;
  next.phase = {
    kind: "move",
    roll: { die: 1, speedBonus: 0, eventModifier: 0, steps: 1 },
    actors: [player.id],
  };
  return act(next, { type: "move", player: player.id, to }, c);
}

/** Every card of `deck` wherever it is now (draw pile, discard pile, active event), sorted. */
export function deckCards(state: GameState, deck: DeckId): CardId[] {
  const { draw, discard } = state.decks[deck];
  const active = deck === "event" && state.activeEvent ? [state.activeEvent.card] : [];
  return [...draw, ...discard, ...active].sort();
}

/** The deck list from the content, sorted the same way. */
export const fullDeck = (deck: DeckId, c: Content = content): CardId[] =>
  expandDeckList(c.cards.decks[deck]).sort();

/** A context for calling rule helpers directly. */
export const ctxFor = (state: GameState, c: Content = content): Ctx => ({
  content: c,
  state: clone(state),
  events: [],
});

/** The invariants of docs/architecture.md section 11 that hold in every state. */
export function invariantProblems(state: GameState, c: Content = content): string[] {
  const out: string[] = [];
  for (const p of state.players) {
    const capacity = p.upgrades.capacity
      ? c.rules.upgrades.capacity.capacity
      : c.rules.baseCapacity;
    if (p.cash < 0) out.push(`${p.id}: negative cash`);
    if (p.fish.length > capacity) out.push(`${p.id}: over capacity`);
    if (p.fineTokens > 0 && p.cash !== 0) out.push(`${p.id}: fine tokens and cash`);
    if (p.fineTokens < 0) out.push(`${p.id}: negative fine tokens`);
  }
  const tiles = state.players.flatMap((p) => (p.position === null ? [] : [p.position]));
  if (new Set(tiles).size !== tiles.length) out.push("two ships share a tile");
  for (const deck of ["safe", "risk", "event"] as const) {
    if (deckCards(state, deck).join() !== fullDeck(deck, c).join())
      out.push(`${deck} deck changed`);
  }
  return out;
}
