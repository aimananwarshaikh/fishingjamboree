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
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadContent } from "./content";
import { cryptoIds } from "./ids";
import { fileRoomStore } from "./roomStore";
import { createGameServer } from "./transport";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST;
const contentDir =
  process.env.CONTENT_DIR ?? fileURLToPath(new URL("../../../content", import.meta.url));

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const content = loadContent(contentDir);
const roomsDir = process.env.ROOMS_DIR;
const store = roomsDir ? fileRoomStore(roomsDir) : undefined;
log(roomsDir ? `saving rooms in ${roomsDir}` : "ROOMS_DIR not set: rooms are lost on restart");

const http = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" }).end("connect with a WebSocket");
});

const server = await createGameServer({
  core: { content, ids: cryptoIds() },
  server: http,
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
  http.close(() => process.exit(0));
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
