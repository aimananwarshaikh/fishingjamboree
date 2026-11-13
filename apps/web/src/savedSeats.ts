/**
 * Seats this browser has held, so a player who closed their tab (or opens the
 * game on another device) can get their seat back. Pure functions over a
 * storage object, so they can be tested without a browser.
 *
 * Two places keep a seat (docs/protocol.md §2, notes log 2026-11-13):
 * - `sessionStorage` (per tab, in useGame.ts): a refresh rejoins by itself.
 * - `localStorage` (this file, shared by every tab of the browser): only ever
 *   *offered* on the start screen. Nothing rejoins from it until the player
 *   clicks, so two tabs of one browser can still be two players.
 *
 * A rejoin link carries the room code and seat token in the URL fragment
 * (`#rejoin=CODE.TOKEN`), which browsers never send to a web server.
 */

/** The parts of `Storage` used here (`localStorage` fits). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedSeat {
  code: string;
  seat: string;
  seatToken: string;
  name: string;
  /** When it was last saved (ms since 1970), for "newest first". */
  savedAt: number;
}

/** What a rejoin link holds. */
export interface RejoinTarget {
  code: string;
  seatToken: string;
}

export const SAVED_SEATS_KEY = "fishingjamboree.seats";
/** Keep at most this many; the oldest go first. */
export const MAX_SAVED_SEATS = 10;
/** Older entries are dropped: no room lives this long. */
export const SAVED_SEAT_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

const CODE = /^[A-Z]{4}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/** A room code as the server matches it: trimmed, upper case. `null` if it cannot be one. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

function isToken(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN.test(raw);
}

/** One stored entry, or `null` if it is malformed. */
function parseEntry(raw: unknown): SavedSeat | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const code = normalizeCode(e.code);
  if (!code || !isToken(e.seatToken)) return null;
  if (typeof e.seat !== "string" || e.seat.length === 0 || e.seat.length > 8) return null;
  if (typeof e.name !== "string" || e.name.length === 0 || e.name.length > 40) return null;
  if (typeof e.savedAt !== "number" || !Number.isFinite(e.savedAt)) return null;
  return { code, seat: e.seat, seatToken: e.seatToken, name: e.name, savedAt: e.savedAt };
}

function read(storage: StorageLike): SavedSeat[] {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_SEATS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseEntry).filter((e): e is SavedSeat => e !== null);
}

function write(storage: StorageLike, seats: SavedSeat[]) {
  try {
    if (seats.length === 0) storage.removeItem(SAVED_SEATS_KEY);
    else storage.setItem(SAVED_SEATS_KEY, JSON.stringify(seats));
  } catch {
    /* storage full or blocked: the rejoin link still works */
  }
}

/**
 * Saved seats, newest first. Malformed and expired entries are skipped.
 * One entry per room and seat: several tabs of one browser can each hold a
 * seat in the same room, so the room code alone is not enough.
 */
export function loadSavedSeats(storage: StorageLike, now: number): SavedSeat[] {
  const seen = new Set<string>();
  return read(storage)
    .filter((e) => now - e.savedAt <= SAVED_SEAT_MAX_AGE_MS)
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((e) => {
      const key = `${e.code}/${e.seat}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SAVED_SEATS);
}

/** Saves (or refreshes) a seat. Replaces any entry for the same room and seat. */
export function saveSeat(
  storage: StorageLike,
  seat: Omit<SavedSeat, "savedAt">,
  now: number,
): SavedSeat[] {
  const entry = parseEntry({ ...seat, savedAt: now });
  if (!entry) return loadSavedSeats(storage, now);
  const rest = loadSavedSeats(storage, now).filter(
    (e) => !(e.code === entry.code && e.seat === entry.seat),
  );
  const seats = [entry, ...rest].slice(0, MAX_SAVED_SEATS);
  write(storage, seats);
  return seats;
}

/**
 * Removes saved seats of a room: the one with `seatToken` (left, or a token
 * the server refused), or every seat of the room when no token is given
 * (the room no longer exists).
 */
export function removeSeat(
  storage: StorageLike,
  code: string,
  seatToken: string | null,
  now: number,
): SavedSeat[] {
  const room = normalizeCode(code);
  const seats = loadSavedSeats(storage, now).filter(
    (e) => !(e.code === room && (seatToken === null || e.seatToken === seatToken)),
  );
  write(storage, seats);
  return seats;
}

/** The rejoin link for a seat: this page's address with the seat in the fragment. */
export function rejoinLink(pageUrl: string, code: string, seatToken: string): string {
  const base = pageUrl.split("#")[0] ?? pageUrl;
  return `${base}#rejoin=${encodeURIComponent(code)}.${encodeURIComponent(seatToken)}`;
}

/** Reads a rejoin link's fragment (`#rejoin=CODE.TOKEN`). `null` if it is not a valid one. */
export function parseRejoinFragment(hash: string): RejoinTarget | null {
  const m = /^#?rejoin=([^.]*)\.(.*)$/.exec(hash.trim());
  if (!m) return null;
  let rawCode: string;
  let rawToken: string;
  try {
    rawCode = decodeURIComponent(m[1] ?? "");
    rawToken = decodeURIComponent(m[2] ?? "");
  } catch {
    return null;
  }
  const code = normalizeCode(rawCode);
  if (!code || !isToken(rawToken)) return null;
  return { code, seatToken: rawToken };
}
