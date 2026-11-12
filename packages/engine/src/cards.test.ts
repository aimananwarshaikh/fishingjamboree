import { describe, expect, it } from "vitest";
import { compiledContent, rawContent } from "./testContent";
import {
  clone,
  content,
  deckCards,
  fullDeck,
  id,
  land,
  started,
  tile,
  types,
  withEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { CatchBonusEffect, GameEvent, GameState } from "./types";

/** Player 0 to act; player 1 parked out of the way in zone 2. */
const base = withShips(started(2), { 1: tile(7, 8) });
const p0 = id(base, 0);

// One-step landings: [from, to].
const ZONE1 = [tile(3, 17), tile(3, 16)] as const;
const ZONE2 = [tile(5, 9), tile(5, 10)] as const;
const ZONE3 = [tile(2, 0), tile(3, 0)] as const;
const BAY = [tile(0, 8), tile(0, 9)] as const;
const LOCKER = [tile(2, 2), tile(3, 2)] as const;

const safe = (state: GameState, card: string, where = ZONE1) =>
  land(withTopCard(state, "safe", card), where[0], where[1]);
const risk = (state: GameState, card: string, where = LOCKER) =>
  land(withTopCard(state, "risk", card), where[0], where[1]);
const find = <T extends GameEvent["type"]>(events: GameEvent[], type: T) =>
  events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const TAIL = ["turnEnded", "turnStarted"];

describe("card pipeline", () => {
  it("open sea draws the top Safe card, resolves it and discards it", () => {
    const before = withTopCard(base, "safe", "fish+2");
    const { state, events } = land(before, ZONE1[0], ZONE1[1]);
    expect(types(events)).toEqual(["moved", "cardDrawn", "fishGained", "cardDiscarded", ...TAIL]);
    expect(events[1]).toEqual({ type: "cardDrawn", player: p0, deck: "safe", card: "fish+2" });
    expect(events[3]).toEqual({ type: "cardDiscarded", deck: "safe", card: "fish+2" });
    expect(state.players[0]!.fish).toEqual([100, 100]);
    expect(state.decks.safe.draw).toEqual(before.decks.safe.draw.slice(1));
    expect(state.decks.safe.discard).toEqual(["fish+2"]);
    expect(state.decks.risk).toEqual(before.decks.risk);
    expect(state.phase).toEqual({ kind: "roll", actors: [id(base, 1)] });
  });

  it("Shipwreck Bay and Davy Jones' Locker draw from the Risk deck", () => {
    for (const where of [BAY, LOCKER]) {
      const before = withTopCard(base, "risk", "fish-700");
      const { state, events } = land(before, where[0], where[1]);
      expect(events[1]).toEqual({ type: "cardDrawn", player: p0, deck: "risk", card: "fish-700" });
      expect(state.players[0]!.fish).toEqual([700]);
      expect(state.decks.risk.discard).toEqual(["fish-700"]);
      expect(state.decks.safe).toEqual(before.decks.safe);
    }
  });

  it("a Boot does nothing", () => {
    const { state, events } = safe(withPlayer(base, 0, { fish: [300] }), "boot");
    expect(types(events)).toEqual(["moved", "cardDrawn", "cardDiscarded", ...TAIL]);
    expect(state.players[0]).toMatchObject({ fish: [300], cash: 0, fineTokens: 0 });
  });

  it("every card of both decks resolves and leaves the decks whole", () => {
    for (const deck of ["safe", "risk"] as const) {
      for (const card of Object.keys(content.cards.decks[deck])) {
        const start = withPlayer(base, 0, { fish: [100, 300], cash: 100 });
        const { state } = deck === "safe" ? safe(start, card) : risk(start, card);
        expect(deckCards(state, deck)).toEqual(fullDeck(deck));
        expect(state.decks[deck].discard).toEqual([card]);
      }
    }
  });

  it("an empty draw pile is rebuilt from the discard pile first", () => {
    const empty = clone(base);
    empty.decks.risk = { draw: [], discard: [...empty.decks.risk.draw] };
    const { state, events } = land(empty, LOCKER[0], LOCKER[1]);
    expect(types(events).slice(0, 3)).toEqual(["moved", "deckReshuffled", "cardDrawn"]);
    expect(events[1]).toEqual({
      type: "deckReshuffled",
      deck: "risk",
      reason: "empty",
      drawCount: 16,
    });
    expect(state.decks.risk.draw).toHaveLength(15);
    expect(state.decks.risk.discard).toHaveLength(1);
    expect(deckCards(state, "risk")).toEqual(fullDeck("risk"));
    expect(state.rng).not.toEqual(empty.rng);
  });
});

describe("capacity overflow", () => {
  it("fish over the limit are lost (rulebook example)", () => {
    const { state, events } = safe(withPlayer(base, 0, { fish: [100, 100, 100, 100] }), "fish+2");
    expect(state.players[0]!.fish).toHaveLength(5);
    expect(find(events, "fishGained")).toMatchObject({ kept: [100], lost: [100] });
  });

  it("a $700 fish drawn on a full ship is lost and nothing is swapped", () => {
    const full = [100, 100, 100, 100, 100];
    const { state, events } = risk(withPlayer(base, 0, { fish: full }), "fish-700");
    expect(state.players[0]!.fish).toEqual(full);
    expect(find(events, "fishGained")).toMatchObject({ kept: [], lost: [700] });
  });

  it("the Capacity upgrade carries 8", () => {
    const start = withPlayer(base, 0, {
      fish: [100, 100, 100, 100, 100, 100, 100],
      upgrades: { speed: false, capacity: true },
    });
    const { state, events } = safe(start, "fish+3");
    expect(state.players[0]!.fish).toHaveLength(8);
    expect(find(events, "fishGained")).toMatchObject({ kept: [100], lost: [100, 100] });
  });
});

describe("+1 Fish to All Catch", () => {
  const WHERE = { 1: ZONE1, 2: ZONE2, 3: ZONE3 };

  it("adds one $100 fish to a fish card drawn in its zone, and only there", () => {
    for (const zone of [1, 2, 3] as const) {
      const state = withEvent(base, `catch-bonus-${zone}`);
      for (const other of [1, 2, 3] as const) {
        const { state: after, events } = safe(state, "fish+1", WHERE[other]);
        const bonus = other === zone ? 1 : 0;
        expect(after.players[0]!.fish).toHaveLength(1 + bonus);
        expect(find(events, "fishGained")).toMatchObject({ bonus });
      }
    }
  });

  it("a Boot in the zone gives one fish", () => {
    const { state, events } = safe(withEvent(base, "catch-bonus-1"), "boot");
    expect(state.players[0]!.fish).toEqual([100]);
    expect(find(events, "fishGained")).toEqual({
      type: "fishGained",
      player: p0,
      kept: [100],
      lost: [],
      bonus: 1,
    });
  });

  it("a fine gets no bonus", () => {
    const { state, events } = safe(withEvent(base, "catch-bonus-1"), "fine-100");
    expect(state.players[0]!.fish).toEqual([]);
    expect(find(events, "fishGained")).toBeUndefined();
  });

  it("never applies to a Risk draw, whichever zone card is active", () => {
    for (const zone of [1, 2, 3]) {
      for (const where of [BAY, LOCKER]) {
        for (const card of ["boot", "fish+3", "fish-300", "shark"]) {
          const { state } = risk(withEvent(base, `catch-bonus-${zone}`), card, where);
          const expected = card === "fish+3" ? 3 : card === "fish-300" ? 1 : 0;
          expect(state.players[0]!.fish).toHaveLength(expected);
        }
      }
    }
  });

  it("bonus fish obey capacity", () => {
    const start = withPlayer(withEvent(base, "catch-bonus-1"), 0, { fish: [100, 100, 100, 100] });
    const { state, events } = safe(start, "fish+1");
    expect(state.players[0]!.fish).toHaveLength(5);
    expect(find(events, "fishGained")).toMatchObject({ kept: [100], lost: [100], bonus: 1 });
  });

  it("the card's own fish load before the bonus fish", () => {
    const raw = rawContent();
    (raw.cards.cards["catch-bonus-1"]!.effect as CatchBonusEffect).value = 300;
    const rich = compiledContent(raw);
    const start = withPlayer(withEvent(base, "catch-bonus-1"), 0, { fish: [100, 100, 100, 100] });
    const { state, events } = land(withTopCard(start, "safe", "fish+1"), ZONE1[0], ZONE1[1], rich);
    expect(state.players[0]!.fish).toEqual([100, 100, 100, 100, 100]);
    expect(find(events, "fishGained")).toMatchObject({ kept: [100], lost: [300] });
  });

  it("no other event gives a bonus", () => {
    for (const card of ["movement+1", "helicopter", "shark-repellent", "golden-fish-1"]) {
      expect(safe(withEvent(base, card), "fish+1").state.players[0]!.fish).toEqual([100]);
    }
  });
});

describe("fines", () => {
  it("are paid from cash at once", () => {
    const { state, events } = safe(withPlayer(base, 0, { cash: 300, fish: [500] }), "fine-100");
    expect(types(events)).toEqual(["moved", "cardDrawn", "fined", "cardDiscarded", ...TAIL]);
    expect(find(events, "fined")).toEqual({
      type: "fined",
      player: p0,
      amount: 100,
      paid: 100,
      tokensTaken: 0,
    });
    expect(state.players[0]).toMatchObject({ cash: 200, fineTokens: 0, fish: [500] });
  });

  it("become $100 tokens for whatever cash cannot cover", () => {
    const part = risk(withPlayer(base, 0, { cash: 100 }), "fine-200");
    expect(part.state.players[0]).toMatchObject({ cash: 0, fineTokens: 1 });
    expect(find(part.events, "fined")).toMatchObject({ amount: 200, paid: 100, tokensTaken: 1 });

    const none = risk(withPlayer(base, 0, { cash: 0 }), "fine-200");
    expect(none.state.players[0]).toMatchObject({ cash: 0, fineTokens: 2 });
  });

  it("stack on tokens already held, with no cap, and never touch the fish", () => {
    const start = withPlayer(base, 0, { fineTokens: 7, fish: [700, 500] });
    const { state } = risk(start, "fine-200");
    expect(state.players[0]).toMatchObject({ cash: 0, fineTokens: 9, fish: [700, 500] });
  });
});

describe("Shark", () => {
  it("takes 3 fish, cheapest first", () => {
    const { state, events } = risk(
      withPlayer(base, 0, { fish: [500, 100, 300, 100, 700] }),
      "shark",
    );
    expect(types(events)).toEqual(["moved", "cardDrawn", "fishLost", "cardDiscarded", ...TAIL]);
    expect(find(events, "fishLost")).toEqual({
      type: "fishLost",
      player: p0,
      fish: [100, 100, 300],
      reason: "shark",
    });
    expect(state.players[0]!.fish).toEqual([500, 700]);
  });

  it("with fewer than 3 fish takes them all; with none, nothing", () => {
    expect(risk(withPlayer(base, 0, { fish: [700, 300] }), "shark").state.players[0]!.fish).toEqual(
      [],
    );
    const none = risk(base, "shark");
    expect(types(none.events)).toEqual(["moved", "cardDrawn", "cardDiscarded", ...TAIL]);
  });

  it("bites in both risk areas without Shark Repellent", () => {
    for (const where of [BAY, LOCKER]) {
      for (const state of [base, withEvent(base, "helicopter")]) {
        const start = withPlayer(state, 0, { fish: [100, 100, 100, 100] });
        expect(risk(start, "shark", where).state.players[0]!.fish).toEqual([100]);
      }
    }
  });

  it("Shark Repellent: no effect in Shipwreck Bay, still bites in Davy Jones' Locker", () => {
    const start = withPlayer(withEvent(base, "shark-repellent"), 0, { fish: [100, 300, 500] });
    const bay = risk(start, "shark", BAY);
    expect(types(bay.events)).toEqual([
      "moved",
      "cardDrawn",
      "sharkRepelled",
      "cardDiscarded",
      ...TAIL,
    ]);
    expect(find(bay.events, "sharkRepelled")).toEqual({
      type: "sharkRepelled",
      player: p0,
      card: "shark",
    });
    expect(bay.state.players[0]!.fish).toEqual([100, 300, 500]);
    expect(bay.state.decks.risk.discard).toEqual(["shark"]);

    const locker = risk(start, "shark", LOCKER);
    expect(locker.state.players[0]!.fish).toEqual([]);
  });

  it("Shark Repellent stops nothing else in Shipwreck Bay", () => {
    const start = withPlayer(withEvent(base, "shark-repellent"), 0, { fish: [100], cash: 0 });
    expect(risk(start, "fine-200", BAY).state.players[0]!.fineTokens).toBe(2);
    expect(risk(start, "sinking-boat", BAY).state.players[0]!.fish).toEqual([]);
  });
});
