import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { replay } from "./replay";
import { createGame } from "./setup";
import { content } from "./testHelpers";
import type { Action, GameEvent, GameState, ReplayLog } from "./types";

/** Plays a whole game with a fixed choice rule and logs it. */
function playLogged(seed: string, players: string[], stride: number) {
  const setup = { seed, players };
  const created = createGame(content, setup);
  let state: GameState = created.state;
  const events: GameEvent[] = [...created.events];
  const actions: Action[] = [];
  while (state.phase.kind !== "gameOver") {
    const player = state.phase.actors[0]!;
    const legal = getLegalActions(content, state, player);
    const action = legal[(state.actionCount * stride) % legal.length]!;
    const result = applyAction(content, state, action);
    if (!result.ok) throw new Error(result.error.message);
    actions.push(action);
    events.push(...result.events);
    state = result.state;
  }
  const log: ReplayLog = { schemaVersion: 1, contentHash: content.hash, setup, actions };
  return { log, state, events };
}

describe("replay", () => {
  it.each([
    ["replay-a", ["ann", "bob", "cy"], 3],
    ["replay-b", ["ann", "bob", "cy", "di"], 7],
  ] as const)("reproduces a whole game exactly (%s)", (seed, players, stride) => {
    const game = playLogged(seed, [...players], stride);
    const replayed = replay(content, game.log);
    expect(replayed.state).toEqual(game.state);
    expect(replayed.events).toEqual(game.events);
    expect(replayed.state.result).not.toBeNull();
  });

  it("an empty log gives the newly created game", () => {
    const setup = { seed: "x", players: ["a", "b"] };
    const log: ReplayLog = { schemaVersion: 1, contentHash: content.hash, setup, actions: [] };
    expect(replay(content, log)).toEqual(createGame(content, setup));
  });

  it("a prefix of the log gives the state at that point", () => {
    const { log } = playLogged("replay-c", ["a", "b", "c"], 5);
    const part = replay(content, { ...log, actions: log.actions.slice(0, 40) });
    expect(part.state.actionCount).toBe(40);
  });

  it("throws when the content hash differs", () => {
    const { log } = playLogged("replay-d", ["a", "b"], 1);
    expect(() => replay(content, { ...log, contentHash: "other" })).toThrow(/content hash/);
  });

  it("throws on an illegal action, naming it", () => {
    const { log } = playLogged("replay-e", ["a", "b"], 1);
    const actions = [...log.actions];
    actions[3] = { ...actions[3]!, player: "nobody" };
    expect(() => replay(content, { ...log, actions })).toThrow(/action 3 .*unknown-player/);
  });
});
