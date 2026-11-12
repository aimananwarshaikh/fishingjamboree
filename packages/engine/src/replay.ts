/**
 * Replays (docs/architecture.md section 8): re-create the game from the
 * logged setup and apply every logged action in order. Deterministic, so the
 * result matches the original game exactly.
 */
import { applyAction } from "./apply";
import { createGame } from "./setup";
import type { Engine, GameEvent } from "./types";

export const replay: Engine["replay"] = (content, log) => {
  if (log.contentHash !== content.hash) {
    throw new Error(
      `replay: content hash ${content.hash} does not match the log's ${log.contentHash}`,
    );
  }
  const created = createGame(content, log.setup);
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  log.actions.forEach((action, i) => {
    const result = applyAction(content, state, action);
    if (!result.ok) {
      throw new Error(
        `replay: action ${i} (${action.type} by ${action.player}) rejected: ` +
          `${result.error.code} ${result.error.message}`,
      );
    }
    state = result.state;
    events.push(...result.events);
  });
  return { state, events };
};
