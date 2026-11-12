/**
 * Decks: build, shuffle, draw, discard, and reshuffle the discard pile when
 * the draw pile runs out. Pure functions; each returns the next RNG state.
 */
import { shuffle } from "./rng";
import type { CardId, Deck, DeckId, DeckList, GameEvent, RngState } from "./types";

/**
 * Every copy in `list`, in a fixed order (card ids sorted by UTF-16 code
 * unit, so the result does not depend on JSON key order or the host locale).
 */
export function expandDeckList(list: DeckList): CardId[] {
  const out: CardId[] = [];
  for (const id of Object.keys(list).sort()) {
    const copies = list[id] ?? 0;
    for (let i = 0; i < copies; i++) out.push(id);
  }
  return out;
}

/** A freshly shuffled deck with an empty discard pile. */
export function buildDeck(list: DeckList, rng: RngState): { deck: Deck; rng: RngState } {
  const [draw, next] = shuffle(expandDeckList(list), rng);
  return { deck: { draw, discard: [] }, rng: next };
}

export interface DrawResult {
  card: CardId;
  /** The deck without the drawn card. The card is in neither pile until discarded. */
  deck: Deck;
  rng: RngState;
  /** A `deckReshuffled` event if the draw pile was empty. */
  events: GameEvent[];
}

/**
 * Draws the top card. If the draw pile is empty, the discard pile is shuffled
 * into a new draw pile first. Throws if both are empty: the rules say this
 * cannot happen (every drawn card is discarded within the same action).
 */
export function drawCard(deckId: DeckId, deck: Deck, rng: RngState): DrawResult {
  let { draw, discard } = deck;
  let state = rng;
  const events: GameEvent[] = [];
  if (draw.length === 0) {
    if (discard.length === 0) throw new Error(`drawCard: ${deckId} deck and discard are empty`);
    [draw, state] = shuffle(discard, state);
    discard = [];
    events.push({ type: "deckReshuffled", deck: deckId, reason: "empty", drawCount: draw.length });
  }
  const [card, ...rest] = draw as [CardId, ...CardId[]];
  return { card, deck: { draw: rest, discard }, rng: state, events };
}

/** Puts `card` face up on top of the discard pile. */
export function discardCard(deck: Deck, card: CardId): Deck {
  return { draw: deck.draw, discard: [...deck.discard, card] };
}
