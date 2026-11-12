/**
 * Movement (Session 3a): where a ship can end its move, plus the small
 * helpers the turn flow needs (occupied tiles, the roll breakdown, free
 * starting docks). Uses public information only.
 *
 * The rules, all from docs/rulebook.md (Movement) and the decisions log:
 * - orthogonal steps on `board.neighbours` (no diagonals, no island);
 * - a sea or risk tile is a destination only on the exact step count;
 * - a free dock is a destination when a legal route reaches it in the step
 *   count or fewer (you may stop early to dock);
 * - no step back onto the tile just left, but loops are allowed, including
 *   over the mover's own start tile;
 * - no step onto a tile holding another ship;
 * - a dock ends the move: it is never passed through, and never entered
 *   directly from another dock;
 * - the move never ends on the tile it started from.
 */
import type { AnyState, Board, Content, DockId, PlayerState, RollResult, TileId } from "./types";

export interface Destination {
  to: TileId;
  /** One legal path, `from` first and `to` last. For display only. */
  path: TileId[];
}

/**
 * Every tile a ship on `from` may end on with `steps` steps, sorted by tile
 * id. `occupied` holds the tiles of the other ships (not the mover's own).
 *
 * A layered search over (tile, previous tile). Each state keeps the first
 * parent that reached it, with neighbours tried in the board's order (up,
 * right, down, left), so the path for each destination is deterministic. A
 * dock keeps the shortest route found.
 */
export function reachableDestinations(
  board: Board,
  from: TileId,
  steps: number,
  occupied: ReadonlySet<TileId>,
): Destination[] {
  if (steps < 1 || !board.tiles[from]) return [];

  const span = board.tiles.length + 1;
  const keyOf = (tile: TileId, prev: TileId): number => tile * span + (prev + 1);
  const tileOf = (key: number): TileId => Math.floor(key / span);
  const prevOf = (key: number): TileId => (key % span) - 1;
  const isDock = (tile: TileId): boolean => board.tiles[tile]?.terrain === "dock";

  // layers[k] maps each state reached after k steps to the state it came from.
  const start = keyOf(from, -1);
  const layers: Map<number, number>[] = [new Map([[start, start]])];

  const pathTo = (layer: number, key: number): TileId[] => {
    const path: TileId[] = [];
    let k = key;
    for (let i = layer; i >= 0; i--) {
      path.push(tileOf(k));
      k = (layers[i] as Map<number, number>).get(k) as number;
    }
    return path.reverse();
  };

  const found = new Map<TileId, TileId[]>();

  for (let step = 1; step <= steps; step++) {
    const current = layers[step - 1] as Map<number, number>;
    const next = new Map<number, number>();
    layers.push(next);
    for (const key of current.keys()) {
      const tile = tileOf(key);
      const prev = prevOf(key);
      // A dock reached during the move ends it. Only the start may be a dock we leave.
      if (step > 1 && isDock(tile)) continue;
      for (const nb of board.neighbours[tile] as TileId[]) {
        if (nb === prev || occupied.has(nb)) continue;
        const nbKey = keyOf(nb, tile);
        if (isDock(nb)) {
          if (isDock(tile) || nb === from) continue;
          if (!next.has(nbKey)) next.set(nbKey, key);
          if (!found.has(nb)) found.set(nb, pathTo(step, nbKey));
          continue;
        }
        if (!next.has(nbKey)) next.set(nbKey, key);
      }
    }
    if (next.size === 0) break;
  }

  const last = layers[steps];
  if (last) {
    for (const key of last.keys()) {
      const tile = tileOf(key);
      if (tile === from || isDock(tile) || found.has(tile)) continue;
      found.set(tile, pathTo(steps, key));
    }
  }

  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([to, path]) => ({ to, path }));
}

/** Tiles holding a ship other than `except`'s. Waiting players are on no tile. */
export function occupiedTiles(players: readonly PlayerState[], except: string): Set<TileId> {
  const out = new Set<TileId>();
  for (const p of players) {
    if (p.id !== except && p.position !== null) out.add(p.position);
  }
  return out;
}

/** Destinations for `player` moving `steps` from where they are now. */
export function destinationsFor(
  content: Content,
  state: AnyState,
  player: PlayerState,
  steps: number,
): Destination[] {
  if (player.position === null) return [];
  return reachableDestinations(
    content.board,
    player.position,
    steps,
    occupiedTiles(state.players, player.id),
  );
}

/** `steps = max(0, die + Speed + movement event)`. All bonuses are mandatory. */
export function computeRoll(
  content: Content,
  state: AnyState,
  player: PlayerState,
  die: number,
): RollResult {
  const speedBonus = player.upgrades.speed ? content.rules.upgrades.speed.rollBonus : 0;
  const effect = state.activeEvent
    ? content.cards.cards[state.activeEvent.card]?.effect
    : undefined;
  const eventModifier = effect?.kind === "movement" ? effect.delta : 0;
  return { die, speedBonus, eventModifier, steps: Math.max(0, die + speedBonus + eventModifier) };
}

/** Starting docks with no ship on them, in content order. */
export function freeStartingDocks(content: Content, state: AnyState): DockId[] {
  const taken = occupiedTiles(state.players, "");
  return content.board.docks
    .filter((d) => d.kind === "starting" && !taken.has(d.tile))
    .map((d) => d.id);
}
