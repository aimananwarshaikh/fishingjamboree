/**
 * Client views (docs/architecture.md section 9): every deck becomes its size
 * and its face-up discard pile, and the RNG state is dropped, so a client can
 * neither see the order of a draw pile nor predict dice and shuffles.
 */
import type { Deck, DeckId, DeckView, Engine } from "./types";

const DECK_IDS: readonly DeckId[] = ["safe", "risk", "event"];

const redactDeck = (deck: Deck): DeckView => ({
  drawCount: deck.draw.length,
  discard: [...deck.discard],
});

export const redactForClient: Engine["redactForClient"] = (state, viewer) => {
  // Copy field by field so nothing private (rng, draw order) can slip through
  // if the state ever gains a field; a new public field must be added here.
  const copy = JSON.parse(JSON.stringify(state)) as typeof state;
  const decks = Object.fromEntries(
    DECK_IDS.map((id) => [id, redactDeck(copy.decks[id])]),
  ) as Record<DeckId, DeckView>;
  return {
    schemaVersion: copy.schemaVersion,
    contentHash: copy.contentHash,
    actionCount: copy.actionCount,
    players: copy.players,
    round: copy.round,
    turn: copy.turn,
    phase: copy.phase,
    decks,
    activeEvent: copy.activeEvent,
    goldenFish: copy.goldenFish,
    result: copy.result,
    viewer,
  };
};
