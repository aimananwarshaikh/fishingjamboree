/**
 * Board facts the bots need, worked out once per compiled content: how many
 * tiles each tile is from each dock (ignoring other ships), and from each risk
 * area. Public information only.
 */
import type { Content, DockId, PlayerState, PlayerView, TileId } from "@fishingjamboree/engine";

export interface BoardInfo {
  /** `toDock[dock][tile]`: shortest number of steps from `tile` to `dock`; `Infinity` if none. */
  toDock: Record<DockId, number[]>;
  /** Steps from each tile to the nearest risk tile (0 on one). */
  toRisk: number[];
  /** Number of tiles a ship can step onto from each dock. */
  dockExits: Record<DockId, number>;
}

const cache = new WeakMap<Content, BoardInfo>();

/** Breadth-first search from `sources`. Ships cannot pass through a dock, so docks are never expanded. */
function distancesFrom(content: Content, sources: TileId[]): number[] {
  const { tiles, neighbours } = content.board;
  const dist: number[] = tiles.map(() => Infinity);
  const queue: TileId[] = [];
  for (const s of sources) {
    dist[s] = 0;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head] as TileId;
    const d = dist[at] as number;
    for (const next of neighbours[at] ?? []) {
      if ((dist[next] as number) !== Infinity) continue;
      dist[next] = d + 1;
      // A dock can end a path but not lie inside one.
      if (tiles[next]?.terrain !== "dock") queue.push(next);
    }
  }
  return dist;
}

export function boardInfo(content: Content): BoardInfo {
  const known = cache.get(content);
  if (known) return known;
  const toDock: Record<DockId, number[]> = {};
  const dockExits: Record<DockId, number> = {};
  for (const dock of content.board.docks) {
    toDock[dock.id] = distancesFrom(content, [dock.tile]);
    dockExits[dock.id] = (content.board.neighbours[dock.tile] ?? []).filter(
      (n) => content.board.tiles[n]?.terrain !== "dock",
    ).length;
  }
  const riskTiles = content.board.tiles.flatMap((t) => (t?.terrain === "risk" ? [t.id] : []));
  const info: BoardInfo = { toDock, toRisk: distancesFrom(content, riskTiles), dockExits };
  cache.set(content, info);
  return info;
}

/** Docks no other ship is on. */
export function freeDocks(content: Content, view: PlayerView, me: PlayerState): DockId[] {
  const taken = new Set(
    view.players.filter((p) => p.id !== me.id && p.position !== null).map((p) => p.position),
  );
  return content.board.docks.filter((d) => !taken.has(d.tile)).map((d) => d.id);
}

/** Steps from `tile` to the nearest dock in `docks`. */
export function stepsHome(info: BoardInfo, docks: readonly DockId[], tile: TileId): number {
  let best = Infinity;
  for (const d of docks) best = Math.min(best, info.toDock[d]?.[tile] ?? Infinity);
  return best;
}
