/**
 * Bots (B6). A bot sees what a player sees: the redacted `PlayerView` (no
 * deck order, no RNG, no awards) and the legal actions from
 * `getLegalActions`, and returns one of those actions. Bots are pure and keep
 * no state: the same content, view, legal list and seed always give the same
 * choice.
 *
 * Four styles. `random` picks uniformly. The other three share one heuristic
 * with different settings (`Style`):
 * - fish mode: pick the landing with the best expected value (the card odds
 *   come from the deck lists minus the public discard pile), counting a catch
 *   only if the ship can still get home before the game ends;
 * - return mode (enough cargo, a full enough hold, or the end is near): head
 *   for the nearest free dock, or use the Helicopter;
 * - shop: buy the style's upgrades in its order until a cut-off round.
 */
import type {
  CardDef,
  Content,
  DeckList,
  DrawDeckId,
  Money,
  PlayerAction,
  PlayerState,
  PlayerView,
  Tile,
  TileId,
  UpgradeId,
} from "@fishingjamboree/engine";
import { boardInfo, freeDocks, stepsHome, type BoardInfo } from "./boardInfo";
import { makeRandom } from "./rng";

export interface BotInput {
  content: Content;
  view: PlayerView;
  /** From `getLegalActions` for this player; never empty. */
  legal: readonly PlayerAction[];
  /** The bot's own seed (per seat); combined with the view's action count. */
  seed: string;
}

export interface Bot {
  name: string;
  choose(input: BotInput): PlayerAction;
}

/** The settings that make greedy, cautious and risk-taker differ. */
export interface Style {
  /** Go home once the fish on board are worth this much. */
  returnAt: Money;
  /** Go home once this share of the hold is full (1 = full). */
  returnFill: number;
  /** Multiplies expected losses (Shark, Sinking Boat): above 1 fears them, below 1 shrugs them off. */
  lossWeight: number;
  /** Dollars added to (or taken from) every Risk landing. */
  riskBonus: Money;
  /** Pull towards the risk areas in fish mode, dollars per step closer. */
  riskPull: Money;
  /** Pull towards a waiting Golden Fish, dollars per step closer. */
  goldenPull: Money;
  /** Upgrades to buy, in order. */
  upgrades: readonly UpgradeId[];
  /** No upgrade is bought after this round. */
  lastUpgradeRound: number;
  /** Use the Helicopter when the catch is worth at least fee + this. */
  helicopterMargin: Money;
  /** Spare turns kept for the trip home at the end of the game. */
  endgameSlack: number;
  /** In return mode, dollars per step further from the dock. */
  homePull: Money;
  /** Random jitter added to each move's score, in dollars (breaks ties, varies play). */
  jitter: Money;
}

export const STYLES = {
  greedy: {
    returnAt: 600,
    returnFill: 1,
    lossWeight: 1,
    riskBonus: 0,
    riskPull: 0,
    goldenPull: 60,
    upgrades: ["capacity", "speed"],
    lastUpgradeRound: 14,
    helicopterMargin: 200,
    endgameSlack: 1,
    homePull: 120,
    jitter: 15,
  },
  cautious: {
    returnAt: 300,
    returnFill: 0.6,
    lossWeight: 2,
    riskBonus: -400,
    riskPull: 0,
    goldenPull: 40,
    upgrades: ["capacity"],
    lastUpgradeRound: 10,
    helicopterMargin: 100,
    endgameSlack: 2,
    homePull: 200,
    jitter: 15,
  },
  "risk-taker": {
    returnAt: 800,
    returnFill: 1,
    lossWeight: 0.5,
    riskBonus: 150,
    riskPull: 10,
    goldenPull: 80,
    upgrades: ["speed", "capacity"],
    lastUpgradeRound: 15,
    helicopterMargin: 400,
    endgameSlack: 0,
    homePull: 80,
    jitter: 15,
  },
} as const satisfies Record<string, Style>;

export type StyleName = keyof typeof STYLES;

// ---------------------------------------------------------------------------
// Helpers on public information
// ---------------------------------------------------------------------------

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function me(view: PlayerView, legal: readonly PlayerAction[]): PlayerState {
  const id = (legal[0] as PlayerAction).player;
  const player = view.players.find((p) => p.id === id);
  if (!player) throw new Error(`bot: player ${id} is not in the view`);
  return player;
}

function activeEffect(content: Content, view: PlayerView) {
  return view.activeEvent ? (content.cards.cards[view.activeEvent.card]?.effect ?? null) : null;
}

