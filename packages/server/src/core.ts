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
 *
 * Time limits in a game (docs/protocol.md §7): a turn timer (a turn that runs
 * out is missed), and a reconnect grace per disconnect, capped by a budget per
 * player. The server never plays for a player; it only misses their turns.
 * The host can remove a player; the engine removes one who misses too many
 * turns in a row.
 */
import * as realEngine from "@fishingjamboree/engine";
import type { Action, Content, GameEvent, GameState, ReplayLog } from "@fishingjamboree/engine";
import type { IdSource } from "./ids";
import { parseClientMessage } from "./parse";
import { parseRoomSnapshot, ROOM_SNAPSHOT_VERSION } from "./snapshot";
import type { RoomSnapshot } from "./snapshot";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  ClientMessage,
  GameSnapshot,
  ProtocolErrorCode,
  RejectionCode,
  RoomInfo,
  RoomStatus,
  RoomTimers,
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
  /**
   * In a game, a player has this long for a whole turn (from its start); then
   * the server misses the turn for them (connected or not). `null`: no turn
   * timer. Copied into each room when it is created.
   */
  turnTimeoutMs: number | null;
  /** In a game, a disconnected player has this long to come back before they are away. */
  reconnectGraceMs: number;
  /** The most reconnect grace one player can use in a whole game, over all their disconnects. */
  reconnectBudgetMs: number;
  /** Pause before the server misses an away player's turn, so others can follow. */
  autoActionDelayMs: number;
  /** A room with no connections at all is deleted after this long. */
  roomIdleTtlMs: number;
  maxNameLength: number;
}

export const DEFAULT_CONFIG: CoreConfig = {
  lobbyGraceMs: 2 * 60_000,
  turnTimeoutMs: 90_000,
  reconnectGraceMs: 60_000,
  reconnectBudgetMs: 2 * 60_000,
  autoActionDelayMs: 2_000,
  roomIdleTtlMs: 30 * 60_000,
  maxNameLength: 20,
};

/** The engine functions the core calls. */
export interface EngineFns {
  applyAction: typeof realEngine.applyAction;
  createGame: typeof realEngine.createGame;
  redactForClient: typeof realEngine.redactForClient;
  replay: typeof realEngine.replay;
}

export interface CoreDeps {
  content: Content;
  /** Milliseconds; only differences matter. */
  now: () => number;
  ids: IdSource;
  config?: Partial<CoreConfig>;
  /** Where the core reports errors it caught (a room that threw). Default: nowhere. */
  log?: (line: string) => void;
  /**
   * Keep track of changed rooms for `takeChanges` (default `true`). Off when
   * nothing saves rooms, so the record does not grow for ever.
   */
  trackChanges?: boolean;
  /** Tests only: replace engine functions (to make a room throw). Default: the real engine. */
  engine?: Partial<EngineFns>;
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
  /** In a game, while disconnected and not away: when the current grace started counting. */
  graceFrom: number | null;
  /** In a game: reconnect grace this player can still use (`reconnectBudgetMs` at the start). */
  graceLeftMs: number;
  /** Removed from the game: no connection, no timers, the token no longer works. */
  removed: boolean;
}

interface Game {
  state: GameState;
  log: ReplayLog;
  /** When the game started or the last action was applied. */
  lastActionAt: number;
  /** When the current turn (or setup placement) started: the turn timer counts from here. */
  turnStartedAt: number;
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
  timers: RoomTimers;
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
  private readonly log: (line: string) => void;
  private readonly engine: EngineFns;
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Map<ConnId, { room: Room; seat: Seat }>();
  /** Codes of rooms that may have changed (or gone) since the last `takeChanges`. */
  private readonly touched = new Set<string>();
  private readonly trackChanges: boolean;

