import { describe, expect, it } from "vitest";
import { ART, tileCentre } from "./boardArt";
import {
  FIT_VIEW,
  MAX_ZOOM,
  TOUCH_TILE_PX,
  clampView,
  distance,
  doubleTapView,
  focusOn,
  followView,
  gestureStep,
  isDoubleTap,
  isZoomed,
  lerpView,
  midpoint,
  panBy,
  screenToArt,
  tilePx,
  touchZoom,
  viewBoxOf,
  zoomAbout,
  zoomForTilePx,
} from "./boardView";

const W = 390;
const H = (W * ART.height) / ART.width;

function inside(v: ReturnType<typeof viewBoxOf>) {
  return (
    v.x >= -1e-6 &&
    v.y >= -1e-6 &&
    v.x + v.width <= ART.width + 1e-6 &&
    v.y + v.height <= ART.height + 1e-6
  );
}

describe("view box", () => {
  it("the fit view is the whole art", () => {
    expect(viewBoxOf(FIT_VIEW)).toEqual({ x: 0, y: 0, width: ART.width, height: ART.height });
    expect(isZoomed(FIT_VIEW)).toBe(false);
  });
  it("keeps the art's aspect ratio at every zoom", () => {
    for (const zoom of [1, 1.7, 2.5, 4]) {
      const b = viewBoxOf({ cx: 700, cy: 900, zoom });
      expect(b.width / b.height).toBeCloseTo(ART.width / ART.height, 9);
    }
  });
  it("clamps the zoom and keeps the window inside the art", () => {
    expect(clampView({ cx: 0, cy: 0, zoom: 99 }).zoom).toBe(MAX_ZOOM);
    expect(clampView({ cx: 0, cy: 0, zoom: 0.2 }).zoom).toBe(1);
    for (const v of [
      { cx: -500, cy: -500, zoom: 2 },
      { cx: 5000, cy: 5000, zoom: 3 },
      { cx: 10, cy: 1900, zoom: 1.3 },
    ]) {
      expect(inside(viewBoxOf(v))).toBe(true);
    }
  });
  it("survives NaN", () => {
    const b = viewBoxOf({ cx: NaN, cy: Infinity, zoom: NaN });
    expect(inside(b)).toBe(true);
  });
});

describe("tile size on screen", () => {
  it("is about 28 px at 390 px, fit (the reason for B4)", () => {
    expect(tilePx(FIT_VIEW, W)).toBeCloseTo(27.9, 1);
    expect(tilePx(FIT_VIEW, W)).toBeLessThan(TOUCH_TILE_PX);
  });
  it("touchZoom gives at least the touch size", () => {
    for (const w of [320, 360, 390, 430, 560, 800]) {
      const z = touchZoom(w);
      expect(z).toBeGreaterThanOrEqual(1);
      expect(tilePx({ cx: 0, cy: 0, zoom: z }, w)).toBeGreaterThanOrEqual(TOUCH_TILE_PX - 1e-9);
    }
  });
  it("zoomForTilePx inverts tilePx", () => {
    expect(tilePx({ cx: 0, cy: 0, zoom: zoomForTilePx(60, W) }, W)).toBeCloseTo(60, 9);
  });
});

describe("screenToArt", () => {
  it("maps the corners at fit and when zoomed", () => {
    expect(screenToArt(FIT_VIEW, { x: 0, y: 0 }, W)).toEqual({ x: 0, y: 0 });
    const br = screenToArt(FIT_VIEW, { x: W, y: H }, W);
    expect(br.x).toBeCloseTo(ART.width, 6);
    expect(br.y).toBeCloseTo(ART.height, 6);
    const z = { cx: 700, cy: 900, zoom: 2 };
    const c = screenToArt(z, { x: W / 2, y: H / 2 }, W);
    expect(c.x).toBeCloseTo(700, 6);
    expect(c.y).toBeCloseTo(900, 6);
  });
  it("a tile centre lands on the screen where the click target is drawn", () => {
    // The target rect is drawn at the tile in art pixels; its screen position
    // is the inverse of screenToArt, so a tap there hits that tile.
    const v = focusOn(tileCentre(3, 7), 2.4);
    const b = viewBoxOf(v);
    const k = W / b.width;
    const c = tileCentre(3, 7);
    const s = { x: (c.x - b.x) * k, y: (c.y - b.y) * k };
    const back = screenToArt(v, s, W);
    expect(back.x).toBeCloseTo(c.x, 6);
    expect(back.y).toBeCloseTo(c.y, 6);
    expect(s.x).toBeCloseTo(W / 2, 6);
  });
});

