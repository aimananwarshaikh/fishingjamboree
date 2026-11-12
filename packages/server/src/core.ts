/**
 * The room and session core (docs/protocol.md). Transport-independent: it is
 * told about messages, closed connections and the passing of time, and it
 * returns the messages to send. It opens no sockets and starts no timers; the
 * WebSocket server (stage 5b) wraps it.
 *
 *   handleMessage(conn, raw)  a JSON-parsed message arrived on a connection
 *   disconnect(conn)          a connection closed
 *   tick()                    do whatever is due now (call it on a timer)
 *   nextDeadline()            when `tick` next has work, or `null`
 */
import { applyAction, createGame, redactForClient } from "@fishingjamboree/engine";
import type { Action, Content, GameEvent, GameState, ReplayLog } from "@fishingjamboree/engine";
import { chooseAutoAction } from "./autoplay";
import type { IdSource } from "./ids";
import { parseClientMessage } from "./parse";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  ClientMessage,
  GameSnapshot,
  ProtocolErrorCode,
  RejectionCode,
  RoomInfo,
  RoomStatus,
  SeatId,
  ServerMessage,
} from "./protocol";

/** Chosen by the transport: one id per live connection. */
export type ConnId = string;

/** Something for the transport to do, in order. */
export type Outbound =
  | { kind: "send"; to: ConnId; message: ServerMessage }
  /** Close the connection (after sending anything queued for it). */
  | { kind: "close"; to: ConnId; reason: string };

export interface CoreConfig {
  /** In the lobby, a disconnected player's seat is kept this long, then freed. */
  lobbyGraceMs: number;
  /** In a game, a disconnected player has this long to come back before the server plays for them. */
  reconnectGraceMs: number;
  /** Pause before each action the server takes for an away player, so others can follow. */
  autoActionDelayMs: number;
  /** A room with no connections at all is deleted after this long. */
  roomIdleTtlMs: number;
  maxNameLength: number;
}

export const DEFAULT_CONFIG: CoreConfig = {
  lobbyGraceMs: 2 * 60_000,
  reconnectGraceMs: 60_000,
  autoActionDelayMs: 2_000,
  roomIdleTtlMs: 30 * 60_000,
  maxNameLength: 20,
};

export interface CoreDeps {
  content: Content;
  /** Milliseconds; only differences matter. */
  now: () => number;
  ids: IdSource;
  config?: Partial<CoreConfig>;
}

interface Seat {
  id: SeatId;
  name: string;
  token: string;
  conn: ConnId | null;
  /** When the seat last lost its connection; `null` while connected. */
  disconnectedAt: number | null;
  /** The player sent `leave` during a game: no grace period. */
  left: boolean;
  /** In a game: the reconnect grace is over (or the player left), so the server plays for them. */
  away: boolean;
}

interface Game {
  state: GameState;
  log: ReplayLog;
  /** When the game started or the last action was applied. */
  lastActionAt: number;
}

interface Room {
  code: string;
  status: RoomStatus;
  host: SeatId;
  /** In seat order. */
  seats: Seat[];
  rev: number;
  game: Game | null;
  /** When the room last had nobody connected; `null` while someone is. */
  emptySince: number | null;
  /** When someone last connected to a room that had nobody connected. */
  resumedAt: number;
}

interface Step {
  at: number;
  run: (out: Outbound[]) => void;
}

const ROOM_CODE_ATTEMPTS = 20;

export class ServerCore {
  private readonly content: Content;
  private readonly now: () => number;
  private readonly ids: IdSource;
  private readonly config: CoreConfig;
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Map<ConnId, { room: Room; seat: Seat }>();

