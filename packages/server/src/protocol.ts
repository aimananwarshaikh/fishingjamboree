/**
 * The online protocol (docs/protocol.md): every message a client and the
 * server exchange, as plain JSON. Types and constants only, with no Node
 * imports, so the web client can import this file too.
 */
import type {
  Action,
  ActionErrorCode,
  GameEvent,
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
   * server plays for them when they have to decide. Always `false` in the lobby.
   */
  away: boolean;
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
  /** Goes up by one on every change to this object. */
  rev: number;
}

/** The game as one seat sees it. `seq` equals `view.actionCount`. */
export interface GameSnapshot {
  seq: number;
  view: PlayerView;
}

/** An engine action without `player`: the server fills that in from the seat. */
export type ClientAction = Action extends infer A
  ? A extends Action
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
  | { type: "leave" };

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
  | "server-busy";

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
   * chose for a disconnected player.
   */
  | {
      type: "update";
      seq: number;
      by: SeatId | null;
      auto: boolean;
      events: GameEvent[];
      view: PlayerView;
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
