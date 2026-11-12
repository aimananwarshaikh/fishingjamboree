import { describe, expect, it } from "vitest";
import { buildDeck, discardCard, drawCard, expandDeckList } from "./decks";
import { seedRng } from "./rng";
import { compiledContent } from "./testContent";
import type { CardId, Deck, RngState } from "./types";

const sorted = (ids: CardId[]) => [...ids].sort();

describe("expandDeckList", () => {
  it("lists every copy, in an order that ignores JSON key order", () => {
    const a = expandDeckList({ shark: 2, boot: 1 });
    const b = expandDeckList({ boot: 1, shark: 2 });
    expect(a).toEqual(["boot", "shark", "shark"]);
    expect(b).toEqual(a);
  });

  it("matches the confirmed card counts", () => {
    const { decks } = compiledContent().cards;
    expect(expandDeckList(decks.safe)).toHaveLength(18);
    expect(expandDeckList(decks.risk)).toHaveLength(16);
    expect(expandDeckList(decks.event)).toHaveLength(11);
  });
});

describe("buildDeck", () => {
  const list = compiledContent().cards.decks.risk;

  it("shuffles every copy into the draw pile with an empty discard", () => {
    const { deck } = buildDeck(list, seedRng("build"));
    expect(sorted(deck.draw)).toEqual(sorted(expandDeckList(list)));
    expect(deck.draw).not.toEqual(expandDeckList(list));
    expect(deck.discard).toEqual([]);
  });

  it("is deterministic for the same RNG state and advances it", () => {
    const rng = seedRng("same");
    const a = buildDeck(list, rng);
    const b = buildDeck(list, rng);
    expect(a).toEqual(b);
    expect(a.rng).not.toEqual(rng);
    expect(buildDeck(list, seedRng("other")).deck.draw).not.toEqual(a.deck.draw);
  });
});

describe("drawCard and discardCard", () => {
  const rng = seedRng("draw");

  it("takes the top card and leaves it in neither pile", () => {
    const deck: Deck = { draw: ["a", "b", "c"], discard: ["z"] };
    const result = drawCard("safe", deck, rng);
    expect(result.card).toBe("a");
    expect(result.deck).toEqual({ draw: ["b", "c"], discard: ["z"] });
    expect(result.events).toEqual([]);
    expect(result.rng).toEqual(rng); // no shuffle, no randomness used
  });

  it("does not mutate the deck it is given", () => {
    const deck: Deck = { draw: ["a", "b"], discard: ["c"] };
    drawCard("safe", deck, rng);
    discardCard(deck, "x");
    expect(deck).toEqual({ draw: ["a", "b"], discard: ["c"] });
  });

  it("discards face up on top of the pile", () => {
    expect(discardCard({ draw: ["a"], discard: ["b"] }, "c")).toEqual({
      draw: ["a"],
      discard: ["b", "c"],
    });
  });

  it("reshuffles the discard pile when the draw pile is empty", () => {
    const discard = ["a", "b", "c", "d", "e"];
    const result = drawCard("risk", { draw: [], discard }, rng);
    expect(result.events).toEqual([
      { type: "deckReshuffled", deck: "risk", reason: "empty", drawCount: 5 },
    ]);
    expect(discard).toContain(result.card);
    expect(result.deck.discard).toEqual([]);
    expect(sorted([result.card, ...result.deck.draw])).toEqual(discard);
    expect(result.rng).not.toEqual(rng);
  });

  it("throws if the draw and discard piles are both empty", () => {
    expect(() => drawCard("event", { draw: [], discard: [] }, rng)).toThrow(/empty/);
  });

  it("keeps every copy through several passes of draw, discard and reshuffle", () => {
    const list = compiledContent().cards.decks.safe;
    const all = sorted(expandDeckList(list));
    let { deck, rng: state } = buildDeck(list, seedRng("passes"));
    let reshuffles = 0;
    const seen: CardId[] = [];
    for (let i = 0; i < all.length * 3; i++) {
      const r = drawCard("safe", deck, state);
      reshuffles += r.events.length;
      seen.push(r.card);
      deck = discardCard(r.deck, r.card);
      state = r.rng as RngState;
      expect(sorted([...deck.draw, ...deck.discard])).toEqual(all);
    }
    expect(reshuffles).toBe(2);
    // Each full pass through the deck draws every copy exactly once.
    expect(sorted(seen.slice(0, all.length))).toEqual(all);
    expect(sorted(seen.slice(all.length, 2 * all.length))).toEqual(all);
  });
});
