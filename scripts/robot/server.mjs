/**
 * Starts and stops the real game server for the robot playtests: the built web
 * client is served by it (`apps/web/dist`), rooms are saved in `ROOMS_DIR`
 * (the checks read the finished game from there), and the timers can be
 * shortened (`TURN_TIMEOUT_MS` and friends, testing only).
 */
/* global setTimeout, fetch, URL */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

const SERVER_DIR = fileURLToPath(new URL("../../packages/server", import.meta.url));

export async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

/**
 * `timers`: { turnTimeoutMs, reconnectGraceMs, reconnectBudgetMs, heartbeatMs }.
 * Returns a handle that can be killed (a crash) and started again on the same
 * port and folder (a restart).
 */
export async function startServer({ port, roomsDir, timers, logFile }) {
  const log = createWriteStream(logFile, { flags: "a" });
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    ROOMS_DIR: roomsDir,
    // Every robot player connects from 127.0.0.1.
    MAX_CONNECTIONS_PER_IP: "1000",
    MAX_CONNECTIONS: "1000",
    TURN_TIMEOUT_MS: String(timers.turnTimeoutMs),
    RECONNECT_GRACE_MS: String(timers.reconnectGraceMs),
    RECONNECT_BUDGET_MS: String(timers.reconnectBudgetMs),
    HEARTBEAT_MS: String(timers.heartbeatMs),
  };
  let child = null;
  const handle = {
    port,
    roomsDir,
    async start() {
      child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
        cwd: SERVER_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      const end = Date.now() + 20000;
      for (;;) {
        const ok = await fetch(`http://127.0.0.1:${port}/health`)
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) return;
        if (Date.now() > end) throw new Error(`server on ${port} did not start (see ${logFile})`);
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    /** A crash: no clean shutdown. */
    async kill() {
      if (!child) return;
      const c = child;
      child = null;
      await new Promise((resolve) => {
        c.once("exit", resolve);
        c.kill("SIGKILL");
      });
    },
    async stop() {
      if (!child) return;
      const c = child;
      child = null;
      await new Promise((resolve) => {
        c.once("exit", resolve);
        c.kill("SIGTERM");
        setTimeout(() => c.kill("SIGKILL"), 3000);
      });
      log.end();
    },
  };
  await handle.start();
  return handle;
}
