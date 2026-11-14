/**
 * Review P3, engine: money values must be multiples of the fine token, the
 * number of setup ships comes from content, `replay` checks the log's schema
 * version, and a view copies each player field by field.
 */
import { describe, expect, it } from "vitest";
import { compileContent } from "./content";
import { replay } from "./replay";
import { createGame } from "./setup";
import { compiledContent, rawContent } from "./testContent";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import {
  act,
  actor,
  content,
  id,
  land,
  playTurn,
  START_LEFT,
  started,
  tile,
  withActiveEvent,
  withPlayer,
  withShips,
  withTopCard,
} from "./testHelpers";

const SEA = [tile(3, 17), tile(3, 16)] as const;
const FEE = (content.cards.cards.helicopter!.effect as { fee: number }).fee;
const LOCKER = [tile(2, 2), tile(3, 2)] as const;
import type { RawContent, ReplayLog } from "./types";
import { redactForClient } from "./view";

const issues = (edit: (raw: RawContent) => void) => {
  const raw = rawContent();
  edit(raw);
  const result = compileContent(raw);
  return result.ok ? "" : result.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
};
const effect = (raw: RawContent, card: string) =>
  raw.cards.cards[card]!.effect as unknown as Record<string, number>;

describe("money is in whole fine tokens", () => {
  it("the real content passes", () => {
    expect(issues(() => {})).toBe("");
  });

  it.each([
    [
      "a fish value",
      (r: RawContent) => (effect(r, "fish-300").value = 350),
      "cards.cards.fish-300.effect.value",
    ],
    [
      "a fine",
      (r: RawContent) => (effect(r, "fine-100").amount = 150),
      "cards.cards.fine-100.effect.amount",
    ],
    [
      "a Golden Fish",
      (r: RawContent) => (effect(r, "golden-fish-1").value = 1050),
      "golden-fish-1.effect.value",
    ],
    [
      "a catch bonus",
      (r: RawContent) => (effect(r, "catch-bonus-1").value = 50),
      "catch-bonus-1.effect.value",
    ],
    [
      "the Helicopter fee",
      (r: RawContent) => (effect(r, "helicopter").fee = 50),
      "helicopter.effect.fee",
    ],
    [
      "an upgrade price",
      (r: RawContent) => (r.rules.upgrades.speed.price = 250),
      "rules.upgrades.speed.price",
    ],
    ["the starting cash", (r: RawContent) => (r.rules.startingCash = 50), "rules.startingCash"],
  ])("refuses %s that is not a multiple of the token value", (_name, edit, path) => {
    expect(issues(edit)).toMatch(
      new RegExp(`${path.replace(/[.+]/g, "\\$&")}: must be a multiple of 100`),
    );
  });

  it("follows the token value from rules.json", () => {
    expect(
      issues((r) => {
        r.rules.fineTokenValue = 50;
        effect(r, "fish-300").value = 350;
      }),
    ).toBe("");
  });
});

describe("setup ships come from content", () => {
  it("rules.setupShips is 2 in the real content", () => {
    expect(content.rules.setupShips).toBe(2);
  });

  it("with 1 setup ship, only the first player places a ship before round 1", () => {
    const one = compiledContent(
      (() => {
        const r = rawContent();
        r.rules.setupShips = 1;
        return r;
      })(),
    );
    const { state } = createGame(one, { seed: "s", players: ["a", "b", "c"] });
    const after = act(state, { type: "placeShip", player: actor(state), dock: "start-left" }, one);
    expect(after.events.map((e) => e.type)).toContain("roundStarted");
    expect(after.state.players.filter((p) => p.position !== null)).toHaveLength(1);
  });

  it.each([
    ["0", (r: RawContent) => (r.rules.setupShips = 0), /setupShips: must be at least 1/],
    ["more than the starting docks", (r: RawContent) => (r.rules.setupShips = 3), /starting docks/],
    [
      "more than the fewest players",
      (r: RawContent) => {
        r.rules.minPlayers = 1;
        r.awards.perGame["1"] = 1;
      },
      /minPlayers/,
    ],
    [
      "missing",
      (r: RawContent) => delete (r.rules as Partial<RawContent["rules"]>).setupShips,
      /setupShips/,
    ],
  ])("refuses setupShips %s", (_name, edit, message) => {
    expect(issues(edit)).toMatch(message);
  });
});

describe("replay", () => {
  it("refuses a log with another schema version", () => {
    const log = {
      schemaVersion: 2,
      contentHash: content.hash,
      setup: { seed: "x", players: ["a", "b"] },
      actions: [],
    } as unknown as ReplayLog;
    expect(() => replay(content, log)).toThrow(/schema version 2/);
  });
});

