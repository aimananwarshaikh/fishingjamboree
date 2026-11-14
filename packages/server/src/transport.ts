/**
 * The WebSocket transport around `ServerCore` (docs/protocol.md §9). Each
 * socket gets its own connection id; each text frame is one JSON message. The
 * core decides everything about rooms and games; this file only moves bytes,
 * keeps time and protects the server:
 *
 *   - `Outbound` is carried out in order (sends, then closes after them).
 *   - `core.disconnect` is called exactly once per closed socket.
 *   - `core.tick` runs on a timer set from `core.nextDeadline()`.
 *   - Heartbeats (ping/pong) notice dead sockets; frames over
 *     `maxMessageBytes` close the socket (1009); a token bucket per socket
 *     closes floods (1008); `maxRooms` caps the number of rooms.
 */
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { ServerCore } from "./core";
import type { ConnId, CoreDeps, Outbound } from "./core";
import type { ServerMessage } from "./protocol";

export interface TransportConfig {
  /** Largest client frame accepted; a bigger one closes the socket with 1009. */
  maxMessageBytes: number;
  /** A ping is sent this often; a socket that has not answered the previous ping is dropped. */
  heartbeatIntervalMs: number;
  /** Messages a socket may send at once, before the refill rate applies. */
  rateBurst: number;
  /** Messages per second a socket may keep sending; more closes it with 1008. */
  ratePerSecond: number;
  /** `create` is answered `server-busy` while this many rooms exist. */
  maxRooms: number;
  /** After an error thrown by `core.tick`, wait at least this long before the next tick. */
  tickRetryMs: number;
}

export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  maxMessageBytes: 4 * 1024,
  heartbeatIntervalMs: 15_000,
  rateBurst: 30,
  ratePerSecond: 10,
  maxRooms: 500,
  tickRetryMs: 1_000,
};

/** WebSocket close codes this server uses. */
export const CLOSE_CODES = {
  /** The core asked for the close; the reason is the core's (for example `replaced`). */
  core: 4000,
  /** RFC 6455 "policy violation": too many messages. */
  rateLimited: 1008,
  /** RFC 6455 "going away": the server is shutting down. */
  shutdown: 1001,
} as const;

export interface GameServerOptions {
  /** What the core is built from. Its `now` is also the transport's clock (default `Date.now`). */
  core: Omit<CoreDeps, "now"> & { now?: () => number };
  transport?: Partial<TransportConfig>;
  /** Attach to an existing HTTP server (the caller listens and closes it)... */
  server?: HttpServer;
  /** ...or listen on this port (0 picks a free one). */
  port?: number;
  host?: string;
  log?: (line: string) => void;
}

export interface GameServer {
  readonly core: ServerCore;
  readonly wss: WebSocketServer;
  /** The port listened on (also when attached to an HTTP server that is listening). */
  port(): number;
  /** Live sockets. */
  connectionCount(): number;
  /** Stops the timers, closes every socket (each is disconnected from the core) and the server. */
  close(): Promise<void>;
}

interface Conn {
  id: ConnId;
  ws: WebSocket;
  /** Answered the last ping. */
  alive: boolean;
  /** No more messages are read from this socket (the server is closing it). */
  closing: boolean;
  tokens: number;
  refilledAt: number;
  closed: Promise<void>;
}

