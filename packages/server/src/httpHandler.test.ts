/** The HTTP side of the server: /health, the built web client, and no way out of its folder. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cryptoIds } from "./ids";
import { PROTOCOL_VERSION as V } from "./protocol";
import { content } from "./testHarness";
import { createGameServer } from "./transport";
import type { GameServer } from "./transport";
import { createHttpHandler, resolveWebPath } from "./httpHandler";
import { TestClient } from "./wsTestClient";

let root: string;
let outside: string;
beforeAll(() => {
  const parent = mkdtempSync(join(tmpdir(), "jamboree-web-"));
  root = join(parent, "dist");
  outside = join(parent, "secret.txt");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(outside, "TOP SECRET");
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Jamboree</title>");
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "board-abc.webp"), "RIFF");
});

let servers: { http: Server; game: GameServer | null }[] = [];
afterEach(async () => {
  for (const s of servers) {
    await s.game?.close();
    s.http.closeAllConnections();
    await new Promise((r) => s.http.close(r));
  }
  servers = [];
});

async function start(webDir: string | undefined, withGame = false) {
  const handle = createHttpHandler({ webDir });
  const http = createServer((req, res) => void handle(req, res));
  const game = withGame
    ? await createGameServer({ core: { content, ids: cryptoIds() }, server: http })
    : null;
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  servers.push({ http, game });
  const addr = http.address() as { port: number };
  return { base: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

/** A raw request, so `..` and encoded paths reach the server unchanged. */
async function raw(port: number, path: string, method = "GET") {
  const { request } = await import("node:http");
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    },
  );
}

describe("resolveWebPath", () => {
  it("stays inside the folder", () => {
    expect(resolveWebPath("/srv/dist", "/assets/a.js")).toBe("/srv/dist/assets/a.js");
    expect(resolveWebPath("/srv/dist", "/../secret")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/assets/../../secret")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/%2e%2e/secret")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/..%2fsecret")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/%00")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/a\\..\\..\\b")).toBeNull();
    expect(resolveWebPath("/srv/dist", "/%E0%A4%A")).toBeNull();
    // A sibling folder with the same prefix is not inside it.
    expect(resolveWebPath("/srv/dist", "/../dist2/x")).toBeNull();
  });
});

describe("the web client over HTTP", () => {
  it("answers /health, with or without a web folder", async () => {
    for (const dir of [undefined, root]) {
      const { port } = await start(dir);
      expect(await raw(port, "/health")).toMatchObject({ status: 200, body: "ok" });
    }
  });

  it("without a web folder answers 426 as before", async () => {
    const { port } = await start(undefined);
    expect(await raw(port, "/")).toMatchObject({ status: 426 });
  });

  it("serves the entry page at / and for a path with no extension (never cached)", async () => {
    const { port } = await start(root);
    for (const path of ["/", "/index.html", "/lobby", "/room/KTBM"]) {
      const r = await raw(port, path);
      expect(r.status).toBe(200);
      expect(r.body).toContain("<title>Jamboree</title>");
      expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(r.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves built files with their type and long caching, and HEAD without a body", async () => {
    const { port } = await start(root);
    const js = await raw(port, "/assets/app-abc123.js");
    expect(js).toMatchObject({ status: 200, body: "console.log(1)" });
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.headers["cache-control"]).toContain("immutable");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");
    expect((await raw(port, "/assets/board-abc.webp")).headers["content-type"]).toBe("image/webp");
    const head = await raw(port, "/assets/app-abc123.js", "HEAD");
    expect(head).toMatchObject({ status: 200, body: "" });
    expect(head.headers["content-length"]).toBe("14");
  });

  it("answers 404 for a missing file with an extension, and for a directory-less miss only with an extension", async () => {
    const { port } = await start(root);
    expect(await raw(port, "/assets/gone-1.js")).toMatchObject({ status: 404 });
    expect(await raw(port, "/favicon.ico")).toMatchObject({ status: 404 });
    // A directory is not a file: no listing, the entry page instead.
    expect((await raw(port, "/assets")).body).toContain("<title>Jamboree</title>");
  });

  it("refuses other methods with 405", async () => {
    const { port } = await start(root);
    const r = await raw(port, "/", "POST");
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET, HEAD");
  });

  it("cannot be walked out of its folder", async () => {
    const { port } = await start(root);
    for (const path of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/assets/../../secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
    ]) {
      const r = await raw(port, path);
      expect(r.body).not.toContain("TOP SECRET");
    }
  });

  it("shares the port with the game: a WebSocket still connects and plays", async () => {
    const { port, base } = await start(root, true);
    expect(await raw(port, "/")).toMatchObject({ status: 200 });
    const client = await TestClient.connect(base.replace("http", "ws"));
    client.send({ type: "create", v: V, name: "Ann" });
    expect((await client.waitFor("welcome")).seat).toBe("p1");
    client.ws.close();
  });
});