describe("views copy each player field by field", () => {
  it("a field a player state gains is not sent until view.ts lists it", () => {
    const { state } = createGame(content, { seed: "v", players: ["a", "b"] });
    (state.players[0] as unknown as Record<string, unknown>).secret = "hidden";
    const view = redactForClient(state, "a");
    expect(view.players[0]).not.toHaveProperty("secret");
    expect(view.players[0]).toEqual({ ...state.players[0], secret: undefined });
  });
});

// ---------------------------------------------------------------------------
// Missing tests from the review (P3)
// ---------------------------------------------------------------------------

describe("the Helicopter at the end of an event", () => {
  /** Player 1's turn, the last of `round`, Helicopter active since round 5; player 1 at sea with a catch. */
  function lastTurnOf(round: number) {
    let s = withActiveEvent(withShips(started(2), { 0: tile(7, 8), 1: SEA[0] }), "helicopter", 5);
    s.round = round;
    s.turn = { playerIndex: 1, helicopterUsed: false };
    s.phase = { kind: "roll", actors: [id(s, 1)] };
    s = withPlayer(s, 1, { fish: [300], cash: 200 });
    s = withPlayer(s, 0, { fish: [100], cash: 500 });
    // A Boot: the turn reaches its end with the catch still on board.
    return land(withTopCard(s, "safe", "boot"), SEA[0], SEA[1]).state;
  }

  it("round 10: still usable at the end of the last turn; gone for the next player", () => {
    const atEnd = lastTurnOf(10);
    const p1 = id(atEnd, 1);
    expect(atEnd.phase).toEqual({ kind: "turnEnd", actors: [p1] });
    const { state, events } = act(atEnd, { type: "useHelicopter", player: p1 });
    const order = events.map((e) => e.type);
    expect(order.slice(0, 3)).toEqual(["helicopterUsed", "fishSold", "turnEnded"]);
    expect(order.indexOf("eventExpired")).toBeGreaterThan(order.indexOf("roundEnded"));
    expect(events).toContainEqual({ type: "eventExpired", card: "helicopter" });
    expect(state.players[1]).toMatchObject({ cash: 200 - FEE + 300, fish: [] });
    expect(state.round).toBe(11);
    // The next player cannot call it any more, though they have a fish and the fee.
    const next = getLegalActions(content, state, id(state, 0));
    expect(next.some((a) => a.type === "useHelicopter")).toBe(false);
  });

  it("round 20: usable on the very last turn, and the sale counts in the score", () => {
    const atEnd = lastTurnOf(20);
    const p1 = id(atEnd, 1);
    const { state, events } = act(atEnd, { type: "useHelicopter", player: p1 });
    expect(events.map((e) => e.type)).toContain("gameEnded");
    expect(state.phase.kind).toBe("gameOver");
    expect(state.result!.scores.find((s) => s.player === p1)!.cash).toBe(200 - FEE + 300);
  });
});

describe("a Sinking Boat and a late entrant", () => {
  it("the victim takes the last free starting dock, so the entrant waits", () => {
    // 4 players: player 0 on the left dock, player 1 in Davy Jones' Locker; 2 and 3 not yet on the board.
    const before = withShips(playTurn(started(4), 2), { 0: START_LEFT, 1: LOCKER[0] });
    const [, b, c, d] = before.players.map((p) => p.id);
    expect(before.players[2]!.position).toBeNull();
    const { state, events } = land(
      withTopCard(before, "risk", "sinking-boat"),
      LOCKER[0],
      LOCKER[1],
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "shipRelocated", player: b, dock: "start-right" }),
    );
    expect(events).toContainEqual({
      type: "turnSkipped",
      player: c,
      reason: "no-free-starting-dock",
    });
    expect(events).toContainEqual({
      type: "turnSkipped",
      player: d,
      reason: "no-free-starting-dock",
    });
    expect(state.players[2]!.position).toBeNull();
  });
});

describe("applyAction leaves its input untouched", () => {
  it("over every kind of action of a whole game", () => {
    let state = createGame(content, { seed: "untouched", players: ["a", "b", "c"] }).state;
    const kinds = new Set<string>();
    for (let guard = 0; state.phase.kind !== "gameOver" && guard < 5_000; guard += 1) {
      const actions = getLegalActions(content, state, state.phase.actors[0]!);
      const action = actions[guard % actions.length]!;
      const before = JSON.stringify(state);
      const result = applyAction(content, state, action);
      expect(JSON.stringify(state)).toBe(before);
      if (!result.ok) throw new Error(result.error.message);
      kinds.add(action.type);
      state = result.state;
    }
    expect(state.phase.kind).toBe("gameOver");
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});
