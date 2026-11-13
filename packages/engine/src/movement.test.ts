import { describe, expect, it } from "vitest";
import { occupiedTiles, reachableDestinations } from "./movement";
import { board, CRUISE, isDock, oracle, START_LEFT, START_RIGHT, tile } from "./testHelpers";
import type { PlayerState, TileId } from "./types";

const set = (...tiles: TileId[]): Set<TileId> => new Set(tiles);
const sorted = (tiles: Iterable<TileId>): TileId[] => [...tiles].sort((a, b) => a - b);
const distance = (a: TileId, b: TileId): number => {
  const ta = board.tiles[a]!;
  const tb = board.tiles[b]!;
  return Math.abs(ta.x - tb.x) + Math.abs(ta.y - tb.y);
};

/** Destination tiles, sorted. */
const reach = (from: TileId, steps: number, occupied: Set<TileId> = set()): TileId[] =>
  reachableDestinations(board, from, steps, occupied).map((d) => d.to);

/** Every tile a ship can stand on. */
const ALL_TILES = board.tiles.flatMap((t) => (t && t.terrain !== "island" ? [t.id] : []));
const STEP_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Independent check of one path against the movement rules. */
function pathProblem(
  path: TileId[],
  from: TileId,
  steps: number,
  occupied: Set<TileId>,
): string | null {
  const to = path[path.length - 1]!;
  if (path[0] !== from) return "does not start at from";
  if (to === from) return "ends on the start tile";
  if (isDock(to) ? path.length - 1 > steps : path.length - 1 !== steps) return "wrong length";
  for (let i = 1; i < path.length; i++) {
    const a = board.tiles[path[i - 1]!];
    const b = board.tiles[path[i]!];
    if (!a || !b) return "off the board";
    if (b.terrain === "island") return "through the island";
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return "not an orthogonal step";
    if (i >= 2 && path[i] === path[i - 2]) return "steps straight back";
    if (occupied.has(b.id)) return "onto another ship";
    if (b.terrain === "dock" && i !== path.length - 1) return "passes through a dock";
    if (b.terrain === "dock" && a.terrain === "dock") return "dock to dock";
  }
  return null;
}

describe("reachableDestinations: exact count, no diagonals", () => {
  it("1 step from the left starting dock is its only exit", () => {
    expect(reach(START_LEFT, 1)).toEqual([tile(3, 18)]);
  });

  it("2 steps skips the tile 1 step away", () => {
    expect(reach(START_LEFT, 2)).toEqual(sorted([tile(4, 18), tile(3, 17)]));
  });

  it("1 step in open sea gives the 4 orthogonal neighbours", () => {
    expect(reach(tile(5, 8), 1)).toEqual(sorted([tile(5, 7), tile(6, 8), tile(5, 9), tile(4, 8)]));
  });

  it("2 steps in open sea gives exactly the 8 tiles at distance 2 (a diagonal costs 2)", () => {
    const from = tile(5, 8);
    const expected = ALL_TILES.filter((t) => distance(from, t) === 2);
    expect(expected).toHaveLength(8);
    expect(reach(from, 2)).toEqual(expected);
  });

  it("sea destinations always match the step count's parity and range", () => {
    for (const from of ALL_TILES) {
      for (const steps of STEP_COUNTS) {
        for (const to of reach(from, steps)) {
          const d = distance(from, to);
          expect(d).toBeLessThanOrEqual(steps);
          if (!isDock(to)) expect(d % 2).toBe(steps % 2);
        }
      }
    }
  });

  it("0 steps goes nowhere", () => {
    expect(reach(tile(5, 8), 0)).toEqual([]);
    expect(reach(START_LEFT, 0)).toEqual([]);
    expect(reach(tile(7, 0), 0)).toEqual([]);
  });
});

describe("reachableDestinations: no step back, loops allowed", () => {
  it("2 steps never returns to the start", () => {
    for (const from of ALL_TILES) expect(reach(from, 2)).not.toContain(from);
  });

  it("a pocket cannot be used to turn round", () => {
    // (6,0) in 3 steps would need (6,0) -> (7,0) -> (6,0), or the route through (6,1).
    const dests = reach(tile(5, 0), 3, set(CRUISE, tile(6, 1)));
    expect(dests).not.toContain(tile(6, 0));
  });

  it("the pocket is fine when the move can finish on the dock behind it", () => {
    expect(reach(tile(5, 0), 3, set(tile(6, 1)))).toContain(CRUISE);
  });

  it("a move may loop over tiles it passed earlier, its own start tile included", () => {
    // The mover is shut into a ring of 4 tiles plus the (7,0) pocket: 5 tiles in all,
    // so every 5-step walk revisits a tile. The two that exist lap the ring and
    // cross the start tile after 4 steps.
    const walls = set(tile(4, 0), tile(4, 1), tile(5, 2), tile(6, 2), CRUISE);
    expect(reach(tile(5, 0), 5, walls)).toEqual(sorted([tile(6, 0), tile(5, 1)]));
  });

  it("a loop cannot end on the start tile", () => {
    const from = tile(5, 8);
    const dests = reach(from, 4);
    expect(dests).not.toContain(from);
    expect(dests).toContain(tile(5, 4)); // straight line
    expect(dests).toContain(tile(5, 6)); // distance 2, by a detour
  });

  it("the start tile is never a destination", () => {
    for (const from of ALL_TILES) {
      for (const steps of STEP_COUNTS) expect(reach(from, steps)).not.toContain(from);
    }
  });
});

