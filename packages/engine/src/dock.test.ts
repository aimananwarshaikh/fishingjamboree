import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { compiledContent, rawContent } from "./testContent";
import {
  act,
  actor,
  content,
  CRUISE,
  deckCards,
  fullDeck,
  id,
  land,
  playTurn,
  START_LEFT,
  START_RIGHT,
  started,
  tile,
  types,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { Action, GameState, PlayerState } from "./types";

/** Player 0 to act; player 1 parked out of the way. */
const base = withShips(started(2), { 1: tile(7, 8) });
const p0 = id(base, 0);
const p1 = id(base, 1);
const TAIL = ["turnEnded", "turnStarted"];

/** Player 0 sails one step from (3,18) onto the left starting dock. */
const dock = (patch: Partial<PlayerState>, c = content) =>
  land(withPlayer(base, 0, patch), tile(3, 18), START_LEFT, c);
const legal = (state: GameState, c = content): Action[] => getLegalActions(c, state, p0);
const code = (state: GameState, action: Action) => {
  const result = applyAction(content, state, action);
  return result.ok ? "ok" : result.error.code;
};
const buy = (upgrade: "speed" | "capacity"): Action => ({
  type: "buyUpgrade",
  player: p0,
  upgrade,
});
const END: Action = { type: "endTurn", player: p0 };

describe("docking", () => {
  it("takes the turn and draws no card, with or without fish", () => {
    const { state, events } = dock({});
    expect(types(events)).toEqual(["moved", "docked", ...TAIL]);
    expect(events[1]).toEqual({ type: "docked", player: p0, dock: "start-left" });
    expect(state.decks).toEqual(base.decks);
    expect(state.players[0]).toMatchObject({ cash: 0, position: START_LEFT });
    expect(actor(state)).toBe(p1);
  });

  it("sells every fish for its value", () => {
    const { state, events } = dock({ fish: [100] });
    expect(types(events)).toEqual(["moved", "docked", "fishSold", ...TAIL]);
    expect(events[2]).toEqual({
      type: "fishSold",
      player: p0,
      fish: [100],
      total: 100,
      via: "dock",
    });
    expect(state.players[0]).toMatchObject({ cash: 100, fish: [] });
  });

  it("pays fine tokens from the sale before anything is bought (rulebook example)", () => {
    const { state, events } = dock({ fish: [500, 700], fineTokens: 1 });
    expect(types(events)).toEqual(["moved", "docked", "fishSold", "fineTokensPaid"]);
    expect(events[3]).toEqual({ type: "fineTokensPaid", player: p0, tokens: 1, amount: 100 });
    expect(state.players[0]).toMatchObject({ cash: 1100, fineTokens: 0 });
    const bought = act(state, buy("speed"));
    expect(bought.state.players[0]!.cash).toBe(900);
    expect(bought.state.players[0]!.upgrades.speed).toBe(true);
  });

  it("a sale smaller than the tokens pays what it can; no shop, the rest stays", () => {
    const { state, events } = dock({ fish: [100, 100], fineTokens: 5 });
    expect(types(events)).toEqual(["moved", "docked", "fishSold", "fineTokensPaid", ...TAIL]);
    expect(state.players[0]).toMatchObject({ cash: 0, fineTokens: 3 });
  });

  it("tokens are not paid without a sale", () => {
    const { state, events } = dock({ fineTokens: 2 });
    expect(types(events)).toEqual(["moved", "docked", ...TAIL]);
    expect(state.players[0]!.fineTokens).toBe(2);
  });

  it("works the same at the cruise ship dock", () => {
    const { state } = land(withPlayer(base, 0, { fish: [300] }), tile(7, 0), CRUISE);
    expect(state.players[0]).toMatchObject({ cash: 300, fish: [], position: CRUISE });
    expect(state.phase).toEqual({
      kind: "dockShop",
      reason: "docked",
      dock: "cruise",
      actors: [p0],
    });
  });
});

describe("the shop", () => {
  it("opens when an unowned upgrade is affordable", () => {
    const { state } = dock({ fish: [100, 100] });
    expect(state.phase).toEqual({
      kind: "dockShop",
      reason: "docked",
      dock: "start-left",
      actors: [p0],
    });
    expect(state.turn.playerIndex).toBe(0);
    expect(legal(state)).toEqual([buy("speed"), buy("capacity"), END]);
  });

  it("is skipped when nothing is affordable", () => {
    expect(dock({ fish: [100] }).state.phase).toEqual({ kind: "roll", actors: [p1] });
    expect(dock({ cash: 199 }).state.phase.kind).toBe("roll");
  });

  it("cash from before the sale counts", () => {
    expect(dock({ cash: 100, fish: [100] }).state.phase.kind).toBe("dockShop");
  });

  it("buying takes the price, gives the upgrade, and keeps the shop open while more is affordable", () => {
    const { state } = dock({ cash: 400 });
    const first = act(state, buy("capacity"));
    expect(first.events).toEqual([
      { type: "upgradeBought", player: p0, upgrade: "capacity", price: 200 },
    ]);
    expect(first.state.players[0]).toMatchObject({
      cash: 200,
      upgrades: { speed: false, capacity: true },
    });
    expect(first.state.phase.kind).toBe("dockShop");
    expect(legal(first.state)).toEqual([buy("speed"), END]);

    const second = act(first.state, buy("speed"));
    expect(types(second.events)).toEqual(["upgradeBought", ...TAIL]);
    expect(second.state.players[0]).toMatchObject({
      cash: 0,
      upgrades: { speed: true, capacity: true },
    });
    expect(second.state.phase).toEqual({ kind: "roll", actors: [p1] });
  });

  it("closes by itself once nothing more is affordable", () => {
    const bought = act(dock({ cash: 300 }).state, buy("speed"));
    expect(types(bought.events)).toEqual(["upgradeBought", ...TAIL]);
    expect(bought.state.players[0]!.cash).toBe(100);
    expect(actor(bought.state)).toBe(p1);
  });

  it("endTurn leaves without buying", () => {
    const { state } = dock({ cash: 500 });
    const ended = act(state, END);
    expect(types(ended.events)).toEqual(TAIL);
    expect(ended.state.players[0]).toMatchObject({
      cash: 500,
      upgrades: { speed: false, capacity: false },
    });
  });

  it("does not offer an upgrade already owned, and does not open with both owned", () => {
    const one = dock({ cash: 900, upgrades: { speed: true, capacity: false } }).state;
    expect(legal(one)).toEqual([buy("capacity"), END]);
    expect(code(one, buy("speed"))).toBe("illegal-action");
    const both = dock({ cash: 900, upgrades: { speed: true, capacity: true } }).state;
    expect(both.phase.kind).toBe("roll");
  });

  it("rejects buying outside the shop, by another player, or what is not affordable", () => {
    expect(code(withPlayer(base, 0, { cash: 900 }), buy("speed"))).toBe("wrong-phase");
    const raw = rawContent();
    raw.rules.upgrades.speed.price = 300;
    const dear = compiledContent(raw);
    const { state } = dock({ cash: 200 }, dear);
    expect(legal(state, dear)).toEqual([buy("capacity"), END]);
    expect(applyAction(dear, state, buy("speed"))).toMatchObject({
      ok: false,
      error: { code: "illegal-action" },
    });
    expect(code(state, { type: "buyUpgrade", player: p1, upgrade: "capacity" })).toBe(
      "not-your-turn",
    );
    expect(code(state, { type: "roll", player: p0 })).toBe("wrong-phase");
  });

  it("upgrades only on arrival: next turn the docked ship just rolls", () => {
    const { state } = dock({ cash: 900 });
    const next = playTurn(act(state, END).state, 1);
    expect(next.phase).toEqual({ kind: "roll", actors: [p0] });
    expect(legal(next)).toEqual([{ type: "roll", player: p0 }]);
  });

  it("a Speed upgrade bought now counts on the next roll; Capacity on the next catch", () => {
    const state = act(act(dock({ cash: 400 }).state, buy("speed")).state, buy("capacity")).state;
    expect(state.players[0]!.upgrades).toEqual({ speed: true, capacity: true });
  });
});

describe("Sinking Boat", () => {
  const LOCKER = [tile(2, 2), tile(3, 2)] as const;
  const sink = (state: GameState) =>
    land(withTopCard(state, "risk", "sinking-boat"), LOCKER[0], LOCKER[1]);
  const loaded = (state: GameState, patch: Partial<PlayerState> = {}) =>
    withPlayer(state, 0, { fish: [100, 500], ...patch });

  it("both starting docks free: lose all fish, then choose a dock", () => {
    const { state, events } = sink(loaded(base));
    expect(types(events)).toEqual(["moved", "cardDrawn", "fishLost", "cardDiscarded"]);
    expect(events[2]).toEqual({
      type: "fishLost",
      player: p0,
      fish: [100, 500],
      reason: "sinking-boat",
    });
    expect(state.players[0]).toMatchObject({ fish: [], position: LOCKER[1] });
    // The card is already discarded while the player decides.
    expect(state.decks.risk.discard).toEqual(["sinking-boat"]);
    expect(deckCards(state, "risk")).toEqual(fullDeck("risk"));
    expect(state.phase).toEqual({
      kind: "placeShip",
      reason: "sinking-boat",
      docks: ["start-left", "start-right"],
      actors: [p0],
    });
    expect(legal(state)).toEqual([
      { type: "placeShip", player: p0, dock: "start-left" },
      { type: "placeShip", player: p0, dock: "start-right" },
    ]);
    expect(code(state, { type: "placeShip", player: p0, dock: "cruise" })).toBe("illegal-action");

    const placed = act(state, { type: "placeShip", player: p0, dock: "start-right" });
    expect(placed.events).toEqual([
      {
        type: "shipRelocated",
        player: p0,
        from: LOCKER[1],
        to: START_RIGHT,
        dock: "start-right",
      },
      { type: "turnEnded", player: p0 },
      { type: "turnStarted", player: p1, round: 1 },
    ]);
    expect(placed.state.players[0]!.position).toBe(START_RIGHT);
    expect(placed.state.phase).toEqual({ kind: "roll", actors: [p1] });
  });

  it("one starting dock free: the ship goes there with no choice", () => {
    const { state, events } = sink(loaded(withShips(base, { 1: START_LEFT })));
    expect(types(events)).toEqual([
      "moved",
      "cardDrawn",
      "fishLost",
      "cardDiscarded",
      "shipRelocated",
      ...TAIL,
    ]);
    expect(events[4]).toMatchObject({ to: START_RIGHT, dock: "start-right" });
    expect(state.players[0]!.position).toBe(START_RIGHT);
  });

  it("both starting docks taken: the cruise ship dock", () => {
    const three = withShips(started(3), { 1: START_LEFT, 2: START_RIGHT });
    const { state, events } = sink(loaded(three));
    expect(events).toContainEqual({
      type: "shipRelocated",
      player: id(three, 0),
      from: LOCKER[1],
      to: CRUISE,
      dock: "cruise",
    });
    expect(state.players[0]).toMatchObject({ fish: [], position: CRUISE });
  });

  it("every dock taken: the ship stays put but the fish are still lost", () => {
    const four = withShips(started(4), { 1: START_LEFT, 2: START_RIGHT, 3: CRUISE });
    const { state, events } = sink(loaded(four, { cash: 900 }));
    expect(types(events)).toEqual([
      "moved",
      "cardDrawn",
      "fishLost",
      "cardDiscarded",
      "relocationFailed",
      ...TAIL,
    ]);
    expect(events[4]).toEqual({ type: "relocationFailed", player: id(four, 0) });
    // No dock reached, so no shop, even with cash.
    expect(state.players[0]).toMatchObject({ fish: [], position: LOCKER[1], cash: 900 });
    expect(actor(state)).toBe(id(four, 1));
  });

  it("the shop opens on arrival when an upgrade is affordable", () => {
    const auto = sink(loaded(withShips(base, { 1: START_LEFT }), { cash: 200 })).state;
    expect(auto.phase).toEqual({
      kind: "dockShop",
      reason: "sinking-boat",
      dock: "start-right",
      actors: [p0],
    });
    const bought = act(auto, buy("capacity"));
    expect(types(bought.events)).toEqual(["upgradeBought", ...TAIL]);

    const chosen = act(sink(loaded(base, { cash: 500 })).state, {
      type: "placeShip",
      player: p0,
      dock: "start-left",
    });
    expect(types(chosen.events)).toEqual(["shipRelocated"]);
    expect(chosen.state.phase).toMatchObject({ kind: "dockShop", dock: "start-left" });
    expect(act(chosen.state, END).state.phase).toEqual({ kind: "roll", actors: [p1] });

    const three = withShips(started(3), { 1: START_LEFT, 2: START_RIGHT });
    expect(sink(loaded(three, { cash: 200 })).state.phase).toMatchObject({
      kind: "dockShop",
      reason: "sinking-boat",
      dock: "cruise",
    });
  });

  it("is not a docking: nothing is sold, fine tokens and cash stay", () => {
    const { state, events } = sink(loaded(withShips(base, { 1: START_LEFT }), { fineTokens: 2 }));
    expect(types(events)).not.toContain("docked");
    expect(types(events)).not.toContain("fishSold");
    expect(types(events)).not.toContain("fineTokensPaid");
    expect(state.players[0]).toMatchObject({ cash: 0, fineTokens: 2, fish: [] });
  });

  it("with no fish the ship is still moved", () => {
    const { state, events } = sink(withShips(base, { 1: START_LEFT }));
    expect(types(events)).not.toContain("fishLost");
    expect(state.players[0]!.position).toBe(START_RIGHT);
  });

  it("next turn the ship sails out of the dock as normal", () => {
    const moved = sink(loaded(withShips(base, { 1: tile(7, 8) }))).state;
    const placed = act(moved, { type: "placeShip", player: p0, dock: "start-left" }).state;
    const next = playTurn(placed, 1);
    expect(next.phase).toEqual({ kind: "roll", actors: [p0] });
    expect(next.players[0]!.position).toBe(START_LEFT);
  });
});
