/**
 * What happens when a move ends on a tile (Session 4a):
 * - a dock: dock there (sale, fine tokens, shop);
 * - the tile holding the Golden Fish: take it instead of drawing, or lose it
 *   for everyone if the ship is full;
 * - open sea: a Safe card; Shipwreck Bay or Davy Jones' Locker: a Risk card.
 */
import { drawAndResolve } from "./cards";
import { currentPlayer, type Ctx } from "./ctx";
import { dockShip } from "./dock";
import { capacityOf } from "./modifiers";
import type { DockInfo, PlayerState } from "./types";

function claimGoldenFish(ctx: Ctx, player: PlayerState): void {
  const golden = ctx.state.goldenFish;
  if (!golden) return;
  ctx.state.goldenFish = null;
  if (player.fish.length >= capacityOf(ctx.content, player)) {
    ctx.events.push({ type: "goldenFishLost", player: player.id, spot: golden.spot });
    return;
  }
  player.fish.push(golden.value);
  ctx.events.push({
    type: "goldenFishTaken",
    player: player.id,
    spot: golden.spot,
    value: golden.value,
  });
}

/** Returns whether the landing opened a phase that keeps the turn going. */
export function resolveLanding(ctx: Ctx): boolean {
  const player = currentPlayer(ctx);
  const { board } = ctx.content;
  const tile = player.position === null ? null : board.tiles[player.position];
  if (!tile || tile.terrain === "island") return false;
  if (tile.terrain === "dock") {
    return dockShip(ctx, player, board.docks.find((d) => d.tile === tile.id) as DockInfo);
  }
  if (ctx.state.goldenFish?.tile === tile.id) {
    claimGoldenFish(ctx, player);
    return false;
  }
  return drawAndResolve(ctx, player, tile.terrain === "sea" ? "safe" : "risk", tile);
}