function capacity(content: Content, p: PlayerState): number {
  return p.upgrades.capacity
    ? content.rules.upgrades.capacity.capacity
    : content.rules.baseCapacity;
}

/** Average tiles a turn's roll gives this ship now (at least 1). */
function averageSteps(content: Content, view: PlayerView, p: PlayerState): number {
  const effect = activeEffect(content, view);
  const delta = effect?.kind === "movement" ? effect.delta : 0;
  const speed = p.upgrades.speed ? content.rules.upgrades.speed.rollBonus : 0;
  return Math.max(1, (content.rules.dieSides + 1) / 2 + speed + delta);
}

/** Cards left in a deck: the list minus the public discard pile (the whole list if that comes to nothing). */
function remainingCards(content: Content, view: PlayerView, deck: DrawDeckId): [CardDef, number][] {
  const list: DeckList = content.cards.decks[deck];
  const left: Record<string, number> = { ...list };
  for (const card of view.decks[deck].discard) {
    if ((left[card] ?? 0) > 0) left[card] = (left[card] as number) - 1;
  }
  const source = sum(Object.values(left)) > 0 ? left : list;
  return Object.entries(source)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => [content.cards.cards[id] as CardDef, n]);
}

interface Situation {
  content: Content;
  view: PlayerView;
  style: Style;
  info: BoardInfo;
  player: PlayerState;
  docks: string[];
  cargo: Money;
  free: number;
  avg: number;
  /** Turns after this one before the game ends. */
  turnsAfter: number;
}

function situation(input: BotInput, style: Style): Situation {
  const { content, view, legal } = input;
  const player = me(view, legal);
  const turnsAfter = content.rules.rounds - view.round;
  return {
    content,
    view,
    style,
    info: boardInfo(content),
    player,
    docks: freeDocks(content, view, player),
    cargo: sum(player.fish),
    free: capacity(content, player) - player.fish.length,
    avg: averageSteps(content, view, player),
    turnsAfter,
  };
}

/** Turns needed to reach a free dock from `tile` (Infinity if none is reachable). */
function turnsHome(s: Situation, tile: TileId): number {
  const steps = stepsHome(s.info, s.docks, tile);
  return steps === 0 ? 0 : Math.ceil(steps / s.avg);
}

/** Expected change in value from ending a move on `tile` (not a dock). */
function landingValue(s: Situation, tile: Tile, fishCount: boolean): Money {
  const { content, view, style, player } = s;
  const effect = activeEffect(content, view);
  const golden = view.goldenFish;
  if (golden && golden.tile === tile.id) return s.free > 0 && fishCount ? golden.value : 0;
  const deck: DrawDeckId = tile.terrain === "risk" ? "risk" : "safe";
  const bonus =
    effect?.kind === "catchBonus" && tile.terrain === "sea" && tile.zone === effect.zone
      ? effect
      : null;
  const repelled =
    effect?.kind === "sharkRepellent" && tile.terrain === "risk" && tile.area === effect.area;
  const cheapest = [...player.fish].sort((a, b) => a - b);
  const cards = remainingCards(content, view, deck);
  const total = sum(cards.map(([, n]) => n));
  let ev = 0;
  for (const [card, n] of cards) {
    const e = card.effect;
    let v = 0;
    if (e.kind === "fish") {
      const tokens: Money[] = [
        ...Array<Money>(e.count).fill(e.value),
        ...Array<Money>(bonus ? bonus.count : 0).fill(bonus ? bonus.value : 0),
      ];
      v = fishCount ? sum(tokens.slice(0, Math.max(0, s.free))) : 0;
    } else if (e.kind === "fine") {
      v = -e.amount;
    } else if (e.kind === "shark") {
      v = repelled ? 0 : -sum(cheapest.slice(0, e.count)) * style.lossWeight;
    } else if (e.kind === "sinkingBoat") {
      v = -s.cargo * style.lossWeight - 50;
    }
    ev += (v * n) / total;
  }
  return tile.terrain === "risk" ? ev + style.riskBonus : ev;
}

function shouldReturn(s: Situation): boolean {
  if (s.player.position === null || s.cargo === 0) return false;
  const cap = capacity(s.content, s.player);
  if (s.cargo >= s.style.returnAt) return true;
  if (s.player.fish.length >= Math.ceil(cap * s.style.returnFill)) return true;
  if (s.free <= 0) return true;
  return turnsHome(s, s.player.position) + s.style.endgameSlack >= s.turnsAfter + 1;
}

