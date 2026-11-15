/**
 * Where content/board.json's tiles sit on the board art (assets/board/board.webp).
 * Pure numbers, so they can be tested. The same numbers are in
 * scripts/render-board.mjs, which draws the trace over the art to check it.
 *
 * The art is 1378x1969. The 8x20 grid starts at x = 293 and fills the height,
 * so a tile is 1969 / 20 = 98.45 px. The printed round track is the strip on
 * the left (its circles end near x = 110). The digital board hides it (decided
 * 2026-11-12): until the designer's PNG without that layer arrives (question 7
 * in docs/next-steps.md), the view box crops it off and keeps a margin of art
 * either side of the grid.
 */
import type { Action, Content, PlayerId, TileId } from "@fishingjamboree/engine";
import type { Frame, ShipPose } from "./animation";

export const ART = {
  width: 1378,
  height: 1969,
  originX: 293,
  originY: 0,
  tile: 1969 / 20,
} as const;

/** Art kept either side of the grid, in art pixels. */
export const MARGIN_X = 50;

/** The part of the art shown: the grid plus a margin, round track cropped off. */
export function viewBox(boardWidth: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = Math.max(0, ART.originX - MARGIN_X);
  const right = Math.min(ART.width, ART.originX + boardWidth * ART.tile + MARGIN_X);
  return { x, y: 0, width: right - x, height: ART.height };
}

/** Top-left corner of tile (x, y), in art pixels. */
export function tileOrigin(x: number, y: number): { x: number; y: number } {
  return { x: ART.originX + x * ART.tile, y: ART.originY + y * ART.tile };
}

/** Centre of tile (x, y), in art pixels. */
export function tileCentre(x: number, y: number): { x: number; y: number } {
  const o = tileOrigin(x, y);
  return { x: o.x + ART.tile / 2, y: o.y + ART.tile / 2 };
}

/** Where a ship's centre is drawn for a pose, in art pixels. `tileXY` maps a tile id to its grid cell. */
export function shipCentre(
  pose: ShipPose,
  tileXY: (tile: number) => { x: number; y: number } | null,
): { x: number; y: number } | null {
  const a = tileXY(pose.tile);
  if (!a) return null;
  const from = tileCentre(a.x, a.y);
  if (pose.to === null) return from;
  const b = tileXY(pose.to);
  if (!b) return from;
  const to = tileCentre(b.x, b.y);
  return { x: from.x + (to.x - from.x) * pose.t, y: from.y + (to.y - from.y) * pose.t };
}

/** Ships sharing a tile are drawn in its corners: offset of ship `index` of `count` there, in art pixels. */
export function shareOffset(index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: 0, y: 0 };
  const d = ART.tile * 0.22;
  const corners = [
    { x: -d, y: -d },
    { x: d, y: d },
    { x: d, y: -d },
    { x: -d, y: d },
  ];
  return corners[index % corners.length]!;
}

/** Tiles a click acts on: move destinations and starting docks to place a ship on. */
export function boardTargets(content: Content, legal: Action[]): Map<TileId, Action> {
  const targets = new Map<TileId, Action>();
  for (const a of legal) {
    if (a.type === "move") targets.set(a.to, a);
    if (a.type === "placeShip") {
      const dock = content.board.docks.find((d) => d.id === a.dock);
      if (dock) targets.set(dock.tile, a);
    }
  }
  return targets;
}

export interface ShipMark {
  player: PlayerId;
  /** Centre, in art pixels. */
  x: number;
  y: number;
  opacity: number;
  /** Still on a tile (not sailing between two). */
  settled: boolean;
}

/** Where to draw each ship in a frame, in seat order; ships at rest on one tile share it. */
export function shipMarks(content: Content, frame: Frame, order: PlayerId[]): ShipMark[] {
  const tileXY = (id: number) => {
    const t = content.board.tiles[id];
    return t ? { x: t.x, y: t.y } : null;
  };
  const resting = new Map<TileId, PlayerId[]>();
  for (const p of order) {
    const pose = frame.ships.get(p);
    if (pose && pose.to === null) resting.set(pose.tile, [...(resting.get(pose.tile) ?? []), p]);
  }
  const marks: ShipMark[] = [];
  for (const p of order) {
    const pose = frame.ships.get(p);
    if (!pose) continue;
    const c = shipCentre(pose, tileXY);
    if (!c) continue;
    let { x, y } = c;
    if (pose.to === null) {
      const here = resting.get(pose.tile) ?? [];
      const off = shareOffset(here.indexOf(p), here.length);
      x += off.x;
      y += off.y;
    }
    marks.push({ player: p, x, y, opacity: pose.opacity, settled: pose.to === null });
  }
  return marks;
}
