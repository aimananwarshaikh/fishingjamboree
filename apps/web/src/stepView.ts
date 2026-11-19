/**
 * Pure helpers for the step components (B2b): which art file a card, token or
 * bill uses, and the numbers that turn a step's `progress` (0-1) into what is
 * drawn. No React, no clock. The components (`StepViews.tsx`) only apply
 * these results as styles, so every look can be tested here.
 *
 * Art paths are relative to `assets/web/` without extension (`artUrls.ts`
 * turns them into URLs); `scripts/make-web-art.mjs` writes those files.
 */
import type { AwardResult, CardId, DrawDeckId, Money, UpgradeId } from "@fishingjamboree/engine";

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

/** Card id (content/cards.json) to its art file. Every card in the content must be here. */
const CARD_ART: Record<CardId, string> = {
  boot: "cards/safe-risk/boot",
  "fish+1": "cards/safe-risk/fish-plus-1",
  "fish+2": "cards/safe-risk/fish-plus-2",
  "fish+3": "cards/safe-risk/fish-plus-3",
  "fine-100": "cards/safe-risk/fine-100-sad-dolphin",
  "fine-200": "cards/safe-risk/fine-200-sadder-dolphin",
  "fish-300": "cards/safe-risk/fish-300-swordfish",
  "fish-500": "cards/safe-risk/fish-500-yellowfin-tuna",
  "fish-700": "cards/safe-risk/fish-700-red-dragon",
  shark: "cards/safe-risk/shark",
  "sinking-boat": "cards/safe-risk/sinking-boat",
  "golden-fish-1": "cards/event/golden-fish-spot-1",
  "golden-fish-2": "cards/event/golden-fish-spot-2",
  "golden-fish-3": "cards/event/golden-fish-spot-3",
  "catch-bonus-1": "cards/event/plus-catch-zone-1",
  "catch-bonus-2": "cards/event/plus-catch-zone-2",
  "catch-bonus-3": "cards/event/plus-catch-zone-3",
  "movement+1": "cards/event/movement-plus-1",
  "movement-1": "cards/event/movement-minus-1",
  helicopter: "cards/event/helicopter",
  "shark-repellent": "cards/event/shark-repellent",
  tsunami: "cards/event/tsunami",
};

export const CARD_BACKS: Record<DrawDeckId | "event", string> = {
  safe: "cards/backs/safe",
  risk: "cards/backs/risk",
  event: "cards/backs/event",
};

/** The face of a card, or `null` for a card with no art (the caller then shows its name). */
export function cardArt(card: CardId): string | null {
  return CARD_ART[card] ?? null;
}

export const cardIds = (): CardId[] => Object.keys(CARD_ART);

const FISH_TOKEN_VALUES = [100, 300, 500, 700, 1000];

/** The fish token for a fish worth `value`, or `null` for a value with no token. */
export function fishTokenArt(value: Money): string | null {
  return FISH_TOKEN_VALUES.includes(value) ? `tokens/fish-${value}` : null;
}

export const FINE_TOKEN_ART = "tokens/fine-100";

export function upgradeTokenArt(upgrade: UpgradeId): string {
  return `tokens/upgrade-${upgrade}`;
}

export const GOLDEN_FISH_ART = "tokens/fish-1000";

export const BILL_100 = "money/bill-100";
export const BILL_500 = "money/bill-500";

