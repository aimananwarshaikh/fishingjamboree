/**
 * Starts the game server: an HTTP server (GET /health answers "ok") with the
 * WebSocket endpoint on the same port.
 *
 *   PORT          default 8787
 *   HOST          default all interfaces
 *   CONTENT_DIR   default the repository's content/ folder
 *   ROOMS_DIR     save rooms here (one JSON file each) and restore them on
 *                 start, so a restart does not end games; unset: memory only.
 *                 The files hold seat tokens: keep the folder private.
 *   ALLOWED_ORIGINS         page origins that may connect, comma-separated
 *                           (https://play.example.com); unset: any (logged)
 *   TRUST_PROXY             1 behind a reverse proxy: client address is the
 *                           last X-Forwarded-For entry (default 0)
 *   MAX_CONNECTIONS         sockets in all (default 200)
 *   MAX_CONNECTIONS_PER_IP  sockets per address (default 12)
 *   MAX_ROOMS               rooms at once (default 500)
 *   MAX_BUFFERED_BYTES      drop a socket with more than this queued (1 MiB)
 *   WEB_DIR                 the built web client to serve on the same port
 *                           (default: apps/web/dist when it exists); with it,
 *                           one address serves the page and the game
 * Every variable is described in docs/deploy.md.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readServerSettings } from "./config";
import { fileURLToPath } from "node:url";
import { loadContent } from "./content";
import { createHttpHandler } from "./httpHandler";
import { cryptoIds } from "./ids";
import { fileRoomStore } from "./roomStore";
import { createGameServer } from "./transport";

const read = readServerSettings(process.env);
if (!read.ok) {
  for (const problem of read.problems) console.error(problem);
  process.exit(1);
}
const { port, host, transport } = read.settings;
const contentDir =
  read.settings.contentDir ?? fileURLToPath(new URL("../../../content", import.meta.url));

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const content = loadContent(contentDir);
const roomsDir = read.settings.roomsDir;
const store = roomsDir ? fileRoomStore(roomsDir) : undefined;
log(roomsDir ? `saving rooms in ${roomsDir}` : "ROOMS_DIR not set: rooms are lost on restart");

log(
  transport.allowedOrigins
    ? `accepting browsers from ${transport.allowedOrigins.join(", ")}`
    : "ALLOWED_ORIGINS not set: any website may connect",
);

const defaultWebDir = fileURLToPath(new URL("../../../apps/web/dist", import.meta.url));
const webDir = read.settings.webDir ?? (existsSync(defaultWebDir) ? defaultWebDir : undefined);
log(webDir ? `serving the web client from ${webDir}` : "no web client served (WEB_DIR not set)");

const handle = createHttpHandler({ webDir });
const http = createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`http error: ${String(error)}`);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("server error");
  });
});

const server = await createGameServer({
  core: { content, ids: cryptoIds() },
  server: http,
  transport,
  log,
  ...(store ? { store } : {}),
});

http.listen(port, host, () => {
  log(`fishingjamboree server on ${host ?? "*"}:${port} (content ${content.hash})`);
});

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: closing ${server.connectionCount()} connections`);
  await server.close();
  // Idle keep-alive connections would hold `close` open; a stuck one gets 5 s.
  http.close(() => process.exit(0));
  http.closeIdleConnections();
  setTimeout(() => {
    http.closeAllConnections();
    process.exit(0);
  }, 5_000).unref();
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
