/**
 * The mutable context every rule handler works on while `applyAction` builds
 * the next state. Handlers change `state` in place and append to `events`.
 */
import type { Content, GameEvent, GameState, PlayerState } from "./types";

export interface Ctx {
  content: Content;
  /** A private copy of the state; handlers mutate it freely. */
  state: GameState;
  events: GameEvent[];
  /** How many of `events` are already in the award stats (`syncStats`). */
  statsCounted?: number;
}

/** The player whose turn it is. */
export const currentPlayer = (ctx: Ctx): PlayerState =>
  ctx.state.players[ctx.state.turn.playerIndex] as PlayerState;
