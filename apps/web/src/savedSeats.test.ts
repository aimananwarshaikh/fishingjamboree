import { describe, expect, it } from "vitest";
import {
  MAX_SAVED_SEATS,
  SAVED_SEATS_KEY,
  SAVED_SEAT_MAX_AGE_MS,
  loadSavedSeats,
  normalizeCode,
  parseRejoinFragment,
  rejoinLink,
  removeSeat,
  saveSeat,
} from "./savedSeats";
import type { StorageLike } from "./savedSeats";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const ann = { code: "KTBM", seat: "p1", seatToken: "a1b2c3d4", name: "Ann" };
const bob = { code: "KTBM", seat: "p2", seatToken: "e5f6a7b8", name: "Bob" };
const cyOther = { code: "QRST", seat: "p3", seatToken: "0011aabb", name: "Cy" };

describe("saved seats", () => {
  it("loads nothing from empty storage", () => {
    expect(loadSavedSeats(memoryStorage(), 1000)).toEqual([]);
  });

  it("saves and loads a seat", () => {
    const s = memoryStorage();
    saveSeat(s, ann, 1000);
    expect(loadSavedSeats(s, 2000)).toEqual([{ ...ann, savedAt: 1000 }]);
  });

  it("keeps two rooms, newest first", () => {
    const s = memoryStorage();
    saveSeat(s, ann, 1000);
    saveSeat(s, cyOther, 2000);
    expect(loadSavedSeats(s, 3000).map((e) => e.code)).toEqual(["QRST", "KTBM"]);
    // Saving the older one again moves it to the front.
    saveSeat(s, ann, 4000);
    expect(loadSavedSeats(s, 5000).map((e) => e.code)).toEqual(["KTBM", "QRST"]);
  });

  it("keeps one entry per room and seat (several tabs can sit in one room)", () => {
    const s = memoryStorage();
    saveSeat(s, ann, 1000);
    saveSeat(s, bob, 2000);
    saveSeat(s, { ...ann, seatToken: "ffff0000" }, 3000);
    const seats = loadSavedSeats(s, 4000);
    expect(seats.map((e) => `${e.name}:${e.seatToken}`)).toEqual(["Ann:ffff0000", "Bob:e5f6a7b8"]);
  });

  it("removes one seat by token, or every seat of a room", () => {
    const s = memoryStorage();
    saveSeat(s, ann, 1000);
    saveSeat(s, bob, 2000);
    saveSeat(s, cyOther, 3000);
    removeSeat(s, "ktbm", bob.seatToken, 4000);
    expect(loadSavedSeats(s, 4000).map((e) => e.name)).toEqual(["Cy", "Ann"]);
    // A wrong token removes nothing.
    removeSeat(s, "KTBM", "deadbeef", 4000);
    expect(loadSavedSeats(s, 4000)).toHaveLength(2);
    removeSeat(s, "KTBM", null, 4000);
    expect(loadSavedSeats(s, 4000).map((e) => e.name)).toEqual(["Cy"]);
    removeSeat(s, "QRST", null, 4000);
    expect(s.data[SAVED_SEATS_KEY]).toBeUndefined();
  });

  it("skips malformed entries and survives a malformed value", () => {
    const good = { ...ann, savedAt: 1000 };
    const s = memoryStorage({
      [SAVED_SEATS_KEY]: JSON.stringify([
        good,
        null,
        "text",
        { ...good, code: "TOOLONG" },
        { ...good, seatToken: "has.dot" },
        { ...good, seatToken: 42 },
        { ...good, name: "" },
        { ...good, savedAt: "yesterday" },
        { code: "KTBM" },
      ]),
    });
    expect(loadSavedSeats(s, 2000)).toEqual([good]);
    expect(loadSavedSeats(memoryStorage({ [SAVED_SEATS_KEY]: "{not json" }), 0)).toEqual([]);
    expect(loadSavedSeats(memoryStorage({ [SAVED_SEATS_KEY]: '{"a":1}' }), 0)).toEqual([]);
    // Saving over a malformed value starts a fresh list.
    const bad = memoryStorage({ [SAVED_SEATS_KEY]: "{not json" });
    saveSeat(bad, ann, 1000);
    expect(loadSavedSeats(bad, 1000)).toHaveLength(1);
  });

  it("does not save a malformed seat", () => {
    const s = memoryStorage();
    saveSeat(s, { ...ann, code: "??" }, 1000);
    expect(loadSavedSeats(s, 1000)).toEqual([]);
  });

  it("drops expired entries and keeps at most the newest few", () => {
    const s = memoryStorage();
    saveSeat(s, ann, 0);
    expect(loadSavedSeats(s, SAVED_SEAT_MAX_AGE_MS + 1)).toEqual([]);
    for (let i = 0; i < MAX_SAVED_SEATS + 3; i++)
      saveSeat(s, { ...ann, seat: `p${i}`, name: `N${i}` }, 1000 + i);
    const seats = loadSavedSeats(s, 2000);
    expect(seats).toHaveLength(MAX_SAVED_SEATS);
    expect(seats[0]?.name).toBe(`N${MAX_SAVED_SEATS + 2}`);
  });

  it("survives storage that throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSavedSeats(broken, 0)).toEqual([]);
    expect(() => saveSeat(broken, ann, 0)).not.toThrow();
    expect(() => removeSeat(broken, "KTBM", null, 0)).not.toThrow();
  });
});

describe("rejoin links", () => {
  it("puts the seat in the fragment and keeps the query", () => {
    expect(rejoinLink("http://localhost:5173/?server=ws://x:1#old", "KTBM", "a1b2")).toBe(
      "http://localhost:5173/?server=ws://x:1#rejoin=KTBM.a1b2",
    );
  });

  it("reads a link back", () => {
    const link = rejoinLink("https://example.test/game", "KTBM", "tok-12");
    expect(parseRejoinFragment(new URL(link).hash)).toEqual({ code: "KTBM", seatToken: "tok-12" });
    expect(parseRejoinFragment("rejoin=ktbm.a1b2")).toEqual({ code: "KTBM", seatToken: "a1b2" });
  });

  it("rejects malformed links", () => {
    for (const hash of [
      "",
      "#",
      "#rejoin=",
      "#rejoin=KTBM",
      "#rejoin=KTBM.",
      "#rejoin=.a1b2",
      "#rejoin=KTB.a1b2",
      "#rejoin=KTBM1.a1b2",
      "#rejoin=KTBM.a1b2.c3",
      "#rejoin=KTBM.a b",
      "#rejoin=KTBM.%E0%A4%A",
      "#join=KTBM.a1b2",
      `#rejoin=KTBM.${"a".repeat(200)}`,
    ])
      expect(parseRejoinFragment(hash), hash).toBeNull();
  });

  it("normalizes room codes", () => {
    expect(normalizeCode(" ktbm ")).toBe("KTBM");
    expect(normalizeCode("KT")).toBeNull();
    expect(normalizeCode(7)).toBeNull();
  });
});
