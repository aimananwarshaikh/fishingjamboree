/**
 * Test helper: the real content files, raw and compiled. Only tests import
 * this; the engine itself never imports JSON (callers pass content in).
 */
import board from "../../../content/board.json";
import cards from "../../../content/cards.json";
import rules from "../../../content/rules.json";
import awards from "../../../content/awards.json";
import { compileContent } from "./content";
import type { Content, RawContent } from "./types";

/** A fresh deep copy each call, so tests can mutate it freely. */
export function rawContent(): RawContent {
  return JSON.parse(JSON.stringify({ board, cards, rules, awards })) as RawContent;
}

export function compiledContent(raw: RawContent = rawContent()): Content {
  const result = compileContent(raw);
  if (!result.ok) {
    throw new Error(`content failed to compile: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.content;
}

/**
 * The upgrade price the rule tests are written around. Balancing (B6) tunes
 * the real price in content/rules.json; the rule tests run on the real board
 * and cards with this price pinned, so a retune does not rewrite them.
 * `content.test.ts` and the simulator check the real values.
 */
export const RULE_TEST_UPGRADE_PRICE = 200;

/** The real content with the upgrade prices pinned for the rule tests. */
export function ruleRawContent(): RawContent {
  const raw = rawContent();
  raw.rules.upgrades.speed.price = RULE_TEST_UPGRADE_PRICE;
  raw.rules.upgrades.capacity.price = RULE_TEST_UPGRADE_PRICE;
  return raw;
}
