/**
 * The game content, bundled from the repository's content/*.json and compiled
 * with the engine. The client needs it to draw the board and to ask
 * `getLegalActions` what is possible. The server's `contentHash` is compared
 * with this one on `welcome` (see `store.ts`).
 */
import { compileContent } from "@fishingjamboree/engine";
import type { Content, RawContent } from "@fishingjamboree/engine";
import board from "../../../content/board.json";
import cards from "../../../content/cards.json";
import rules from "../../../content/rules.json";
import awards from "../../../content/awards.json";

export function loadBundledContent(): Content {
  const result = compileContent({ board, cards, rules, awards } as unknown as RawContent);
  if (!result.ok) {
    throw new Error(
      `bundled content is not valid: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  }
  return result.content;
}
