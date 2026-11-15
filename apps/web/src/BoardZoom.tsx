/**
 * Zoom for the board (B4): the state, the touch and mouse gestures, the
 * auto-follow, and the small toolbar. The maths is in boardView.ts (pure and
 * tested); this file only reads pointer events and calls it.
 *
 * - Pinch with two fingers, drag with one finger when zoomed, double tap (or
 *   double click) to zoom in on a point and again to go back out.
 * - Buttons: My ship, Whole board, + and -.
 * - "Follow my turn" (on by default on phones): on my decision the view goes to
 *   my ship and the tiles I can tap; on other players' turns it shows the
 *   whole board. A gesture or button of mine holds until the next change of
 *   turn or phase.
 * Nothing here touches the game, the animation queue or the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  DRAG_PX,
  FIT_VIEW,
  distance,
  doubleTapView,
  followView,
  gestureStep,
  isDoubleTap,
  isZoomed,
  lerpView,
  midpoint,
  viewBoxOf,
  zoomAbout,
} from "./boardView";
import type { BoardView, Box, Pt, Tap } from "./boardView";
import { ART } from "./boardArt";

const TWEEN_MS = 220;
/** Width used before the board has been measured (a phone). */
const FALLBACK_WIDTH = 390;

export interface ZoomInput {
  /** My ship's tile centre in art pixels; null while off the board. */
  ship: Pt | null;
  /** Centres of the tiles I can tap now (art pixels). */
  targets: Pt[];
  /** It is my decision. */
  myDecision: boolean;
  /** Changes whenever the view should be re-aimed (turn, phase, my position). */
  signature: string;
  reducedMotion: boolean;
}

export interface BoardZoom {
  box: Box;
  zoomed: boolean;
  follow: boolean;
  setFollow: (on: boolean) => void;
  svgRef: React.RefObject<SVGSVGElement>;
  svgProps: {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onClickCapture: (e: ReactMouseEvent<SVGSVGElement>) => void;
    style: { touchAction: string };
  };
  toShip: () => void;
  toFit: () => void;
  zoomBy: (factor: number) => void;
  canShip: boolean;
}

/** Phones and narrow windows (the single-column layout) follow by default. */
function followByDefault(): boolean {
  try {
    return window.matchMedia("(max-width: 799px)").matches;
  } catch {
    return false;
  }
}

