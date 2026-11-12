import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getActors, getLegalActions } from "./legal";
import { rollDie } from "./rng";
import { createGame } from "./setup";
import { compiledContent, rawContent } from "./testContent";
import {
  act,
  actor,
  board,
  clone,
  content,
  CRUISE,
  deepFreeze,
  id,
  moveTargets,
  playTurn,
  roll,
  START_LEFT,
  START_RIGHT,
  started,
  tile,
  types,
  withDie,
  withEvent,
  withShips,
} from "./testHelpers";
import type { Action, GameEvent, GameState, MovementEffect, PlayerView, TileId } from "./types";

const speed = (state: GameState, index: number): GameState => {
  const next = clone(state);
  next.players[index]!.upgrades.speed = true;
  return next;
};

const rolledEvent = (events: GameEvent[]) => {
  const e = events.find((x) => x.type === "rolled");
  if (e?.type !== "rolled") throw new Error("no rolled event");
  return e.roll;
};

const reject = (state: GameState, action: Action) => {
  const frozen = deepFreeze(clone(state));
  const result = applyAction(content, frozen, action);
  if (result.ok) throw new Error("expected a rejection");
  expect(result).toEqual({ ok: false, error: result.error });
  return result.error.code;
};

describe("roll and step count", () => {
  it("steps = die with no upgrades and no event", () => {
    for (const die of [1, 2, 3, 4, 5, 6]) {
      const { events } = roll(started(2), die);
      expect(rolledEvent(events)).toEqual({ die, speedBonus: 0, eventModifier: 0, steps: die });
    }
  });

  it("the Speed upgrade adds the configured bonus", () => {
    const bonus = content.rules.upgrades.speed.rollBonus;
    expect(bonus).toBe(2);
    const { events } = roll(speed(started(2), 0), 3);
    expect(rolledEvent(events)).toEqual({ die: 3, speedBonus: 2, eventModifier: 0, steps: 5 });
  });

  it("movement events add or subtract 1", () => {
    expect(rolledEvent(roll(withEvent(started(2), "movement+1"), 4).events)).toEqual({
      die: 4,
      speedBonus: 0,
      eventModifier: 1,
      steps: 5,
    });
    expect(rolledEvent(roll(withEvent(started(2), "movement-1"), 4).events)).toEqual({
      die: 4,
      speedBonus: 0,
      eventModifier: -1,
      steps: 3,
    });
  });

  it("Speed and -1 Movement combine: a 1 becomes 2 steps", () => {
    const state = withEvent(speed(started(2), 0), "movement-1");
    expect(rolledEvent(roll(state, 1).events).steps).toBe(2);
  });

  it("an event that is not a movement event adds nothing", () => {
    expect(rolledEvent(roll(withEvent(started(2), "helicopter"), 4).events).eventModifier).toBe(0);
  });

  it("a 1 with -1 Movement is 0 steps: no move, no card, the turn ends", () => {
    const before = withEvent(started(2), "movement-1");
    const { state, events } = roll(before, 1);
    expect(types(events)).toEqual(["rolled", "blocked", "turnEnded", "turnStarted"]);
    expect(events[1]).toEqual({ type: "blocked", player: id(before, 0), reason: "zero-steps" });
    expect(state.players[0]!.position).toBe(START_LEFT);
    expect(state.decks).toEqual(before.decks);
    expect(state.phase).toEqual({ kind: "roll", actors: [id(before, 1)] });
  });

  it("steps never go below 0", () => {
    const raw = rawContent();
    (raw.cards.cards["movement-1"]!.effect as MovementEffect).delta = -3;
    const slow = compiledContent(raw);
    const state = withEvent(started(2, "slow", slow), "movement-1");
    const { events } = roll(state, 2, slow);
    expect(rolledEvent(events)).toEqual({ die: 2, speedBonus: 0, eventModifier: -3, steps: 0 });
    expect(types(events)).toContain("blocked");
  });

  it("the worst case, 6 + 2 + 1 = 9 steps, gives a move phase", () => {
    const state = withEvent(speed(started(2), 0), "movement+1");
    const { state: after, events } = roll(state, 6);
    expect(rolledEvent(events).steps).toBe(9);
    expect(after.phase.kind).toBe("move");
    expect(moveTargets(after).length).toBeGreaterThan(0);
  });

  it("uses exactly one die from the RNG and is deterministic", () => {
    const before = withDie(started(2), 4);
    const a = act(before, { type: "roll", player: actor(before) });
    const b = act(before, { type: "roll", player: actor(before) });
    expect(a).toEqual(b);
    expect(a.state.rng).toEqual(rollDie(before.rng, content.rules.dieSides)[1]);
  });
});

