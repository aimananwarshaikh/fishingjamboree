/**
 * Golden Hook Awards, evaluated on recorded games for any amounts and budget.
 *
 * Play never depends on the awards (secret, own RNG stream; bots cannot see
 * them), and each record keeps every player's counted stats, upgrades and
 * fine tokens. So any candidate `AwardsContent` (other amounts, budget, or
 * award definitions) is resolved on the recorded games with the engine's own
 * `resolveAward`, and each game counts as the exact average over every valid
 * set the engine could draw (it draws one uniformly). No replay is needed.
 */
import {
  resolveAward,
  type AwardDef,
  type AwardId,
  type AwardsContent,
  type PlayerId,
  type PlayerState,
} from "@fishingjamboree/engine";
import type { GameRecord } from "./play";

/** The seats `def` would pay in this recorded game (the engine's rule, from the recorded stats). */
export function awardWinners(record: GameRecord, def: AwardDef): PlayerId[] {
  const players: PlayerState[] = record.scores.map((s) => ({
    id: s.seat,
    cash: s.cash,
    fish: [],
    fineTokens: s.fineTokens,
    upgrades: { speed: s.speed, capacity: s.capacity },
    position: null,
    missedTurns: 0,
    missedLastTurn: s.missedLastTurn,
    removed: s.removed,
  }));
  const stats = Object.fromEntries(record.scores.map((s) => [s.seat, s.stats]));
  return resolveAward(def, players, stats).winners;
}

const conflicting = (a: AwardDef, b: AwardDef): boolean =>
  (a.conflicts ?? []).includes(b.id) || (b.conflicts ?? []).includes(a.id);

/** Same rule as the engine's `validAwardSets`: no conflicting pair, total within the budget. */
export function validSets(awards: AwardsContent, count: number): AwardDef[][] {
  const sets: AwardDef[][] = [];
  const pick = (start: number, chosen: AwardDef[], total: number) => {
    if (chosen.length === count) {
      sets.push(chosen);
      return;
    }
    for (let i = start; i < awards.awards.length; i += 1) {
      const a = awards.awards[i] as AwardDef;
      if (total + a.amount > awards.budget || chosen.some((c) => conflicting(c, a))) continue;
      pick(i + 1, [...chosen, a], total + a.amount);
    }
  };
  if (count > 0) pick(0, [], 0);
  return sets;
}

export const GAP_BUCKETS = [
  { label: "$0 (tied)", max: 0 },
  { label: "$100-$200", max: 200 },
  { label: "$300-$400", max: 400 },
  { label: "$500-$900", max: 900 },
  { label: "$1,000+", max: Infinity },
] as const;

export interface AwardLine {
  id: AwardId;
  name: string;
  amount: number;
  /** Share of games it is drawn in (over the valid sets). */
  drawRate: number;
  /** Share of games where it pays at least one player. */
  paidRate: number;
  /** Mean money it pays in a game where it pays. */
  meanPayoutWhenPaid: number;
}

export interface AwardsSummary {
  games: number;
  validSets: Record<number, number>;
  lines: AwardLine[];
  /** Mean award money paid per game. */
  meanPaidPerGame: number;
  /** Share of games whose winner(s) differ from the winner(s) before awards. */
  flipRate: number;
  flipByGap: { label: string; games: number; flips: number }[];
  /** Share of games where one player is paid by every drawn award. */
  oneTakesAll: number;
  /** Median winning total before awards (the base for the 10–15% rule of thumb). */
  medianWinnerBase: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

const topSeats = (totals: Map<PlayerId, number>): PlayerId[] => {
  const best = Math.max(...totals.values());
  return [...totals].filter(([, v]) => v === best).map(([k]) => k);
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function evaluateAwards(
  records: readonly GameRecord[],
  awards: AwardsContent,
): AwardsSummary {
  const setsByCount = new Map<number, AwardDef[][]>();
  const validCounts: Record<number, number> = {};
  const draws = new Map<AwardId, number>();
  const paid = new Map<AwardId, number>();
  const payout = new Map<AwardId, number>();
  let paidMoney = 0;
  let flips = 0;
  let allToOne = 0;
  const gapGames = GAP_BUCKETS.map(() => 0);
  const gapFlips = GAP_BUCKETS.map(() => 0);
  for (const a of awards.awards) {
    draws.set(a.id, 0);
    paid.set(a.id, 0);
    payout.set(a.id, 0);
  }

  for (const r of records) {
    const count = awards.perGame[String(r.players)] ?? 0;
    let sets = setsByCount.get(count);
    if (!sets) {
      sets = validSets(awards, count);
      setsByCount.set(count, sets);
      validCounts[r.players] = sets.length;
    }
    const winners = new Map(awards.awards.map((a) => [a.id, awardWinners(r, a)]));
    const winnersOf = (id: AwardId) => winners.get(id) ?? [];
    for (const a of awards.awards) {
      const w = winnersOf(a.id);
      if (w.length > 0) {
        paid.set(a.id, (paid.get(a.id) ?? 0) + 1);
        payout.set(a.id, (payout.get(a.id) ?? 0) + a.amount * w.length);
      }
    }
    const bases = r.scores.map((s) => s.base).sort((a, b) => b - a);
    const gap = (bases[0] ?? 0) - (bases[1] ?? bases[0] ?? 0);
    const bucket = GAP_BUCKETS.findIndex((b) => gap <= b.max);
    const baseTotals = new Map(r.scores.map((s) => [s.seat, s.base]));
    const baseWinners = topSeats(baseTotals);
    if (sets.length === 0) {
      gapGames[bucket] = (gapGames[bucket] ?? 0) + 1;
      continue;
    }
    let gameFlips = 0;
    let gameMoney = 0;
    let gameAllToOne = 0;
    for (const set of sets) {
      const totals = new Map(baseTotals);
      for (const a of set) {
        draws.set(a.id, (draws.get(a.id) ?? 0) + 1 / sets.length);
        for (const seat of winnersOf(a.id)) {
          totals.set(seat, (totals.get(seat) ?? 0) + a.amount);
          gameMoney += a.amount;
        }
      }
      if (!sameSet(topSeats(totals), baseWinners)) gameFlips += 1;
      const first = winnersOf((set[0] as AwardDef).id);
      if (first.some((seat) => set.every((a) => winnersOf(a.id).includes(seat)))) gameAllToOne += 1;
    }
    flips += gameFlips / sets.length;
    paidMoney += gameMoney / sets.length;
    allToOne += gameAllToOne / sets.length;
    gapGames[bucket] = (gapGames[bucket] ?? 0) + 1;
    gapFlips[bucket] = (gapFlips[bucket] ?? 0) + gameFlips / sets.length;
  }

  const n = records.length || 1;
  return {
    games: records.length,
    validSets: validCounts,
    lines: awards.awards.map((a) => ({
      id: a.id,
      name: a.name,
      amount: a.amount,
      drawRate: (draws.get(a.id) ?? 0) / n,
      paidRate: (paid.get(a.id) ?? 0) / n,
      meanPayoutWhenPaid:
        (paid.get(a.id) ?? 0) > 0 ? (payout.get(a.id) ?? 0) / (paid.get(a.id) as number) : 0,
    })),
    meanPaidPerGame: paidMoney / n,
    flipRate: flips / n,
    flipByGap: GAP_BUCKETS.map((b, i) => ({
      label: b.label,
      games: gapGames[i] ?? 0,
      flips: gapFlips[i] ?? 0,
    })),
    oneTakesAll: allToOne / n,
    medianWinnerBase: median(records.map((r) => Math.max(...r.scores.map((s) => s.base)))),
  };
}
