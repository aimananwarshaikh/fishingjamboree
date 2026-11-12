/**
 * What happens when a move ends on a tile. This is the seam for Session 4.
 *
 * TODO(Session 4): resolve the landing here, before the turn ends:
 * - sea: draw and resolve a Safe card; risk area: a Risk card;
 * - a fishing spot holding the Golden Fish: take it (or lose it on a full ship);
 * - a dock: `docked`, pay fine tokens, sell fish, then the `dockShop` phase.
 * Return `true` when a phase was opened (shop, Sinking Boat placement) so the
 * caller does not end the turn.
 *
 * In stage 3a nothing is resolved: no card, no sale, no shop.
 */
import type { Content, GameEvent, GameState } from "./types";

export interface LandingContext {
  content: Content;
  /** Mutable draft of the state being built by `applyAction`. */
  state: GameState;
  events: GameEvent[];
  playerIndex: number;
}

/** Returns whether the landing opened a phase that keeps the turn going. */
export function resolveLanding(ctx: LandingContext): boolean {
  void ctx;
  return false;
}
