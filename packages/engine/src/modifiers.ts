/**
 * Modifiers (Session 4a): the one place that says how upgrades and the active
 * event card change a rule.
 *
 * Nothing here is stored. Every answer is derived from `state.activeEvent` and
 * the player's upgrades, so an event's effect ends the moment `activeEvent` is
 * replaced: there is no modifier list to clean up. Rules never read
 * `activeEvent` themselves; they ask a function in this file.
 *
 * Uses public information only, so legality is the same on a client view.
 */
import type {
  AnyState,
  CatchBonusEffect,
  Content,
  EventEffect,
  Money,
  PlayerState,
  Tile,
  UpgradeId,
} from "./types";

/** The shop lists upgrades in this order. */
export const UPGRADE_ORDER: readonly UpgradeId[] = ["speed", "capacity"];

/** The active event's effect if it is of `kind`, else `null`. */
export function activeEffect<K extends EventEffect["kind"]>(
  content: Content,
  state: AnyState,
  kind: K,
): Extract<EventEffect, { kind: K }> | null {
  if (!state.activeEvent) return null;
  const effect = content.cards.cards[state.activeEvent.card]?.effect;
  return effect?.kind === kind ? (effect as Extract<EventEffect, { kind: K }>) : null;
}

/** Added to every roll (+1 / −1 Movement). 0 without a movement event. */
export function movementModifier(content: Content, state: AnyState): number {
  return activeEffect(content, state, "movement")?.delta ?? 0;
}

/**
 * The "+1 Fish to All Catch" bonus for a card drawn on `tile`, or `null`.
 * Only open sea has a zone, so a Risk draw never gets one.
 */
export function catchBonusAt(
  content: Content,
  state: AnyState,
  tile: Tile,
): CatchBonusEffect | null {
  const effect = activeEffect(content, state, "catchBonus");
  return effect && tile.terrain === "sea" && tile.zone === effect.zone ? effect : null;
}

/** Whether Shark Repellent protects a ship on `tile`. */
export function sharkRepelledAt(content: Content, state: AnyState, tile: Tile): boolean {
  const effect = activeEffect(content, state, "sharkRepellent");
  return effect !== null && tile.terrain === "risk" && tile.area === effect.area;
}

/** The Helicopter fee while that event is active, else `null`. */
export function helicopterFee(content: Content, state: AnyState): Money | null {
  return activeEffect(content, state, "helicopter")?.fee ?? null;
}

/**
 * Whether `player`, whose turn it is, may use the Helicopter now: the event
 * is active, it was not used this turn, they carry a fish, and they hold the
 * fee in cash (it cannot come out of the sale).
 */
export function helicopterUsable(content: Content, state: AnyState, player: PlayerState): boolean {
  const fee = helicopterFee(content, state);
  return fee !== null && !state.turn.helicopterUsed && player.fish.length > 0 && player.cash >= fee;
}

/** How many fish the ship holds. */
export function capacityOf(content: Content, player: PlayerState): number {
  return player.upgrades.capacity
    ? content.rules.upgrades.capacity.capacity
    : content.rules.baseCapacity;
}

/** Upgrades the player does not own and can pay for now, in shop order. */
export function affordableUpgrades(content: Content, player: PlayerState): UpgradeId[] {
  return UPGRADE_ORDER.filter(
    (u) => !player.upgrades[u] && player.cash >= content.rules.upgrades[u].price,
  );
}
