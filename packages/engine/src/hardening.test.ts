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
import { act, actor, content } from "./testHelpers";
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