export function useBoardZoom(input: ZoomInput): BoardZoom {
  const [view, setView] = useState<BoardView>(FIT_VIEW);
  const [follow, setFollow] = useState(followByDefault);
  const viewRef = useRef(view);
  const svgRef = useRef<SVGSVGElement>(null);
  const tween = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;

  const width = useCallback(() => {
    const w = svgRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? w : FALLBACK_WIDTH;
  }, []);

  const set = useCallback((v: BoardView) => {
    window.cancelAnimationFrame(tween.current);
    viewRef.current = v;
    setView(v);
  }, []);

  const animateTo = useCallback(
    (to: BoardView) => {
      window.cancelAnimationFrame(tween.current);
      const from = viewRef.current;
      if (inputRef.current.reducedMotion) return set(to);
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / TWEEN_MS);
        const eased = 1 - (1 - t) * (1 - t);
        const v = lerpView(from, to, eased);
        viewRef.current = v;
        setView(v);
        if (t < 1) tween.current = window.requestAnimationFrame(frame);
      };
      tween.current = window.requestAnimationFrame(frame);
    },
    [set],
  );

  useEffect(() => () => window.cancelAnimationFrame(tween.current), []);

  // Auto-follow: re-aim when the signature changes (and when it is switched on).
  const { signature } = input;
  useEffect(() => {
    if (!follow) return;
    const i = inputRef.current;
    if (i.myDecision && i.ship) animateTo(followView(i.ship, i.targets, width()));
    else animateTo(FIT_VIEW);
  }, [follow, signature, animateTo, width]);

  // Gestures.
  const pointers = useRef(new Map<number, Pt>());
  const origins = useRef(new Map<number, Pt>());
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const lastTap = useRef<Tap | null>(null);

  const local = (e: ReactPointerEvent<SVGSVGElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    origins.current.set(e.pointerId, p);
    if (pointers.current.size > 1) {
      dragging.current = true;
      suppressClick.current = true;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = local(e);
    const w = width();
    if (pointers.current.size >= 2) {
      const other = [...pointers.current].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const scale = distance(next, other) / Math.max(1, distance(prev, other));
      pointers.current.set(e.pointerId, next);
      set(gestureStep(viewRef.current, midpoint(prev, other), midpoint(next, other), scale, w));
      return;
    }
    // One finger or the mouse: a drag, but only once it is clearly not a tap.
    if (!dragging.current) {
      const o = origins.current.get(e.pointerId) ?? prev;
      if (distance(o, next) < DRAG_PX) return;
      // At the whole board there is nothing to pan: the page scrolls instead.
      if (!isZoomed(viewRef.current)) return;
      dragging.current = true;
      suppressClick.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // a pointer that is already gone; the drag simply ends
      }
    }
    pointers.current.set(e.pointerId, next);
    set(gestureStep(viewRef.current, prev, next, 1, w));
  };

  const end = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    const wasTap = !dragging.current && pointers.current.size === 1 && !cancelled;
    pointers.current.delete(e.pointerId);
    origins.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      dragging.current = false;
      // the click that follows this pointerup is still suppressed; clear after it
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    if (!wasTap) return;
    const onTarget = e.target instanceof Element && e.target.closest(".target") !== null;
    if (onTarget) {
      lastTap.current = null;
      return;
    }
    const tap: Tap = { at: p, time: e.timeStamp };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      animateTo(doubleTapView(viewRef.current, p, width()));
    } else {
      lastTap.current = tap;
    }
  };

  const onClickCapture = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const centre = (): Pt => {
    const w = width();
    return { x: w / 2, y: (w * ART.height) / ART.width / 2 };
  };

  return {
    box: viewBoxOf(view),
    zoomed: isZoomed(view),
    follow,
    setFollow,
    svgRef,
    svgProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => end(e, false),
      onPointerCancel: (e) => end(e, true),
      onClickCapture,
      // Zoomed: every touch on the board is ours. At the whole board the page
      // may scroll vertically; a pinch still reaches us (it is not allowed here).
      style: { touchAction: isZoomed(view) ? "none" : "pan-y" },
    },
    toShip: () => {
      const i = inputRef.current;
      if (i.ship) animateTo(followView(i.ship, i.myDecision ? i.targets : [], width()));
    },
    toFit: () => animateTo(FIT_VIEW),
    zoomBy: (factor) => animateTo(zoomAbout(viewRef.current, factor, centre(), width())),
    canShip: input.ship !== null,
  };
}

/** The zoom buttons and the "Follow my turn" switch, above the board. */
export function ZoomTools({ zoom }: { zoom: BoardZoom }) {
  return (
    <div className="board-tools" role="group" aria-label="Board zoom">
      <button
        type="button"
        className="secondary"
        disabled={!zoom.canShip}
        onClick={zoom.toShip}
        data-zoom="ship"
      >
        My ship
      </button>
      <button
        type="button"
        className="secondary"
        disabled={!zoom.zoomed}
        onClick={zoom.toFit}
        data-zoom="fit"
      >
        Whole board
      </button>
      <button
        type="button"
        className="secondary icon"
        aria-label="Zoom in"
        onClick={() => zoom.zoomBy(1.4)}
        data-zoom="in"
      >
        +
      </button>
      <button
        type="button"
        className="secondary icon"
        aria-label="Zoom out"
        disabled={!zoom.zoomed}
        onClick={() => zoom.zoomBy(1 / 1.4)}
        data-zoom="out"
      >
        −
      </button>
      <label className="follow">
        <input
          type="checkbox"
          checked={zoom.follow}
          onChange={(e) => zoom.setFollow(e.target.checked)}
        />
        Follow my turn
      </label>
    </div>
  );
}
