/** Plain-English text for events and actions. No React, so it can be tested. */
import type {
  Content,
  GameEvent,
  Money,
  PlayerAction,
  PlayerId,
  PlayerView,
  TileId,
  UpgradeId,
} from "@fishingjamboree/engine";
import type { SeatInfo } from "../../../packages/server/src/protocol";

export type NameOf = (player: PlayerId) => string;

const money = (n: Money) => `$${n}`;
const fishList = (fish: Money[]) =>
  fish.length === 0 ? "no fish" : `${fish.length} fish (${money(fish.reduce((a, b) => a + b, 0))})`;

export function tileLabel(content: Content, tile: TileId): string {
  const t = content.board.tiles[tile];
  return t ? `${t.x},${t.y}` : `#${tile}`;
}

/** A dock's name for people: "start-left" → "left starting dock". */
export function dockName(content: Content, dock: string): string {
  const d = content.board.docks.find((x) => x.id === dock);
  if (d?.kind === "starting") {
    const side = dock.replace(/^start-?/, "");
    return side ? `${side} starting dock` : "starting dock";
  }
  if (d?.kind === "cruise") return "cruise dock";
  return dock;
}

/** One line per event, or `null` for events not worth a log line. */
export function describeEvent(ev: GameEvent, content: Content, name: NameOf): string | null {
  const card = (id: string) => content.cards.cards[id]?.name ?? id;
  switch (ev.type) {
    case "gameStarted":
      return "The game starts.";
    case "turnOrderDecided":
      return `Turn order: ${ev.order.map(name).join(", ")}.`;
    case "shipPlaced":
      return `${name(ev.player)} places a ship at the ${dockName(content, ev.dock)}.`;
    case "roundStarted":
      return `Round ${ev.round} of ${content.rules.rounds}.`;
    case "turnStarted":
      return null;
    case "turnSkipped":
      return `${name(ev.player)} has no free starting dock and skips the turn.`;
    case "turnMissed":
      return ev.reason === "away"
        ? `${name(ev.player)} is away and misses the turn.`
        : `${name(ev.player)} ran out of time and misses the turn.`;
    case "turnTimedOut":
      return ev.reason === "away"
        ? `${name(ev.player)} is away; the turn ends.`
        : `${name(ev.player)} ran out of time; the turn ends.`;
    case "playerRemoved":
      return ev.reason === "kicked"
        ? `${name(ev.player)} is removed from the game by the host.`
        : `${name(ev.player)} is removed from the game after running out of time ${content.rules.missedTurnsBeforeRemoval} turns in a row.`;
    case "rolled": {
      const r = ev.roll;
      const bonus = r.speedBonus + r.eventModifier;
      return `${name(ev.player)} rolls ${r.die}${bonus ? ` ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}` : ""} = ${r.steps} steps.`;
    }
    case "blocked":
      return `${name(ev.player)} cannot move (${ev.reason === "zero-steps" ? "0 steps" : "no legal move"}).`;
    case "moved":
      return `${name(ev.player)} sails to ${tileLabel(content, ev.to)}.`;
    case "cardDrawn":
      return `${name(ev.player)} draws ${card(ev.card)} (${ev.deck}).`;
    case "fishGained":
      return `${name(ev.player)} keeps ${fishList(ev.kept)}${ev.lost.length ? `, loses ${fishList(ev.lost)} (full)` : ""}.`;
    case "fishLost":
      return `${name(ev.player)} loses ${fishList(ev.fish)} (${ev.reason}).`;
    case "sharkRepelled":
      return `${name(ev.player)} repels the shark with ${card(ev.card)}.`;
    case "fined":
      return `${name(ev.player)} is fined ${money(ev.amount)}: pays ${money(ev.paid)}${ev.tokensTaken ? `, takes ${ev.tokensTaken} fine token(s)` : ""}.`;
    case "shipRelocated":
      return `${name(ev.player)}'s ship is moved to the ${dockName(content, ev.dock)}.`;
    case "relocationFailed":
      return `${name(ev.player)}'s ship stays put (every dock is taken).`;
    case "cardDiscarded":
      return null;
    case "docked":
      return `${name(ev.player)} docks at the ${dockName(content, ev.dock)}.`;
    case "fishSold":
      return `${name(ev.player)} sells ${fishList(ev.fish)} for ${money(ev.total)}${ev.via === "helicopter" ? " by helicopter" : ""}.`;
    case "fineTokensPaid":
      return `${name(ev.player)} pays ${ev.tokens} fine token(s) (${money(ev.amount)}).`;
    case "upgradeBought":
      return `${name(ev.player)} buys the ${ev.upgrade} upgrade for ${money(ev.price)}.`;
    case "helicopterUsed":
      return `${name(ev.player)} calls the helicopter (fee ${money(ev.fee)}).`;
    case "goldenFishPlaced":
      return `A Golden Fish (${money(ev.value)}) appears at spot ${ev.spot}.`;
    case "goldenFishTaken":
      return `${name(ev.player)} catches the Golden Fish (${money(ev.value)}).`;
    case "goldenFishLost":
      return `${name(ev.player)}'s ship is full: the Golden Fish at spot ${ev.spot} is lost.`;
    case "goldenFishRemoved":
      return `The Golden Fish at spot ${ev.spot} is gone.`;
    case "turnEnded":
      return null;
    case "roundEnded":
      return null;
    case "eventExpired":
      return `Event over: ${card(ev.card)}.`;
    case "eventDrawn":
      return `Event after round ${ev.afterRound}: ${card(ev.card)}.`;
    case "deckReshuffled":
      return `The ${ev.deck} deck is reshuffled.`;
    case "awardGiven": {
      // The reveal as a log line; B2 builds the real one, one award at a time.
      const def = content.awards.awards.find((a) => a.id === ev.award);
      const title = `Golden Hook for ${def?.name ?? ev.award} (${def?.text.toLowerCase() ?? ""})`;
      if (ev.winners.length > 0) {
        return `${title}: ${ev.winners.map(name).join(" and ")}, +${money(ev.amount)}.`;
      }
      if (ev.qualified.length > 0) {
        return `${title}: ${ev.qualified.map(name).join(" and ")}, not paid (not in the game at the end).`;
      }
      return `${title}: nobody.`;
    }
    case "gameEnded":
      return ev.result.reason === "last-player"
        ? `Game over. ${ev.result.winners.map(name).join(" and ")} is the last player left and wins.`
        : `Game over. Winner: ${ev.result.winners.map(name).join(" and ")}.`;
  }
}

