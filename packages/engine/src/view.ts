/**
 * Client views (docs/architecture.md section 9): every deck becomes its size
 * and its face-up discard pile, and the RNG state is dropped, so a client can
 * neither see the order of a draw pile nor predict dice and shuffles.
 */
import type { Deck, DeckId, DeckView, Engine, PlayerState } from "./types";

const DECK_IDS: readonly DeckId[] = ["safe", "risk", "event"];

const redactDeck = (deck: Deck): DeckView => ({
  drawCount: deck.draw.length,
  discard: [...deck.discard],
});

export const redactForClient: Engine["redactForClient"] = (state, viewer) => {
  // Copy field by field so nothing private (rng, draw order, the awards) can
  // slip through if the state ever gains a field; a new public field must be
  // added here. Players are copied field by field too (a new player field
  // does not compile until it is listed). `turn` and `phase` hold only public
  // information and are copied whole.
  const copy = JSON.parse(JSON.stringify(state)) as typeof state;
  const players = copy.players.map((p): PlayerState => ({
    id: p.id,
    cash: p.cash,
    fish: p.fish,
    fineTokens: p.fineTokens,
    upgrades: p.upgrades,
    position: p.position,
    missedTurns: p.missedTurns,
    missedLastTurn: p.missedLastTurn,
    removed: p.removed,
  }));
  const decks = Object.fromEntries(
    DECK_IDS.map((id) => [id, redactDeck(copy.decks[id])]),
  ) as Record<DeckId, DeckView>;
  return {
    schemaVersion: copy.schemaVersion,
    contentHash: copy.contentHash,
    actionCount: copy.actionCount,
    players,
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