describe("reachableDestinations: island and board edge", () => {
  it("cannot step onto the island", () => {
    expect(reach(tile(2, 11), 1)).toEqual(sorted([tile(2, 10), tile(1, 11)]));
  });

  it("cannot cut through the island", () => {
    expect(reach(tile(1, 12), 2)).not.toContain(tile(3, 12));
    // (5,12) is 4 columns from (1,12); going round takes far more than 4 steps.
    expect(reach(tile(1, 12), 4)).not.toContain(tile(5, 12));
  });

  it("does not wrap round the board edge", () => {
    expect(reach(tile(0, 7), 1)).toEqual(sorted([tile(0, 6), tile(1, 7), tile(0, 8)]));
    expect(reach(tile(7, 8), 1)).toEqual(sorted([tile(7, 7), tile(7, 9), tile(6, 8)]));
  });

  it("never ends on an island or off-board tile", () => {
    for (const from of ALL_TILES) {
      for (const steps of STEP_COUNTS) {
        for (const to of reach(from, steps)) {
          expect(board.tiles[to]).not.toBeNull();
          expect(board.tiles[to]!.terrain).not.toBe("island");
        }
      }
    }
  });
});

describe("reachableDestinations: other ships", () => {
  it("cannot end on another ship", () => {
    expect(reach(START_RIGHT, 1, set(tile(5, 19)))).toEqual([tile(4, 18)]);
  });

  it("cannot pass through another ship", () => {
    expect(reach(START_RIGHT, 2)).toEqual(sorted([tile(3, 18), tile(5, 18), tile(4, 17)]));
    expect(reach(START_RIGHT, 2, set(tile(4, 18)))).toEqual([tile(5, 18)]);
  });

  it("a ship that is not on any route changes nothing", () => {
    expect(reach(START_RIGHT, 3, set(tile(0, 4)))).toEqual(reach(START_RIGHT, 3));
  });

  it("a ship on the left starting dock's only exit blocks every roll", () => {
    for (const steps of STEP_COUNTS) {
      expect(reach(START_LEFT, steps, set(tile(3, 18)))).toEqual([]);
    }
  });

  it("two ships can leave the right starting dock with only a roll of 1", () => {
    const ships = set(tile(4, 18), tile(5, 18));
    expect(reach(START_RIGHT, 1, ships)).toEqual([tile(5, 19)]);
    for (const steps of STEP_COUNTS.slice(1)) expect(reach(START_RIGHT, steps, ships)).toEqual([]);
  });

  it("players waiting off the board are not obstacles", () => {
    const player = (id: string, position: TileId | null): PlayerState => ({
      id,
      cash: 0,
      fish: [],
      fineTokens: 0,
      upgrades: { speed: false, capacity: false },
      position,
      missedTurns: 0,
      removed: false,
    });
    const players = [player("a", START_LEFT), player("b", tile(3, 18)), player("c", null)];
    expect([...occupiedTiles(players, "a")]).toEqual([tile(3, 18)]);
    expect([...occupiedTiles(players, "b")]).toEqual([START_LEFT]);
  });
});