describe("roll to move", () => {
  it("a roll with destinations opens the move phase for the same player", () => {
    const before = started(2);
    const { state, events } = roll(before, 3);
    expect(types(events)).toEqual(["rolled"]);
    expect(state.phase).toEqual({
      kind: "move",
      roll: { die: 3, speedBonus: 0, eventModifier: 0, steps: 3 },
      actors: [id(before, 0)],
    });
    const legal = getLegalActions(content, state, id(before, 0));
    expect(legal.every((a) => a.type === "move")).toBe(true);
    // Player 1 sits on the right starting dock, so it is not offered.
    expect(moveTargets(state)).toEqual(
      [tile(5, 18), tile(4, 17), tile(2, 17), tile(3, 16)].sort((a, b) => a - b),
    );
  });

  it("a single legal destination still waits for the player's move", () => {
    const { state } = roll(started(2), 1);
    expect(state.phase.kind).toBe("move");
    expect(moveTargets(state)).toEqual([tile(3, 18)]);
  });

  it("a legal move moves the ship, reports a path and passes the turn", () => {
    const before = roll(started(2), 2).state;
    const to = tile(3, 17);
    const { state, events } = act(before, { type: "move", player: id(before, 0), to });
    expect(state.players[0]!.position).toBe(to);
    expect(events[0]).toEqual({
      type: "moved",
      player: id(before, 0),
      from: START_LEFT,
      to,
      path: [START_LEFT, tile(3, 18), to],
    });
    expect(types(events)).toEqual(["moved", "turnEnded", "turnStarted"]);
    expect(state.phase).toEqual({ kind: "roll", actors: [id(before, 1)] });
    expect(state.turn).toEqual({ playerIndex: 1, helicopterUsed: false });
  });

  it("rejects a move to anything but a legal destination", () => {
    const state = roll(started(2), 2).state;
    const player = id(state, 0);
    const bad: TileId[] = [START_LEFT, tile(3, 18), tile(3, 11), tile(0, 0), -1, 9999, 1.5];
    for (const to of bad)
      expect(reject(state, { type: "move", player, to })).toBe("illegal-action");
  });

  it("accepts a move if and only if getLegalActions lists it", () => {
    const positions: [TileId, TileId, number][] = [
      [START_LEFT, START_RIGHT, 3],
      [tile(5, 17), tile(4, 18), 5],
      [tile(7, 0), tile(6, 1), 2],
      [tile(2, 11), CRUISE, 6],
    ];
    for (const [mine, theirs, die] of positions) {
      const state = roll(withShips(started(2), { 0: mine, 1: theirs }), die).state;
      const legal = new Set(moveTargets(state));
      expect(legal.size).toBeGreaterThan(0);
      for (let to = 0; to < board.tiles.length; to++) {
        const result = applyAction(content, state, { type: "move", player: id(state, 0), to });
        expect(result.ok).toBe(legal.has(to));
      }
    }
  });

  it("with no legal move the ship stays and the turn ends without a card", () => {
    const before = withShips(started(2), { 1: tile(3, 18) });
    for (const die of [1, 4, 6]) {
      const { state, events } = roll(before, die);
      expect(types(events)).toEqual(["rolled", "blocked", "turnEnded", "turnStarted"]);
      expect(events[1]).toEqual({
        type: "blocked",
        player: id(before, 0),
        reason: "no-legal-move",
      });
      expect(state.players[0]!.position).toBe(START_LEFT);
      expect(state.decks).toEqual(before.decks);
      expect(state.phase).toEqual({ kind: "roll", actors: [id(before, 1)] });
    }
  });

  it("a ship boxed in at sea is blocked the same way", () => {
    const before = withShips(started(3), { 0: tile(5, 19), 1: START_RIGHT, 2: tile(5, 18) });
    const { state, events } = roll(before, 3);
    expect(types(events)).toEqual(["rolled", "blocked", "turnEnded", "turnStarted"]);
    expect(state.players[0]!.position).toBe(tile(5, 19));
    expect(state.decks).toEqual(before.decks);
  });

  it("a blocked docked ship stays docked and does not dock again", () => {
    const before = withShips(started(2), { 1: tile(3, 18) });
    before.players[0]!.fish = [100, 300];
    before.players[0]!.fineTokens = 1;
    for (const state of [roll(before, 5), roll(withEvent(before, "movement-1"), 1)]) {
      // No docked, fishSold, fineTokensPaid or shop: only these four events.
      expect(types(state.events)).toEqual(["rolled", "blocked", "turnEnded", "turnStarted"]);
      expect(state.state.players[0]).toEqual(before.players[0]);
      expect(state.state.phase.kind).toBe("roll");
      expect(actor(state.state)).toBe(id(before, 1));
    }
  });

  it("a docked ship with a way out has to leave", () => {
    for (const die of [1, 2, 3, 4, 5, 6]) {
      const state = roll(withShips(started(2), { 1: tile(0, 7) }), die).state;
      const legal = getLegalActions(content, state, id(state, 0));
      expect(legal.length).toBeGreaterThan(0);
      expect(legal.every((a) => a.type === "move" && a.to !== START_LEFT)).toBe(true);
    }
  });

  it("a player who cannot possibly move still has to roll", () => {
    const state = withShips(started(2), { 1: tile(3, 18) });
    expect(getLegalActions(content, state, id(state, 0))).toEqual([
      { type: "roll", player: id(state, 0) },
    ]);
  });

  it("a roll higher than the distance can still dock", () => {
    // (5,17) is 3 steps from the right starting dock.
    const before = withShips(started(2), { 0: tile(5, 17), 1: tile(0, 7) });
    expect(moveTargets(roll(before, 2).state)).not.toContain(START_RIGHT);
    const rolled = roll(before, 6).state;
    expect(moveTargets(rolled)).toContain(START_RIGHT);
    const { state, events } = act(rolled, { type: "move", player: id(before, 0), to: START_RIGHT });
    expect(state.players[0]!.position).toBe(START_RIGHT);
    const moved = events[0]!;
    if (moved.type !== "moved") throw new Error("no moved event");
    expect(moved.path).toHaveLength(4);
  });

  it("a ship on a dock keeps everyone else off it and from passing through", () => {
    const before = withShips(started(2), { 0: tile(7, 0), 1: tile(6, 0) });
    const docked = act(roll(before, 1).state, { type: "move", player: id(before, 0), to: CRUISE });
    expect(docked.state.players[0]!.position).toBe(CRUISE);
    for (const die of [1, 2, 3, 4, 5, 6]) {
      const targets = moveTargets(roll(docked.state, die).state);
      expect(targets).not.toContain(CRUISE);
    }
    // (7,0) is only reachable in 1; with the dock taken, 2 steps cannot go on to (7,2).
    expect(moveTargets(roll(withShips(docked.state, { 1: tile(7, 0) }), 2).state)).not.toContain(
      tile(7, 2),
    );
  });

  it("a ship on one starting dock does not stop a neighbour docking on the other", () => {
    const before = withShips(started(2), { 0: tile(5, 19), 1: START_LEFT });
    expect(moveTargets(roll(before, 1).state)).toContain(START_RIGHT);
  });

  it("landing resolves nothing yet (Session 4): no card, no sale", () => {
    const base = withShips(started(2), { 0: tile(7, 0), 1: tile(0, 7) });
    base.players[0]!.fish = [100];
    for (const to of [tile(6, 0), CRUISE]) {
      const rolled = roll(base, 1).state;
      const { state, events } = act(rolled, { type: "move", player: id(base, 0), to });
      expect(types(events)).toEqual(["moved", "turnEnded", "turnStarted"]);
      expect(state.decks).toEqual(base.decks);
      expect(state.players[0]!.fish).toEqual([100]);
      expect(state.players[0]!.cash).toBe(0);
    }
  });
});