function scoreMove(s: Situation, to: TileId, returning: boolean): Money {
  const tile = s.content.board.tiles[to] as Tile;
  const { style, info, view } = s;
  if (tile.terrain === "dock") {
    if (returning || s.cargo > 0) return returning ? 100_000 : s.cargo * 0.3 + 10;
    // An empty ship docks only when nothing better is left (end of the game) or to shop.
    return s.player.cash >= s.content.rules.upgrades.speed.price ? 40 : 0;
  }
  const home = turnsHome(s, to);
  const canGetHome = home <= s.turnsAfter;
  if (returning) {
    return -stepsHome(info, s.docks, to) * style.homePull + landingValue(s, tile, canGetHome);
  }
  let score = landingValue(s, tile, canGetHome);
  // Fish already on board are lost if this tile leaves no time to get home.
  if (home + style.endgameSlack > s.turnsAfter) score -= s.cargo;
  if (style.riskPull > 0) score -= (info.toRisk[to] ?? 0) * style.riskPull;
  if (view.goldenFish && s.free > 0 && canGetHome) {
    const golden = view.goldenFish.tile;
    const gx = golden % s.content.board.width;
    const gy = Math.floor(golden / s.content.board.width);
    const dist = Math.abs(tile.x - gx) + Math.abs(tile.y - gy);
    score -= dist * style.goldenPull;
  }
  return score;
}

/** The heuristic bot with a given style. */
export function styleBot(name: string, style: Style): Bot {
  return {
    name,
    choose(input) {
      const { legal, view, content } = input;
      if (legal.length === 1) return legal[0] as PlayerAction;
      const random = makeRandom(`${input.seed}|${view.viewer}|${view.actionCount}`);
      const s = situation(input, style);
      const kind = view.phase.kind;
      const find = <T extends PlayerAction["type"]>(type: T) =>
        legal.find((a) => a.type === type) as Extract<PlayerAction, { type: T }> | undefined;

      if (kind === "placeShip") {
        // Prefer the dock with the most ways out (the left starting dock has one).
        const exits = (a: PlayerAction) => (a.type === "placeShip" ? s.info.dockExits[a.dock] : 0);
        return [...legal].sort((a, b) => (exits(b) ?? 0) - (exits(a) ?? 0))[0] as PlayerAction;
      }

      const heli = find("useHelicopter");
      if (heli) {
        const effect = activeEffect(content, view);
        const fee = effect?.kind === "helicopter" ? effect.fee : Infinity;
        const pos = s.player.position;
        const stranded = pos === null || turnsHome(s, pos) > s.turnsAfter;
        const farFromDock = pos === null || stepsHome(s.info, s.docks, pos) > s.avg;
        const lastChance = kind === "turnEnd" && stranded;
        if (s.cargo > fee && lastChance) return heli;
        if (s.cargo >= fee + style.helicopterMargin && (kind === "turnEnd" || farFromDock)) {
          return heli;
        }
      }

      if (kind === "dockShop") {
        if (view.round <= style.lastUpgradeRound) {
          for (const upgrade of style.upgrades) {
            const buy = legal.find((a) => a.type === "buyUpgrade" && a.upgrade === upgrade);
            if (buy) return buy;
          }
        }
        return find("endTurn") as PlayerAction;
      }

      if (kind === "move") {
        const returning = shouldReturn(s);
        let best: PlayerAction = legal[0] as PlayerAction;
        let bestScore = -Infinity;
        for (const action of legal) {
          if (action.type !== "move") continue;
          const score = scoreMove(s, action.to, returning) + random() * style.jitter;
          if (score > bestScore) {
            bestScore = score;
            best = action;
          }
        }
        return best;
      }

      return find("roll") ?? find("endTurn") ?? (legal[0] as PlayerAction);
    },
  };
}

export const randomBot: Bot = {
  name: "random",
  choose({ legal, view, seed }) {
    const random = makeRandom(`${seed}|${view.viewer}|${view.actionCount}`);
    return legal[Math.floor(random() * legal.length)] as PlayerAction;
  },
};

export const BOTS: Record<string, Bot> = {
  random: randomBot,
  greedy: styleBot("greedy", STYLES.greedy),
  cautious: styleBot("cautious", STYLES.cautious),
  "risk-taker": styleBot("risk-taker", STYLES["risk-taker"]),
};

export const BOT_NAMES = Object.keys(BOTS);

export function botByName(name: string): Bot {
  const bot = BOTS[name];
  if (!bot) throw new Error(`unknown bot "${name}" (known: ${BOT_NAMES.join(", ")})`);
  return bot;
}
