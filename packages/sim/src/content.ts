/** Loads and compiles content/*.json (Node only; the bots and the runner never read files). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileContent, type Content, type RawContent } from "@fishingjamboree/engine";

export function readRawContent(dir: string): RawContent {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return {
    board: read("board.json"),
    cards: read("cards.json"),
    rules: read("rules.json"),
    awards: read("awards.json"),
  } as RawContent;
}

export function compileOrThrow(raw: RawContent): Content {
  const result = compileContent(raw);
  if (!result.ok) {
    const issues = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`content is not valid: ${issues}`);
  }
  return result.content;
}
