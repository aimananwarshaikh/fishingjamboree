import { describe, expect, it } from "vitest";
import { cyrb128, nextUint32, randomInt, rollDie, seedRng, shuffle } from "./rng";
import type { RngState } from "./types";

const isUint32 = (n: number) => Number.isInteger(n) && n >= 0 && n < 2 ** 32;

describe("rng", () => {
  // Pinned values: if these change, every saved game and replay breaks.
  it("is pinned to known values", () => {
    expect(cyrb128("fishing")).toEqual([1394646959, 46465028, 2061195588, 2189124559]);
    let rng = seedRng("fishing");
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [v, next] = nextUint32(rng);
      values.push(v);
      rng = next;
    }
    expect(values).toEqual([2691435457, 1922398782, 2745533015, 459783463]);

    rng = seedRng("fishing");
    const dice: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [d, next] = rollDie(rng, 6);
      dice.push(d);
      rng = next;
    }
    expect(dice).toEqual([2, 1, 6, 2, 3, 1, 4, 4, 4, 2]);
  });

  it("keeps its state as four unsigned 32-bit integers (plain JSON)", () => {
    let rng = seedRng("json");
    for (let i = 0; i < 1000; i++) {
      rng = nextUint32(rng)[1];
      expect(rng).toHaveLength(4);
      expect(rng.every(isUint32)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(rng))).toEqual(rng);
  });

  it("does not mutate the state it is given", () => {
    const rng = seedRng("immutable");
    const copy = [...rng];
    nextUint32(rng);
    randomInt(rng, 6);
    shuffle([1, 2, 3], rng);
    expect(rng).toEqual(copy);
  });

  it("gives different streams for different seeds", () => {
    expect(nextUint32(seedRng("a"))[0]).not.toBe(nextUint32(seedRng("b"))[0]);
    expect(seedRng("")).toHaveLength(4);
  });

  it("rolls a fair die", () => {
    let rng = seedRng("fair-die");
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const [d, next] = rollDie(rng, 6);
      rng = next;
      counts[d - 1]! += 1;
    }
    expect(counts.reduce((a, b) => a + b)).toBe(n); // every roll was 1-6
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n / 6 / 20);
  });

  it("randomInt stays in range and rejects bad ranges", () => {
    let rng: RngState = seedRng("range");
    for (let i = 0; i < 1000; i++) {
      const [x, next] = randomInt(rng, 3);
      rng = next;
      expect([0, 1, 2]).toContain(x);
    }
    expect(randomInt(rng, 1)[0]).toBe(0);
    expect(() => randomInt(rng, 0)).toThrow();
    expect(() => randomInt(rng, 2.5)).toThrow();
    expect(() => randomInt(rng, 2 ** 32 + 1)).toThrow();
  });

  it("shuffle returns a permutation and leaves the input alone", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const [out] = shuffle(items, seedRng("perm"));
    expect(out).not.toBe(items);
    expect(items).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect([...out].sort((a, b) => a - b)).toEqual(items);
    expect(out).not.toEqual(items);
    expect(shuffle([], seedRng("x"))[0]).toEqual([]);
  });

  it("shuffle is uniform enough: each item lands first about equally often", () => {
    let rng = seedRng("uniform-shuffle");
    const firsts = [0, 0, 0, 0];
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const [out, next] = shuffle([0, 1, 2, 3], rng);
      rng = next;
      firsts[out[0]!]! += 1;
    }
    for (const c of firsts) expect(Math.abs(c - n / 4)).toBeLessThan(n / 4 / 10);
  });
});