describe("setup placement", () => {
  it("player 1 chooses a starting dock, player 2 gets the other, round 1 starts", () => {
    const created = createGame(content, { seed: "setup", players: ["a", "b", "c", "d"] }).state;
    const first = actor(created);
    expect(getLegalActions(content, created, first)).toEqual([
      { type: "placeShip", player: first, dock: "start-left" },
      { type: "placeShip", player: first, dock: "start-right" },
    ]);
    expect(reject(created, { type: "placeShip", player: first, dock: "cruise" })).toBe(
      "illegal-action",
    );
    const { state, events } = act(created, {
      type: "placeShip",
      player: first,
      dock: "start-right",
    });
    const second = id(state, 1);
    expect(events).toEqual([
      {
        type: "shipPlaced",
        player: first,
        dock: "start-right",
        tile: START_RIGHT,
        reason: "setup",
      },
      { type: "shipPlaced", player: second, dock: "start-left", tile: START_LEFT, reason: "setup" },
      { type: "roundStarted", round: 1 },
      { type: "turnStarted", player: first, round: 1 },
    ]);
    expect(state.players.map((p) => p.position)).toEqual([START_RIGHT, START_LEFT, null, null]);
    expect(state.phase).toEqual({ kind: "roll", actors: [first] });
    expect(state.round).toBe(1);
  });

  it("with 2 players nobody waits", () => {
    expect(started(2).players.map((p) => p.position)).toEqual([START_LEFT, START_RIGHT]);
  });

  it("with 3 players only the third waits", () => {
    expect(started(3).players.map((p) => p.position)).toEqual([START_LEFT, START_RIGHT, null]);
  });
});

