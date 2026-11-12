import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { compiledContent, rawContent } from "./testContent";
import {
  act,
  actor,
  clone,
  content,
  id,
  land,
  roll,
  START_LEFT,
  started,
  tile,
  types,
  withEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { Action, GameState, HelicopterEffect } from "./types";

/** Helicopter active; player 0 to roll on the left starting dock, player 1 out at sea. */
const base = withEvent(withShips(started(2), { 1: tile(7, 8) }), "helicopter");
const p0 = id(base, 0);
const p1 = id(base, 1);
const ROLL: Action = { type: "roll", player: p0 };
const HELI: Action = { type: "useHelicopter", player: p0 };
const END: Action = { type: "endTurn", player: p0 };
const legal = (state: GameState): Action[] => getLegalActions(content, state, p0);
const code = (state: GameState, action: Action) => {
  const result = applyAction(content, state, action);
  return result.ok ? "ok" : result.error.code;
};
const SEA = [tile(3, 17), tile(3, 16)] as const;

describe("Helicopter before rolling", () => {
  it("is offered with a fish and the fee in cash", () => {
    expect(legal(withPlayer(base, 0, { fish: [100], cash: 200 }))).toEqual([ROLL, HELI]);
  });

  it("is not offered with no fish, without the fee, with fine tokens, or without the event", () => {
    const cases = [
      withPlayer(base, 0, { fish: [], cash: 900 }),
      withPlayer(base, 0, { fish: [1000], cash: 100 }),
      withPlayer(base, 0, { fish: [1000], cash: 0, fineTokens: 1 }),
      { ...withPlayer(base, 0, { fish: [100], cash: 900 }), activeEvent: null },
      withEvent(withPlayer(base, 0, { fish: [100], cash: 900 }), "movement+1"),
    ];
    for (const state of cases) {
      expect(legal(state)).toEqual([ROLL]);
      expect(code(state, HELI)).toBe("illegal-action");
    }
  });

  it("pays the fee from cash, sells every fish, and the turn carries on to the roll", () => {
    const before = withPlayer(base, 0, { fish: [300, 100], cash: 200 });
    const { state, events } = act(before, HELI);
    expect(events).toEqual([
      { type: "helicopterUsed", player: p0, fee: 200 },
      { type: "fishSold", player: p0, fish: [300, 100], total: 400, via: "helicopter" },
    ]);
    expect(state.players[0]).toMatchObject({ cash: 400, fish: [], position: START_LEFT });
    expect(state.turn).toEqual({ playerIndex: 0, helicopterUsed: true });
    expect(state.phase).toEqual({ kind: "roll", actors: [p0] });
    expect(state.decks).toEqual(before.decks);
    expect(legal(state)).toEqual([ROLL]);
    expect(code(state, HELI)).toBe("illegal-action");
  });

  it("once used at the start it is not offered again at the end of the same turn", () => {
    const used = act(withPlayer(base, 0, { fish: [100], cash: 500 }), HELI).state;
    const { state, events } = land(withTopCard(used, "safe", "fish+3"), SEA[0], SEA[1]);
    // Fish on board and cash for the fee, but the turn just ends.
    expect(state.players[0]).toMatchObject({ fish: [100, 100, 100], cash: 400 });
    expect(types(events).slice(-2)).toEqual(["turnEnded", "turnStarted"]);
    expect(actor(state)).toBe(p1);
  });

  it("uses the fee from the content", () => {
    const raw = rawContent();
    (raw.cards.cards["helicopter"]!.effect as HelicopterEffect).fee = 300;
    const dear = compiledContent(raw);
    const poor = withPlayer(base, 0, { fish: [100], cash: 200 });
    expect(getLegalActions(dear, poor, p0)).toEqual([ROLL]);
    const result = applyAction(dear, withPlayer(base, 0, { fish: [100], cash: 300 }), HELI);
    expect(result.ok && result.state.players[0]!.cash).toBe(100);
  });
});

describe("Helicopter at the end of the turn", () => {
  it("the turn waits after the card resolves, so a fresh catch can be sold", () => {
    const before = withTopCard(withPlayer(base, 0, { cash: 200 }), "safe", "fish+2");
    expect(legal(before)).toEqual([ROLL]);
    const { state, events } = land(before, SEA[0], SEA[1]);
    expect(types(events)).toEqual(["moved", "cardDrawn", "fishGained", "cardDiscarded"]);
    expect(state.phase).toEqual({ kind: "turnEnd", actors: [p0] });
    expect(state.turn).toEqual({ playerIndex: 0, helicopterUsed: false });
    expect(legal(state)).toEqual([HELI, END]);
    expect(getLegalActions(content, state, p1)).toEqual([]);

    const used = act(state, HELI);
    expect(used.events).toEqual([
      { type: "helicopterUsed", player: p0, fee: 200 },
      { type: "fishSold", player: p0, fish: [100, 100], total: 200, via: "helicopter" },
      { type: "turnEnded", player: p0 },
      { type: "turnStarted", player: p1, round: 1 },
    ]);
    expect(used.state.players[0]).toMatchObject({ cash: 200, fish: [] });
    expect(used.state.phase).toEqual({ kind: "roll", actors: [p1] });
    expect(used.state.turn).toEqual({ playerIndex: 1, helicopterUsed: false });
  });

  it("endTurn declines it: fish and cash stay", () => {
    const before = withTopCard(withPlayer(base, 0, { cash: 200, fish: [500] }), "safe", "boot");
    const waiting = land(before, SEA[0], SEA[1]).state;
    const { state, events } = act(waiting, END);
    expect(types(events)).toEqual(["turnEnded", "turnStarted"]);
    expect(state.players[0]).toMatchObject({ cash: 200, fish: [500] });
    expect(actor(state)).toBe(p1);
  });

  it("the turn does not wait when it could not be used", () => {
    const cases = [
      withTopCard(withPlayer(base, 0, { cash: 200 }), "safe", "boot"), // still no fish
      withTopCard(withPlayer(base, 0, { cash: 100 }), "safe", "fish+3"), // no fee
      withTopCard(withPlayer(base, 0, { cash: 200, fish: [100] }), "safe", "fine-100"), // fee gone
      withEvent(withTopCard(withPlayer(base, 0, { cash: 200 }), "safe", "fish+3"), "movement+1"),
    ];
    for (const before of cases) expect(actor(land(before, SEA[0], SEA[1]).state)).toBe(p1);
  });

  it("is offered after a blocked turn too", () => {
    const boxed = withShips(withPlayer(base, 0, { fish: [100], cash: 200 }), { 1: tile(3, 18) });
    const { state, events } = roll(boxed, 4);
    expect(types(events)).toEqual(["rolled", "blocked"]);
    expect(state.phase).toEqual({ kind: "turnEnd", actors: [p0] });
    expect(types(act(state, HELI).events)).toEqual([
      "helicopterUsed",
      "fishSold",
      "turnEnded",
      "turnStarted",
    ]);
  });

  it("a shark can leave nothing to sell", () => {
    const before = withTopCard(
      withPlayer(base, 0, { fish: [100, 100], cash: 200 }),
      "risk",
      "shark",
    );
    expect(actor(land(before, tile(2, 2), tile(3, 2)).state)).toBe(p1);
  });

  it("docking sells everything, so the turn does not wait afterwards", () => {
    const before = withPlayer(base, 0, { fish: [100], cash: 200 });
    const docked = land(before, tile(3, 18), START_LEFT).state;
    expect(docked.phase.kind).toBe("dockShop");
    expect(act(docked, END).state.phase).toEqual({ kind: "roll", actors: [p1] });
  });

  it("each player gets their own use on their own turn", () => {
    const both = withPlayer(withPlayer(base, 0, { fish: [100], cash: 200 }), 1, {
      fish: [300],
      cash: 200,
    });
    const used = act(both, HELI).state;
    const next = land(withTopCard(used, "safe", "boot"), SEA[0], SEA[1]).state;
    expect(actor(next)).toBe(p1);
    expect(next.turn.helicopterUsed).toBe(false);
    expect(getLegalActions(content, next, p1)).toEqual([
      { type: "roll", player: p1 },
      { type: "useHelicopter", player: p1 },
    ]);
  });

  it("rejects endTurn and useHelicopter in the wrong place", () => {
    const state = withPlayer(base, 0, { fish: [100], cash: 200 });
    expect(code(state, END)).toBe("wrong-phase");
    const moving = clone(roll(state, 2).state);
    expect(code(moving, HELI)).toBe("wrong-phase");
    expect(code(state, { type: "useHelicopter", player: p1 })).toBe("not-your-turn");
  });
});
