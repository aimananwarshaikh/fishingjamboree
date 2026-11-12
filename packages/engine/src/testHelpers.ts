/**
 * Test helpers for the movement and turn-flow tests. Only tests import this.
 * Coordinates are (x, y) on the real board, x from the left, y from the top.
 */
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { rollDie, seedRng } from "./rng";
import { createGame } from "./setup";
import { compiledContent } from "./testContent";
import type {
  Action,
  CardId,
  Content,
  GameEvent,
  GameState,
  GameUpdate,
  PlayerId,
  RngState,
  TileId,
} from "./types";

export const content = compiledContent();
export const { board } = content;

export const tile = (x: number, y: number): TileId => y * board.width + x;

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

/** The current actor rolls `die` and takes the first legal move, if there is one. */
export function playTurn(state: GameState, die: number): GameState {
  const rolled = roll(state, die).state;
  if (rolled.phase.kind !== "move") return rolled;
  const to = moveTargets(rolled)[0] as TileId;
  return act(rolled, { type: "move", player: actor(rolled), to }).state;
}