describe("pan and pinch", () => {
  it("a drag moves the board with the finger", () => {
    const v = { cx: 700, cy: 900, zoom: 2 };
    const a = { x: 100, y: 200 };
    const before = screenToArt(v, a, W);
    const moved = panBy(v, 40, -30, W);
    // the art point that was under the finger is now 40/-30 px away
    const k = viewBoxOf(moved).width / W;
    const after = screenToArt(moved, { x: a.x + 40, y: a.y - 30 }, W);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(k).toBeGreaterThan(0);
  });
  it("a pan stops at the edge", () => {
    const v = panBy({ cx: 700, cy: 900, zoom: 2 }, 100000, 100000, W);
    expect(inside(viewBoxOf(v))).toBe(true);
    expect(viewBoxOf(v).x).toBeCloseTo(0, 6);
    expect(viewBoxOf(v).y).toBeCloseTo(0, 6);
  });
  it("there is nothing to pan at fit", () => {
    expect(panBy(FIT_VIEW, 80, 80, W)).toEqual(FIT_VIEW);
  });
  it("a pinch keeps the point under the fingers' midpoint", () => {
    const v = { cx: 700, cy: 900, zoom: 1.8 };
    const prev = midpoint({ x: 100, y: 150 }, { x: 200, y: 150 });
    const next = midpoint({ x: 80, y: 140 }, { x: 260, y: 140 });
    const scale = distance({ x: 80, y: 140 }, { x: 260, y: 140 }) / 100;
    const out = gestureStep(v, prev, next, scale, W);
    expect(out.zoom).toBeCloseTo(1.8 * scale, 6);
    const a = screenToArt(v, prev, W);
    const b = screenToArt(out, next, W);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });
  it("zoomAbout keeps the anchor fixed, and zoom is limited both ways", () => {
    const v = { cx: 700, cy: 900, zoom: 2 };
    const at = { x: 300, y: 100 };
    const out = zoomAbout(v, 1.5, at, W);
    expect(out.zoom).toBeCloseTo(3, 9);
    const a = screenToArt(v, at, W);
    const b = screenToArt(out, at, W);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(zoomAbout(v, 50, at, W).zoom).toBe(MAX_ZOOM);
    expect(zoomAbout(v, 0.001, at, W)).toEqual(FIT_VIEW);
  });
  it("ignores a bad scale", () => {
    const v = { cx: 700, cy: 900, zoom: 2 };
    expect(gestureStep(v, { x: 5, y: 5 }, { x: 5, y: 5 }, NaN, W).zoom).toBe(2);
    expect(gestureStep(v, { x: 5, y: 5 }, { x: 5, y: 5 }, -3, W).zoom).toBe(2);
  });
});

describe("followView (my turn)", () => {
  const ship = tileCentre(4, 10);
  it("alone, the ship is centred and a tile is at least the touch size", () => {
    for (const w of [320, 390, 430]) {
      const v = followView(ship, [], w);
      expect(tilePx(v, w)).toBeGreaterThanOrEqual(TOUCH_TILE_PX - 1e-9);
      expect(v.cx).toBeCloseTo(ship.x, 6);
      expect(v.cy).toBeCloseTo(ship.y, 6);
    }
  });
  it("near an edge the window stays inside the art, with the ship in it", () => {
    for (const s of [tileCentre(0, 0), tileCentre(7, 19), tileCentre(0, 19)]) {
      const v = followView(s, [], W);
      const b = viewBoxOf(v);
      expect(inside(b)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(b.x);
      expect(s.x).toBeLessThanOrEqual(b.x + b.width);
      expect(s.y).toBeGreaterThanOrEqual(b.y);
      expect(s.y).toBeLessThanOrEqual(b.y + b.height);
    }
  });
  it("holds the targets when they fit at the touch size", () => {
    const targets = [tileCentre(4, 8), tileCentre(5, 9), tileCentre(4, 12)];
    const v = followView(ship, targets, W);
    const b = viewBoxOf(v);
    for (const p of [ship, ...targets]) {
      expect(p.x).toBeGreaterThan(b.x);
      expect(p.x).toBeLessThan(b.x + b.width);
      expect(p.y).toBeGreaterThan(b.y);
      expect(p.y).toBeLessThan(b.y + b.height);
    }
    expect(tilePx(v, W)).toBeGreaterThanOrEqual(TOUCH_TILE_PX - 1e-9);
  });
  it("never goes below the touch size, even if the targets are far apart (the ship stays shown)", () => {
    const targets = [tileCentre(0, 0), tileCentre(7, 19)];
    const v = followView(tileCentre(3, 9), targets, W);
    expect(tilePx(v, W)).toBeGreaterThanOrEqual(TOUCH_TILE_PX - 1e-9);
    const b = viewBoxOf(v);
    const s = tileCentre(3, 9);
    expect(s.x).toBeGreaterThan(b.x);
    expect(s.x).toBeLessThan(b.x + b.width);
    expect(s.y).toBeGreaterThan(b.y);
    expect(s.y).toBeLessThan(b.y + b.height);
  });
});

describe("lerpView", () => {
  it("starts and ends on the two views, and stays valid between", () => {
    const a = FIT_VIEW;
    const b = focusOn(tileCentre(5, 5), 3);
    expect(lerpView(a, b, 0)).toEqual(a);
    expect(lerpView(a, b, 1)).toEqual(clampView(b));
    for (const t of [0.1, 0.5, 0.9]) expect(inside(viewBoxOf(lerpView(a, b, t)))).toBe(true);
  });
});

describe("double tap", () => {
  const t0 = { at: { x: 100, y: 100 }, time: 1000 };
  it("needs two taps close in time and place", () => {
    expect(isDoubleTap(null, t0)).toBe(false);
    expect(isDoubleTap(t0, { at: { x: 110, y: 104 }, time: 1200 })).toBe(true);
    expect(isDoubleTap(t0, { at: { x: 110, y: 104 }, time: 1500 })).toBe(false);
    expect(isDoubleTap(t0, { at: { x: 190, y: 100 }, time: 1100 })).toBe(false);
  });
  it("zooms in on the tapped art point, then back out", () => {
    const at = { x: 300, y: 400 };
    const target = screenToArt(FIT_VIEW, at, W);
    const zoomed = doubleTapView(FIT_VIEW, at, W);
    expect(isZoomed(zoomed)).toBe(true);
    expect(tilePx(zoomed, W)).toBeGreaterThanOrEqual(TOUCH_TILE_PX - 1e-9);
    // the tapped point is now the centre, or as near as the art edge allows
    const b = viewBoxOf(zoomed);
    expect(target.x).toBeGreaterThanOrEqual(b.x);
    expect(target.x).toBeLessThanOrEqual(b.x + b.width);
    expect(doubleTapView(zoomed, at, W)).toEqual(FIT_VIEW);
  });
});
