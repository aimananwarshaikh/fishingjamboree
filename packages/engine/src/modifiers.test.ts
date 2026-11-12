import { describe, expect, it } from "vitest";
import {
  activeEffect,
  affordableUpgrades,
  capacityOf,
  catchBonusAt,
  helicopterFee,
  helicopterUsable,
  movementModifier,
  sharkRepelledAt,
} from "./modifiers";
import { compiledContent, rawContent } from "./testContent";
import { board, clone, content, started, tile, withEvent, withPlayer } from "./testHelpers";
import type { GameState, Tile } from "./types";

const at = (x: number, y: number): Tile => board.tiles[tile(x, y)] as Tile;
const base = started(2);
const ZONE = { 1: at(3, 17), 2: at(5, 9), 3: at(2, 0) };
const BAY = at(0, 9);
const LOCKER = at(3, 2);
const DOCK = at(3, 19);
const EVENTS = Object.keys(content.cards.decks.event);

describe("activeEffect", () => {
  it("is null with no event and for an event of another kind", () => {
    expect(activeEffect(content, base, "movement")).toBeNull();
    expect(activeEffect(content, withEvent(base, "helicopter"), "movement")).toBeNull();
    expect(activeEffect(content, withEvent(base, "movement+1"), "movement")).toEqual({
      kind: "movement",
      delta: 1,
    });
  });
});

describe("movement modifier", () => {
  it("is the event's delta, and 0 under any other event", () => {
    expect(movementModifier(content, base)).toBe(0);
    for (const card of EVENTS) {
      const expected = card === "movement+1" ? 1 : card === "movement-1" ? -1 : 0;
      expect(movementModifier(content, withEvent(base, card))).toBe(expected);
    }
  });
});

describe("catch bonus", () => {
  it("applies only on open sea of the event's zone", () => {
    for (const zone of [1, 2, 3] as const) {
      const state = withEvent(base, `catch-bonus-${zone}`);
      for (const other of [1, 2, 3] as const) {
        const bonus = catchBonusAt(content, state, ZONE[other]);
        if (other === zone) expect(bonus).toMatchObject({ zone, count: 1, value: 100 });
        else expect(bonus).toBeNull();
      }
      // Risk areas and docks belong to no zone.
      for (const t of [BAY, LOCKER, DOCK]) expect(catchBonusAt(content, state, t)).toBeNull();
    }
  });

  it("is null with no event or another event", () => {
    expect(catchBonusAt(content, base, ZONE[1])).toBeNull();
    expect(catchBonusAt(content, withEvent(base, "movement+1"), ZONE[1])).toBeNull();
  });
});

describe("shark repellent", () => {
  it("covers Shipwreck Bay only", () => {
    const state = withEvent(base, "shark-repellent");
    expect(sharkRepelledAt(content, state, BAY)).toBe(true);
    expect(sharkRepelledAt(content, state, at(3, 10))).toBe(true);
    expect(sharkRepelledAt(content, state, LOCKER)).toBe(false);
    expect(sharkRepelledAt(content, state, ZONE[2])).toBe(false);
  });

  it("is off with no event or another event", () => {
    expect(sharkRepelledAt(content, base, BAY)).toBe(false);
    expect(sharkRepelledAt(content, withEvent(base, "helicopter"), BAY)).toBe(false);
  });

  it("follows the area named in the content", () => {
    const raw = rawContent();
    raw.cards.cards["shark-repellent"]!.effect = {
      kind: "sharkRepellent",
      area: "davy-jones-locker",
    };
    const other = compiledContent(raw);
    const state = withEvent(base, "shark-repellent");
    expect(sharkRepelledAt(other, state, LOCKER)).toBe(true);
    expect(sharkRepelledAt(other, state, BAY)).toBe(false);
  });
});

describe("helicopter", () => {
  const ready = (patch: Partial<GameState["players"][number]> = {}): GameState =>
    withPlayer(withEvent(base, "helicopter"), 0, { fish: [100], cash: 200, ...patch });
  const usable = (state: GameState): boolean => helicopterUsable(content, state, state.players[0]!);

  it("has a fee only while the Helicopter is the active event", () => {
    expect(helicopterFee(content, base)).toBeNull();
    expect(helicopterFee(content, withEvent(base, "movement+1"))).toBeNull();
    expect(helicopterFee(content, ready())).toBe(200);
  });

  it("is usable with a fish and the fee in cash", () => {
    expect(usable(ready())).toBe(true);
    expect(usable(ready({ cash: 5000, fish: [100, 700] }))).toBe(true);
  });

  it("is not usable with no fish, too little cash, or fine tokens (which mean $0)", () => {
    expect(usable(ready({ fish: [] }))).toBe(false);
    expect(usable(ready({ cash: 100 }))).toBe(false);
    // The fee cannot come out of the sale, however big the catch.
    expect(usable(ready({ cash: 0, fish: [1000, 700] }))).toBe(false);
    expect(usable(ready({ cash: 0, fineTokens: 1 }))).toBe(false);
  });

  it("is not usable twice in a turn, or under another event", () => {
    const used = clone(ready());
    used.turn.helicopterUsed = true;
    expect(usable(used)).toBe(false);
    expect(usable({ ...ready(), activeEvent: null })).toBe(false);
    expect(usable({ ...ready(), activeEvent: { card: "movement+1", drawnAfterRound: 5 } })).toBe(
      false,
    );
  });
});

describe("capacity and upgrades", () => {
  const player = (patch: Partial<GameState["players"][number]>) =>
    withPlayer(base, 0, patch).players[0]!;

  it("capacity is 5, or 8 with the upgrade", () => {
    expect(capacityOf(content, player({}))).toBe(5);
    expect(capacityOf(content, player({ upgrades: { speed: true, capacity: false } }))).toBe(5);
    expect(capacityOf(content, player({ upgrades: { speed: false, capacity: true } }))).toBe(8);
  });

  it("lists unowned upgrades the player can pay for, Speed first", () => {
    expect(affordableUpgrades(content, player({ cash: 199 }))).toEqual([]);
    expect(affordableUpgrades(content, player({ cash: 200 }))).toEqual(["speed", "capacity"]);
    expect(
      affordableUpgrades(
        content,
        player({ cash: 900, upgrades: { speed: true, capacity: false } }),
      ),
    ).toEqual(["capacity"]);
    expect(
      affordableUpgrades(content, player({ cash: 900, upgrades: { speed: true, capacity: true } })),
    ).toEqual([]);
  });

  it("uses each upgrade's own price", () => {
    const raw = rawContent();
    raw.rules.upgrades.speed.price = 300;
    const dear = compiledContent(raw);
    expect(affordableUpgrades(dear, player({ cash: 200 }))).toEqual(["capacity"]);
    expect(affordableUpgrades(dear, player({ cash: 300 }))).toEqual(["speed", "capacity"]);
  });
});
