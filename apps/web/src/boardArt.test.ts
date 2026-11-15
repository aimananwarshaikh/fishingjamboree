import { describe, expect, it } from "vitest";
import type { Action } from "@fishingjamboree/engine";
import { loadBundledContent } from "./content";
import {
  ART,
  boardTargets,
  shareOffset,
  shipCentre,
  shipMarks,
  tileCentre,
  tileOrigin,
  viewBox,
} from "./boardArt";
import type { Frame, ShipPose } from "./animation";

const content = loadBundledContent();
const { board } = content;
const tileXY = (id: number) => {
  const t = board.tiles[id];
  return t ? { x: t.x, y: t.y } : null;
};
const tileAt = (x: number, y: number) => board.tiles.find((t) => t && t.x === x && t.y === y)!.id;
const still = (tile: number): ShipPose => ({ tile, to: null, t: 0, opacity: 1 });

describe("board art geometry", () => {
  it("matches the art and the board's grid", () => {
    expect(board.width).toBe(8);
    expect(board.height).toBe(20);
    expect(ART.tile * board.height).toBeCloseTo(ART.height, 6);
    expect(ART.originX + board.width * ART.tile).toBeLessThanOrEqual(ART.width);
  });

  it("shows the whole art, with the whole grid inside it", () => {
    const box = viewBox();
    expect(box).toEqual({ x: 0, y: 0, width: ART.width, height: ART.height });
    expect(ART.originX + board.width * ART.tile).toBeLessThanOrEqual(box.width);
  });

  it("places tiles on the grid", () => {
    expect(tileOrigin(0, 0)).toEqual({ x: ART.originX, y: 0 });
    const c = tileCentre(7, 19);
    expect(c.x).toBeCloseTo(ART.originX + 7.5 * ART.tile, 6);
    expect(c.y).toBeCloseTo(19.5 * ART.tile, 6);
  });

  it("draws a sailing ship between its two tiles", () => {
    const a = tileAt(2, 5);
    const b = tileAt(2, 6);
    const half = shipCentre({ tile: a, to: b, t: 0.5, opacity: 1 }, tileXY)!;
    expect(half.x).toBeCloseTo(tileCentre(2, 5).x, 6);
    expect(half.y).toBeCloseTo(6 * ART.tile, 6);
    expect(shipCentre(still(a), tileXY)).toEqual(tileCentre(2, 5));
    expect(shipCentre(still(99_999), tileXY)).toBeNull();
  });

  it("puts ships sharing a tile in different corners", () => {
    expect(shareOffset(0, 1)).toEqual({ x: 0, y: 0 });
    const four = [0, 1, 2, 3].map((i) => JSON.stringify(shareOffset(i, 4)));
    expect(new Set(four).size).toBe(4);
    for (const i of [0, 1, 2, 3]) {
      const o = shareOffset(i, 4);
      expect(Math.abs(o.x)).toBeLessThan(ART.tile / 2);
      expect(Math.abs(o.y)).toBeLessThan(ART.tile / 2);
    }
  });
});

describe("boardTargets", () => {
  it("maps move destinations and starting docks to the action they send", () => {
    const left = board.docks.find((d) => d.id === "start-left")!;
    const legal: Action[] = [
      { type: "move", player: "p1", to: 42 },
      { type: "placeShip", player: "p1", dock: "start-left" },
      { type: "roll", player: "p1" },
    ];
    const t = boardTargets(content, legal);
    expect([...t.keys()].sort((a, b) => a - b)).toEqual([42, left.tile].sort((a, b) => a - b));
    expect(t.get(left.tile)).toEqual(legal[1]);
  });
});

describe("shipMarks", () => {
  const frame = (ships: [string, ShipPose][]): Frame => ({
    current: null,
    ships: new Map(ships),
    goldenFish: null,
    busy: false,
    revealing: false,
  });

  it("draws every ship in the frame, sharing a tile at rest", () => {
    const dock = board.docks.find((d) => d.id === "start-right")!.tile;
    const marks = shipMarks(
      content,
      frame([
        ["p1", still(dock)],
        ["p2", still(dock)],
        ["p3", { tile: tileAt(2, 5), to: tileAt(2, 6), t: 0.5, opacity: 0.5 }],
      ]),
      ["p1", "p2", "p3", "p4"],
    );
    expect(marks.map((m) => m.player)).toEqual(["p1", "p2", "p3"]);
    expect(marks[0]!.x).not.toBe(marks[1]!.x);
    expect(marks[2]).toMatchObject({ settled: false, opacity: 0.5 });
    expect(marks[2]!.y).toBeCloseTo(6 * ART.tile, 6);
  });
});
