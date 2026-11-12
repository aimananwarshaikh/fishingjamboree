/**
 * Table-driven movement tests generated from the real map (Session 3b):
 * every tile a ship can stand on, every step count 1-9, against the
 * brute-force oracle, with no other ships and with fixed sets of 1-3 ships.
 * Plus a performance check on the worst case (6 + 2 + 1 = 9 steps).
 */
import { describe, expect, it } from "vitest";
import { reachableDestinations } from "./movement";
import { board, CRUISE, oracle, START_RIGHT, tile } from "./testHelpers";
import type { TileId } from "./types";

const ALL_TILES: TileId[] = board.tiles.flatMap((t) =>
  t && t.terrain !== "island" ? [t.id] : [],
);
const STEP_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const SHIP_SETS: [string, TileId[]][] = [
  ["no other ships", []],
  ["1 ship beside the right starting dock", [tile(4, 18)]],
  ["2 ships boxing in the right starting dock", [tile(5, 18), START_RIGHT]],
  ["3 ships round the cruise dock", [tile(6, 1), CRUISE, tile(7, 2)]],
  ["3 ships in open sea", [tile(5, 7), tile(1, 11), tile(5, 9)]],
  ["2 ships by the island", [tile(2, 10), tile(1, 12)]],
];

const reach = (from: TileId, steps: number, ships: ReadonlySet<TileId>): TileId[] =>
  reachableDestinations(board, from, steps, ships).map((d) => d.to);

describe("reachableDestinations vs the brute-force oracle, every tile", () => {
  it("the board has tiles to test", () => {
    expect(ALL_TILES.length).toBeGreaterThan(100);
  });

  describe.each(SHIP_SETS)("%s", (_name, shipTiles) => {
    const ships = new Set(shipTiles);
    it.each(STEP_COUNTS)("%i steps", (steps) => {
      for (const from of ALL_TILES) {
        if (ships.has(from)) continue;
        expect(reach(from, steps, ships), `from tile ${from}`).toEqual(oracle(from, steps, ships));
      }
    });
  });
});

describe("reachableDestinations performance", () => {
  // Generous on purpose: the sweep takes well under a second on a normal machine.
  const LIMIT_MS = 10_000;

  it.each(SHIP_SETS)("whole-board sweep at 9 steps, %s, finishes inside the limit", (_n, tiles) => {
    const ships = new Set(tiles);
    const started = performance.now();
    let total = 0;
    for (const from of ALL_TILES) {
      if (!ships.has(from)) total += reachableDestinations(board, from, 9, ships).length;
    }
    const elapsed = performance.now() - started;
    expect(total).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });
});
