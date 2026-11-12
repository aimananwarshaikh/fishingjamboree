/**
 * Docks (Session 4a): docking, the shop, and where a Sinking Boat ends up.
 * Each function returns whether it opened a phase that keeps the turn going.
 */
import type { Ctx } from "./ctx";
import { sellFish } from "./economy";
import { affordableUpgrades } from "./modifiers";
import { freeStartingDocks, occupiedTiles } from "./movement";
import type { DockInfo, DockShopReason, PlayerState } from "./types";

/** Opens the shop when the player can afford an upgrade they do not own. */
export function openShopIfAffordable(
  ctx: Ctx,
  player: PlayerState,
  dock: DockInfo,
  reason: DockShopReason,
): boolean {
  if (affordableUpgrades(ctx.content, player).length === 0) return false;
  ctx.state.phase = { kind: "dockShop", reason, dock: dock.id, actors: [player.id] };
  return true;
}

/** A move ended on a free dock: sell, pay off fine tokens, then the shop. */
export function dockShip(ctx: Ctx, player: PlayerState, dock: DockInfo): boolean {
  ctx.events.push({ type: "docked", player: player.id, dock: dock.id });
  sellFish(ctx, player, "dock");
  return openShopIfAffordable(ctx, player, dock, "docked");
}

/**
 * Sinking Boat puts the ship on `dock`. This is not a docking: nothing is
 * sold and fine tokens stay. The player may buy upgrades on arrival.
 */
export function relocateTo(ctx: Ctx, player: PlayerState, dock: DockInfo): boolean {
  const from = player.position;
  if (from === null) throw new Error("relocateTo: the ship is not on the board");
  player.position = dock.tile;
  ctx.events.push({
    type: "shipRelocated",
    player: player.id,
    from,
    to: dock.tile,
    dock: dock.id,
  });
  return openShopIfAffordable(ctx, player, dock, "sinking-boat");
}

/**
 * Where a sunk ship goes: a free starting dock (the player chooses when
 * several are free); with none free, a free dock of any other kind (the cruise
 * ship dock; the first in content order if a board has several); with no dock
 * free at all the ship stays where it is.
 */
export function sinkingBoatRelocation(ctx: Ctx, player: PlayerState): boolean {
  const { content, state } = ctx;
  const { docks } = content.board;
  const starting = freeStartingDocks(content, state);
  if (starting.length > 1) {
    state.phase = {
      kind: "placeShip",
      reason: "sinking-boat",
      docks: starting,
      actors: [player.id],
    };
    return true;
  }
  const taken = occupiedTiles(state.players, "");
  const target =
    docks.find((d) => d.id === starting[0]) ??
    docks.find((d) => d.kind !== "starting" && !taken.has(d.tile));
  if (!target) {
    ctx.events.push({ type: "relocationFailed", player: player.id });
    return false;
  }
  return relocateTo(ctx, player, target);
}
