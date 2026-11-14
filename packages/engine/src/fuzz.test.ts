/**
 * Fuzz test (docs/architecture.md section 11): a random bot plays seeded games
 * for 2, 3 and 4 players. The bot sees only the redacted view and picks
 * uniformly from `getLegalActions`. Any failure names the seed, player count
 * and action number, so `fuzzGame(seed, n)` reproduces it.
 *
 * 1,000 games, about 10 s. Edit GAMES to run fewer (lint bans `process` here, so no env var).
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { getLegalActions } from "./legal";
import { replay } from "./replay";
import { randomInt, seedRng } from "./rng";
import { createGame } from "./setup";
import { content, deepFreeze, invariantProblems } from "./testHelpers";
import type { Action, GameEvent, GameEventType, GameState, ReplayLog } from "./types";
import { redactForClient } from "./view";

const GAMES = 1000;
const ACTION_LIMIT = 20_000;
const SAMPLE_EVERY = 50;
const SEATS = ["ann", "bob", "cy", "di"];

class FuzzFailure extends Error {
  constructor(seed: string, players: number, action: number, what: string) {
    super(`fuzz failure: seed=${seed} players=${players} action=${action}: ${what}`);
  }
}

const key = (a: Action) => JSON.stringify(a);

/** Actions that are not legal now: another seat's, and every action type not on offer. */
function illegalCandidates(state: GameState, legal: Action[]): Action[] {
  const actor = state.phase.actors[0]!;
  const other = state.players.find((p) => p.id !== actor)!.id;
  const legalKeys = new Set(legal.map(key));
  const candidates: Action[] = [
    { type: "roll", player: other },
    { type: "endTurn", player: other },
    { type: "useHelicopter", player: other },
    { type: "buyUpgrade", player: other, upgrade: "speed" } as unknown as Action,
    { type: "move", player: actor, to: -1 },
    { type: "roll", player: actor },
    { type: "endTurn", player: actor },
    { type: "useHelicopter", player: actor },
    { type: "move", player: actor, to: 0 },
    ...legal.map((a) => ({ ...a, player: other }) as Action),
  ];
  return candidates.filter((c) => !legalKeys.has(key(c)));
}

/**
 * Whether the random bot must reach each event type in the run. The table
 * does not compile until a new event type is added, so a new branch is
 * either reached here or named with the test that covers it instead.
 */
const MUST_REACH: Record<GameEventType, true | string> = {
  gameStarted: true,
  turnOrderDecided: true,
  shipPlaced: true,
  roundStarted: true,
  turnStarted: true,
  turnSkipped: "too rare for a random bot: apply.test.ts (late entry with no free starting dock)",
  turnMissed: "server system action, never chosen by a player: missedTurns.test.ts",
  playerRemoved: "server system action, never chosen by a player: missedTurns.test.ts",
  rolled: true,
  blocked: true,
  moved: true,
  cardDrawn: true,
  fishGained: true,
  fishLost: true,
  sharkRepelled: true,
  fined: true,
  shipRelocated: true,
  relocationFailed: "too rare for a random bot: dock.test.ts (Sinking Boat with every dock taken)",
  cardDiscarded: true,
  docked: true,
  fishSold: true,
  fineTokensPaid: true,
  upgradeBought: true,
  helicopterUsed: true,
  goldenFishPlaced: true,
  goldenFishTaken: true,
  goldenFishLost: true,
  goldenFishRemoved: true,
  turnEnded: true,
  roundEnded: true,
  eventExpired: true,
  eventDrawn: true,
  deckReshuffled: true,
  awardGiven: true,
  gameEnded: true,
};

/** Special cases inside an event type that must come up too. */
const MUST_REACH_CASES = ["shipRelocated:starting", "awardGiven:paid", "awardGiven:none"];
// Not reached by the bot, covered elsewhere: "shipRelocated:cruise" (dock.test.ts,
// "both starting docks taken: the cruise ship dock").

/** How often each event type (and a few special cases) came up over the run. */
type Seen = Map<string, number>;

function tally(seen: Seen, events: readonly GameEvent[]): void {
  const bump = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const e of events) {
    bump(e.type);
    if (e.type === "shipRelocated") {
      const kind = content.board.docks.find((d) => d.id === e.dock)?.kind;
      bump(`shipRelocated:${kind}`);
    }
    if (e.type === "awardGiven") bump(e.winners.length > 0 ? "awardGiven:paid" : "awardGiven:none");
  }
}

