/**
 * Checks for the B7 robot playtests (`scripts/robot-playtest.mjs`). Pure: the
 * script reads a finished room's saved file (`ROOMS_DIR`) and what each tab
 * showed, and these functions say what is wrong. The rules checked here are
 * written from the rulebook ("Online play", "End of the game"), not taken from
 * the engine, so an engine mistake shows up too.
 */
import { replay } from "@fishingjamboree/engine";
import type {
  Content,
  GameEvent,
  GameResult,
  GameState,
  PlayerId,
  ReplayLog,
} from "@fishingjamboree/engine";

export interface PlayerAudit {
  /** Turns missed because the turn timer ran out (they count towards removal). */
  timeoutMisses: number;
  /** Turns missed while away (they do not count). */
  awayMisses: number;
  /** Turns ended by the server after the move (shop, Helicopter choice, Sinking Boat dock). */
  timedOut: number;
  /** The longest run of counted misses. */
  longestRun: number;
  removed: "kicked" | "missed-turns" | null;
  cardsDrawn: number;
}

export interface GameAudit {
  problems: string[];
  result: GameResult | null;
  players: Record<PlayerId, PlayerAudit>;
  events: GameEvent[];
  actions: number;
}

/**
 * Replays the saved log and checks it against the saved state and the online
 * rules: missed turns, removal after `missedTurnsBeforeRemoval` counted misses
 * in a row, and the end-of-game sums and awards.
 */
export function auditGame(content: Content, game: { log: ReplayLog; state: GameState }): GameAudit {
  const problems: string[] = [];
  let state: GameState;
  let events: GameEvent[];
  try {
    ({ state, events } = replay(content, game.log));
  } catch (error) {
    return {
      problems: [`the saved log does not replay: ${String(error)}`],
      result: null,
      players: {},
      events: [],
      actions: game.log.actions.length,
    };
  }
  if (JSON.stringify(state) !== JSON.stringify(game.state)) {
    problems.push("the replay of the saved log differs from the saved state");
  }
  const players: Record<PlayerId, PlayerAudit> = {};
  for (const id of game.log.setup.players) {
    players[id] = {
      timeoutMisses: 0,
      awayMisses: 0,
      timedOut: 0,
      longestRun: 0,
      removed: null,
      cardsDrawn: 0,
    };
  }
  problems.push(...auditMissedTurns(content, game.log, events, players));
  for (const e of events) {
    if (e.type === "cardDrawn") players[e.player]!.cardsDrawn++;
  }
  if (state.phase.kind === "gameOver" && state.result) {
    problems.push(...auditResult(content, state, state.result));
  }
  return {
    problems,
    result: state.result ?? null,
    players,
    events,
    actions: game.log.actions.length,
  };
}

/**
 * Rulebook "Online play": only a timed-out turn counts; an away miss neither
 * counts nor breaks the run; a turn the player plays breaks it; the third
 * counted miss in a row removes the player. A removed player plays no more.
 */
export function auditMissedTurns(
  content: Content,
  log: ReplayLog,
  events: readonly GameEvent[],
  players: Record<PlayerId, PlayerAudit>,
): string[] {
  const problems: string[] = [];
  const limit = content.rules.missedTurnsBeforeRemoval;
  const removedAt = new Map<PlayerId, number>();
  log.actions.forEach((a, i) => {
    const p = a.player;
    if (removedAt.has(p) && a.type !== "removePlayer") {
      problems.push(`action ${i} (${a.type}) by ${p} after they were removed`);
    }
    if (a.type === "missTurn") return;
    if (a.type === "removePlayer") {
      removedAt.set(p, i);
    }
  });
  for (const e of events) {
    if (e.type === "turnMissed") {
      const audit = players[e.player]!;
      if (e.counted !== (e.reason === "timeout")) {
        problems.push(`${e.player}: a ${e.reason} miss has counted=${e.counted}`);
      }
      if (e.reason === "timeout") audit.timeoutMisses++;
      else audit.awayMisses++;
    } else if (e.type === "turnTimedOut") {
      players[e.player]!.timedOut++;
    } else if (e.type === "playerRemoved") {
      players[e.player]!.removed = e.reason;
    }
  }
  // Walk the events in order to follow each player's run of counted misses.
  const current: Record<PlayerId, number> = {};
  let actor: PlayerId | null = null;
  let played = false;
  const endTurn = () => {
    if (actor && played) current[actor] = 0;
    actor = null;
    played = false;
  };
  for (const e of events) {
    if (e.type === "turnStarted") {
      endTurn();
      actor = e.player;
    } else if (e.type === "turnMissed") {
      if (e.counted) {
        current[e.player] = (current[e.player] ?? 0) + 1;
        const audit = players[e.player]!;
        audit.longestRun = Math.max(audit.longestRun, current[e.player]!);
        if (current[e.player]! > limit) {
          problems.push(
            `${e.player}: ${current[e.player]} counted misses in a row, not removed at ${limit}`,
          );
        }
      }
      if (actor === e.player) actor = null;
    } else if (e.type === "playerRemoved") {
      if (e.reason === "missed-turns" && (current[e.player] ?? 0) !== limit) {
        problems.push(
          `${e.player}: removed for missed turns after ${current[e.player] ?? 0} counted misses in a row (rule: ${limit})`,
        );
      }
    } else if (
      actor !== null &&
      "player" in e &&
      e.player === actor &&
      (e.type === "rolled" || e.type === "shipPlaced" || e.type === "turnTimedOut")
    ) {
      played = true;
    }
  }
  endTurn();
  for (const [p, audit] of Object.entries(players)) {
    if (audit.removed !== "missed-turns" && audit.longestRun >= limit) {
      problems.push(`${p}: ${audit.longestRun} counted misses in a row but not removed for it`);
    }
  }
  return problems;
}

