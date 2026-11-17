/**
 * Plays one whole game with bots and records what the report needs. Pure: no
 * I/O, no clock. Each bot gets `redactForClient(state, seat)` and the legal
 * actions, never the full state; an action that is not in the legal list
 * throws (a bot bug), as does a game that does not end.
 */
import {
  applyAction,
  createGame,
  getLegalActions,
  redactForClient,
  resolveAward,
  type AwardId,
  type Content,
  type GameEvent,
  type GameState,
  type PlayerAction,
  type PlayerId,
  type PlayerStats,
} from "@fishingjamboree/engine";
import { botByName } from "./bots";

export interface GameSpec {
  seed: string;
  /** Bot name per seat, in seat order (turn order comes from the roll-off). */
  bots: string[];
}

export interface PlayerRecord {
  seat: PlayerId;
  bot: string;
  /** 0-based place in turn order. */
  turnIndex: number;
  cash: number;
  fineTokens: number;
  /** cash − fine tokens × token value: the total before awards. */
  base: number;
  awards: number;
  total: number;
  speed: boolean;
  capacity: boolean;
  helicopterUses: number;
  sinkingBoats: number;
  stats: PlayerStats;
}

export interface GameRecord {
  seed: string;
  players: number;
  actions: number;
  /** In turn order. */
  scores: PlayerRecord[];
  /** Seats with the highest total (the engine's result). */
  winners: PlayerId[];
  /** Seats with the highest base total (before awards). */
  baseWinners: PlayerId[];
  /** Award ids drawn for this game, in draw order. */
  drawn: AwardId[];
  /**
   * Every award in the content, resolved on this game as if it had been drawn:
   * the seats that would be paid. Play does not depend on the awards (they
   * are secret and use their own RNG stream), so this lets the report try
   * other amounts and budgets without replaying.
   */
  awardWinners: Record<AwardId, PlayerId[]>;
  goldenFish: { placed: number; taken: number; lost: number; expired: number };
  events: Partial<Record<GameEvent["type"], number>>;
}

export const ACTION_LIMIT = 5_000;

const SEAT_IDS = ["p1", "p2", "p3", "p4", "p5", "p6"];

export interface PlayedGame {
  record: GameRecord;
  state: GameState;
  events: GameEvent[];
  actions: PlayerAction[];
}

export function playGame(content: Content, spec: GameSpec): PlayedGame {
  const seats = spec.bots.map((_, i) => SEAT_IDS[i] as PlayerId);
  const botOf = new Map(seats.map((seat, i) => [seat, botByName(spec.bots[i] as string)]));
  const created = createGame(content, { seed: spec.seed, players: seats });
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  const actions: PlayerAction[] = [];
  while (state.phase.kind !== "gameOver") {
    if (actions.length >= ACTION_LIMIT) {
      throw new Error(`sim: game ${spec.seed} did not end after ${ACTION_LIMIT} actions`);
    }
    const actor = state.phase.actors[0] as PlayerId;
    const legal = getLegalActions(content, state, actor);
    const view = redactForClient(state, actor);
    const bot = botOf.get(actor);
    if (!bot) throw new Error(`sim: no bot for ${actor}`);
    const action = bot.choose({ content, view, legal, seed: `${spec.seed}|${actor}` });
    const key = JSON.stringify(action);
    if (!legal.some((a) => JSON.stringify(a) === key)) {
      throw new Error(`sim: bot ${bot.name} chose an illegal action ${key} (seed ${spec.seed})`);
    }
    const result = applyAction(content, state, action);
    if (!result.ok) throw new Error(`sim: legal action refused: ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
    actions.push(action);
  }
  return {
    record: recordGame(content, spec, state, events, actions.length),
    state,
    events,
    actions,
  };
}

function recordGame(
  content: Content,
  spec: GameSpec,
  state: GameState,
  events: GameEvent[],
  actionCount: number,
): GameRecord {
  const result = state.result;
  if (!result) throw new Error("sim: finished game has no result");
  const counts: Partial<Record<GameEvent["type"], number>> = {};
  const per = (type: GameEvent["type"], player: PlayerId) =>
    events.filter((e) => e.type === type && "player" in e && e.player === player).length;
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const seatIndex = (id: PlayerId) => Number(id.slice(1)) - 1;
  const scores: PlayerRecord[] = state.players.map((p, turnIndex) => {
    const score = result.scores.find((s) => s.player === p.id);
    if (!score) throw new Error(`sim: no score for ${p.id}`);
    const base = score.cash - score.fineTokens * content.rules.fineTokenValue;
    return {
      seat: p.id,
      bot: spec.bots[seatIndex(p.id)] as string,
      turnIndex,
      cash: score.cash,
      fineTokens: score.fineTokens,
      base,
      awards: score.awards,
      total: score.total,
      speed: p.upgrades.speed,
      capacity: p.upgrades.capacity,
      helicopterUses: per("helicopterUsed", p.id),
      sinkingBoats: events.filter(
        (e) => e.type === "fishLost" && e.player === p.id && e.reason === "sinking-boat",
      ).length,
      stats: result.stats[p.id] as PlayerStats,
    };
  });
  const bestBase = Math.max(...scores.map((s) => s.base));
  const awardWinners: Record<AwardId, PlayerId[]> = {};
  for (const def of content.awards.awards) {
    awardWinners[def.id] = resolveAward(def, state.players, result.stats).winners;
  }
  return {
    seed: spec.seed,
    players: spec.bots.length,
    actions: actionCount,
    scores,
    winners: result.winners,
    baseWinners: scores.filter((s) => s.base === bestBase).map((s) => s.seat),
    drawn: result.awards.map((a) => a.award),
    awardWinners,
    goldenFish: {
      placed: counts.goldenFishPlaced ?? 0,
      taken: counts.goldenFishTaken ?? 0,
      lost: counts.goldenFishLost ?? 0,
      expired: counts.goldenFishRemoved ?? 0,
    },
    events: counts,
  };
}