function fuzzGame(seed: string, playerCount: number, seen: Seen = new Map()): void {
  const players = SEATS.slice(0, playerCount);
  const created = createGame(content, { seed, players });
  tally(seen, created.events);
  let state = created.state;
  const actions: Action[] = [];
  let botRng = seedRng(`bot:${seed}`);
  const sampled = (Number(seed.split("-")[1]) + 1) % SAMPLE_EVERY === 0;

  while (state.phase.kind !== "gameOver") {
    const n = state.actionCount;
    if (actions.length >= ACTION_LIMIT)
      throw new FuzzFailure(seed, playerCount, n, "stuck: action limit");
    const actor = state.phase.actors[0];
    if (actor === undefined)
      throw new FuzzFailure(seed, playerCount, n, "no actor outside gameOver");

    const view = redactForClient(state, actor);
    const legal = getLegalActions(content, view, actor);
    if (legal.length === 0)
      throw new FuzzFailure(seed, playerCount, n, `no legal action for ${actor}`);
    const fromState = getLegalActions(content, state, actor);
    if (JSON.stringify(fromState) !== JSON.stringify(legal)) {
      throw new FuzzFailure(seed, playerCount, n, "legal actions differ between state and view");
    }
    for (const p of state.players) {
      if (
        JSON.stringify(getLegalActions(content, view, p.id)) !==
        JSON.stringify(getLegalActions(content, state, p.id))
      ) {
        throw new FuzzFailure(seed, playerCount, n, `legal actions differ for ${p.id}`);
      }
    }

    if (sampled) {
      for (const bad of illegalCandidates(state, legal)) {
        const r = applyAction(content, state, bad);
        if (r.ok)
          throw new FuzzFailure(seed, playerCount, n, `accepted illegal action ${key(bad)}`);
      }
    }

    const [i, next] = randomInt(botRng, legal.length);
    botRng = next;
    const action = legal[i]!;
    const result = applyAction(content, deepFreeze(state), action);
    if (!result.ok) {
      throw new FuzzFailure(
        seed,
        playerCount,
        n,
        `legal action ${key(action)} rejected: ${result.error.message}`,
      );
    }
    actions.push(action);
    tally(seen, result.events);
    state = result.state;
    const problems = invariantProblems(state);
    if (problems.length > 0) {
      throw new FuzzFailure(
        seed,
        playerCount,
        n + 1,
        `invariants after ${key(action)}: ${problems.join("; ")}`,
      );
    }
  }

  const n = state.actionCount;
  if (state.round !== content.rules.rounds)
    throw new FuzzFailure(seed, playerCount, n, `ended in round ${state.round}`);
  const result = state.result;
  if (!result) throw new FuzzFailure(seed, playerCount, n, "gameOver without a result");
  const best = Math.max(...result.scores.map((s) => s.total));
  const expected = result.scores.filter((s) => s.total === best).map((s) => s.player);
  if (JSON.stringify(result.winners) !== JSON.stringify(expected) || expected.length === 0) {
    throw new FuzzFailure(seed, playerCount, n, "winners are not the players on the best total");
  }
  for (const s of result.scores) {
    const p = state.players.find((q) => q.id === s.player)!;
    // The sum rule: final = cash - fines + Golden Hook Awards won.
    const won = result.awards
      .filter((a) => a.winners.includes(s.player))
      .reduce((sum, a) => sum + a.amount, 0);
    const tokenValue = content.rules.fineTokenValue;
    if (s.awards !== won || s.total !== p.cash - tokenValue * p.fineTokens + won)
      throw new FuzzFailure(seed, playerCount, n, `bad total for ${s.player}`);
  }

  if (sampled) {
    const log: ReplayLog = {
      schemaVersion: 1,
      contentHash: content.hash,
      setup: { seed, players },
      actions,
    };
    const replayed = replay(content, log);
    if (JSON.stringify(replayed.state) !== JSON.stringify(state)) {
      throw new FuzzFailure(seed, playerCount, n, "replay does not reproduce the final state");
    }
  }
}

describe(`fuzz: random bot, ${GAMES} games`, () => {
  it("every game plays to a correct result with all invariants held", () => {
    const seen: Seen = new Map();
    for (let g = 0; g < GAMES; g++) {
      fuzzGame(`fuzz-${g}`, 2 + (g % 3), seen);
    }
    // Every branch the bot can reach was reached at least once.
    const required = [
      ...Object.entries(MUST_REACH)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
      ...MUST_REACH_CASES,
    ];
    expect(required.filter((k) => !seen.has(k))).toEqual([]);
  }, 600_000);

  it("the harness catches a failure and names seed, players and action", () => {
    expect(() => {
      throw new FuzzFailure("fuzz-7", 3, 12, "x");
    }).toThrow(/seed=fuzz-7 players=3 action=12/);
  });
});