  constructor(deps: CoreDeps) {
    this.content = deps.content;
    this.now = deps.now;
    this.ids = deps.ids;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  handleMessage(conn: ConnId, raw: unknown): Outbound[] {
    const out: Outbound[] = [];
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.error(out, conn, "bad-message", parsed.reason);
      return out;
    }
    const message = parsed.message;
    switch (message.type) {
      case "create":
        this.onCreate(out, conn, message);
        break;
      case "join":
        this.onJoin(out, conn, message);
        break;
      case "rejoin":
        this.onRejoin(out, conn, message);
        break;
      case "start":
        this.onStart(out, conn);
        break;
      case "intent":
        this.onIntent(out, conn, message);
        break;
      case "sync":
        this.onSync(out, conn);
        break;
      case "leave":
        this.onLeave(out, conn);
        break;
    }
    return out;
  }

  /** The transport calls this when a connection closes for any reason. */
  disconnect(conn: ConnId): Outbound[] {
    const out: Outbound[] = [];
    const bound = this.conns.get(conn);
    if (!bound) return out;
    this.conns.delete(conn);
    this.vacate(bound.room, bound.seat, false);
    this.broadcastRoom(out, bound.room);
    return out;
  }

  /** Runs everything that is due: frees lobby seats, plays for away players, deletes idle rooms. */
  tick(): Outbound[] {
    const out: Outbound[] = [];
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      for (let step = this.nextStep(room); step && step.at <= now; step = this.nextStep(room)) {
        step.run(out);
      }
    }
    return out;
  }

  /** The time of the earliest thing `tick` has to do, or `null` if nothing is pending. */
  nextDeadline(): number | null {
    let earliest: number | null = null;
    for (const room of this.rooms.values()) {
      const step = this.nextStep(room);
      if (step && (earliest === null || step.at < earliest)) earliest = step.at;
    }
    return earliest;
  }

  // -------------------------------------------------------------------------
  // Read-only access (tests, debugging, saving replays)
  // -------------------------------------------------------------------------

  roomCodes(): string[] {
    return [...this.rooms.keys()];
  }

  roomInfo(code: string): RoomInfo | null {
    const room = this.rooms.get(code);
    return room ? this.info(room) : null;
  }

  /** Contains the seed: never send this to a client while the game is being played. */
  replayLog(code: string): ReplayLog | null {
    const log = this.rooms.get(code)?.game?.log;
    return log ? (JSON.parse(JSON.stringify(log)) as ReplayLog) : null;
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  private onCreate(out: Outbound[], conn: ConnId, message: ClientMessage & { type: "create" }) {
    if (!this.checkNewcomer(out, conn, message.v)) return;
    const name = this.cleanName(message.name);
    if (name === null) return this.error(out, conn, "name-invalid", this.nameRule());
    const code = this.newRoomCode();
    if (code === null) return this.error(out, conn, "server-busy", "no room code is free");
    const room: Room = {
      code,
      status: "lobby",
      host: "p1",
      seats: [],
      rev: 0,
      game: null,
      emptySince: null,
      resumedAt: this.now(),
    };
    this.rooms.set(code, room);
    const seat = this.addSeat(room, name, conn);
    this.welcome(out, room, seat);
  }

  private onJoin(out: Outbound[], conn: ConnId, message: ClientMessage & { type: "join" }) {
    if (!this.checkNewcomer(out, conn, message.v)) return;
    const name = this.cleanName(message.name);
    if (name === null) return this.error(out, conn, "name-invalid", this.nameRule());
    const room = this.findRoom(message.code);
    if (!room) return this.error(out, conn, "room-not-found", "no room has that code");
    if (room.status !== "lobby") {
      return this.error(out, conn, "game-started", "that game has already started");
    }
    if (room.seats.length >= this.content.rules.maxPlayers) {
      return this.error(out, conn, "room-full", "that room is full");
    }
    if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return this.error(out, conn, "name-taken", "someone in that room already has that name");
    }
    this.occupy(room);
    const seat = this.addSeat(room, name, conn);
    room.rev += 1;
    this.welcome(out, room, seat);
    this.broadcastRoom(out, room, conn);
  }

  private onRejoin(out: Outbound[], conn: ConnId, message: ClientMessage & { type: "rejoin" }) {
    if (!this.checkNewcomer(out, conn, message.v)) return;
    const room = this.findRoom(message.code);
    if (!room) return this.error(out, conn, "room-not-found", "no room has that code");
    const seat = room.seats.find((s) => s.token === message.seatToken);
    if (!seat) return this.error(out, conn, "bad-token", "that seat token is not valid here");
    if (seat.conn !== null) {
      // The newest connection wins (a second tab, or a socket the server has not seen close yet).
      this.conns.delete(seat.conn);
      this.error(out, seat.conn, "replaced", "this seat was opened on another connection");
      out.push({ kind: "close", to: seat.conn, reason: "replaced" });
    }
    this.occupy(room);
    seat.conn = conn;
    seat.disconnectedAt = null;
    seat.left = false;
    seat.away = false;
    this.conns.set(conn, { room, seat });
    room.rev += 1;
    this.welcome(out, room, seat);
    this.broadcastRoom(out, room, conn);
  }

  private onLeave(out: Outbound[], conn: ConnId) {
    const bound = this.seated(out, conn);
    if (!bound) return;
    const { room, seat } = bound;
    this.conns.delete(conn);
    out.push({ kind: "send", to: conn, message: { type: "left" } });
    if (room.status === "lobby") {
      seat.conn = null;
      this.removeLobbySeat(out, room, seat);
    } else {
      this.vacate(room, seat, true);
      this.broadcastRoom(out, room);
    }
  }

  private onStart(out: Outbound[], conn: ConnId) {
    const bound = this.seated(out, conn);
    if (!bound) return;
    const { room, seat } = bound;
    if (room.status !== "lobby") {
      return this.error(out, conn, "game-started", "the game has already started");
    }
    if (seat.id !== room.host) {
      return this.error(out, conn, "not-host", "only the host can start the game");
    }
    const { minPlayers } = this.content.rules;
    if (room.seats.length < minPlayers) {
      return this.error(out, conn, "not-enough-players", `the game needs ${minPlayers} players`);
    }
    if (room.seats.some((s) => s.conn === null)) {
      return this.error(out, conn, "players-disconnected", "a player in the room is disconnected");
    }
    const setup = { seed: this.ids.gameSeed(), players: room.seats.map((s) => s.id) };
    const created = createGame(this.content, setup);
    room.game = {
      state: created.state,
      log: { schemaVersion: 1, contentHash: this.content.hash, setup, actions: [] },
      lastActionAt: this.now(),
    };
    room.status = "playing";
    room.rev += 1;
    this.broadcastRoom(out, room);
    this.broadcastUpdate(out, room, null, false, created.events);
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  private onIntent(out: Outbound[], conn: ConnId, message: ClientMessage & { type: "intent" }) {
    const bound = this.seated(out, conn);
    if (!bound) return;
    const { room, seat } = bound;
    const reject = (code: RejectionCode, text: string) =>
      out.push({
        kind: "send",
        to: conn,
        message: {
          type: "rejected",
          clientActionId: message.clientActionId,
          seq: room.game?.state.actionCount ?? 0,
          error: { code, message: text },
        },
      });
    const game = room.game;
    if (!game) return reject("no-game", "the game has not started");
    if (message.seq !== game.state.actionCount) {
      return reject("stale", `that choice was made at seq ${message.seq}; the game has moved on`);
    }
    // The seat decides who is acting, never the message.
    const action = { ...message.action, player: seat.id } as Action;
    const result = applyAction(this.content, game.state, action);
    if (!result.ok) return reject(result.error.code, result.error.message);
    this.commit(out, room, game, action, result.state, result.events, false);
  }

  private onSync(out: Outbound[], conn: ConnId) {
    const bound = this.seated(out, conn);
    if (!bound) return;
    const { room, seat } = bound;
    out.push({
      kind: "send",
      to: conn,
      message: { type: "snapshot", room: this.info(room), game: this.snapshot(room, seat) },
    });
  }

  /** Stores an accepted action and tells everyone. */
  private commit(
    out: Outbound[],
    room: Room,
    game: Game,
    action: Action,
    state: GameState,
    events: GameEvent[],
    auto: boolean,
  ) {
    game.state = state;
    game.log.actions.push(action);
    game.lastActionAt = this.now();
    this.broadcastUpdate(out, room, action.player, auto, events);
    if (state.phase.kind === "gameOver") {
      room.status = "finished";
      room.rev += 1;
      this.broadcastRoom(out, room);
    }
  }

  // -------------------------------------------------------------------------
  // Time: lobby seats, away players, idle rooms
  // -------------------------------------------------------------------------

  /** The earliest pending thing in this room, if any. */
  private nextStep(room: Room): Step | null {
    if (!this.rooms.has(room.code)) return null;
    const steps: Step[] = [];
    if (room.emptySince !== null) {
      steps.push({
        at: room.emptySince + this.config.roomIdleTtlMs,
        run: () => this.deleteRoom(room),
      });
    }
    if (room.status === "lobby") {
      for (const seat of room.seats) {
        if (seat.disconnectedAt === null) continue;
        steps.push({
          at: seat.disconnectedAt + this.config.lobbyGraceMs,
          run: (out) => this.removeLobbySeat(out, room, seat),
        });
      }
    }
    const game = room.game;
    // Nobody is played for while nobody is watching.
    if (room.status === "playing" && game && room.emptySince === null) {
      // A disconnected player becomes away when the grace ends; everyone is told.
      for (const seat of room.seats) {
        if (seat.disconnectedAt === null || seat.away) continue;
        steps.push({
          at: Math.max(seat.disconnectedAt, room.resumedAt) + this.config.reconnectGraceMs,
          run: (out) => this.markAway(out, room, seat),
        });
      }
      for (const actor of game.state.phase.actors) {
        const seat = room.seats.find((s) => s.id === actor);
        if (!seat || seat.disconnectedAt === null || !seat.away) continue;
        steps.push({
          at: game.lastActionAt + this.config.autoActionDelayMs,
          run: (out) => this.autoAct(out, room, game, seat),
        });
      }
    }
    return steps.reduce<Step | null>((a, b) => (a === null || b.at < a.at ? b : a), null);
  }

  private markAway(out: Outbound[], room: Room, seat: Seat) {
    seat.away = true;
    room.rev += 1;
    this.broadcastRoom(out, room);
  }

  private autoAct(out: Outbound[], room: Room, game: Game, seat: Seat) {
    const view = redactForClient(game.state, seat.id);
    const action = chooseAutoAction(this.content, view, seat.id);
    const result = action && applyAction(this.content, game.state, action);
    if (!action || !result || !result.ok) {
      // Cannot happen: an actor always has a legal action. Fail loudly rather than spin.
      throw new Error(`room ${room.code}: no automatic action for ${seat.id}`);
    }
    this.commit(out, room, game, action, result.state, result.events, true);
  }

  // -------------------------------------------------------------------------
  // Seats and rooms
  // -------------------------------------------------------------------------

  private checkNewcomer(out: Outbound[], conn: ConnId, v: number): boolean {
    if (v !== PROTOCOL_VERSION) {
      this.error(
        out,
        conn,
        "unsupported-version",
        `this server speaks protocol version ${PROTOCOL_VERSION}; reload the page`,
      );
      return false;
    }
    if (this.conns.has(conn)) {
      this.error(out, conn, "already-seated", "this connection already has a seat; leave first");
      return false;
    }
    return true;
  }

  private seated(out: Outbound[], conn: ConnId) {
    const bound = this.conns.get(conn);
    if (!bound) this.error(out, conn, "not-seated", "create, join or rejoin a room first");
    return bound;
  }

  private findRoom(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  private newRoomCode(): string | null {
    for (let i = 0; i < ROOM_CODE_ATTEMPTS; i += 1) {
      const code = this.ids.roomCode().toUpperCase();
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private nameRule(): string {
    return `a name needs 1 to ${this.config.maxNameLength} characters`;
  }

  private cleanName(raw: string): string | null {
    const name = raw.replace(/\s+/g, " ").trim();
    return name.length >= 1 && name.length <= this.config.maxNameLength ? name : null;
  }

  /** Takes the lowest free seat number. */
  private addSeat(room: Room, name: string, conn: ConnId): Seat {
    let n = 1;
    while (room.seats.some((s) => s.id === `p${n}`)) n += 1;
    const seat: Seat = {
      id: `p${n}`,
      name,
      token: this.ids.seatToken(),
      conn,
      disconnectedAt: null,
      left: false,
      away: false,
    };
    room.seats.push(seat);
    room.seats.sort((a, b) => a.id.localeCompare(b.id));
    this.conns.set(conn, { room, seat });
    return seat;
  }

  /** A connection is arriving: the room is no longer idle. */
  private occupy(room: Room) {
    if (room.emptySince === null) return;
    room.emptySince = null;
    room.resumedAt = this.now();
    // Every other disconnected player's grace starts again (docs/protocol.md §7).
    for (const seat of room.seats) if (!seat.left) seat.away = false;
  }

  /** The seat loses its connection but stays in the room. */
  private vacate(room: Room, seat: Seat, left: boolean) {
    seat.conn = null;
    seat.disconnectedAt = this.now();
    seat.left = left;
    seat.away = left && room.status === "playing";
    room.rev += 1;
    if (room.seats.every((s) => s.conn === null)) room.emptySince = this.now();
  }

  private removeLobbySeat(out: Outbound[], room: Room, seat: Seat) {
    room.seats = room.seats.filter((s) => s !== seat);
    const first = room.seats[0];
    if (!first) return this.deleteRoom(room);
    if (room.host === seat.id) room.host = first.id;
    if (room.seats.every((s) => s.conn === null)) room.emptySince ??= this.now();
    room.rev += 1;
    this.broadcastRoom(out, room);
  }

  private deleteRoom(room: Room) {
    this.rooms.delete(room.code);
  }

  // -------------------------------------------------------------------------
  // Outgoing messages
  // -------------------------------------------------------------------------

  private info(room: Room): RoomInfo {
    return {
      code: room.code,
      status: room.status,
      host: room.host,
      seats: room.seats.map((s) => ({
        seat: s.id,
        name: s.name,
        connected: s.conn !== null,
        away: s.away,
      })),
      minPlayers: this.content.rules.minPlayers,
      maxPlayers: this.content.rules.maxPlayers,
      rev: room.rev,
    };
  }

  private snapshot(room: Room, seat: Seat): GameSnapshot | null {
    if (!room.game) return null;
    const view = redactForClient(room.game.state, seat.id);
    return { seq: view.actionCount, view };
  }

  private welcome(out: Outbound[], room: Room, seat: Seat) {
    if (seat.conn === null) return;
    out.push({
      kind: "send",
      to: seat.conn,
      message: {
        type: "welcome",
        v: PROTOCOL_VERSION,
        seat: seat.id,
        seatToken: seat.token,
        contentHash: this.content.hash,
        room: this.info(room),
        game: this.snapshot(room, seat),
      },
    });
  }

  /** Callers add one to `room.rev` when they change anything `RoomInfo` shows. */
  private broadcastRoom(out: Outbound[], room: Room, except?: ConnId) {
    if (!this.rooms.has(room.code)) return;
    const info = this.info(room);
    for (const seat of room.seats) {
      if (seat.conn === null || seat.conn === except) continue;
      out.push({ kind: "send", to: seat.conn, message: { type: "room", room: info } });
    }
  }

  private broadcastUpdate(
    out: Outbound[],
    room: Room,
    by: SeatId | null,
    auto: boolean,
    events: GameEvent[],
  ) {
    const state = room.game?.state;
    if (!state) return;
    for (const seat of room.seats) {
      if (seat.conn === null) continue;
      const view = redactForClient(state, seat.id);
      out.push({
        kind: "send",
        to: seat.conn,
        message: { type: "update", seq: view.actionCount, by, auto, events, view },
      });
    }
  }

  private error(out: Outbound[], conn: ConnId, code: ProtocolErrorCode, message: string) {
    out.push({ kind: "send", to: conn, message: { type: "error", code, message } });
  }
}