/** Rulebook "End of the game": the sums, the number of awards and who may be paid. */
export function auditResult(content: Content, state: GameState, result: GameResult): string[] {
  const problems: string[] = [];
  const fine = content.rules.fineTokenValue;
  for (const s of result.scores) {
    const paid = result.awards
      .filter((a) => a.winners.includes(s.player))
      .reduce((t, a) => t + a.amount, 0);
    if (s.awards !== paid)
      problems.push(`${s.player}: awards $${s.awards}, paid awards add to $${paid}`);
    if (s.total !== s.cash - s.fineTokens * fine + s.awards) {
      problems.push(`${s.player}: total $${s.total} is not cash - fines + awards`);
    }
    const p = state.players.find((x) => x.id === s.player);
    if (p && p.removed !== s.removed)
      problems.push(`${s.player}: removed flag differs in the score`);
  }
  const count = state.players.length;
  const want = (content.awards.perGame as Record<string, number>)[String(count)];
  if (want !== undefined && result.awards.length !== want) {
    problems.push(`${result.awards.length} awards drawn with ${count} players (rule: ${want})`);
  }
  const budget = result.awards.reduce((t, a) => t + a.amount, 0);
  if (budget > content.awards.budget)
    problems.push(`awards add to $${budget}, over the $${content.awards.budget} budget`);
  for (const a of result.awards) {
    for (const w of a.winners) {
      const p = state.players.find((x) => x.id === w);
      if (!a.qualified.includes(w)) problems.push(`${a.award}: ${w} paid without qualifying`);
      if (p?.removed) problems.push(`${a.award}: paid to removed player ${w}`);
      if (p?.missedLastTurn) problems.push(`${a.award}: paid to ${w}, who missed their last turn`);
    }
  }
  const standing = result.scores.filter((s) => !s.removed);
  const best = Math.max(...standing.map((s) => s.total));
  const winners = standing
    .filter((s) => s.total === best)
    .map((s) => s.player)
    .sort();
  if (JSON.stringify(winners) !== JSON.stringify([...result.winners].sort())) {
    problems.push(
      `winners ${result.winners.join(",")} but the best total is held by ${winners.join(",")}`,
    );
  }
  return problems;
}

/** What a tab showed at the end against the engine's result (the same JSON, awards included). */
export function compareShownResult(
  expected: GameResult,
  shown: GameResult | null | undefined,
  label: string,
): string[] {
  if (!shown) return [`${label}: no result shown`];
  if (JSON.stringify(shown) === JSON.stringify(expected)) return [];
  const problems: string[] = [];
  if (JSON.stringify(shown.winners) !== JSON.stringify(expected.winners)) {
    problems.push(
      `${label}: winners ${shown.winners.join(",")}, engine ${expected.winners.join(",")}`,
    );
  }
  if (JSON.stringify(shown.awards) !== JSON.stringify(expected.awards)) {
    problems.push(`${label}: the awards differ from the engine's replay`);
  }
  if (JSON.stringify(shown.scores) !== JSON.stringify(expected.scores)) {
    problems.push(`${label}: the scores differ from the engine's replay`);
  }
  return problems.length > 0 ? problems : [`${label}: the result differs from the engine's replay`];
}
