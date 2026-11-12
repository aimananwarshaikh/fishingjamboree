/**
 * Seeded RNG (docs/architecture.md section 8): sfc32 seeded from cyrb128.
 *
 * Every function is pure: it takes an `RngState` and returns the value with
 * the next state. Only 32-bit integer maths is used, so results are identical
 * in every JS runtime.
 */
import type { RngState } from "./types";

/** cyrb128: hashes a string to four unsigned 32-bit words. */
export function cyrb128(text: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** One sfc32 step: an unsigned 32-bit value and the next state. */
export function nextUint32(rng: RngState): [number, RngState] {
  let [a, b, c, d] = rng;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]];
}

/** Rounds discarded after seeding so similar seeds diverge. */
const WARM_UP = 15;

export function seedRng(seed: string): RngState {
  let rng = cyrb128(seed);
  for (let i = 0; i < WARM_UP; i++) rng = nextUint32(rng)[1];
  return rng;
}

const UINT32_RANGE = 2 ** 32;

/** Uniform integer in `[0, n)` by rejection sampling (no modulo bias). */
export function randomInt(rng: RngState, n: number): [number, RngState] {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new Error(`randomInt: bad range ${n}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let state = rng;
  for (;;) {
    const [x, next] = nextUint32(state);
    state = next;
    if (x < limit) return [x % n, state];
  }
}

/** A die roll in `[1, sides]`. */
export function rollDie(rng: RngState, sides: number): [number, RngState] {
  const [x, next] = randomInt(rng, sides);
  return [x + 1, next];
}

/** Fisher–Yates. Returns a new array; the input is not changed. */
export function shuffle<T>(items: readonly T[], rng: RngState): [T[], RngState] {
  const out = items.slice();
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = randomInt(state, i + 1);
    state = next;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, state];
}
