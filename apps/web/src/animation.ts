/**
 * The animation queue (B2a). Pure: no React, no timers, no clock of its own.
 *
 * Each game `update` carries the engine's events. `enqueueUpdate` turns them
 * into steps (a ship sailing along its path, the dice, a card, fish, a fine,
 * a sale, an award...) and gives each step a start and end time on the tab's
 * clock, after whatever is still playing. `frameAt` says, for any time, which
 * step is playing, how far it has got, and where each ship and the Golden Fish
 * should be drawn.
 *
 * The view is the truth. The queue never changes what the game state is; it
 * only holds ships and the Golden Fish back at their old places until their
 * step has played. A refresh, a rejoin or a `sync` gives a view with no
 * events: `resetQueue` empties the queue and the board shows the view as it
 * is. When the queue falls behind it plays faster, and far behind it skips.
 *
 * Steps are data for components: B2b draws the dice, cards, fish, fines and
 * the awards reveal from `frame.current` (docs/architecture.md, "Web client").
 */
import type {
  AwardResult,
  CardId,
  DrawDeckId,
  FishLossReason,
  GameEvent,
  GoldenFishState,
  Money,
  PlayerId,
  PlayerView,
  RollResult,
  SaleVia,
  TileId,
  UpgradeId,
} from "@fishingjamboree/engine";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type AnimStep =
  /** A ship appears on a dock (setup, late entry). */
  | { kind: "place"; player: PlayerId; tile: TileId }
  | { kind: "dice"; player: PlayerId; roll: RollResult }
  /** `path` starts where the ship was and ends where it stops. */
  | { kind: "move"; player: PlayerId; path: TileId[] }
  /** Sinking Boat: the ship is towed to a dock. */
  | { kind: "relocate"; player: PlayerId; from: TileId; to: TileId }
  | { kind: "card"; player: PlayerId; deck: DrawDeckId; card: CardId }
  | { kind: "fish"; player: PlayerId; kept: Money[]; lost: Money[]; bonus: number }
  | { kind: "fishLost"; player: PlayerId; fish: Money[]; reason: FishLossReason }
  | { kind: "repelled"; player: PlayerId; card: CardId }
  | { kind: "fine"; player: PlayerId; amount: Money; paid: Money; tokensTaken: number }
  | { kind: "sale"; player: PlayerId; fish: Money[]; total: Money; via: SaleVia }
  | { kind: "tokensPaid"; player: PlayerId; tokens: number; amount: Money }
  | { kind: "upgrade"; player: PlayerId; upgrade: UpgradeId; price: Money }
  | { kind: "helicopter"; player: PlayerId; fee: Money }
  /** `fish` is where it is (or was); `player` is who took or lost it. */
  | {
      kind: "goldenFish";
      what: "placed" | "taken" | "lost" | "removed";
      player: PlayerId | null;
      fish: GoldenFishState;
    }
  /** The ship leaves the board (`tile` is where it was, if on the board). */
  | { kind: "removed"; player: PlayerId; tile: TileId | null }
  | { kind: "round"; round: number }
  | { kind: "event"; card: CardId; afterRound: number }
  /** One Golden Hook Award revealed (end of the game, in draw order). */
  | { kind: "award"; award: AwardResult }
  | { kind: "gameEnd" };

export type AnimKind = AnimStep["kind"];

/** How long each step plays at normal speed, in milliseconds. `move` is per tile sailed. */
export const DURATION: Record<AnimKind, number> = {
  place: 350,
  dice: 900,
  move: 180,
  relocate: 700,
  card: 1300,
  fish: 700,
  fishLost: 700,
  repelled: 900,
  fine: 800,
  sale: 900,
  tokensPaid: 600,
  upgrade: 700,
  helicopter: 900,
  goldenFish: 700,
  removed: 500,
  round: 900,
  event: 1600,
  award: 3000,
  gameEnd: 800,
};

/** Normal-speed length of one step. */
export function stepDuration(step: AnimStep): number {
  if (step.kind === "move") return Math.max(1, step.path.length - 1) * DURATION.move;
  return DURATION[step.kind];
}

