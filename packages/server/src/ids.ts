/**
 * Room codes, seat tokens and game seeds. The core takes these as a
 * dependency so tests can supply predictable ones; the real server uses
 * `cryptoIds()`.
 */
import { randomBytes, randomInt } from "node:crypto";

export interface IdSource {
  /** A short code players read out to each other. The core retries if it is taken. */
  roomCode(): string;
  /** A secret that proves who owns a seat. Must be unguessable. */
  seatToken(): string;
  /** The game's RNG seed. Must be unguessable: it determines every die and shuffle. */
  gameSeed(): string;
}

/** Consonants only (no words), without L, which reads like 1 or I. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;

export function cryptoIds(): IdSource {
  return {
    roomCode: () =>
      Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
      ).join(""),
    seatToken: () => randomBytes(16).toString("hex"),
    gameSeed: () => randomBytes(16).toString("hex"),
  };
}
