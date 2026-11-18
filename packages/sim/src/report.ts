/**
 * Turns game records into a report (numbers) and the report into text. Pure.
 */
import type { AwardsContent } from "@fishingjamboree/engine";
import { evaluateAwards, type AwardsSummary } from "./awardsEval";
import type { GameRecord, PlayerRecord } from "./play";

export interface Spread {
  mean: number;
  p10: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

export interface WinLine {
  key: string;
  /** Seats played (games × seats with this key). */
  seats: number;
  /** Wins, a shared win counting 1/k each. */
  wins: number;
  winRate: number;
  /** An even share: 1 / players. */
  fair: number;
}

export interface GroupReport {
  players: number;
  games: number;
  winBySeat: WinLine[];
  winByBot: WinLine[];
  /** Totals before awards (cash − fine tokens). */
  base: Spread;
  /** Final totals (with awards). */
  total: Spread;
  winnerTotal: Spread;
  /** Share of games whose winner ends above $0. */
  winnerPositive: number;
  /** Share of player results below $0. */
  negativeTotals: number;
  sharedWins: number;
  actions: Spread;
  perPlayer: {
    speed: number;
    capacity: number;
    both: number;
    none: number;
    helicopterUses: number;
    finesPaid: number;
    fineTokensAtEnd: number;
    dockVisits: number;
    riskDraws: number;
    sharkDraws: number;
    fishCaught: number;
    fishLostToCapacity: number;
    turnsBlocked: number;
  };
  perGame: {
    goldenFishPlaced: number;
    goldenFishTaken: number;
    goldenFishLost: number;
    sinkingBoats: number;
    helicopterEvent: number;
  };
  awards: AwardsSummary;
}

export interface Report {
  games: number;
  bots: string;
  groups: GroupReport[];
}

const quantile = (sorted: number[], q: number): number =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);

export function spread(xs: number[]): Spread {
  const s = [...xs].sort((a, b) => a - b);
  return {
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
    p10: quantile(s, 0.1),
    median: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
  };
}

function winLines(records: readonly GameRecord[], keyOf: (p: PlayerRecord) => string): WinLine[] {
  const seats = new Map<string, number>();
  const wins = new Map<string, number>();
  const fair = new Map<string, number>();
  for (const r of records) {
    for (const p of r.scores) {
      const k = keyOf(p);
      seats.set(k, (seats.get(k) ?? 0) + 1);
      fair.set(k, (fair.get(k) ?? 0) + 1 / r.players);
      if (r.winners.includes(p.seat)) wins.set(k, (wins.get(k) ?? 0) + 1 / r.winners.length);
    }
  }
  return [...seats.keys()].sort().map((key) => {
    const n = seats.get(key) as number;
    return {
      key,
      seats: n,
      wins: wins.get(key) ?? 0,
      winRate: (wins.get(key) ?? 0) / n,
      fair: (fair.get(key) ?? 0) / n,
    };
  });
}

export function groupReport(records: readonly GameRecord[], awards: AwardsContent): GroupReport {
  const players = records[0]?.players ?? 0;
  const all = records.flatMap((r) => r.scores);
  const np = all.length || 1;
  const ng = records.length || 1;
  const mean = (f: (p: PlayerRecord) => number) => all.reduce((a, p) => a + f(p), 0) / np;
  const winnerTotals = records.map((r) => Math.max(...r.scores.map((s) => s.total)));
  return {
    players,
    games: records.length,
    winBySeat: winLines(records, (p) => `turn ${p.turnIndex + 1}`),
    winByBot: winLines(records, (p) => p.bot),
    base: spread(all.map((p) => p.base)),
    total: spread(all.map((p) => p.total)),
    winnerTotal: spread(winnerTotals),
    winnerPositive: winnerTotals.filter((t) => t > 0).length / ng,
    negativeTotals: all.filter((p) => p.total < 0).length / np,
    sharedWins: records.filter((r) => r.winners.length > 1).length / ng,
    actions: spread(records.map((r) => r.actions)),
    perPlayer: {
      speed: mean((p) => +p.speed),
      capacity: mean((p) => +p.capacity),
      both: mean((p) => +(p.speed && p.capacity)),
      none: mean((p) => +(!p.speed && !p.capacity)),
      helicopterUses: mean((p) => p.helicopterUses),
      finesPaid: mean((p) => p.stats.finesPaid),
      fineTokensAtEnd: mean((p) => p.fineTokens),
      dockVisits: mean((p) => p.stats.dockVisits),
      riskDraws: mean((p) => p.stats.riskDraws),
      sharkDraws: mean((p) => p.stats.sharkDraws),
      fishCaught: mean((p) => p.stats.fishCaught),
      fishLostToCapacity: mean((p) => p.stats.fishLostToCapacity),
      turnsBlocked: mean((p) => p.stats.turnsBlocked),
    },
    perGame: {
      goldenFishPlaced: records.reduce((a, r) => a + r.goldenFish.placed, 0) / ng,
      goldenFishTaken: records.reduce((a, r) => a + r.goldenFish.taken, 0) / ng,
      goldenFishLost: records.reduce((a, r) => a + r.goldenFish.lost, 0) / ng,
      sinkingBoats: all.reduce((a, p) => a + p.sinkingBoats, 0) / ng,
      helicopterEvent: records.filter((r) => (r.events.helicopterUsed ?? 0) > 0).length / ng,
    },
    awards: evaluateAwards(records, awards),
  };
}

