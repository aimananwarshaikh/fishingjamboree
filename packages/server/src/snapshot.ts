/**
 * What is saved of a room so that a server restart does not end its game
 * (review P2-5; docs/protocol.md §9). Plain JSON, no I/O: the core makes these
 * (`ServerCore.takeChanges`) and accepts them back (`ServerCore.restoreRoom`);
 * the transport hands them to a `RoomStore` (`roomStore.ts`).
 *
 * A snapshot holds the seat tokens and the game's seed: it is for the server's
 * disk only and must never reach a client.
 *
 * No clock times are saved: a restored room starts with nobody connected, as
 * if everyone had just dropped (docs/protocol.md §7, "When nobody is
 * connected"). Each player's reconnect budget is saved as what is left.
 */
import type { GameState, ReplayLog } from "@fishingjamboree/engine";
import type { RoomStatus, RoomTimers, SeatId } from "./protocol";

export const ROOM_SNAPSHOT_VERSION = 1;

export interface SeatSnapshot {
  id: SeatId;
  name: string;
  token: string;
  /** Sent `leave` during the game (no grace when the room is rejoined). */
  left: boolean;
  away: boolean;
  removed: boolean;
  /** Reconnect grace this player can still use in this game. */
  graceLeftMs: number;
}

export interface RoomSnapshot {
  kind: "fishingjamboree-room";
  version: typeof ROOM_SNAPSHOT_VERSION;
  code: string;
  status: RoomStatus;
  host: SeatId;
  rev: number;
  timers: RoomTimers;
  /** In seat order. */
  seats: SeatSnapshot[];
  /**
   * `null` in the lobby. `log` rebuilds the game; `state` is the state the
   * server had, kept only to check that the replay matches it.
   */
  game: { log: ReplayLog; state: GameState } | null;
}

export type SnapshotParse = { ok: true; snapshot: RoomSnapshot } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isSeatId = (v: unknown): v is SeatId => typeof v === "string" && /^p[1-9][0-9]?$/.test(v);

/**
 * Checks the shape of something read from disk. The game itself is checked by
 * replaying its log (`ServerCore.restoreRoom`), not here.
 */
export function parseRoomSnapshot(raw: unknown): SnapshotParse {
  const fail = (reason: string): SnapshotParse => ({ ok: false, reason });
  if (!isObject(raw)) return fail("not an object");
  if (raw.kind !== "fishingjamboree-room") return fail("not a room snapshot");
  if (raw.version !== ROOM_SNAPSHOT_VERSION) return fail(`unknown version ${String(raw.version)}`);
  if (typeof raw.code !== "string" || !/^[A-Z0-9]{1,16}$/.test(raw.code)) return fail("bad code");
  if (raw.status !== "lobby" && raw.status !== "playing" && raw.status !== "finished") {
    return fail("bad status");
  }
  if (!isSeatId(raw.host)) return fail("bad host");
  if (!isCount(raw.rev)) return fail("bad rev");
  const t = raw.timers;
  if (
    !isObject(t) ||
    !(t.turnTimeoutMs === null || isCount(t.turnTimeoutMs)) ||
    !isCount(t.reconnectGraceMs) ||
    !isCount(t.reconnectBudgetMs)
  ) {
    return fail("bad timers");
  }
  if (!Array.isArray(raw.seats) || raw.seats.length === 0) return fail("no seats");
  for (const s of raw.seats as unknown[]) {
    if (
      !isObject(s) ||
      !isSeatId(s.id) ||
      typeof s.name !== "string" ||
      s.name.length === 0 ||
      typeof s.token !== "string" ||
      s.token.length === 0 ||
      typeof s.left !== "boolean" ||
      typeof s.away !== "boolean" ||
      typeof s.removed !== "boolean" ||
      !isCount(s.graceLeftMs)
    ) {
      return fail("bad seat");
    }
  }
  const seats = raw.seats as SeatSnapshot[];
  if (new Set(seats.map((s) => s.id)).size !== seats.length) return fail("seat ids repeat");
  if (new Set(seats.map((s) => s.token)).size !== seats.length) return fail("seat tokens repeat");
  if (!seats.some((s) => s.id === raw.host)) return fail("the host has no seat");
  if (raw.status === "lobby") {
    if (raw.game !== null) return fail("a lobby has no game");
  } else {
    const g = raw.game;
    if (!isObject(g) || !isObject(g.log) || !isObject(g.state)) return fail("bad game");
    const log = g.log;
    if (
      log.schemaVersion !== 1 ||
      typeof log.contentHash !== "string" ||
      !isObject(log.setup) ||
      typeof log.setup.seed !== "string" ||
      !Array.isArray(log.setup.players) ||
      !Array.isArray(log.actions)
    ) {
      return fail("bad replay log");
    }
  }
  return { ok: true, snapshot: raw as unknown as RoomSnapshot };
}