/** Label for an action button. */
export function describeAction(action: PlayerAction, content: Content): string {
  switch (action.type) {
    case "placeShip":
      return `Start at the ${dockName(content, action.dock)}`;
    case "roll":
      return "Roll";
    case "move":
      return `Sail to ${tileLabel(content, action.to)}`;
    case "buyUpgrade":
      return `Buy ${action.upgrade} upgrade (${money(content.rules.upgrades[action.upgrade].price)})`;
    case "useHelicopter":
      return "Call the helicopter";
    case "endTurn":
      return "End turn";
  }
}

/** What an upgrade does, for the shop. */
export function upgradeText(content: Content, upgrade: UpgradeId): string {
  const u = content.rules.upgrades;
  return upgrade === "speed"
    ? `+${u.speed.rollBonus} to every roll`
    : `hold ${u.capacity.capacity} fish instead of ${content.rules.baseCapacity}`;
}

/** What the deciding player has to do, as a phrase: "roll the die". */
export function phaseTask(view: PlayerView): string {
  switch (view.phase.kind) {
    case "placeShip":
      return "choose a starting dock";
    case "roll":
      return "roll the die";
    case "move":
      return `move (${view.phase.roll.steps} step${view.phase.roll.steps === 1 ? "" : "s"})`;
    case "dockShop":
      return "shop at the dock or end the turn";
    case "turnEnd":
      return "end the turn";
    case "gameOver":
      return "finish";
  }
}

/**
 * A seat's connection in words, or `null` when it is connected. `secondsLeft`
 * is what is left of a disconnected player's reconnect grace (from `awayInMs`).
 */
export function seatStatus(
  seat: SeatInfo | undefined,
  secondsLeft: number | null = null,
): string | null {
  if (seat?.removed) return "removed from the game";
  if (!seat || seat.connected) return null;
  if (seat.away) return "away: their turns are missed until they come back";
  return secondsLeft === null ? "disconnected" : `disconnected: ${secondsLeft} s to come back`;
}