export function buildReport(
  records: readonly GameRecord[],
  awards: AwardsContent,
  bots: string,
): Report {
  const counts = [...new Set(records.map((r) => r.players))].sort();
  return {
    games: records.length,
    bots,
    groups: counts.map((n) =>
      groupReport(
        records.filter((r) => r.players === n),
        awards,
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) =>
  `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
const num = (x: number, d = 2) => x.toFixed(d);

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number))).join(" | ")} |`;
  const rule = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [line(head), rule, ...rows.map(line)].join("\n");
}

const spreadRow = (label: string, s: Spread) => [
  label,
  money(s.mean),
  money(s.p10),
  money(s.median),
  money(s.p90),
  money(s.min),
  money(s.max),
];

function winTable(title: string, lines: WinLine[]): string {
  return `${title}\n\n${table(
    ["", "seats", "wins", "win rate", "even share", "diff"],
    lines.map((l) => [
      l.key,
      String(l.seats),
      num(l.wins, 1),
      pct(l.winRate),
      pct(l.fair),
      `${l.winRate >= l.fair ? "+" : ""}${((l.winRate - l.fair) * 100).toFixed(1)}`,
    ]),
  )}`;
}

export function formatGroup(g: GroupReport): string {
  const a = g.awards;
  const pp = g.perPlayer;
  return [
    `## ${g.players} players (${g.games} games)`,
    winTable("### Win rate by turn order", g.winBySeat),
    winTable("### Win rate by bot", g.winByBot),
    `### Scores\n\n${table(
      ["", "mean", "p10", "median", "p90", "min", "max"],
      [
        spreadRow("total before awards", g.base),
        spreadRow("final total", g.total),
        spreadRow("winner's final total", g.winnerTotal),
      ],
    )}\n\nWinner above $0: ${pct(g.winnerPositive)}. Results below $0: ${pct(g.negativeTotals)}. Shared wins: ${pct(g.sharedWins)}.`,
    `### Game length\n\nActions per game: mean ${num(g.actions.mean, 0)}, median ${g.actions.median}, p90 ${g.actions.p90}. Turns a ship could not move, per player: ${num(pp.turnsBlocked)}.`,
    `### Play, per player\n\n${table(
      ["", "value"],
      [
        ["Speed bought", pct(pp.speed)],
        ["Capacity bought", pct(pp.capacity)],
        ["both upgrades", pct(pp.both)],
        ["no upgrade", pct(pp.none)],
        ["Helicopter uses", num(pp.helicopterUses)],
        ["fined (incl. tokens)", money(pp.finesPaid)],
        ["fine tokens at the end", num(pp.fineTokensAtEnd)],
        ["dock visits", num(pp.dockVisits)],
        ["Risk cards drawn", num(pp.riskDraws)],
        ["Sharks drawn", num(pp.sharkDraws)],
        ["fish caught", num(pp.fishCaught, 1)],
        ["fish lost to a full ship", num(pp.fishLostToCapacity)],
      ],
    )}\n\nPer game: Golden Fish placed ${num(g.perGame.goldenFishPlaced)}, taken ${num(g.perGame.goldenFishTaken)}, lost to a full ship ${num(g.perGame.goldenFishLost)}; Sinking Boats ${num(g.perGame.sinkingBoats)}; games with a Helicopter use ${pct(g.perGame.helicopterEvent)}.`,
    `### Golden Hook Awards\n\nValid sets: ${Object.values(a.validSets).join(", ")}. Median winning total before awards: ${money(a.medianWinnerBase)} (10-15% of it: ${money(a.medianWinnerBase * 0.1)}-${money(a.medianWinnerBase * 0.15)}).\n\n${table(
      ["award", "amount", "drawn", "pays someone", "mean paid when it pays"],
      a.lines.map((l) => [
        l.name,
        money(l.amount),
        pct(l.drawRate),
        pct(l.paidRate),
        money(l.meanPayoutWhenPaid),
      ]),
    )}\n\nAward money paid per game: ${money(a.meanPaidPerGame)}. Winner changed by the awards: ${pct(a.flipRate)}. One player paid by every drawn award: ${pct(a.oneTakesAll)}.\n\n${table(
      ["gap 1st-2nd before awards", "games", "winner changed"],
      a.flipByGap.map((b) => [
        b.label,
        String(b.games),
        b.games ? `${num(b.flips, 1)} (${pct(b.flips / b.games)})` : "-",
      ]),
    )}`,
  ].join("\n\n");
}

export function formatReport(r: Report, header: string[] = []): string {
  return [
    `# Simulation report`,
    ...header,
    `Games: ${r.games}. Bots: ${r.bots}.`,
    ...r.groups.map(formatGroup),
  ].join("\n\n");
}