  constructor(deps: CoreDeps) {
    this.content = deps.content;
    this.now = deps.now;
    this.ids = deps.ids;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.log = deps.log ?? (() => {});
    this.trackChanges = deps.trackChanges ?? true;
    this.engine = {
      applyAction: realEngine.applyAction,
      createGame: realEngine.createGame,
      redactForClient: realEngine.redactForClient,
      replay: realEngine.replay,
      ...deps.engine,
    };
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
    this.touchConn(conn);
    try {
      this.dispatch(out, conn, message);
      this.touchConn(conn);
    } catch (error) {
      // A bug, not the player's fault. Whatever was half-built is dropped; the
      // sender is told, so their buttons stop waiting (docs/protocol.md §5).
      const room = this.conns.get(conn)?.room.code ?? "-";
      this.log(`${conn} (room ${room}): error handling "${message.type}": ${describeError(error)}`);
      const reply: Outbound[] = [];
      this.error(reply, conn, "server-error", "the server hit an error; try again");
      return reply;
    }
    return out;
  }

  private dispatch(out: Outbound[], conn: ConnId, message: ClientMessage) {
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
      case "kick":
        this.onKick(out, conn, message);
        break;
    }
  }

  /** The transport calls this when a connection closes for any reason. */
  disconnect(conn: ConnId): Outbound[] {
    const out: Outbound[] = [];
    const bound = this.conns.get(conn);
    if (!bound) return out;
    this.touch(bound.room.code);
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
      // Each room on its own: one that throws is closed (`closeBroken`) and
      // the others still run on this tick.
      const roomOut: Outbound[] = [];
      try {
        for (let step = this.nextStep(room); step && step.at <= now; step = this.nextStep(room)) {
          this.touch(room.code);
          step.run(roomOut);
        }
        out.push(...roomOut);
      } catch (error) {
        this.closeBroken(out, room, error);
      }
    }
    return out;
  }

  /** The time of the earliest thing `tick` has to do, or `null` if nothing is pending. */
  nextDeadline(): number | null {
    let earliest: number | null = null;
    for (const room of this.rooms.values()) {
      let at: number | null;
      try {
        at = this.nextStep(room)?.at ?? null;
      } catch {
        // `tick` meets the same error and closes the room.
        at = this.now();
      }
      if (at !== null && (earliest === null || at < earliest)) earliest = at;
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
  // Saving and restoring rooms (review P2-5; src/snapshot.ts)
  // -------------------------------------------------------------------------

  /**
   * The rooms that may have changed since the last call, as snapshots to
   * save, and the codes of rooms that are gone (to delete). Server-side only:
   * snapshots hold tokens and seeds.
   */
  takeChanges(): { save: RoomSnapshot[]; remove: string[] } {
    const save: RoomSnapshot[] = [];
    const remove: string[] = [];
    for (const code of this.touched) {
      const room = this.rooms.get(code);
      if (room) save.push(this.snapshotOf(room));
      else remove.push(code);
    }
    this.touched.clear();
    return { save, remove };
  }

  /** A snapshot of one room now, or `null`. */
  snapshotRoom(code: string): RoomSnapshot | null {
    const room = this.rooms.get(code);
    return room ? this.snapshotOf(room) : null;
  }

  /**
   * Brings back a saved room (read from disk: anything may be in it). The game
   * is rebuilt by replaying its log and must match the saved state. Everyone
   * starts disconnected, as if all had just dropped: the empty-room rules
   * apply (docs/protocol.md §7). Refused, with the reason, if the snapshot is
   * malformed, its code is taken, its content differs from this server's, or
   * the replay does not match.
   */
  restoreRoom(raw: unknown): { ok: true; code: string } | { ok: false; reason: string } {
    const parsed = parseRoomSnapshot(raw);
    if (!parsed.ok) return parsed;
    const snap = parsed.snapshot;
    const fail = (reason: string) => ({
      ok: false as const,
      reason: `room ${snap.code}: ${reason}`,
    });
    if (this.rooms.has(snap.code)) return fail("a room with that code already exists");
    const seatIds = snap.seats.map((s) => s.id);
    let game: Game | null = null;
    if (snap.game) {
      const { log } = snap.game;
      if (log.contentHash !== this.content.hash) {
        return fail(`saved with content ${log.contentHash}, this server has ${this.content.hash}`);
      }
      if (JSON.stringify(log.setup.players) !== JSON.stringify(seatIds)) {
        return fail("the game's players are not the room's seats");
      }
      let state: GameState;
      try {
        state = this.engine.replay(this.content, log).state;
      } catch (error) {
        return fail(`the replay failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (JSON.stringify(state) !== JSON.stringify(snap.game.state)) {
        return fail("the replay does not match the saved state");
      }
      if ((state.phase.kind === "gameOver") !== (snap.status === "finished")) {
        return fail("the status does not match the game");
      }
      for (const seat of snap.seats) {
        if (state.players.find((p) => p.id === seat.id)?.removed !== seat.removed) {
          return fail(`seat ${seat.id}: removed does not match the game`);
        }
      }
      const now = this.now();
      game = { state, log, lastActionAt: now, turnStartedAt: now };
    } else if (snap.seats.some((s) => s.removed || s.left || s.away)) {
      return fail("a lobby seat cannot be removed, left or away");
    }
    const now = this.now();
    const room: Room = {
      code: snap.code,
      status: snap.status,
      host: snap.host,
      seats: snap.seats.map((s) => ({
        id: s.id,
        name: s.name,
        token: s.token,
        conn: null,
        disconnectedAt: now,
        left: s.left,
        away: s.away,
        graceFrom: null,
        graceLeftMs: Math.min(s.graceLeftMs, snap.timers.reconnectBudgetMs),
        removed: s.removed,
      })),
      // Above anything a client may hold, so the restored room is taken as newer.
      rev: snap.rev + 1,
      game,
      emptySince: now,
      resumedAt: now,
      timers: { ...snap.timers },
    };
    this.rooms.set(room.code, room);
    return { ok: true, code: room.code };
  }

  private snapshotOf(room: Room): RoomSnapshot {
    const now = this.now();
    return {
      kind: "fishingjamboree-room",
      version: ROOM_SNAPSHOT_VERSION,
      code: room.code,
      status: room.status,
      host: room.host,
      rev: room.rev,
      timers: { ...room.timers },
      seats: room.seats.map((s) => ({
        id: s.id,
        name: s.name,
        token: s.token,
        left: s.left,
        away: s.away,
        removed: s.removed,
        // As if a running grace ended now (what `chargeGrace` would leave).
        graceLeftMs:
          s.graceFrom === null
            ? s.graceLeftMs
            : Math.max(
                0,
                s.graceLeftMs - Math.min(now - s.graceFrom, room.timers.reconnectGraceMs),
              ),
      })),
      game: room.game
        ? (JSON.parse(JSON.stringify({ log: room.game.log, state: room.game.state })) as {
            log: ReplayLog;
            state: GameState;
          })
        : null,
    };
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
      timers: {
        turnTimeoutMs: this.config.turnTimeoutMs,
        reconnectGraceMs: this.config.reconnectGraceMs,
        reconnectBudgetMs: this.config.reconnectBudgetMs,
      },
    };
    this.rooms.set(code, room);
    this.touch(code);
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
    if (seat.removed) {
      return this.error(out, conn, "kicked", "you have been removed from this game");
    }
    if (seat.conn !== null) {
      // The newest connection wins (a second tab, or a socket the server has not seen close yet).
      this.conns.delete(seat.conn);
      this.error(out, seat.conn, "replaced", "this seat was opened on another connection");
      out.push({ kind: "close", to: seat.conn, reason: "replaced" });
    }
    this.occupy(room);
    this.chargeGrace(room, seat);
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
    const created = this.engine.createGame(this.content, setup);
    room.game = {
      state: created.state,
      log: { schemaVersion: 1, contentHash: this.content.hash, setup, actions: [] },
      lastActionAt: this.now(),
      turnStartedAt: this.now(),
    };
    room.status = "playing";
    for (const s of room.seats) {
      s.graceFrom = null;
      s.graceLeftMs = room.timers.reconnectBudgetMs;
    }
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
    const result = this.engine.applyAction(this.content, game.state, action);
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

  /** Host only: removes a player from the lobby, or from the game for good. */
  private onKick(out: Outbound[], conn: ConnId, message: ClientMessage & { type: "kick" }) {
    const bound = this.seated(out, conn);
    if (!bound) return;
    const { room, seat } = bound;
    if (seat.id !== room.host) {
      return this.error(out, conn, "not-host", "only the host can remove a player");
    }
    const target = room.seats.find((s) => s.id === message.seat);
    if (!target || target === seat || target.removed) {
      return this.error(out, conn, "cannot-kick", "that player cannot be removed");
    }
    if (room.status === "lobby") {
      this.unbindRemoved(out, target);
      this.removeLobbySeat(out, room, target);
      return;
    }
    const game = room.game;
    if (room.status !== "playing" || !game) {
      return this.error(out, conn, "cannot-kick", "the game is over");
    }
    const action: Action = { type: "removePlayer", player: target.id };
    const result = this.engine.applyAction(this.content, game.state, action);
    if (!result.ok) return this.error(out, conn, "cannot-kick", result.error.message);
    this.commit(out, room, game, action, result.state, result.events, false, seat.id);
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
    by = action.player,
  ) {
    const previousActor = game.state.phase.actors[0];
    game.state = state;
    game.log.actions.push(action);
    game.lastActionAt = this.now();
    // A new turn (or the next setup placement) restarts the turn timer.
    if (events.some((e) => e.type === "turnStarted") || state.phase.actors[0] !== previousActor) {
      game.turnStartedAt = this.now();
    }
    this.broadcastUpdate(out, room, by, auto, events);
    let changed = false;
    for (const e of events) {
      if (e.type !== "playerRemoved") continue;
      const seat = room.seats.find((s) => s.id === e.player);
      if (!seat) continue;
      this.unbindRemoved(out, seat);
      seat.removed = true;
      seat.away = false;
      seat.graceFrom = null;
      if (room.host === seat.id) {
        room.host = room.seats.find((s) => !s.removed)?.id ?? room.host;
      }
      changed = true;
    }
    if (changed && room.emptySince === null && room.seats.every((s) => s.conn === null)) {
      room.emptySince = this.now();
      for (const s of room.seats) this.chargeGrace(room, s);
    }
    if (state.phase.kind === "gameOver") {
      room.status = "finished";
      changed = true;
    }
    if (changed) {
      room.rev += 1;
      this.broadcastRoom(out, room);
    }
  }

  /** Tells a removed player's connection, which then has no seat (it stays open). */
  private unbindRemoved(out: Outbound[], seat: Seat) {
    if (seat.conn === null) return;
    this.error(out, seat.conn, "kicked", "you have been removed from this game");
    this.conns.delete(seat.conn);
    seat.conn = null;
    seat.disconnectedAt = this.now();
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
        const at = this.awayAt(room, seat);
        if (at === null) continue;
        steps.push({ at, run: (out) => this.markAway(out, room, seat) });
      }
      // The server misses an away player's turn after a short delay, and
      // anyone else's (connected or not) when the turn timer runs out.
      const turnDeadline = this.turnDeadline(room, game);
      for (const actor of game.state.phase.actors) {
        const seat = room.seats.find((s) => s.id === actor);
        if (!seat) continue;
        const at = seat.away ? game.lastActionAt + this.config.autoActionDelayMs : turnDeadline;
        if (at === null) continue;
        steps.push({ at, run: (out) => this.missTurn(out, room, game, seat) });
      }
    }
    return steps.reduce<Step | null>((a, b) => (a === null || b.at < a.at ? b : a), null);
  }

  /** When a disconnected player's grace ends, or `null` if none is running. */
  private awayAt(room: Room, seat: Seat): number | null {
    if (room.status !== "playing" || seat.away || seat.graceFrom === null) return null;
    return seat.graceFrom + Math.min(room.timers.reconnectGraceMs, seat.graceLeftMs);
  }

  /** When the turn timer runs out for a deciding player who is not away. */
  private turnDeadline(room: Room, game: Game): number | null {
    const timeout = room.timers.turnTimeoutMs;
    if (timeout === null) return null;
    // Time while nobody was connected does not count: the turn starts again.
    return Math.max(game.turnStartedAt, room.resumedAt) + timeout;
  }

  /** Ends a running grace and takes the time it lasted (at most one grace) from the budget. */
  private chargeGrace(room: Room, seat: Seat) {
    if (seat.graceFrom === null) return;
    const used = Math.min(this.now() - seat.graceFrom, room.timers.reconnectGraceMs);
    seat.graceLeftMs = Math.max(0, seat.graceLeftMs - used);
    seat.graceFrom = null;
  }

  private markAway(out: Outbound[], room: Room, seat: Seat) {
    this.chargeGrace(room, seat);
    seat.away = true;
    room.rev += 1;
    this.broadcastRoom(out, room);
  }

  /** The deciding player is away or out of time: their turn is missed (docs/protocol.md §7). */
  private missTurn(out: Outbound[], room: Room, game: Game, seat: Seat) {
    const action: Action = { type: "missTurn", player: seat.id };
    const result = this.engine.applyAction(this.content, game.state, action);
    if (!result.ok) {
      // Cannot happen: the deciding player can always miss their turn. Fail loudly rather than spin.
      throw new Error(`room ${room.code}: cannot miss ${seat.id}'s turn: ${result.error.message}`);
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
      graceFrom: null,
      graceLeftMs: room.timers.reconnectBudgetMs,
      removed: false,
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
    if (room.status !== "playing") return;
    // Every other disconnected player's grace starts again (docs/protocol.md §7),
    // as far as their budget allows.
    for (const seat of room.seats) {
      if (seat.left || seat.conn !== null || seat.graceLeftMs <= 0) continue;
      seat.away = false;
      seat.graceFrom = room.resumedAt;
    }
  }

  /** The seat loses its connection but stays in the room. */
  private vacate(room: Room, seat: Seat, left: boolean) {
    const playing = room.status === "playing";
    seat.conn = null;
    seat.disconnectedAt = this.now();
    seat.left = left;
    // No grace after `leave`, or once the player's budget is spent.
    seat.away = playing && (left || seat.graceLeftMs <= 0);
    seat.graceFrom = playing && !seat.away ? this.now() : null;
    room.rev += 1;
    if (room.seats.every((s) => s.conn === null)) {
      room.emptySince = this.now();
      // Graces stop counting while nobody is connected.
      for (const s of room.seats) this.chargeGrace(room, s);
    }
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
    this.touch(room.code);
  }

  private touch(code: string) {
    if (this.trackChanges) this.touched.add(code);
  }

  private touchConn(conn: ConnId) {
    const code = this.conns.get(conn)?.room.code;
    if (code !== undefined) this.touch(code);
  }

  /**
   * A room threw while running its timers: it would throw again on every
   * tick, so it is closed for good (notes log "Server errors"). Its players
   * are told and keep their sockets, with no seat; anything the failed tick
   * had built for the room is dropped.
   */
  private closeBroken(out: Outbound[], room: Room, error: unknown) {
    this.log(`room ${room.code}: error in tick, room closed: ${describeError(error)}`);
    for (const seat of room.seats) {
      if (seat.conn === null) continue;
      this.error(out, seat.conn, "room-closed", "this room hit a server error and was closed");
      this.conns.delete(seat.conn);
      seat.conn = null;
    }
    this.deleteRoom(room);
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
        removed: s.removed,
        awayInMs: this.msUntil(this.awayAt(room, s)),
      })),
      minPlayers: this.content.rules.minPlayers,
      maxPlayers: this.content.rules.maxPlayers,
      timers: { ...room.timers },
      rev: room.rev,
    };
  }

  private snapshot(room: Room, seat: Seat): GameSnapshot | null {
    if (!room.game) return null;
    const view = this.engine.redactForClient(room.game.state, seat.id);
    return { seq: view.actionCount, view, turnTimeLeftMs: this.turnTimeLeft(room) };
  }

  private msUntil(at: number | null): number | null {
    return at === null ? null : Math.max(0, at - this.now());
  }

  /** What clients are told about the turn timer: `null` unless it is running for someone. */
  private turnTimeLeft(room: Room): number | null {
    const game = room.game;
    if (!game || room.status !== "playing") return null;
    const deciding = game.state.phase.actors.some(
      (actor) => room.seats.find((s) => s.id === actor)?.away === false,
    );
    return deciding ? this.msUntil(this.turnDeadline(room, game)) : null;
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
    const turnTimeLeftMs = this.turnTimeLeft(room);
    for (const seat of room.seats) {
      if (seat.conn === null) continue;
      const view = this.engine.redactForClient(state, seat.id);
      out.push({
        kind: "send",
        to: seat.conn,
        message: { type: "update", seq: view.actionCount, by, auto, events, view, turnTimeLeftMs },
      });
    }
  }

  private error(out: Outbound[], conn: ConnId, code: ProtocolErrorCode, message: string) {
    out.push({ kind: "send", to: conn, message: { type: "error", code, message } });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
