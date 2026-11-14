/**
 * Golden Hook Awards (docs/bonus-awards.md; rulebook "End of the game").
 *
 *   draw at setup  → `drawAwards`: secret, from the seed, never in a client view
 *   during play    → `countStats`: per-player stats, counted from the events
 *   after round 20 → `resolveAwards`: who qualifies, who is paid
 *
 * Awards are pure data in `content/awards.json`; resolution is keyed by
 * `kind` and `stat`, never by award id, so a new award is content only.
 */
import type { Ctx } from "./ctx";
import { randomInt, seedRng } from "./rng";
import type {
  AwardDef,
  AwardId,
  AwardResult,
  AwardStat,
  Content,
  GameEvent,
  PlayerId,
  PlayerState,
  PlayerStats,
} from "./types";

/** Every counted stat, in a fixed order. */
export const STAT_KEYS = [
  "fishCaught",
  "fishLostToCapacity",
  "fishLostToShark",
  "tilesMoved",
  "riskDraws",
  "sharkDraws",
  "bootDraws",
  "dockVisits",
  "finesPaid",
  "goldenFishTaken",
  "turnsBlocked",
] as const satisfies readonly (keyof PlayerStats)[];

/** Stats read from the player at the end instead of counted. */
export const DERIVED_STATS = ["upgradesBought", "fineTokens"] as const;

export const AWARD_STATS: readonly AwardStat[] = [...STAT_KEYS, ...DERIVED_STATS];

export function emptyStats(): PlayerStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as unknown as PlayerStats;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** Adds what `events` show to each player's stats (mutates `stats`). */
export function countStats(
  content: Content,
  stats: Record<PlayerId, PlayerStats>,
  events: readonly GameEvent[],
): void {
  for (const e of events) {
    const s = "player" in e && typeof e.player === "string" ? stats[e.player] : undefined;
    if (!s) continue;
    switch (e.type) {
      case "fishGained":
        s.fishCaught += e.kept.length;
        s.fishLostToCapacity += e.lost.length;
        break;
      case "goldenFishTaken":
        s.goldenFishTaken += 1;
        break;
      case "goldenFishLost":
        // A full ship landed on it: one fish lost to capacity.
        s.fishLostToCapacity += 1;
        break;
      case "fishLost":
        if (e.reason === "shark") s.fishLostToShark += e.fish.length;
        break;
      case "moved":
        s.tilesMoved += e.path.length - 1;
        break;
      case "cardDrawn": {
        if (e.deck === "risk") s.riskDraws += 1;
        const effect = content.cards.cards[e.card]?.effect;
        if (effect?.kind === "shark") s.sharkDraws += 1;
        if (effect?.kind === "fish" && effect.count === 0) s.bootDraws += 1;
        break;
      }
      case "docked":
        s.dockVisits += 1;
        break;
      case "fined":
        s.finesPaid += e.amount;
        break;
      case "blocked":
      case "turnSkipped":
        s.turnsBlocked += 1;
        break;
      default:
        break;
    }
  }
}

/**
 * Counts the events added to `ctx` since the last call. `applyAction` calls it
 * once at the end; `endGame` calls it first, so the last turn counts.
 */
export function syncStats(ctx: Ctx): void {
  const from = ctx.statsCounted ?? 0;
  countStats(ctx.content, ctx.state.awards.stats, ctx.events.slice(from));
  ctx.statsCounted = ctx.events.length;
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

export function awardsPerGame(content: Content, players: number): number {
  return content.awards.perGame[String(players)] ?? 0;
}

const conflicting = (a: AwardDef, b: AwardDef): boolean =>
  (a.conflicts ?? []).includes(b.id) || (b.conflicts ?? []).includes(a.id);

/**
 * Every set of `count` awards (in content order) with no conflicting pair and
 * a combined amount within the budget. The draw picks one of these uniformly.
 */
export function validAwardSets(content: Content, count: number): AwardId[][] {
  const { awards, budget } = content.awards;
  const sets: AwardId[][] = [];
  const pick = (start: number, chosen: AwardDef[], total: number) => {
    if (chosen.length === count) {
      sets.push(chosen.map((a) => a.id));
      return;
    }
    for (let i = start; i < awards.length; i += 1) {
      const a = awards[i] as AwardDef;
      if (total + a.amount > budget || chosen.some((c) => conflicting(c, a))) continue;
      pick(i + 1, [...chosen, a], total + a.amount);
    }
  };
  if (count > 0) pick(0, [], 0);
  return sets;
}

/**
 * The awards for a game, from the seed. They use their own RNG stream (seed
 * plus a suffix), so drawing them does not change the dice or the decks: a
 * seed plays the same game with or without awards. Returned in draw order
 * (a shuffle of the picked set), which is the reveal order.
 */
export function drawAwards(content: Content, seed: string, players: number): AwardId[] {
  const sets = validAwardSets(content, awardsPerGame(content, players));
  if (sets.length === 0) return [];
  let rng = seedRng(`${seed}#golden-hook-awards`);
  const [index, next] = randomInt(rng, sets.length);
  rng = next;
  const set = [...(sets[index] as AwardId[])];
  for (let i = set.length - 1; i > 0; i -= 1) {
    const [j, after] = randomInt(rng, i + 1);
    rng = after;
    [set[i], set[j]] = [set[j] as AwardId, set[i] as AwardId];
  }
  return set;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function statValue(stat: AwardStat, player: PlayerState, stats: PlayerStats): number {
  if (stat === "upgradesBought") return Object.values(player.upgrades).filter(Boolean).length;
  if (stat === "fineTokens") return player.fineTokens;
  return stats[stat];
}

/**
 * Removed players cannot win awards; nor can a player who is away when the
 * game ends, which the engine reads as "missed their last turn" (online play:
 * an away player's turns are missed). Both still count in the comparison: if
 * they hold the best value, the award goes unpaid (no second place).
 */
export function eligibleForAwards(player: PlayerState): boolean {
  return !player.removed && player.missedTurns === 0;
}

export function resolveAward(
  def: AwardDef,
  players: readonly PlayerState[],
  stats: Record<PlayerId, PlayerStats>,
): AwardResult {
  const values = players.map((p) => ({
    player: p,
    value: statValue(def.stat, p, stats[p.id] as PlayerStats),
  }));
  let qualified: PlayerState[];
  let value: number | null = null;
  if (def.kind === "condition") {
    qualified = values
      .filter((v) => v.value >= (def.min ?? -Infinity) && v.value <= (def.max ?? Infinity))
      .map((v) => v.player);
  } else {
    const best = (def.kind === "most" ? Math.max : Math.min)(...values.map((v) => v.value));
    // A stat of 0 never wins (nobody is the Boot Lord with no boots).
    qualified = best === 0 ? [] : values.filter((v) => v.value === best).map((v) => v.player);
    value = qualified.length > 0 ? best : null;
  }
  return {
    award: def.id,
    amount: def.amount,
    value,
    qualified: qualified.map((p) => p.id),
    winners: qualified.filter(eligibleForAwards).map((p) => p.id),
  };
}

/** The drawn awards resolved in draw order. */
export function resolveAwards(
  content: Content,
  chosen: readonly AwardId[],
  players: readonly PlayerState[],
  stats: Record<PlayerId, PlayerStats>,
): AwardResult[] {
  return chosen.map((id) => {
    const def = content.awards.awards.find((a) => a.id === id);
    if (!def) throw new Error(`resolveAwards: unknown award ${id}`);
    return resolveAward(def, players, stats);
  });
}
