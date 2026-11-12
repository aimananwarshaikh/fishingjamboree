/**
 * Event cards (Session 4a): replacing the active event after an event round.
 *
 * A lasting effect needs no code here: rules read it through `modifiers.ts`
 * for as long as the card is `state.activeEvent`. This file only does what
 * happens at the two moments of change: when a card expires and when one is
 * drawn. The active card sits in neither pile; it joins the event discard
 * pile when it expires.
 */
import type { Ctx } from "./ctx";
import { discardCard, drawCard } from "./decks";
import type { EventEffect } from "./types";

type OnDraw<E extends EventEffect> = (ctx: Ctx, effect: E) => void;

/** Lasting effects do nothing at the moment they are drawn. */
const lasting = (): void => {};

const ON_DRAW: { [K in EventEffect["kind"]]: OnDraw<Extract<EventEffect, { kind: K }>> } = {
  /** The token appears even under a ship; only a move that ends there claims it. */
  goldenFish(ctx, effect) {
    const spot = ctx.content.board.fishingSpots.find((s) => s.spot === effect.spot);
    if (!spot) throw new Error(`goldenFish: the board has no fishing spot ${effect.spot}`);
    ctx.state.goldenFish = { spot: spot.spot, tile: spot.tile, value: effect.value };
    ctx.events.push({
      type: "goldenFishPlaced",
      spot: spot.spot,
      tile: spot.tile,
      value: effect.value,
    });
  },
  catchBonus: lasting,
  movement: lasting,
  helicopter: lasting,
  sharkRepellent: lasting,
  reshuffleDiscard(ctx, effect) {
    // TODO(4b): Tsunami. Shuffle `effect.deck`'s discard pile into its draw pile (the draw
    // pile is reshuffled even when the discard pile is empty) with `shuffle` from rng.ts,
    // store the new RNG state, and emit `deckReshuffled` with reason "tsunami". The card
    // still becomes `activeEvent` (already done by `nextEvent`), with no lasting effect.
    void ctx;
    void effect;
  },
};

/** Ends the active event: an unclaimed Golden Fish goes, the card is discarded. */
function expireEvent(ctx: Ctx): void {
  const { state } = ctx;
  const old = state.activeEvent;
  if (!old) return;
  ctx.events.push({ type: "eventExpired", card: old.card });
  if (state.goldenFish) {
    ctx.events.push({
      type: "goldenFishRemoved",
      spot: state.goldenFish.spot,
      reason: "event-expired",
    });
    state.goldenFish = null;
  }
  state.decks.event = discardCard(state.decks.event, old.card);
  state.activeEvent = null;
}

/** After an event round: the old event expires, then the next card is drawn and takes effect. */
export function nextEvent(ctx: Ctx, afterRound: number): void {
  const { state, content } = ctx;
  expireEvent(ctx);
  const deck = state.decks.event;
  // Content with no event cards at all: nothing to draw.
  if (deck.draw.length === 0 && deck.discard.length === 0) return;
  const drawn = drawCard("event", deck, state.rng);
  state.rng = drawn.rng;
  state.decks.event = drawn.deck;
  ctx.events.push(...drawn.events);
  state.activeEvent = { card: drawn.card, drawnAfterRound: afterRound };
  ctx.events.push({ type: "eventDrawn", card: drawn.card, afterRound });

  const effect = content.cards.cards[drawn.card]?.effect as EventEffect | undefined;
  const onDraw = effect && (ON_DRAW[effect.kind] as OnDraw<EventEffect> | undefined);
  // compileContent only lets event effects into the event deck.
  if (!effect || !onDraw) throw new Error(`nextEvent: no handler for card ${drawn.card}`);
  onDraw(ctx, effect);
}