/**
 * The longest the queue may run behind the server before it plays faster:
 * steps not yet started are shortened so that everything has played this
 * long after the newest update arrived.
 */
export const MAX_LAG_MS = 4_000;
/** The same while it is this tab's player's turn: their 90 s are running. */
export const MY_TURN_LAG_MS = 1_500;
/** Further behind than this (normal speed), the queue skips to the view. */
export const SKIP_LAG_MS = 15_000;
/** A shortened step never plays faster than this share of its normal length; below it, it is dropped. */
export const MIN_SPEED = 0.15;

// ---------------------------------------------------------------------------
// Events to steps
// ---------------------------------------------------------------------------

/**
 * The steps for one update's events, in order. `before` is the view the
 * client held before the update (`null` for the first): it says where ships
 * and the Golden Fish were when an event does not.
 */
export function eventsToSteps(events: GameEvent[], before: PlayerView | null): AnimStep[] {
  const pos = new Map<PlayerId, TileId | null>(
    (before?.players ?? []).map((p) => [p.id, p.position]),
  );
  let fish: GoldenFishState | null = before?.goldenFish ?? null;
  const goldenAt = (spot: number): GoldenFishState | null =>
    fish && fish.spot === spot ? fish : null;
  const steps: AnimStep[] = [];

  for (const e of events) {
    switch (e.type) {
      case "shipPlaced":
        steps.push({ kind: "place", player: e.player, tile: e.tile });
        pos.set(e.player, e.tile);
        break;
      case "rolled":
        steps.push({ kind: "dice", player: e.player, roll: e.roll });
        break;
      case "moved":
        steps.push({ kind: "move", player: e.player, path: e.path });
        pos.set(e.player, e.to);
        break;
      case "shipRelocated":
        steps.push({ kind: "relocate", player: e.player, from: e.from, to: e.to });
        pos.set(e.player, e.to);
        break;
      case "cardDrawn":
        steps.push({ kind: "card", player: e.player, deck: e.deck, card: e.card });
        break;
      case "fishGained":
        steps.push({ kind: "fish", player: e.player, kept: e.kept, lost: e.lost, bonus: e.bonus });
        break;
      case "fishLost":
        steps.push({ kind: "fishLost", player: e.player, fish: e.fish, reason: e.reason });
        break;
      case "sharkRepelled":
        steps.push({ kind: "repelled", player: e.player, card: e.card });
        break;
      case "fined":
        steps.push({
          kind: "fine",
          player: e.player,
          amount: e.amount,
          paid: e.paid,
          tokensTaken: e.tokensTaken,
        });
        break;
      case "fishSold":
        steps.push({ kind: "sale", player: e.player, fish: e.fish, total: e.total, via: e.via });
        break;
      case "fineTokensPaid":
        steps.push({ kind: "tokensPaid", player: e.player, tokens: e.tokens, amount: e.amount });
        break;
      case "upgradeBought":
        steps.push({ kind: "upgrade", player: e.player, upgrade: e.upgrade, price: e.price });
        break;
      case "helicopterUsed":
        steps.push({ kind: "helicopter", player: e.player, fee: e.fee });
        break;
      case "goldenFishPlaced":
        fish = { spot: e.spot, tile: e.tile, value: e.value };
        steps.push({ kind: "goldenFish", what: "placed", player: null, fish });
        break;
      case "goldenFishTaken":
      case "goldenFishLost": {
        const f = goldenAt(e.spot);
        if (f) {
          const what = e.type === "goldenFishTaken" ? "taken" : "lost";
          steps.push({ kind: "goldenFish", what, player: e.player, fish: f });
        }
        fish = null;
        break;
      }
      case "goldenFishRemoved": {
        const f = goldenAt(e.spot);
        if (f) steps.push({ kind: "goldenFish", what: "removed", player: null, fish: f });
        fish = null;
        break;
      }
      case "playerRemoved":
        steps.push({ kind: "removed", player: e.player, tile: pos.get(e.player) ?? null });
        pos.set(e.player, null);
        break;
      case "roundStarted":
        steps.push({ kind: "round", round: e.round });
        break;
      case "eventDrawn":
        steps.push({ kind: "event", card: e.card, afterRound: e.afterRound });
        break;
      case "awardGiven": {
        const { type: _type, ...award } = e;
        void _type;
        steps.push({ kind: "award", award });
        break;
      }
      case "gameEnded":
        steps.push({ kind: "gameEnd" });
        break;
      // Log only: nothing to show on the board.
      case "gameStarted":
      case "turnOrderDecided":
      case "turnStarted":
      case "turnSkipped":
      case "turnMissed":
      case "turnTimedOut":
      case "blocked":
      case "relocationFailed":
      case "cardDiscarded":
      case "docked":
      case "turnEnded":
      case "roundEnded":
      case "eventExpired":
      case "deckReshuffled":
        break;
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface ScheduledStep {
  /** Unique within the queue's life; stable keys for components. */
  id: number;
  /** The update it came from. */
  seq: number;
  step: AnimStep;
  /** On the tab's clock (the same `now` the store uses). */
  start: number;
  end: number;
}

export interface AnimQueue {
  /** The `seq` of the last update queued (or reset to); `null` before the game. */
  seq: number | null;
  /** In order; finished ones are dropped when the next update is queued. */
  steps: ScheduledStep[];
  nextId: number;
}

export const emptyQueue: AnimQueue = { seq: null, steps: [], nextId: 1 };

export interface EnqueueOptions {
  /** The player prefers reduced motion: nothing plays but the awards reveal. */
  reducedMotion?: boolean;
  /** It is now this tab's player's decision: catch up to `MY_TURN_LAG_MS`. */
  myTurn?: boolean;
}

/** Nothing to play; the board shows the view at `seq` as it is (welcome, snapshot, rejoin). */
export function resetQueue(queue: AnimQueue, seq: number | null): AnimQueue {
  return { seq, steps: [], nextId: queue.nextId };
}

/** The award reveal is never shortened or skipped: it is the point of the end of the game. */
const keepsPace = (s: AnimStep) => s.kind === "award" || s.kind === "gameEnd";

/**
 * Adds one update's steps after what is still playing. An update that does
 * not follow the last one queued (a gap) resets the queue instead: the view
 * is the truth and is shown as it is.
 */
export function enqueueUpdate(
  queue: AnimQueue,
  update: { seq: number; events: GameEvent[]; before: PlayerView | null },
  now: number,
  options: EnqueueOptions = {},
): AnimQueue {
  if (queue.seq !== null && update.seq !== queue.seq + 1) return resetQueue(queue, update.seq);

  const playing = queue.steps.filter((s) => s.end > now && s.start <= now);
  const waiting = queue.steps
    .filter((s) => s.start > now)
    .map((s) => ({ seq: s.seq, step: s.step }));
  const added = eventsToSteps(update.events, update.before).map((step) => ({
    seq: update.seq,
    step,
  }));
  const todo = [...waiting, ...added];

  // What is still to play, and how far behind that puts the board.
  const tail = playing.reduce((t, s) => Math.max(t, s.end), now);
  const flexible = todo.filter((t) => !keepsPace(t.step));
  const flexMs = flexible.reduce((sum, t) => sum + stepDuration(t.step), 0);
  const lag = tail - now + flexMs;

  let speed = 1; // share of normal length
  if (options.reducedMotion || lag > SKIP_LAG_MS) speed = 0;
  else {
    const limit = options.myTurn ? MY_TURN_LAG_MS : MAX_LAG_MS;
    if (lag > limit && flexMs > 0) speed = Math.max(0, (limit - (tail - now)) / flexMs);
    if (speed < MIN_SPEED) speed = 0;
  }

  let t = tail;
  let nextId = queue.nextId;
  const scheduled: ScheduledStep[] = [...playing];
  for (const { seq, step } of todo) {
    const length = keepsPace(step) ? stepDuration(step) : stepDuration(step) * speed;
    if (length <= 0) continue; // skipped: the view already shows the outcome
    scheduled.push({ id: nextId++, seq, step, start: t, end: t + length });
    t += length;
  }
  return { seq: update.seq, steps: scheduled, nextId };
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Where to draw a ship: on `tile`, or `t` (0–1) of the way from `tile` to `to`. */
export interface ShipPose {
  tile: TileId;
  to: TileId | null;
  t: number;
  /** 0–1, for a ship appearing or leaving; 1 otherwise. */
  opacity: number;
}

export interface Frame {
  /** The step playing now and how far it has got (0–1), or `null`. */
  current: { id: number; step: AnimStep; progress: number } | null;
  /** Every ship to draw, by player. A player with no entry has no ship on the board. */
  ships: Map<PlayerId, ShipPose>;
  goldenFish: GoldenFishState | null;
  /** Something is still to play: keep drawing frames. */
  busy: boolean;
}

const still = (tile: TileId): ShipPose => ({ tile, to: null, t: 0, opacity: 1 });

/** The step a player's ship (or the Golden Fish) waits for: its first one not yet over. */
function firstOpen<T extends ScheduledStep>(
  steps: T[],
  now: number,
  match: (s: AnimStep) => boolean,
) {
  return steps.find((s) => s.end > now && match(s.step));
}

/** What to draw at `now`: the view, with ships and the Golden Fish held back until their steps play. */
export function frameAt(queue: AnimQueue, view: PlayerView, now: number): Frame {
  const open = queue.steps.filter((s) => s.end > now);
  const cur = open.find((s) => s.start <= now) ?? null;
  const progressOf = (s: ScheduledStep) =>
    s.end > s.start ? Math.min(1, Math.max(0, (now - s.start) / (s.end - s.start))) : 1;

  const ships = new Map<PlayerId, ShipPose>();
  for (const p of view.players) {
    const s = firstOpen(
      open,
      now,
      (st) =>
        (st.kind === "move" ||
          st.kind === "relocate" ||
          st.kind === "place" ||
          st.kind === "removed") &&
        st.player === p.id,
    );
    if (!s) {
      if (p.position !== null && !p.removed) ships.set(p.id, still(p.position));
      continue;
    }
    const playing = s.start <= now;
    const k = progressOf(s);
    const st = s.step;
    if (st.kind === "move") {
      const legs = st.path.length - 1;
      if (!playing || legs <= 0) {
        if (st.path[0] !== undefined) ships.set(p.id, still(st.path[0]));
        continue;
      }
      const along = k * legs;
      const i = Math.min(legs - 1, Math.floor(along));
      ships.set(p.id, {
        tile: st.path[i]!,
        to: st.path[i + 1]!,
        t: along - i,
        opacity: 1,
      });
    } else if (st.kind === "relocate") {
      ships.set(p.id, playing ? { tile: st.from, to: st.to, t: k, opacity: 1 } : still(st.from));
    } else if (st.kind === "place") {
      if (playing) ships.set(p.id, { ...still(st.tile), opacity: k });
    } else if (st.kind === "removed" && st.tile !== null) {
      ships.set(p.id, playing ? { ...still(st.tile), opacity: 1 - k } : still(st.tile));
    }
  }

  let goldenFish = view.goldenFish;
  const g = firstOpen(open, now, (st) => st.kind === "goldenFish");
  if (g && g.step.kind === "goldenFish") {
    goldenFish = g.step.what === "placed" && g.start > now ? null : g.step.fish;
  }

  return {
    current: cur ? { id: cur.id, step: cur.step, progress: progressOf(cur) } : null,
    ships,
    goldenFish,
    busy: open.length > 0,
  };
}

/** When the last step ends (`null` if nothing is queued). The UI draws frames until then. */
export function queueEnd(queue: AnimQueue): number | null {
  return queue.steps.reduce<number | null>((t, s) => (t === null || s.end > t ? s.end : t), null);
}