describe("late entry (players 3 and 4)", () => {
  /** 4 players, player 0 has played, player 1 is about to roll. Ships as given. */
  const beforeEntry = (positions: Record<number, TileId | null> = {}): GameState =>
    withShips(playTurn(started(4), 2), positions);

  it("both starting docks free: the entrant chooses, then rolls and sails out", () => {
    const state = playTurn(beforeEntry(), 2);
    const third = id(state, 2);
    expect(state.phase).toEqual({
      kind: "placeShip",
      reason: "entry",
      docks: ["start-left", "start-right"],
      actors: [third],
    });
    expect(state.turn.playerIndex).toBe(2);
    // Placing is the only thing they can do.
    expect(getLegalActions(content, state, third)).toEqual([
      { type: "placeShip", player: third, dock: "start-left" },
      { type: "placeShip", player: third, dock: "start-right" },
    ]);

    const placed = act(state, { type: "placeShip", player: third, dock: "start-right" });
    expect(placed.events).toEqual([
      {
        type: "shipPlaced",
        player: third,
        dock: "start-right",
        tile: START_RIGHT,
        reason: "entry",
      },
    ]);
    expect(placed.state.phase).toEqual({ kind: "roll", actors: [third] });
    expect(placed.state.turn.playerIndex).toBe(2);

    const rolled = roll(placed.state, 1).state;
    expect(moveTargets(rolled)).toEqual([tile(4, 18), tile(5, 19)]);
  });

  it("one starting dock free: the entrant is placed there and rolls", () => {
    // Player 0 is back on (or never left) the left dock; player 1 sails out of the right one.
    const before = beforeEntry({ 0: START_LEFT });
    const rolled = roll(before, 2).state;
    const { state, events } = act(rolled, { type: "move", player: id(before, 1), to: tile(4, 17) });
    const third = id(before, 2);
    expect(types(events)).toEqual(["moved", "turnEnded", "turnStarted", "shipPlaced"]);
    expect(events[3]).toEqual({
      type: "shipPlaced",
      player: third,
      dock: "start-right",
      tile: START_RIGHT,
      reason: "entry",
    });
    expect(state.players[2]!.position).toBe(START_RIGHT);
    expect(state.phase).toEqual({ kind: "roll", actors: [third] });
  });

  it("no starting dock free: the entrants miss the turn, roll nothing, and the cruise dock is no help", () => {
    // Players 0 and 1 sit on the starting docks; -1 Movement and a 1 keeps player 1 there.
    const before = withDie(withEvent(beforeEntry({ 0: START_LEFT }), "movement-1"), 1);
    const [a, b, c, d] = before.players.map((p) => p.id) as [string, string, string, string];
    const { state, events } = act(before, { type: "roll", player: b });
    expect(events.slice(1)).toEqual([
      { type: "blocked", player: b, reason: "zero-steps" },
      { type: "turnEnded", player: b },
      { type: "turnStarted", player: c, round: 1 },
      { type: "turnSkipped", player: c, reason: "no-free-starting-dock" },
      { type: "turnEnded", player: c },
      { type: "turnStarted", player: d, round: 1 },
      { type: "turnSkipped", player: d, reason: "no-free-starting-dock" },
      { type: "turnEnded", player: d },
      { type: "roundEnded", round: 1 },
      { type: "roundStarted", round: 2 },
      { type: "turnStarted", player: a, round: 2 },
    ]);
    expect(state.players.map((p) => p.position)).toEqual([START_LEFT, START_RIGHT, null, null]);
    expect(state.players.some((p) => p.position === CRUISE)).toBe(false);
    // Only player 1's die was rolled.
    expect(state.rng).toEqual(rollDie(before.rng, content.rules.dieSides)[1]);
    expect(state.round).toBe(2);
    expect(state.phase).toEqual({ kind: "roll", actors: [a] });
  });

  it("a skipped entrant tries again next round", () => {
    const skipped = roll(withEvent(beforeEntry({ 0: START_LEFT }), "movement-1"), 1).state;
    // Round 2: player 0 sails out (3 - 1 = 2 steps), player 1 is stuck again.
    const afterFirst = playTurn(skipped, 3);
    expect(afterFirst.players[0]!.position).not.toBe(START_LEFT);
    const { state, events } = roll(afterFirst, 1);
    const third = id(state, 2);
    expect(events).toContainEqual({
      type: "shipPlaced",
      player: third,
      dock: "start-left",
      tile: START_LEFT,
      reason: "entry",
    });
    expect(state.phase).toEqual({ kind: "roll", actors: [third] });
    expect(state.round).toBe(2);
  });

  it("player 4 gets the same choice once player 3 has sailed out", () => {
    let state = playTurn(beforeEntry(), 2);
    state = act(state, { type: "placeShip", player: actor(state), dock: "start-left" }).state;
    state = playTurn(state, 2);
    expect(state.phase).toEqual({
      kind: "placeShip",
      reason: "entry",
      docks: ["start-left", "start-right"],
      actors: [id(state, 3)],
    });
  });

  it("an entrant placed but blocked stays on the dock; player 4 takes the other dock", () => {
    // Player 0 sits on the left dock's only exit.
    let state = playTurn(beforeEntry({ 0: tile(3, 18), 1: tile(0, 7) }), 2);
    const third = id(state, 2);
    state = act(state, { type: "placeShip", player: third, dock: "start-left" }).state;
    const { state: after, events } = roll(state, 4);
    expect(types(events)).toEqual([
      "rolled",
      "blocked",
      "turnEnded",
      "turnStarted",
      "shipPlaced", // player 4, on the only free starting dock
    ]);
    expect(events[1]).toEqual({ type: "blocked", player: third, reason: "no-legal-move" });
    expect(after.players[2]!.position).toBe(START_LEFT);
    expect(after.players[3]!.position).toBe(START_RIGHT);
    expect(after.phase).toEqual({ kind: "roll", actors: [id(after, 3)] });

    // Next round player 3 is an ordinary docked ship: straight to the roll, no new placement.
    let next = playTurn(after, 1); // player 4
    next = playTurn(next, 1); // player 0 moves off (3,18)
    const beforeThird = playTurn(next, 1); // player 1
    expect(beforeThird.round).toBe(2);
    expect(beforeThird.phase).toEqual({ kind: "roll", actors: [third] });
    expect(beforeThird.players[2]!.position).toBe(START_LEFT);
  });

  it("an entrant sitting on one dock with the other taken leaves player 4 waiting", () => {
    // Player 1 stays on the right dock (0 steps); player 0 blocks the left dock's exit.
    let state = withEvent(beforeEntry({ 0: tile(3, 18) }), "movement-1");
    state = roll(state, 1).state; // player 1: 0 steps; player 3 auto-placed on the left dock
    const third = id(state, 2);
    expect(state.players[2]!.position).toBe(START_LEFT);
    expect(actor(state)).toBe(third);
    const { state: after, events } = roll(state, 5);
    expect(events).toContainEqual({
      type: "turnSkipped",
      player: id(state, 3),
      reason: "no-free-starting-dock",
    });
    expect(after.players[3]!.position).toBeNull();
    expect(after.round).toBe(2);
  });

  it("an entrant who rolls 0 steps stays on the dock without a card", () => {
    let state = withEvent(beforeEntry({ 1: tile(0, 7) }), "movement-1");
    state = playTurn(state, 3);
    const third = actor(state);
    state = act(state, { type: "placeShip", player: third, dock: "start-right" }).state;
    const { state: after, events } = roll(state, 1);
    expect(types(events).slice(0, 3)).toEqual(["rolled", "blocked", "turnEnded"]);
    expect(after.players[2]!.position).toBe(START_RIGHT);
    expect(after.decks).toEqual(state.decks);
  });

  it("rejects placing on a taken dock, the cruise dock or an unknown dock", () => {
    const state = playTurn(beforeEntry(), 2);
    const player = actor(state);
    for (const dock of ["cruise", "nowhere", ""]) {
      expect(reject(state, { type: "placeShip", player, dock })).toBe("illegal-action");
    }
    const oneFree = clone(state);
    if (oneFree.phase.kind !== "placeShip") throw new Error("expected placeShip");
    oneFree.phase.docks = ["start-left"];
    expect(reject(oneFree, { type: "placeShip", player, dock: "start-right" })).toBe(
      "illegal-action",
    );
  });

  it("a waiting ship holds no tile: its future dock stays open to others", () => {
    const before = withShips(started(3), { 0: tile(5, 19), 1: tile(0, 7) });
    expect(moveTargets(roll(before, 1).state)).toContain(START_RIGHT);
  });
});