export async function createGameServer(options: GameServerOptions): Promise<GameServer> {
  const config: TransportConfig = { ...DEFAULT_TRANSPORT_CONFIG, ...options.transport };
  const now = options.core.now ?? Date.now;
  const log = options.log ?? (() => {});
  const core = new ServerCore({ log, ...options.core, now });

  const wsOptions = { maxPayload: config.maxMessageBytes };
  const wss = options.server
    ? new WebSocketServer({ ...wsOptions, server: options.server })
    : new WebSocketServer({
        ...wsOptions,
        port: options.port ?? 0,
        ...(options.host === undefined ? {} : { host: options.host }),
      });
  if (!options.server) {
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
  }

  const conns = new Map<ConnId, Conn>();
  let nextConn = 1;
  let shuttingDown = false;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Carrying out what the core asks for -------------------------------

  const send = (conn: Conn, message: ServerMessage) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(message));
  };

  const closeConn = (conn: Conn, code: number, reason: string) => {
    conn.closing = true;
    // `ws` sends the close frame after anything already queued on the socket.
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close(code, reason);
  };

  const carryOut = (out: Outbound[]) => {
    for (const o of out) {
      const conn = conns.get(o.to);
      if (!conn) continue;
      if (o.kind === "send") send(conn, o.message);
      else closeConn(conn, CLOSE_CODES.core, o.reason);
    }
  };

  /**
   * Runs a core call, carries out its result and re-arms the tick timer. The
   * core catches its own errors per room and per message (review P2-4); this
   * is the last line of defence. `onError` builds a reply when it fires.
   */
  const run = (what: string, call: () => Outbound[], onError?: () => Outbound[]) => {
    let out: Outbound[] = [];
    let failed = false;
    try {
      out = call();
    } catch (error) {
      failed = true;
      log(
        `core error in ${what}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      out = onError?.() ?? [];
    }
    carryOut(out);
    schedule(failed);
  };

  const schedule = (afterError = false) => {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = null;
    if (shuttingDown) return;
    let deadline: number | null;
    try {
      deadline = core.nextDeadline();
    } catch (error) {
      log(`core error in nextDeadline: ${String(error)}`);
      deadline = now() + config.tickRetryMs;
    }
    if (deadline === null) return;
    if (afterError) deadline = Math.max(deadline, now() + config.tickRetryMs);
    const delay = Math.min(Math.max(deadline - now(), 0), 2 ** 31 - 1);
    tickTimer = setTimeout(() => run("tick", () => core.tick()), delay);
  };

  // --- Rate limit and room cap --------------------------------------------

  const withinRate = (conn: Conn): boolean => {
    const t = now();
    conn.tokens = Math.min(
      config.rateBurst,
      conn.tokens + ((t - conn.refilledAt) / 1000) * config.ratePerSecond,
    );
    conn.refilledAt = t;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  };

  const isCreate = (raw: unknown) =>
    typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "create";

  // --- Sockets ------------------------------------------------------------

  const onMessage = (conn: Conn, data: RawData, isBinary: boolean) => {
    if (conn.closing) return;
    if (!withinRate(conn)) {
      log(`${conn.id}: rate limit, closing`);
      closeConn(conn, CLOSE_CODES.rateLimited, "rate limit");
      return;
    }
    const badMessage = (reason: string) =>
      send(conn, { type: "error", code: "bad-message", message: reason });
    if (isBinary) return badMessage("send JSON text frames");
    let raw: unknown;
    try {
      raw = JSON.parse(rawToString(data));
    } catch {
      return badMessage("not valid JSON");
    }
    if (isCreate(raw) && core.roomCodes().length >= config.maxRooms) {
      send(conn, {
        type: "error",
        code: "server-busy",
        message: "the server has too many rooms; try again later",
      });
      return;
    }
    run(
      "handleMessage",
      () => core.handleMessage(conn.id, raw),
      () => [
        {
          kind: "send",
          to: conn.id,
          message: { type: "error", code: "server-error", message: "the server hit an error" },
        },
      ],
    );
  };

  wss.on("connection", (ws) => {
    const id: ConnId = `ws-${nextConn++}`;
    let markClosed = () => {};
    const conn: Conn = {
      id,
      ws,
      alive: true,
      closing: false,
      tokens: config.rateBurst,
      refilledAt: now(),
      closed: new Promise<void>((resolve) => (markClosed = resolve)),
    };
    conns.set(id, conn);
    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on("error", (error) => log(`${id}: socket error: ${error.message}`));
    // `close` fires once per socket, whoever closed it and however.
    ws.on("close", () => {
      if (conns.get(id) === conn) {
        conns.delete(id);
        run("disconnect", () => core.disconnect(id));
      }
      markClosed();
    });
    if (shuttingDown) ws.close(CLOSE_CODES.shutdown, "server shutting down");
  });

  const heartbeat = setInterval(() => {
    for (const conn of conns.values()) {
      if (!conn.alive) {
        log(`${conn.id}: no pong, dropping`);
        conn.closing = true;
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
    }
  }, config.heartbeatIntervalMs);

  return {
    core,
    wss,
    port: () => {
      const address = wss.address();
      if (address === null || typeof address === "string") throw new Error("not listening");
      return address.port;
    },
    connectionCount: () => conns.size,
    close: async () => {
      shuttingDown = true;
      clearInterval(heartbeat);
      if (tickTimer) clearTimeout(tickTimer);
      tickTimer = null;
      const closing = [...conns.values()];
      for (const conn of closing) {
        conn.closing = true;
        conn.ws.terminate();
      }
      await Promise.all(closing.map((c) => c.closed));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
