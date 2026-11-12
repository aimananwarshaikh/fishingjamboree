/**
 * One row per card id in content/cards.json: what drawing that card does.
 * Adding a card to the content without a row here fails the first test.
 */
import { describe, expect, it } from "vitest";
import { catchBonusAt, helicopterFee, movementModifier, sharkRepelledAt } from "./modifiers";
import {
  board,
  clone,
  content,
  deckCards,
  fullDeck,
  id,
  land,
  roll,
  START_LEFT,
  started,
  tile,
  types,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { CardId, DeckId, GameEvent, GameState, Money, PhaseKind, TileId } from "./types";

// --- Safe and Risk cards ----------------------------------------------------

/** Player 0 to act with two fish and $100; player 1 parked out of the way. */
const base = withPlayer(withShips(started(2), { 1: tile(7, 8) }), 0, {
  fish: [100, 300],
  cash: 100,
});
const LANDING: Record<"safe" | "risk", readonly [TileId, TileId]> = {
  safe: [tile(3, 17), tile(3, 16)], // open sea, zone 1
  risk: [tile(2, 2), tile(3, 2)], // Davy Jones' Locker
};

interface DrawRow {
  decks: ("safe" | "risk")[];
  fish: Money[];
  cash: Money;
  fineTokens: number;
  /** The phase after the card: the next player's roll, unless the card opens a decision. */
  phase: PhaseKind;
}
const draw = (decks: DrawRow["decks"], fish: Money[], extra: Partial<DrawRow> = {}): DrawRow => ({
  decks,
  fish,
  cash: 100,
  fineTokens: 0,
  phase: "roll",
  ...extra,
});

const DRAW_TABLE: Record<CardId, DrawRow> = {
  boot: draw(["safe", "risk"], [100, 300]),
  "fish+1": draw(["safe"], [100, 300, 100]),
  "fish+2": draw(["safe"], [100, 300, 100, 100]),
  "fish+3": draw(["safe", "risk"], [100, 300, 100, 100, 100]),
  "fine-100": draw(["safe"], [100, 300], { cash: 0 }),
  "fish-300": draw(["risk"], [100, 300, 300]),
  "fish-500": draw(["risk"], [100, 300, 500]),
  "fish-700": draw(["risk"], [100, 300, 700]),
  "fine-200": draw(["risk"], [100, 300], { cash: 0, fineTokens: 1 }),
  shark: draw(["risk"], []),
  // Both starting docks are free, so the victim chooses one.
  "sinking-boat": draw(["risk"], [], { phase: "placeShip" }),
};

// --- Event cards ------------------------------------------------------------

/** The last player of round 5 is boxed in on a starting dock; any roll ends the round. */
function endOfRound5(): GameState {
  const state = clone(withShips(started(2), { 0: tile(3, 18), 1: START_LEFT }));
  state.round = 5;
  state.turn = { playerIndex: 1, helicopterUsed: false };
  state.phase = { kind: "roll", actors: [id(state, 1)] };
  return state;
}

const ZONE_TILE = { 1: tile(3, 16), 2: tile(5, 10), 3: tile(3, 0) } as const;
const BAY = tile(0, 9);
const LOCKER = tile(3, 2);

/** Everything an event card can change, read through the public rule helpers. */
interface EventRow {
  movement: number;
  helicopterFee: Money | null;
  repelled: { bay: boolean; locker: boolean };
  /** Bonus fish count by zone. */
  catchBonus: { 1: number; 2: number; 3: number };
  goldenFish: { spot: number; tile: TileId; value: Money } | null;
  riskReshuffled: boolean;
}
const QUIET: EventRow = {
  movement: 0,
  helicopterFee: null,
  repelled: { bay: false, locker: false },
  catchBonus: { 1: 0, 2: 0, 3: 0 },
  goldenFish: null,
  riskReshuffled: false,
};
const ev = (patch: Partial<EventRow>): EventRow => ({ ...QUIET, ...patch });
const golden = (spot: 1 | 2 | 3) => {
  const at = board.fishingSpots.find((s) => s.spot === spot)!;
  return ev({ goldenFish: { spot, tile: at.tile, value: 1000 } });
};

const EVENT_TABLE: Record<CardId, EventRow> = {
  "golden-fish-1": golden(1),
  "golden-fish-2": golden(2),
  "golden-fish-3": golden(3),
  "catch-bonus-1": ev({ catchBonus: { 1: 1, 2: 0, 3: 0 } }),
  "catch-bonus-2": ev({ catchBonus: { 1: 0, 2: 1, 3: 0 } }),
  "catch-bonus-3": ev({ catchBonus: { 1: 0, 2: 0, 3: 1 } }),
  "movement+1": ev({ movement: 1 }),
  "movement-1": ev({ movement: -1 }),
  helicopter: ev({ helicopterFee: 200 }),
  "shark-repellent": ev({ repelled: { bay: true, locker: false } }),
  tsunami: ev({ riskReshuffled: true }),
};

function observe(state: GameState, events: GameEvent[]): EventRow {
  const bonus = (zone: 1 | 2 | 3) =>
    catchBonusAt(content, state, board.tiles[ZONE_TILE[zone]]!)?.count ?? 0;
  return {
    movement: movementModifier(content, state),
    helicopterFee: helicopterFee(content, state),
    repelled: {
      bay: sharkRepelledAt(content, state, board.tiles[BAY]!),
      locker: sharkRepelledAt(content, state, board.tiles[LOCKER]!),
    },
    catchBonus: { 1: bonus(1), 2: bonus(2), 3: bonus(3) },
    goldenFish: state.goldenFish,
    riskReshuffled: events.some((e) => e.type === "deckReshuffled" && e.reason === "tsunami"),
  };
}

// --- Tests ------------------------------------------------------------------

describe("card table", () => {
  it("has exactly one row for every card id in content/cards.json", () => {
    const rows = [...Object.keys(DRAW_TABLE), ...Object.keys(EVENT_TABLE)].sort();
    expect(rows).toEqual(Object.keys(content.cards.cards).sort());
  });

  it("each row names the decks the card is really in", () => {
    const decksOf = (card: CardId): DeckId[] =>
      (["safe", "risk", "event"] as const).filter((d) => (content.cards.decks[d][card] ?? 0) > 0);
    for (const [card, row] of Object.entries(DRAW_TABLE)) expect(decksOf(card)).toEqual(row.decks);
    for (const card of Object.keys(EVENT_TABLE)) expect(decksOf(card)).toEqual(["event"]);
  });

  const drawCases = Object.entries(DRAW_TABLE).flatMap(([card, row]) =>
    row.decks.map((deck) => [card, deck, row] as const),
  );
  it.each(drawCases)("%s from the %s deck", (card, deck, row) => {
    const [from, to] = LANDING[deck];
    const before = withTopCard(base, deck, card);
    const { state, events } = land(before, from, to);
    expect(events.find((e) => e.type === "cardDrawn")).toEqual({
      type: "cardDrawn",
      player: id(base, 0),
      deck,
      card,
    });
    expect(state.players[0]).toMatchObject({
      fish: row.fish,
      cash: row.cash,
      fineTokens: row.fineTokens,
    });
    expect(state.phase.kind).toBe(row.phase);
    // Discarded before any decision, and the deck is whole.
    expect(state.decks[deck].discard).toEqual([card]);
    expect(deckCards(state, deck)).toEqual(fullDeck(deck));
    expect(types(events)).toContain("cardDiscarded");
  });

  it.each(Object.entries(EVENT_TABLE))("event card %s", (card, row) => {
    const before = withTopCard(endOfRound5(), "event", card);
    expect(observe(before, [])).toEqual(QUIET);
    const { state, events } = roll(before, 3);
    expect(state.activeEvent).toEqual({ card, drawnAfterRound: 5 });
    expect(observe(state, events)).toEqual(row);
    expect(deckCards(state, "event")).toEqual(fullDeck("event"));
  });
});
