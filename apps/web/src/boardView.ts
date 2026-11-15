/**
 * Zoom and pan for the board (B4). Pure maths, no React and no DOM, so it can be tested.
 *
 * A `BoardView` is the part of the art that is shown: a centre in art pixels
 * and a zoom (1 = the whole art, edge to edge). The window keeps the art's
 * aspect ratio, so the board's container never changes shape; only the SVG's
 * `viewBox` does. Ships, targets and the Golden Fish are drawn in art pixels
 * inside that SVG, so they stay lined up with the board at every zoom, and a
 * click on a target is the browser's own hit test of the zoomed drawing.
 *
 * "Screen" pixels below are CSS pixels inside the board's container
 * (0,0 = its top-left corner); `width` is the container's width in CSS pixels.
 * The scale from art to screen is `width / viewBox.width`.
 */
import { ART } from "./boardArt";

export interface BoardView {
  /** Centre of the shown part, in art pixels. */
  cx: number;
  cy: number;
  /** 1 = the whole art. */
  zoom: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest touch target the design asks for (CSS px). */
export const TOUCH_TILE_PX = 44;
/** A tile this big (CSS px) when the view follows my ship. */
export const FOLLOW_TILE_PX = 64;
/** The most a tile may be enlarged by following several targets (CSS px). */
export const FOLLOW_MAX_TILE_PX = 84;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** The whole art. */
export const FIT_VIEW: BoardView = { cx: ART.width / 2, cy: ART.height / 2, zoom: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keeps the zoom in range and the shown part inside the art. */
export function clampView(v: BoardView): BoardView {
  const zoom = clamp(Number.isFinite(v.zoom) ? v.zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const w = ART.width / zoom;
  const h = ART.height / zoom;
  const cx = clamp(Number.isFinite(v.cx) ? v.cx : ART.width / 2, w / 2, ART.width - w / 2);
  const cy = clamp(Number.isFinite(v.cy) ? v.cy : ART.height / 2, h / 2, ART.height - h / 2);
  return { cx, cy, zoom };
}

/** The SVG view box for a view. */
export function viewBoxOf(v: BoardView): Box {
  const c = clampView(v);
  const width = ART.width / c.zoom;
  const height = ART.height / c.zoom;
  return { x: c.cx - width / 2, y: c.cy - height / 2, width, height };
}

export function isZoomed(v: BoardView): boolean {
  return v.zoom > 1.01;
}

/** Size of a tile on screen, in CSS px. */
export function tilePx(v: BoardView, width: number): number {
  return (ART.tile * width * v.zoom) / ART.width;
}

/** The zoom at which a tile is `px` CSS px wide (not clamped). */
export function zoomForTilePx(px: number, width: number): number {
  return (px * ART.width) / (ART.tile * width);
}

/** The smallest zoom at which a tile is at least the touch size. */
export function touchZoom(width: number): number {
  return clamp(zoomForTilePx(TOUCH_TILE_PX, width), MIN_ZOOM, MAX_ZOOM);
}

/** The art point under a screen point. */
export function screenToArt(v: BoardView, s: Pt, width: number): Pt {
  const b = viewBoxOf(v);
  const k = b.width / width;
  return { x: b.x + s.x * k, y: b.y + s.y * k };
}

/**
 * One step of a pinch (or a plain drag, `scale` 1): the art point that was
 * under `prev` is put under `next`, with the zoom multiplied by `scale`.
 * The shown part never leaves the art, so a pan stops at the edge.
 */
export function gestureStep(
  v: BoardView,
  prev: Pt,
  next: Pt,
  scale: number,
  width: number,
): BoardView {
  const base = clampView(v);
  const a = screenToArt(base, prev, width);
  const zoom = clamp(
    base.zoom * (Number.isFinite(scale) && scale > 0 ? scale : 1),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const w = ART.width / zoom;
  const h = ART.height / zoom;
  const k = w / width;
  return clampView({ zoom, cx: a.x - next.x * k + w / 2, cy: a.y - next.y * k + h / 2 });
}

/** A drag of `dx`, `dy` screen px: the board moves with the finger. */
export function panBy(v: BoardView, dx: number, dy: number, width: number): BoardView {
  const mid = { x: width / 2, y: (width * ART.height) / ART.width / 2 };
  return gestureStep(v, mid, { x: mid.x + dx, y: mid.y + dy }, 1, width);
}

/** Zoom by `factor` keeping the art point under `at` where it is. */
export function zoomAbout(v: BoardView, factor: number, at: Pt, width: number): BoardView {
  return gestureStep(v, at, at, factor, width);
}

/** Zoom to `zoom` (1 = whole art) centred on an art point. */
export function focusOn(point: Pt, zoom: number): BoardView {
  return clampView({ cx: point.x, cy: point.y, zoom });
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The view for "my turn" (auto-follow, and the "My ship" button): my ship, and
 * the tiles I can tap, as large as is useful but never under the touch size.
 * Alone the ship gets `FOLLOW_TILE_PX`. With targets the view zooms out to
 * hold them all, down to the touch size; if they do not fit even then, the
 * ship stays in the middle and the rest is a pan away. `points` are tile
 * centres in art pixels.
 */
export function followView(ship: Pt, targets: Pt[], width: number): BoardView {
  const zMin = touchZoom(width);
  const zFollow = clamp(zoomForTilePx(FOLLOW_TILE_PX, width), zMin, MAX_ZOOM);
  if (targets.length === 0) return focusOn(ship, zFollow);
  const pts = [ship, ...targets];
  const half = ART.tile * 0.75;
  const x0 = Math.min(...pts.map((p) => p.x)) - half;
  const x1 = Math.max(...pts.map((p) => p.x)) + half;
  const y0 = Math.min(...pts.map((p) => p.y)) - half;
  const y1 = Math.max(...pts.map((p) => p.y)) + half;
  const fit = Math.min(ART.width / (x1 - x0), ART.height / (y1 - y0));
  const zMax = clamp(zoomForTilePx(FOLLOW_MAX_TILE_PX, width), zMin, MAX_ZOOM);
  const zoom = clamp(fit, zMin, Math.max(zMin, Math.min(zMax, zFollow * 1.4)));
  const fits = fit >= zoom;
  return fits ? focusOn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, zoom) : focusOn(ship, zoom);
}

/** A view part-way between two, for a short transition (zoom in steps of its logarithm). */
export function lerpView(a: BoardView, b: BoardView, t: number): BoardView {
  const k = clamp(t, 0, 1);
  if (k === 0) return clampView(a);
  if (k === 1) return clampView(b);
  const za = Math.log(a.zoom);
  const zb = Math.log(b.zoom);
  return clampView({
    cx: a.cx + (b.cx - a.cx) * k,
    cy: a.cy + (b.cy - a.cy) * k,
    zoom: Math.exp(za + (zb - za) * k),
  });
}

export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 32;
/** A finger that moves more than this (CSS px) is a drag, not a tap. */
export const DRAG_PX = 8;

export interface Tap {
  at: Pt;
  time: number;
}

/** Is `next` the second tap of a double tap that started with `prev`? */
export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  return next.time - prev.time <= DOUBLE_TAP_MS && distance(prev.at, next.at) <= DOUBLE_TAP_PX;
}

/**
 * What a double tap does: zoomed in -> the whole board; otherwise zoom in on
 * the tapped point (at the follow size). `at` is the tap in screen px.
 */
export function doubleTapView(v: BoardView, at: Pt, width: number): BoardView {
  if (isZoomed(v)) return FIT_VIEW;
  const target = screenToArt(v, at, width);
  return focusOn(target, clamp(zoomForTilePx(FOLLOW_TILE_PX, width), touchZoom(width), MAX_ZOOM));
}
