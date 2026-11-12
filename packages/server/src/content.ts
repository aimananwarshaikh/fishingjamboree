/** Loads and compiles `content/*.json` for the server (the engine never reads files). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileContent } from "@fishingjamboree/engine";
import type { Content, RawContent } from "@fishingjamboree/engine";

export function loadContent(dir: string): Content {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));
  const raw = {
    board: read("board.json"),
    cards: read("cards.json"),
    rules: read("rules.json"),
  } as RawContent;
  const result = compileContent(raw);
  if (!result.ok) {
    const issues = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`content in ${dir} is not valid: ${issues}`);
  }
  return result.content;
}
