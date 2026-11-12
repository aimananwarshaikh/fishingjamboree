/**
 * Client state and how each server message changes it (docs/protocol.md §4–§6).
 * Pure functions, so the rules for `seq` and `rev` can be tested without a socket.
 */
import type { GameEvent } from "@fishingjamboree/engine";
import type {
  GameSnapshot,
  RoomInfo,
  SeatId,
  ServerMessage,
} from "../../../packages/server/src/protocol";

export interface Session {
  code: string;
  seat: SeatId;
  seatToken: string;
}

export interface LogLine {
  id: number;
  text: string;
  kind: "event" | "info" | "error";
}

export type Connection = "idle" | "connecting" | "open" | "closed";

/** A short message shown over the table, e.g. when a round starts. `id` changes each time. */
export interface Banner {
  id: number;
  title: string;
  detail: string | null;
}

export interface ClientState {
  connection: Connection;
  session: Session | null;
  room: RoomInfo | null;
  game: GameSnapshot | null;
  /** Events of each applied update, in order. `describe` turns them into log lines. */
  log: LogLine[];
  /** The last problem to show the player; cleared by the next successful update. */
  notice: string | null;
  /** The server's content differs from the bundled one: board and legal moves may be wrong. */
  contentMismatch: boolean;
  /** An update skipped a `seq`: ask for a `sync`. */
  needsSync: boolean;
  /** `clientActionId` of an intent that has had no answer yet. */
  pending: string | null;
  /** The latest banner (round start, event card, game over); the UI hides it after a moment. */
  banner: Banner | null;
}

export const initialState: ClientState = {
  connection: "idle",
  session: null,
  room: null,
  game: null,
  log: [],
  notice: null,
  contentMismatch: false,
  needsSync: false,
  pending: null,
  banner: null,
};

export interface Context {
  /** Hash of the bundled content. */
  contentHash: string;
  /** Turns events into log text (needs names and content). */
  describe: (events: GameEvent[], room: RoomInfo | null) => string[];
  /** Name of a card, for the event banner. Defaults to the card id. */
  cardName?: (card: string) => string;
  /** Rounds in a game, for "Round 6 of 20". */
  rounds?: number;
}

/** The banner for an update's events, or `null` if none of them deserve one. */
export function bannerFor(events: GameEvent[], ctx: Context, lastId: number): Banner | null {
  const cardName = ctx.cardName ?? ((c: string) => c);
  let title: string | null = null;
  let detail: string | null = null;
  for (const e of events) {
    if (e.type === "roundStarted") {
      title = `Round ${e.round}${ctx.rounds ? ` of ${ctx.rounds}` : ""}`;
    } else if (e.type === "eventDrawn") {
      detail = `Event: ${cardName(e.card)}`;
      title ??= `After round ${e.afterRound}`;
    } else if (e.type === "gameEnded") {
      title = "Game over";
      detail = null;
    }
  }
  return title === null ? null : { id: lastId + 1, title, detail };
}

const MAX_LOG = 300;

function addLog(state: ClientState, texts: string[], kind: LogLine["kind"]): LogLine[] {
  if (texts.length === 0) return state.log;
  const last = state.log[state.log.length - 1]?.id ?? 0;
  const added = texts.map((text, i) => ({ id: last + i + 1, text, kind }));
  return [...state.log, ...added].slice(-MAX_LOG);
}

/** A room object is only taken if it is newer (or from another room). */
function newerRoom(current: RoomInfo | null, incoming: RoomInfo): RoomInfo {
  if (current && current.code === incoming.code && current.rev > incoming.rev) return current;
  return incoming;
}

export function connectionChanged(state: ClientState, connection: Connection): ClientState {
  return { ...state, connection, pending: connection === "open" ? state.pending : null };
}

export function intentSent(state: ClientState, clientActionId: string): ClientState {
  return { ...state, pending: clientActionId, notice: null };
}

export function dismissNotice(state: ClientState): ClientState {
  return { ...state, notice: null };
}

/** The player left, or the saved seat no longer works: back to the start screen. */
export function resetSession(state: ClientState, notice: string | null = null): ClientState {
  return { ...initialState, connection: state.connection, notice };
}

export function onServerMessage(state: ClientState, msg: ServerMessage, ctx: Context): ClientState {
  switch (msg.type) {
    case "welcome": {
      const session = { code: msg.room.code, seat: msg.seat, seatToken: msg.seatToken };
      const me = msg.room.seats.find((s) => s.seat === msg.seat)?.name ?? msg.seat;
      return {
        ...state,
        session,
        room: newerRoom(state.session?.code === session.code ? state.room : null, msg.room),
        // A rejoin returns the current game; take it whole.
        game: msg.game,
        pending: null,
        needsSync: false,
        notice: null,
        contentMismatch: msg.contentHash !== ctx.contentHash,
        log: addLog(state, [`Joined room ${msg.room.code} as ${me}.`], "info"),
      };
    }
    case "room":
      return { ...state, room: newerRoom(state.room, msg.room) };
    case "update": {
      const have = state.game?.seq ?? -1;
      if (msg.seq <= have) return state; // old or repeated
      if (msg.seq !== have + 1) return { ...state, needsSync: true };
      // What the server did for an away player is marked in the log. Only that
      // player's events: the same update can also hold a round start or another
      // player's forced move.
      const texts = msg.events.flatMap((e) => {
        const lines = ctx.describe([e], state.room);
        const theirs = msg.auto && "player" in e && e.player === msg.by;
        return theirs ? lines.map((t) => `${t} (auto)`) : lines;
      });
      return {
        ...state,
        game: { seq: msg.seq, view: msg.view },
        log: addLog(state, texts, "event"),
        pending: null,
        notice: null,
        banner: bannerFor(msg.events, ctx, state.banner?.id ?? 0) ?? state.banner,
      };
    }
    case "snapshot": {
      const have = state.game?.seq ?? -1;
      const take = msg.game !== null && msg.game.seq >= have;
      return {
        ...state,
        room: newerRoom(state.room, msg.room),
        game: take ? msg.game : state.game,
        needsSync: false,
        pending: null,
      };
    }
    case "rejected":
      return {
        ...state,
        pending: state.pending === msg.clientActionId ? null : state.pending,
        // After `stale` the newer view is on its way; say nothing alarming.
        notice: msg.error.code === "stale" ? null : msg.error.message,
      };
    case "error":
      return {
        ...state,
        notice: msg.message,
        log: addLog(state, [msg.message], "error"),
        pending: null,
      };
    case "left":
      return resetSession(state);
  }
}
