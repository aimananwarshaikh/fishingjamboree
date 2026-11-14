/**
 * The online protocol (docs/protocol.md): every message a client and the
 * server exchange, as plain JSON. Types and constants only, with no Node
 * imports, so the web client can import this file too.
 */
import type {
  ActionErrorCode,
  GameEvent,
  PlayerAction,
  PlayerId,
  PlayerView,
} from "@fishingjamboree/engine";

/** Sent by the client in `create`, `join` and `rejoin`; the server refuses any other value. */
export const PROTOCOL_VERSION = 1;

/** A seat is the engine's `PlayerId`: "p1" to "p4", in the order players joined. */
export type SeatId = PlayerId;

export type RoomStatus = "lobby" | "playing" | "finished";

export interface SeatInfo {
  seat: SeatId;
  name: string;
  /** `false` while the player has no live connection. */
  connected: boolean;
  /**
   * In a game: the player's reconnect grace is over (or they sent `leave`), so the
   * server misses their turns for them. Always `false` in the lobby.
   */
  away: boolean;
  /** Removed from the game (kicked by the host, or after too many missed turns). The seat stays for the results. */
  removed: boolean;
  /**
   * In a game, while the player is disconnected and not yet away: milliseconds
   * until the server marks them away (their reconnect grace, capped by what is
   * left of their budget). Counted when the message is sent; `null` otherwise.
   */
  awayInMs: number | null;
}

/** The room's time limits (docs/protocol.md §7). Fixed for the life of the room. */
export interface RoomTimers {
  /** How long a player has for a whole turn before the server misses it for them; `null`: no turn timer. */
  turnTimeoutMs: number | null;
  /** How long one disconnect may last before the player is away. */
  reconnectGraceMs: number;
  /** The most reconnect grace one player can use in a whole game. */
  reconnectBudgetMs: number;
}

/** Everything public about a room. Sent whole each time; a higher `rev` is newer. */
export interface RoomInfo {
  code: string;
  status: RoomStatus;
  /** The seat that may start the game. */
  host: SeatId;
  /** In seat order. */
  seats: SeatInfo[];
  minPlayers: number;
  maxPlayers: number;
  timers: RoomTimers;
  /** Goes up by one on every change to this object. */
  rev: number;
}

/** The game as one seat sees it. `seq` equals `view.actionCount`. */
export interface GameSnapshot {
  seq: number;
  view: PlayerView;
  /**
   * Milliseconds until the server misses the deciding player's turn (turn timer),
   * counted when the message is sent: add it to the time it arrived. `null`
   * when no turn timer runs (no timer set, the deciding player is away, the
   * game is over).
   */
  turnTimeLeftMs: number | null;
}

/**
 * An engine action a player can choose, without `player`: the server fills
 * that in from the seat. System actions (`missTurn`, `removePlayer`) are never
 * accepted from a client.
 */
export type ClientAction = PlayerAction extends infer A
  ? A extends PlayerAction
    ? Omit<A, "player">
    : never
  : never;

// ---------------------------------------------------------------------------
// Client to server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "create"; v: number; name: string }
  | { type: "join"; v: number; code: string; name: string }
  | { type: "rejoin"; v: number; code: string; seatToken: string }
  | { type: "start" }
  /** `seq` is the `seq` of the view the player was looking at when they chose. */
  | { type: "intent"; clientActionId: string; seq: number; action: ClientAction }
  | { type: "sync" }
  | { type: "leave" }
  /** Host only: remove `seat` from the lobby or the game for good. */
  | { type: "kick"; seat: SeatId };

export type ClientMessageType = ClientMessage["type"];

// ---------------------------------------------------------------------------
// Server to client
// ---------------------------------------------------------------------------

export type ProtocolErrorCode =
  | "bad-message"
  | "unsupported-version"
  | "not-seated"
  | "already-seated"
  | "room-not-found"
  | "room-full"
  | "game-started"
  | "name-invalid"
  | "name-taken"
  | "bad-token"
  | "not-host"
  | "not-enough-players"
  | "players-disconnected"
  | "replaced"
  | "server-busy"
  | "kicked"
  | "cannot-kick"
  /** The server hit an error handling the message (a bug); nothing was changed. Try again. */
  | "server-error"
  /** The room hit a server error and was closed; the connection has no seat any more. */
  | "room-closed";

/** Why an intent was refused: the engine's reasons plus two of the server's. */
export type RejectionCode = ActionErrorCode | "stale" | "no-game";

export type ServerMessage =
  /** To one connection, after `create`, `join` or `rejoin`. The only message that carries a seat token. */
  | {
      type: "welcome";
      v: number;
      seat: SeatId;
      seatToken: string;
      contentHash: string;
      room: RoomInfo;
      game: GameSnapshot | null;
    }
  /** To everyone in the room when the lobby, a connection or the status changes. */
  | { type: "room"; room: RoomInfo }
  /**
   * To everyone in the room. `seq` 0 is the start of the game (`by` is `null`);
   * `seq` N carries the events of action N. `auto` marks an action the server
   * applied for a player: a turn missed because they are away or ran out of time.
   * `turnTimeLeftMs` is as in `GameSnapshot`.
   */
  | {
      type: "update";
      seq: number;
      by: SeatId | null;
      auto: boolean;
      events: GameEvent[];
      view: PlayerView;
      turnTimeLeftMs: number | null;
    }
  /** Reply to `sync`. */
  | { type: "snapshot"; room: RoomInfo; game: GameSnapshot | null }
  /** Only to the sender of the intent. `seq` is the server's current `seq`. */
  | {
      type: "rejected";
      clientActionId: string;
      seq: number;
      error: { code: RejectionCode; message: string };
    }
  | { type: "error"; code: ProtocolErrorCode; message: string }
  /** Reply to `leave`. The connection stays open and has no seat. */
  | { type: "left" };

export type ServerMessageType = ServerMessage["type"];