describe("reachableDestinations: docks", () => {
  it("a free dock is a legal last step (left dock to right dock is a roll of 3)", () => {
    expect(reach(START_LEFT, 3)).toEqual(
      sorted([tile(5, 18), tile(4, 17), START_RIGHT, tile(2, 17), tile(3, 16)]),
    );
  });

  it("cannot step straight from one dock to the next", () => {
    expect(reach(START_LEFT, 1)).not.toContain(START_RIGHT);
    expect(reach(START_RIGHT, 1)).toEqual(sorted([tile(4, 18), tile(5, 19)]));
    for (const steps of [1, 2]) {
      expect(reach(START_LEFT, steps)).not.toContain(START_RIGHT);
      expect(reach(START_RIGHT, steps)).not.toContain(START_LEFT);
    }
    expect(reach(START_RIGHT, 3)).toContain(START_LEFT);
  });

  it("a roll higher than the distance still reaches the dock", () => {
    expect(reach(START_LEFT, 2)).not.toContain(START_RIGHT);
    for (const steps of [3, 4, 6, 9]) expect(reach(START_LEFT, steps)).toContain(START_RIGHT);
    for (const steps of STEP_COUNTS) expect(reach(tile(7, 0), steps)).toContain(CRUISE);
    // (5,17) is 3 steps from the right starting dock.
    for (const steps of [1, 2]) expect(reach(tile(5, 17), steps)).not.toContain(START_RIGHT);
    for (const steps of STEP_COUNTS.slice(2)) {
      expect(reach(tile(5, 17), steps)).toContain(START_RIGHT);
    }
  });

  it("stopping early is only for docks: sea tiles still need the exact roll", () => {
    const dests = reach(START_LEFT, 6);
    expect(dests).toContain(START_RIGHT);
    expect(dests).not.toContain(tile(3, 18)); // 1 step away
    expect(dests).not.toContain(tile(4, 17)); // 3 steps away
    expect(dests).toContain(tile(3, 15)); // 4 steps away, reached in 6 by a detour
  });

  it("the path to a dock reached early is the short route and ends on the dock", () => {
    const dest = reachableDestinations(board, tile(5, 17), 9, set()).find(
      (d) => d.to === START_RIGHT,
    )!;
    expect(dest.path).toHaveLength(4);
    expect(dest.path[0]).toBe(tile(5, 17));
    expect(dest.path[3]).toBe(START_RIGHT);
  });

  it("cannot pass through a free dock", () => {
    // (7,2) is 2 steps from (7,0) only by crossing the cruise dock.
    expect(reach(tile(7, 0), 2)).toEqual(sorted([tile(5, 0), tile(6, 1), CRUISE]));
  });

  it("cannot pass through a taken dock", () => {
    expect(reach(tile(7, 0), 2, set(CRUISE))).toEqual(sorted([tile(5, 0), tile(6, 1)]));
  });

  it("cannot end on a taken dock", () => {
    expect(reach(tile(7, 0), 1)).toEqual(sorted([tile(6, 0), CRUISE]));
    expect(reach(tile(7, 0), 1, set(CRUISE))).toEqual([tile(6, 0)]);
    for (const steps of STEP_COUNTS) {
      expect(reach(START_LEFT, steps, set(START_RIGHT))).not.toContain(START_RIGHT);
    }
  });

  it("cannot come back to the dock it started on", () => {
    // The loop (4,18) -> (5,18) -> (5,19) -> dock is 4 steps.
    for (const steps of STEP_COUNTS) expect(reach(START_RIGHT, steps)).not.toContain(START_RIGHT);
  });

  it("can leave a dock in every open direction", () => {
    expect(reach(CRUISE, 1)).toEqual(sorted([tile(7, 0), tile(6, 1), tile(7, 2)]));
  });

  it("the pocket beside the right starting dock", () => {
    expect(reach(tile(5, 19), 1)).toEqual(sorted([tile(5, 18), START_RIGHT]));
    expect(reach(tile(5, 19), 1, set(START_RIGHT))).toEqual([tile(5, 18)]);
    expect(reach(tile(5, 19), 1, set(START_RIGHT, tile(5, 18)))).toEqual([]);
  });

  it("docking early rescues a roll that would otherwise be blocked", () => {
    for (const steps of STEP_COUNTS) {
      expect(reach(tile(5, 19), steps, set(tile(5, 18)))).toEqual([START_RIGHT]);
      expect(reach(tile(5, 19), steps, set(tile(5, 18), START_RIGHT))).toEqual([]);
    }
  });
});

describe("reachableDestinations: paths and output", () => {
  it("gives every destination a legal path, for every tile and roll", () => {
    for (const from of ALL_TILES) {
      for (const steps of STEP_COUNTS) {
        for (const { to, path } of reachableDestinations(board, from, steps, set())) {
          expect(path[path.length - 1]).toBe(to);
          expect(pathProblem(path, from, steps, set())).toBeNull();
        }
      }
    }
  });

  it("gives legal paths around other ships", () => {
    const ships = set(tile(4, 18), tile(4, 16), CRUISE);
    for (const from of [START_RIGHT, tile(5, 17), tile(7, 0), tile(3, 17)]) {
      for (const steps of STEP_COUNTS) {
        for (const { path } of reachableDestinations(board, from, steps, ships)) {
          expect(pathProblem(path, from, steps, ships)).toBeNull();
        }
      }
    }
  });

  it("returns unique destinations sorted by tile id, the same every time", () => {
    for (const from of [START_LEFT, CRUISE, tile(5, 8)]) {
      const a = reachableDestinations(board, from, 7, set(tile(4, 18)));
      const ids = a.map((d) => d.to);
      expect(ids).toEqual(sorted(new Set(ids)));
      expect(reachableDestinations(board, from, 7, set(tile(4, 18)))).toEqual(a);
    }
  });

  it("matches a brute-force walk of every route", () => {
    const starts = [START_LEFT, START_RIGHT, CRUISE, tile(5, 8), tile(2, 11), tile(5, 19)];
    const shipSets = [
      set(),
      set(tile(4, 18)),
      set(tile(5, 18), START_RIGHT),
      set(tile(6, 1), CRUISE),
      set(tile(5, 7), tile(1, 11)),
    ];
    for (const from of starts) {
      for (const ships of shipSets) {
        if (ships.has(from)) continue;
        for (const steps of [1, 2, 3, 4, 5, 6]) {
          expect(reach(from, steps, ships)).toEqual(oracle(from, steps, ships));
        }
      }
    }
  });
});
