/**
 * Fish, fines and sales (Session 4a): the few ways a player's fish, cash and
 * fine tokens change. Cards, docks and the Helicopter all go through these.
 */
import type { Ctx } from "./ctx";
import { capacityOf } from "./modifiers";
import type {
  Content,
  FishLossReason,
  GameEndReason,
  GameResult,
  Money,
  PlayerState,
  SaleVia,
} from "./types";

const sum = (values: readonly Money[]): Money => values.reduce((a, b) => a + b, 0);

/**
 * Loads a catch. The card's own fish go on first, then any event bonus fish;
 * whatever does not fit is lost. Fish already on the ship are never swapped
 * out. Nothing is reported when there is nothing to load (a plain Boot).
 */
export function gainFish(
  ctx: Ctx,
  player: PlayerState,
  fish: readonly Money[],
  bonus: readonly Money[] = [],
): void {
  const all = [...fish, ...bonus];
  if (all.length === 0) return;
  const room = Math.max(0, capacityOf(ctx.content, player) - player.fish.length);
  const kept = all.slice(0, room);
  const lost = all.slice(room);
  player.fish.push(...kept);
  ctx.events.push({ type: "fishGained", player: player.id, kept, lost, bonus: bonus.length });
}

/**
 * Removes up to `count` fish, cheapest first (equal-value tokens are
 * identical, so there is no tie-break). Nothing is reported for an empty ship.
 */
export function loseFish(
  ctx: Ctx,
  player: PlayerState,
  count: number,
  reason: FishLossReason,
): void {
  const sorted = [...player.fish].sort((a, b) => a - b);
  const lost = sorted.slice(0, Math.max(0, count));
  if (lost.length === 0) return;
  // Keep the ship's own order for what is left.
  const remaining = [...player.fish];
  for (const value of lost) remaining.splice(remaining.indexOf(value), 1);
  player.fish = remaining;
  ctx.events.push({ type: "fishLost", player: player.id, fish: lost, reason });
}

/** Cash first; whatever is left unpaid becomes fine tokens (rounded up to whole tokens). */
export function chargeFine(ctx: Ctx, player: PlayerState, amount: Money): void {
  const paid = Math.min(player.cash, amount);
  const tokensTaken = Math.ceil((amount - paid) / ctx.content.rules.fineTokenValue);
  player.cash -= paid;
  player.fineTokens += tokensTaken;
  ctx.events.push({ type: "fined", player: player.id, amount, paid, tokensTaken });
}

/**
 * Sells every fish on the ship, then pays off as many fine tokens as the
 * player's cash covers. Used by docking and by the Helicopter.
 */
export function sellFish(ctx: Ctx, player: PlayerState, via: SaleVia): void {
  if (player.fish.length > 0) {
    const fish = player.fish;
    const total = sum(fish);
    player.fish = [];
    player.cash += total;
    ctx.events.push({ type: "fishSold", player: player.id, fish, total, via });
  }
  const value = ctx.content.rules.fineTokenValue;
  const tokens = Math.min(player.fineTokens, Math.floor(player.cash / value));
  if (tokens > 0) {
    player.fineTokens -= tokens;
    player.cash -= tokens * value;
    ctx.events.push({
      type: "fineTokensPaid",
      player: player.id,
      tokens,
      amount: tokens * value,
    });
  }
}

/**
 * Final scores (rulebook "End of the game"): cash minus the fine tokens still
 * held; fish on the ship are worth nothing. Every player on the highest
 * total wins (a tie is a tie; fine tokens are not a tie-break).
 */
export function scoreGame(
  content: Content,
  players: readonly PlayerState[],
  reason: GameEndReason = "rounds",
): GameResult {
  const scores = players.map((p) => ({
    player: p.id,
    cash: p.cash,
    fineTokens: p.fineTokens,
    total: p.cash - p.fineTokens * content.rules.fineTokenValue,
    removed: p.removed,
  }));
  // A removed player cannot win (online play). With one player left, they win whatever the totals.
  const inGame = scores.filter((s) => !s.removed);
  const best = Math.max(...inGame.map((s) => s.total));
  const winners =
    reason === "last-player"
      ? inGame.map((s) => s.player)
      : inGame.filter((s) => s.total === best).map((s) => s.player);
  return { scores, winners, reason };
}
