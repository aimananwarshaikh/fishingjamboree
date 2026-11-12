/**
 * Test helper: the real content files, raw and compiled. Only tests import
 * this; the engine itself never imports JSON (callers pass content in).
 */
import board from "../../../content/board.json";
import cards from "../../../content/cards.json";
import rules from "../../../content/rules.json";
import { compileContent } from "./content";
import type { Content, RawContent } from "./types";

/** A fresh deep copy each call, so tests can mutate it freely. */
export function rawContent(): RawContent {
  return JSON.parse(JSON.stringify({ board, cards, rules })) as RawContent;
}

export function compiledContent(raw: RawContent = rawContent()): Content {
  const result = compileContent(raw);
  if (!result.ok) {
    throw new Error(`content failed to compile: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.content;
}