/** Every art path the components can ask for (the files test checks them all). */
export function allArtPaths(): string[] {
  return [
    ...Object.values(CARD_ART),
    ...Object.values(CARD_BACKS),
    ...FISH_TOKEN_VALUES.map((v) => `tokens/fish-${v}`),
    FINE_TOKEN_ART,
    upgradeTokenArt("speed"),
    upgradeTokenArt("capacity"),
    BILL_100,
    BILL_500,
  ];
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface BillStack {
  /** Bill art, largest first, at most `max`. */
  bills: string[];
  /** Money not drawn because of the cap. */
  hidden: Money;
}

/**
 * Bills for an amount: $500 bills first, then $100. Capped at `max` bills
 * (the biggest ones are kept); `hidden` is the money left out, to be written
 * as text. Money is always whole hundreds (`compileContent` checks it).
 */
export function billStack(amount: Money, max = 6): BillStack {
  const all: string[] = [];
  let left = Math.max(0, Math.floor(amount / 100) * 100);
  while (left >= 500) {
    all.push(BILL_500);
    left -= 500;
  }
  while (left >= 100) {
    all.push(BILL_100);
    left -= 100;
  }
  const bills = all.slice(0, max);
  const shown = bills.reduce((sum, b) => sum + (b === BILL_500 ? 500 : 100), 0);
  return { bills, hidden: Math.max(0, Math.floor(amount / 100) * 100 - shown) };
}

/** Fish tokens to draw from a list of fish values: those with art, at most `max`, and how many were left out. */
export function fishTokens(values: Money[], max = 8): { art: string[]; hidden: number } {
  const art = values.map(fishTokenArt).filter((a): a is string => a !== null);
  return { art: art.slice(0, max), hidden: Math.max(0, values.length - Math.min(art.length, max)) };
}

// ---------------------------------------------------------------------------
// Progress to look
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Fade in over the first `inEnd` of the step, hold, fade out over the part
 * after `outStart`. 0 to 1 to 0. `inEnd` 0 means no fade in; `outStart` 1, none out.
 */
export function envelope(progress: number, inEnd = 0.15, outStart = 0.85): number {
  const p = clamp01(progress);
  if (inEnd > 0 && p < inEnd) return p / inEnd;
  if (outStart < 1 && p > outStart) return (1 - p) / (1 - outStart);
  return 1;
}

/** A pop-in: grows from 0.6 to 1 as `envelope` rises, so things arrive instead of appearing. */
export function popScale(opacity: number): number {
  return 0.6 + 0.4 * clamp01(opacity);
}

/**
 * The face the die shows. It tumbles through faces for the first
 * `TUMBLE_END` of the step (same sequence every time: no randomness here) and
 * then rests on the rolled value.
 */
export const TUMBLE_END = 0.6;
export function diceFace(progress: number, die: number, sides = 6): number {
  if (progress >= TUMBLE_END) return die;
  const tick = Math.floor((clamp01(progress) / TUMBLE_END) * 9);
  const face = ((tick * 5 + 2) % sides) + 1;
  // Never let the last tumble face equal the result, which would look like a stall.
  return face === die && tick >= 8 ? (face % sides) + 1 : face;
}

/** The die's rotation in degrees: spinning while it tumbles, level after. */
export function diceAngle(progress: number): number {
  if (progress >= TUMBLE_END) return 0;
  const k = clamp01(progress) / TUMBLE_END;
  return (1 - k) * 540;
}

/** Pips of a die face as [column, row] cells of a 3x3 grid (0-2). */
export function pips(face: number): [number, number][] {
  const c = 1;
  const l = 0;
  const r = 2;
  switch (face) {
    case 1:
      return [[c, c]];
    case 2:
      return [
        [l, l],
        [r, r],
      ];
    case 3:
      return [
        [l, l],
        [c, c],
        [r, r],
      ];
    case 4:
      return [
        [l, l],
        [r, l],
        [l, r],
        [r, r],
      ];
    case 5:
      return [
        [l, l],
        [r, l],
        [c, c],
        [l, r],
        [r, r],
      ];
    case 6:
      return [
        [l, l],
        [r, l],
        [l, c],
        [r, c],
        [l, r],
        [r, r],
      ];
    default:
      return [];
  }
}

export interface CardFlip {
  /** 0 shows the back, 180 the face. */
  angle: number;
  opacity: number;
  scale: number;
}

/**
 * A card arriving: the back fades in, holds, turns over, shows its face, and
 * fades out. With no back (`flip` false) the face just fades in and out.
 * Back 0-0.15 in, turns 0.3-0.5, face held until 0.85, then out.
 */
export function cardFlip(progress: number, flip = true): CardFlip {
  const p = clamp01(progress);
  const opacity = envelope(p, 0.15, 0.85);
  // The back shows briefly, then the face holds from 0.3 to the fade-out (B7: about 1.2 s of a 2.2 s card).
  const angle = !flip ? 180 : p <= 0.12 ? 0 : p >= 0.3 ? 180 : ((p - 0.12) / 0.18) * 180;
  return { angle, opacity, scale: popScale(opacity) };
}

// ---------------------------------------------------------------------------
// Awards reveal
// ---------------------------------------------------------------------------

export interface AwardLook {
  /** Name and text of the award. */
  titleOpacity: number;
  /** The winners and the amount appear after a beat of suspense. */
  resultOpacity: number;
  /** The winners are showing (for tests and `aria`). */
  revealed: boolean;
}

export const AWARD_REVEAL_AT = 0.4;

/** One award: the name comes first, the winners after `AWARD_REVEAL_AT`, then all of it holds to the end. */
export function awardLook(progress: number): AwardLook {
  const p = clamp01(progress);
  return {
    titleOpacity: envelope(p, 0.1, 1),
    resultOpacity:
      p < AWARD_REVEAL_AT ? 0 : envelope((p - AWARD_REVEAL_AT) / (1 - AWARD_REVEAL_AT), 0.15, 1),
    revealed: p >= AWARD_REVEAL_AT,
  };
}

/** "Award 2 of 3" for the award being shown (`null` if it is not in the list). */
export function awardPosition(
  awards: AwardResult[],
  award: AwardResult,
): { n: number; of: number } | null {
  const i = awards.findIndex((a) => a.award === award.award);
  return i < 0 ? null : { n: i + 1, of: awards.length };
}

// ---------------------------------------------------------------------------
// Round bar
// ---------------------------------------------------------------------------

export interface RoundBar {
  /** Share of the game played (the round in progress counts as played). */
  fill: number;
  marks: { after: number; at: number; passed: boolean }[];
}

/** The "Round N/20" bar: how full it is and the three event marks (after rounds 5, 10, 15). */
export function roundBar(round: number, rounds: number, eventAfter: number[]): RoundBar {
  const total = Math.max(1, rounds);
  return {
    fill: clamp01(round / total),
    marks: eventAfter.map((after) => ({
      after,
      at: clamp01(after / total),
      passed: round > after,
    })),
  };
}

/**
 * Progress of item `index` of `count` that arrive one after another: the
 * first starts at 0, the last at `spread`, all end together at 1.
 */
export function stagger(progress: number, index: number, count: number, spread = 0.4): number {
  const delay = count <= 1 ? 0 : (index / (count - 1)) * spread;
  return clamp01((clamp01(progress) - delay) / (1 - spread));
}
