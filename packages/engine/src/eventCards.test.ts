import { describe, expect, it } from "vitest";
import {
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
  withActiveEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { GameEvent, GameState } from "./types";

const SPOT1 = tile(0, 4);

/**
 * The last player of `round` is about to roll and is boxed in on the left
 * starting dock (player 0 sits on its only exit), so any roll ends the round.
 */
function lastTurnOf(round: number, players = 2): GameState {
  const last = players - 1;
  const state = clone(
    withShips(started(players), { 0: tile(3, 18), 1: tile(7, 8), [last]: START_LEFT }),
  );
  state.round = round;
  state.turn = { playerIndex: last, helicopterUsed: false };
  state.phase = { kind: "roll", actors: [id(state, last)] };
  return state;
}
const endRound = (state: GameState) => roll(state, 3);
const of = <T extends GameEvent["type"]>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe("event rounds", () => {
  it("an event card is drawn after rounds 5, 10 and 15 and at no other time", () => {
    expect(content.rules.eventAfterRounds).toEqual([5, 10, 15]);
    for (let round = 1; round < content.rules.rounds; round++) {
      const { state, events } = endRound(lastTurnOf(round));
      const drawn = of(events, "eventDrawn");
      if ([5, 10, 15].includes(round)) {
        expect(drawn).toEqual([
          { type: "eventDrawn", card: state.activeEvent!.card, afterRound: round },
        ]);
        expect(state.activeEvent!.drawnAfterRound).toBe(round);
      } else {
        expect(drawn).toEqual([]);
        expect(state.activeEvent).toBeNull();
      }
      expect(state.round).toBe(round + 1);
    }
  });

  it("the draw sits between the round ending and the next one starting", () => {
    const before = withTopCard(lastTurnOf(5), "event", "movement+1");
    const { state, events } = endRound(before);
    expect(types(events)).toEqual([
      "rolled",
      "blocked",
      "turnEnded",
      "roundEnded",
      "eventDrawn",
      "roundStarted",
      "turnStarted",
    ]);
    expect(state.activeEvent).toEqual({ card: "movement+1", drawnAfterRound: 5 });
    // The active card is in neither pile.
    expect(state.decks.event.draw).toHaveLength(10);
    expect(state.decks.event.discard).toEqual([]);
    expect(deckCards(state, "event")).toEqual(fullDeck("event"));
    expect(state.rng).toEqual(roll(before, 3).state.rng);
  });

  it("the next event replaces the old one, which goes to the discard pile", () => {
    const before = withTopCard(
      withActiveEvent(lastTurnOf(10), "movement+1"),
      "event",
      "helicopter",
    );
    const { state, events } = endRound(before);
    expect(types(events).slice(3, 6)).toEqual(["roundEnded", "eventExpired", "eventDrawn"]);
    expect(of(events, "eventExpired")).toEqual([{ type: "eventExpired", card: "movement+1" }]);
    expect(state.activeEvent).toEqual({ card: "helicopter", drawnAfterRound: 10 });
    expect(state.decks.event.discard).toEqual(["movement+1"]);
    expect(deckCards(state, "event")).toEqual(fullDeck("event"));
  });

  it("an expired event's modifier is gone at once", () => {
    const before = withTopCard(
      withActiveEvent(lastTurnOf(10), "movement+1"),
      "event",
      "helicopter",
    );
    const after = endRound(before).state;
    const rolled = of(roll(after, 4).events, "rolled")[0]!;
    expect(rolled.roll).toMatchObject({ eventModifier: 0, steps: 4 });
  });

  it("an event stays in force through the rounds between draws", () => {
    const { state, events } = endRound(withActiveEvent(lastTurnOf(7), "movement-1"));
    expect(of(events, "eventExpired")).toEqual([]);
    expect(state.activeEvent).toEqual({ card: "movement-1", drawnAfterRound: 5 });
  });

  it("Tsunami still ends the previous event and becomes the active card", () => {
    const before = withTopCard(withActiveEvent(lastTurnOf(10), "helicopter"), "event", "tsunami");
    const { state, events } = endRound(before);
    expect(of(events, "eventExpired")).toEqual([{ type: "eventExpired", card: "helicopter" }]);
    expect(state.activeEvent).toEqual({ card: "tsunami", drawnAfterRound: 10 });
  });

  it.todo("Tsunami shuffles the Risk discard pile back into the Risk deck (4b)");
  it.todo("Tsunami reshuffles the Risk draw pile even when the discard pile is empty (4b)");

  it("no event is drawn after the last round", () => {
    const { state, events } = endRound(lastTurnOf(content.rules.rounds));
    expect(of(events, "eventDrawn")).toEqual([]);
    expect(state.phase).toEqual({ kind: "gameOver", actors: [] });
  });

  it.todo("game end removes an unclaimed Golden Fish, scores and emits gameEnded (4b)");
});

describe("Golden Fish", () => {
  /** Golden Fish on spot 1, player 0 to act, player 1 out of the way. */
  const golden = (): GameState => {
    const state = withActiveEvent(withShips(started(2), { 1: tile(7, 8) }), "golden-fish-1");
    state.goldenFish = { spot: 1, tile: SPOT1, value: 1000 };
    return state;
  };
  const p0 = id(golden(), 0);
  const ONTO = [tile(0, 5), SPOT1] as const;
  const TAIL = ["turnEnded", "turnStarted"];

  it("its event puts a $1000 token on the numbered spot", () => {
    const spots = { 1: tile(0, 4), 2: tile(0, 12), 3: tile(7, 14) };
    for (const spot of [1, 2, 3] as const) {
      const before = withTopCard(lastTurnOf(5), "event", `golden-fish-${spot}`);
      const { state, events } = endRound(before);
      const placed = { spot, tile: spots[spot], value: 1000 };
      expect(types(events).slice(4, 6)).toEqual(["eventDrawn", "goldenFishPlaced"]);
      expect(of(events, "goldenFishPlaced")).toEqual([{ type: "goldenFishPlaced", ...placed }]);
      expect(state.goldenFish).toEqual(placed);
    }
  });

  it("a ship already on the spot does not get it", () => {
    const three = withShips(lastTurnOf(5, 3), { 1: SPOT1 });
    const { state } = endRound(withTopCard(three, "event", "golden-fish-1"));
    expect(state.goldenFish).toMatchObject({ tile: SPOT1 });
    expect(state.players[1]!.fish).toEqual([]);
  });

  it("the first ship to land there takes it instead of drawing", () => {
    const before = withPlayer(golden(), 0, { fish: [100] });
    const { state, events } = land(before, ONTO[0], ONTO[1]);
    expect(types(events)).toEqual(["moved", "goldenFishTaken", ...TAIL]);
    expect(events[1]).toEqual({ type: "goldenFishTaken", player: p0, spot: 1, value: 1000 });
    expect(state.players[0]!.fish).toEqual([100, 1000]);
    expect(state.goldenFish).toBeNull();
    expect(state.decks).toEqual(before.decks);
    // The event card itself stays until the next event.
    expect(state.activeEvent).toEqual(before.activeEvent);
  });

  it("it counts as one fish: the fifth fits, and it is worth $1000 at a dock", () => {
    const four = withPlayer(golden(), 0, { fish: [100, 100, 100, 100] });
    expect(land(four, ONTO[0], ONTO[1]).state.players[0]!.fish).toHaveLength(5);
    const sold = land(withPlayer(golden(), 0, { fish: [1000] }), tile(3, 18), START_LEFT).state;
    expect(sold.players[0]!.cash).toBe(1000);
  });

  it("a full ship loses it for everyone and draws nothing", () => {
    const full = [100, 100, 100, 100, 100];
    const before = withPlayer(golden(), 0, { fish: full });
    const { state, events } = land(before, ONTO[0], ONTO[1]);
    expect(types(events)).toEqual(["moved", "goldenFishLost", ...TAIL]);
    expect(events[1]).toEqual({ type: "goldenFishLost", player: p0, spot: 1 });
    expect(state.players[0]!.fish).toEqual(full);
    expect(state.goldenFish).toBeNull();
    expect(state.decks).toEqual(before.decks);
  });

  it("the Capacity upgrade makes room for it", () => {
    const before = withPlayer(golden(), 0, {
      fish: [100, 100, 100, 100, 100],
      upgrades: { speed: false, capacity: true },
    });
    expect(land(before, ONTO[0], ONTO[1]).state.players[0]!.fish).toHaveLength(6);
  });

  it("once it is gone the spot is ordinary sea again", () => {
    const taken = land(golden(), ONTO[0], ONTO[1]).state;
    const again = clone(taken);
    again.turn.playerIndex = 0;
    const { events } = land(withTopCard(again, "safe", "boot"), ONTO[0], ONTO[1]);
    expect(types(events)).toEqual(["moved", "cardDrawn", "cardDiscarded", ...TAIL]);
  });

  it("other tiles, including the other spots, draw as normal while it waits", () => {
    const before = withTopCard(golden(), "safe", "fish+1");
    const { state, events } = land(before, tile(1, 12), tile(0, 12));
    expect(types(events)).toContain("cardDrawn");
    expect(state.goldenFish).toEqual(before.goldenFish);
  });

  it("unclaimed, it is removed when the next event is drawn", () => {
    const before = withTopCard(
      withActiveEvent(lastTurnOf(10), "golden-fish-1"),
      "event",
      "movement+1",
    );
    before.goldenFish = { spot: 1, tile: SPOT1, value: 1000 };
    const { state, events } = endRound(before);
    expect(types(events).slice(4, 7)).toEqual(["eventExpired", "goldenFishRemoved", "eventDrawn"]);
    expect(of(events, "goldenFishRemoved")).toEqual([
      { type: "goldenFishRemoved", spot: 1, reason: "event-expired" },
    ]);
    expect(state.goldenFish).toBeNull();
  });

  it("claimed, there is nothing to remove", () => {
    const before = withTopCard(
      withActiveEvent(lastTurnOf(10), "golden-fish-1"),
      "event",
      "movement+1",
    );
    expect(of(endRound(before).events, "goldenFishRemoved")).toEqual([]);
  });

  it("a second Golden Fish event replaces an unclaimed first one", () => {
    const before = withTopCard(
      withActiveEvent(lastTurnOf(10), "golden-fish-1"),
      "event",
      "golden-fish-3",
    );
    before.goldenFish = { spot: 1, tile: SPOT1, value: 1000 };
    expect(endRound(before).state.goldenFish).toEqual({ spot: 3, tile: tile(7, 14), value: 1000 });
  });
});
