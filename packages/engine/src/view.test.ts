import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getActors, getLegalActions } from "./legal";
import { createGame } from "./setup";
import {
  act,
  actor,
  clone,
  content,
  deepFreeze,
  id,
  land,
  START_LEFT,
  started,
  tile,
  withActiveEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";
import type { GameState, PlayerView } from "./types";
import { redactForClient } from "./view";

/** Player 0 to act; player 1 parked out of the way. */
const base = withShips(started(2), { 1: tile(7, 8) });
const p0 = id(base, 0);
const LOCKER = [tile(2, 2), tile(3, 2)] as const;
const ZONE1 = [tile(3, 17), tile(3, 16)] as const;

/** Every player gets the same legal actions from the state and from each view. */
function expectSameLegality(state: GameState): void {
  const viewers = [...state.players.map((p) => p.id), "spectator" as const];
  for (const viewer of viewers) {
    const view = redactForClient(state, viewer);
    expect(getActors(view)).toEqual(getActors(state));
    for (const p of state.players) {
      expect(getLegalActions(content, view, p.id)).toEqual(getLegalActions(content, state, p.id));
    }
  }
}

describe("redactForClient", () => {
  it("hides deck order and the RNG and keeps everything public", () => {
    const state = withTopCard(withActiveEvent(base, "helicopter"), "safe", "fish+2");
    state.decks.safe.discard = [state.decks.safe.draw.pop()!];
    const view = redactForClient(state, p0);
    expect(view).not.toHaveProperty("rng");
    // The Golden Hook Awards and the stats are secret until the result.
    expect(view).not.toHaveProperty("awards");
    expect(view.decks).toEqual({
      safe: { drawCount: state.decks.safe.draw.length, discard: state.decks.safe.discard },
      risk: { drawCount: 16, discard: [] },
      event: { drawCount: 10, discard: [] },
    });
    for (const deck of Object.values(view.decks)) expect(deck).not.toHaveProperty("draw");
    const omit = (o: object, keys: string[]) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    expect(omit(view, ["viewer", "decks"])).toEqual(omit(state, ["rng", "decks", "awards"]));
    expect(view.viewer).toBe(p0);
  });

  it("the view is plain JSON with no draw order anywhere in it", () => {
    const view = redactForClient(base, "spectator");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    // The top cards of a pile, in order, never appear in the serialised view.
    const top = JSON.stringify(base.decks.safe.draw.slice(0, 6));
    expect(JSON.stringify(view)).not.toContain(top);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(base.rng));
  });

  it("does not share or change the state", () => {
    const state = deepFreeze(clone(base));
    const view = redactForClient(state, p0) as PlayerView;
    view.players[0]!.cash = 999;
    view.decks.safe.discard.push("boot");
    expect(state.players[0]!.cash).toBe(0);
    expect(state.decks.safe.discard).toEqual([]);
  });

  it("every viewer currently gets the same information", () => {
    const forA = redactForClient(base, id(base, 0));
    const forSpectator = redactForClient(base, "spectator");
    expect({ ...forA, viewer: null }).toEqual({ ...forSpectator, viewer: null });
  });

  it("shows the result once the game is over", () => {
    const over = clone(base);
    over.phase = { kind: "gameOver", actors: [] };
    over.result = { scores: [], winners: [], reason: "rounds", awards: [], stats: {} };
    expect(redactForClient(over, p0).result).toEqual(over.result);
  });
});

describe("getLegalActions on a redacted view", () => {
  it("dockShop", () => {
    const docked = land(withPlayer(base, 0, { fish: [300, 300] }), tile(3, 18), START_LEFT);
    expect(docked.state.phase.kind).toBe("dockShop");
    expect(getLegalActions(content, docked.state, p0).map((a) => a.type)).toEqual([
      "buyUpgrade",
      "buyUpgrade",
      "endTurn",
    ]);
    expectSameLegality(docked.state);
  });

  it("turnEnd (Helicopter usable after the card)", () => {
    const before = withActiveEvent(withPlayer(base, 0, { cash: 200 }), "helicopter");
    const { state } = land(withTopCard(before, "safe", "fish+1"), ZONE1[0], ZONE1[1]);
    expect(state.phase.kind).toBe("turnEnd");
    expect(getLegalActions(content, state, p0).map((a) => a.type)).toEqual([
      "useHelicopter",
      "endTurn",
    ]);
    expectSameLegality(state);
  });

  it("placeShip after a Sinking Boat", () => {
    const before = withPlayer(base, 0, { fish: [300] });
    const { state } = land(withTopCard(before, "risk", "sinking-boat"), LOCKER[0], LOCKER[1]);
    expect(state.phase).toMatchObject({ kind: "placeShip", reason: "sinking-boat" });
    expect(getLegalActions(content, state, p0)).toHaveLength(2);
    expectSameLegality(state);
  });

  it("setup placement, roll, move and gameOver", () => {
    const setup = createGame(content, { seed: "view", players: ["a", "b", "c"] }).state;
    expect(setup.phase).toMatchObject({ kind: "placeShip", reason: "setup" });
    expectSameLegality(setup);
    expectSameLegality(base);
    const moving = act(base, { type: "roll", player: p0 }).state;
    expect(moving.phase.kind).toBe("move");
    expectSameLegality(moving);
    const over = clone(base);
    over.phase = { kind: "gameOver", actors: [] };
    expectSameLegality(over);
  });

  it("in every state of a whole game", () => {
    let state = started(4, "view-legality");
    let guard = 0;
    while (state.phase.kind !== "gameOver") {
      if (++guard > 5000) throw new Error("game did not end");
      expectSameLegality(state);
      const legal = getLegalActions(content, state, actor(state));
      const result = applyAction(content, state, legal[state.actionCount % legal.length]!);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expectSameLegality(state);
  });
});