describe("turn and round plumbing", () => {
  it("turns follow player order and rounds advance after the last player", () => {
    let state = started(3);
    const order: string[] = [];
    const seen: GameEvent[] = [];
    const step = (action: Action): void => {
      const update = act(state, action);
      seen.push(...update.events);
      state = update.state;
    };
    for (let i = 0; i < 6; i++) {
      const player = actor(state);
      order.push(player);
      if (state.phase.kind === "placeShip") step({ type: "placeShip", player, dock: "start-left" });
      state = withDie(state, 2);
      step({ type: "roll", player });
      if (state.phase.kind === "move") step({ type: "move", player, to: moveTargets(state)[0]! });
    }
    const ids = state.players.map((p) => p.id);
    expect(order).toEqual([...ids, ...ids]);
    expect(seen.filter((e) => e.type === "roundEnded")).toEqual([
      { type: "roundEnded", round: 1 },
      { type: "roundEnded", round: 2 },
    ]);
    expect(state.round).toBe(3);
  });

  it("reports errors in a fixed order and returns no state", () => {
    const state = started(3);
    const [a, b] = [id(state, 0), id(state, 1)];
    expect(reject(state, { type: "roll", player: "nobody" })).toBe("unknown-player");
    expect(reject(state, { type: "roll", player: b })).toBe("not-your-turn");
    expect(reject(state, { type: "move", player: b, to: 0 })).toBe("not-your-turn");
    expect(reject(state, { type: "move", player: a, to: tile(3, 18) })).toBe("wrong-phase");
    expect(reject(state, { type: "placeShip", player: a, dock: "start-left" })).toBe("wrong-phase");
    expect(reject(state, { type: "endTurn", player: a })).toBe("wrong-phase");
    const moving = roll(state, 2).state;
    expect(reject(moving, { type: "roll", player: a })).toBe("wrong-phase");
    expect(reject(moving, { type: "move", player: a, to: 0 })).toBe("illegal-action");
    // The Helicopter belongs to the roll phase but is never legal before Session 4.
    expect(reject(state, { type: "useHelicopter", player: a })).toBe("illegal-action");
  });

  it("counts accepted actions only", () => {
    const state = started(2);
    expect(state.actionCount).toBe(1);
    reject(state, { type: "roll", player: id(state, 1) });
    const rolled = roll(state, 2).state;
    expect(rolled.actionCount).toBe(2);
    expect(playTurn(state, 2).actionCount).toBe(3);
  });

  it("getActors returns the phase's actors; nobody else has legal actions", () => {
    const state = started(3);
    expect(getActors(state)).toEqual([id(state, 0)]);
    expect(getLegalActions(content, state, id(state, 1))).toEqual([]);
    expect(getLegalActions(content, state, id(state, 2))).toEqual([]);
    expect(getLegalActions(content, state, "nobody")).toEqual([]);
  });

  it("gives the same legal actions on a client view (no deck order, no RNG)", () => {
    const view = (state: GameState): PlayerView => {
      const { decks, ...rest }: Omit<GameState, "rng"> & { rng?: GameState["rng"] } = clone(state);
      delete rest.rng;
      const count = (d: (typeof decks)["safe"]) => ({
        drawCount: d.draw.length,
        discard: d.discard,
      });
      return {
        ...rest,
        viewer: "spectator",
        decks: { safe: count(decks.safe), risk: count(decks.risk), event: count(decks.event) },
      };
    };
    const states = [started(4), roll(started(4), 5).state, playTurn(playTurn(started(4), 2), 2)];
    for (const state of states) {
      for (const p of state.players) {
        expect(getLegalActions(content, view(state), p.id)).toEqual(
          getLegalActions(content, state, p.id),
        );
      }
    }
  });

  it("plays a whole game: plain JSON, ships never share a tile, then gameOver", () => {
    let state = started(4, "full-game");
    let guard = 0;
    while (state.phase.kind !== "gameOver") {
      if (++guard > 2000) throw new Error("game did not end");
      const player = actor(state);
      const legal = getLegalActions(content, state, player);
      expect(legal.length).toBeGreaterThan(0);
      // A spread of choices without a second RNG: vary the pick with the action count.
      const action = legal[(state.actionCount * 7) % legal.length]!;
      const result = applyAction(content, deepFreeze(state), action);
      if (!result.ok) throw new Error(`legal action rejected: ${result.error.message}`);
      state = result.state;
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      const tiles = state.players.flatMap((p) => (p.position === null ? [] : [p.position]));
      expect(new Set(tiles).size).toBe(tiles.length);
      for (const t of tiles) expect(board.tiles[t]?.terrain).not.toBe("island");
    }
    expect(state.round).toBe(content.rules.rounds);
    expect(state.phase).toEqual({ kind: "gameOver", actors: [] });
    expect(getActors(state)).toEqual([]);
    for (const p of state.players) {
      expect(getLegalActions(content, state, p.id)).toEqual([]);
      expect(reject(state, { type: "roll", player: p.id })).toBe("game-over");
    }
    expect(reject(state, { type: "roll", player: "nobody" })).toBe("game-over");
  });
});
