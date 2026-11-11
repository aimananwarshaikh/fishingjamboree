import { describe, expect, it } from "vitest";
import { expandDeckList } from "./decks";
import { seedRng } from "./rng";
import { createGame, rollOff } from "./setup";
import { compiledContent } from "./testContent";
import type { GameSetup, PlayerId, RollOffRound } from "./types";

const content = compiledContent();
const setup = (seed = "seed-1", players: PlayerId[] = ["p1", "p2", "p3", "p4"]): GameSetup => ({
  seed,
  players,
});

/**
 * Checks a roll-off against the rules: the first round is everyone in seat
 * order; a later round only ever re-rolls players who tied in an earlier
 * round; and the final order puts higher rolls first.
 */
function checkRollOff(players: PlayerId[], order: PlayerId[], rounds: RollOffRound[]): void {
  expect([...order].sort()).toEqual([...players].sort());
  expect(rounds[0]!.rolls.map((r) => r.player)).toEqual(players);
  for (let i = 1; i < rounds.length; i++) {
    const group = rounds[i]!.rolls.map((r) => r.player);
    expect(group.length).toBeGreaterThan(1);
    const tiedEarlier = rounds.slice(0, i).some((earlier) => {
      const dice = group.map((p) => earlier.rolls.find((r) => r.player === p)?.die);
      return dice.every((d) => d !== undefined && d === dice[0]);
    });
    expect(tiedEarlier).toBe(true);
  }
  // Two players' relative order is decided by the last round both rolled in.
  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      const decider = [...rounds]
        .reverse()
        .find(
          (r) =>
            r.rolls.some((x) => x.player === order[a]) &&
            r.rolls.some((x) => x.player === order[b]),
        )!;
      const dieA = decider.rolls.find((x) => x.player === order[a])!.die;
      const dieB = decider.rolls.find((x) => x.player === order[b])!.die;
      expect(dieA).toBeGreaterThan(dieB);
    }
  }
}

describe("rollOff", () => {
  it("orders players by roll, re-rolling ties among the tied players only", () => {
    let sawTie = false;
    let sawMultiRound = false;
    for (let i = 0; i < 300; i++) {
      const players = ["a", "b", "c", "d"];
      const { order, rounds } = rollOff(players, 6, seedRng(`roll-off-${i}`));
      checkRollOff(players, order, rounds);
      if (rounds.length > 1) sawTie = true;
      if (rounds.length > 2) sawMultiRound = true;
    }
    expect(sawTie).toBe(true);
    expect(sawMultiRound).toBe(true);
  });

  it("gives each seat a fair chance of going first", () => {
    const firsts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const n = 8000;
    for (let i = 0; i < n; i++) {
      const { order } = rollOff(["a", "b", "c", "d"], 6, seedRng(`fair-${i}`));
      firsts[order[0]!]! += 1;
    }
    for (const c of Object.values(firsts)) expect(Math.abs(c - n / 4)).toBeLessThan(n / 4 / 10);
  });
});

describe("createGame", () => {
  it("is deterministic: same content and setup give the same state and events", () => {
    expect(createGame(content, setup())).toEqual(createGame(content, setup()));
  });

  it("depends on the seed", () => {
    const a = createGame(content, setup("a")).state;
    const b = createGame(content, setup("b")).state;
    expect(a.decks).not.toEqual(b.decks);
    expect(a.rng).not.toEqual(b.rng);
  });

  it("produces plain JSON", () => {
    const update = createGame(content, setup());
    expect(JSON.parse(JSON.stringify(update))).toEqual(update);
  });

  it("starts every player with the configured cash, no fish, no tokens, no upgrades, off the board", () => {
    const { state } = createGame(content, setup());
    for (const p of state.players) {
      expect(p).toEqual({
        id: p.id,
        cash: content.rules.startingCash,
        fish: [],
        fineTokens: 0,
        upgrades: { speed: false, capacity: false },
        position: null,
      });
    }
  });

  it("puts players in roll-off order and reports the roll-off", () => {
    for (let i = 0; i < 50; i++) {
      const players = ["p1", "p2", "p3", "p4"];
      const { state, events } = createGame(content, setup(`order-${i}`, players));
      const decided = events.find((e) => e.type === "turnOrderDecided");
      if (decided?.type !== "turnOrderDecided") throw new Error("no turnOrderDecided event");
      expect(state.players.map((p) => p.id)).toEqual(decided.order);
      checkRollOff(players, decided.order, decided.rollOff);
    }
  });

  it("emits gameStarted (seat order) then turnOrderDecided", () => {
    const { events } = createGame(content, setup("events", ["x", "y", "z"]));
    expect(events.map((e) => e.type)).toEqual(["gameStarted", "turnOrderDecided"]);
    expect(events[0]).toEqual({
      type: "gameStarted",
      players: ["x", "y", "z"],
      contentHash: content.hash,
    });
  });

  it("shuffles full decks with empty discard piles", () => {
    const { state } = createGame(content, setup());
    for (const id of ["safe", "risk", "event"] as const) {
      const all = expandDeckList(content.cards.decks[id]);
      expect([...state.decks[id].draw].sort()).toEqual(all);
      expect(state.decks[id].discard).toEqual([]);
    }
    expect(state.decks.safe.draw).not.toEqual(expandDeckList(content.cards.decks.safe));
  });

  it("stops at player 1 choosing a starting dock, before round 1's first turn", () => {
    const { state } = createGame(content, setup());
    expect(state.phase).toEqual({
      kind: "placeShip",
      reason: "setup",
      docks: ["start-left", "start-right"],
      actors: [state.players[0]!.id],
    });
    expect(state).toMatchObject({
      schemaVersion: 1,
      contentHash: content.hash,
      actionCount: 0,
      round: 1,
      turn: { playerIndex: 0, helicopterUsed: false },
      activeEvent: null,
      goldenFish: null,
      result: null,
    });
  });

  it("supports every allowed player count and rejects the rest", () => {
    const ids = ["a", "b", "c", "d", "e"];
    for (let n = content.rules.minPlayers; n <= content.rules.maxPlayers; n++) {
      expect(createGame(content, setup("n", ids.slice(0, n))).state.players).toHaveLength(n);
    }
    expect(() => createGame(content, setup("n", ["a"]))).toThrow(/players/);
    expect(() => createGame(content, setup("n", ids))).toThrow(/players/);
  });

  it("rejects duplicate or empty player ids", () => {
    expect(() => createGame(content, setup("n", ["a", "a"]))).toThrow(/duplicate/);
    expect(() => createGame(content, setup("n", ["a", ""]))).toThrow(/non-empty/);
  });

  it("does not mutate the content", () => {
    const before = JSON.stringify(content);
    createGame(content, setup());
    expect(JSON.stringify(content)).toBe(before);
  });
});
