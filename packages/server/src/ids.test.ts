import { describe, expect, it } from "vitest";
import { cryptoIds, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./ids";

describe("cryptoIds", () => {
  const ids = cryptoIds();

  it("makes room codes of the right length from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = ids.roomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it("has no vowels or look-alike letters in the alphabet", () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[AEIOUYL0-9]/);
  });

  it("makes 128-bit seat tokens and seeds that do not repeat", () => {
    const made = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const token = ids.seatToken();
      const seed = ids.gameSeed();
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(seed).toMatch(/^[0-9a-f]{32}$/);
      made.add(token).add(seed);
    }
    expect(made.size).toBe(200);
  });
});
