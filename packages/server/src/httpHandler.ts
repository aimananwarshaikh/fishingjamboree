/**
 * The server's plain HTTP side (B5 follow-up): `GET /health`, and, when
 * `webDir` is set, the built web client (`apps/web/dist`), so one address (and
 * one tunnel or one free web service) serves both the page and the game.
 *
 * Only GET and HEAD, only files under `webDir`, never a directory listing. A
 * path that is not a file and has no extension is the app's entry page
 * (`index.html`); a missing file with an extension is a 404.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** The file a URL path names under `root`, or `null` if it would leave it or is malformed. */
export function resolveWebPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const target = normalize(join(root, decoded));
  const base = normalize(root).replace(/[\\/]+$/, "");
  return target === base || target.startsWith(base + sep) ? target : null;
}

export function createHttpHandler(options: { webDir?: string | undefined }) {
  const webDir = options.webDir;

  const plain = (res: ServerResponse, status: number, text: string, extra = {}) =>
    res.writeHead(status, { "content-type": "text/plain", ...extra }).end(text);

  const sendFile = async (
    req: IncomingMessage,
    res: ServerResponse,
    file: string,
    size: number,
  ) => {
    const ext = extname(file).toLowerCase();
    const isPage = ext === ".html";
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-length": size,
      "x-content-type-options": "nosniff",
      // Vite names built files by content, so they never change; the page itself must be re-read.
      "cache-control": isPage ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  };

  const fileInfo = async (path: string) => {
    try {
      const info = await stat(path);
      return info.isFile() ? info : null;
    } catch {
      return null;
    }
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return void plain(res, 200, "ok");
    if (!webDir) return void plain(res, 426, "connect with a WebSocket");
    if (req.method !== "GET" && req.method !== "HEAD") {
      return void plain(res, 405, "method not allowed", { allow: "GET, HEAD" });
    }
    const path = resolveWebPath(webDir, url.pathname === "/" ? "/index.html" : url.pathname);
    if (path === null) return void plain(res, 400, "bad path");
    // An unknown path with no extension is a page of the app; a missing file is a 404.
    let file = path;
    let info = await fileInfo(file);
    if (!info && extname(url.pathname) === "") {
      file = join(webDir, "index.html");
      info = await fileInfo(file);
    }
    if (!info) return void plain(res, 404, "not found");
    await sendFile(req, res, file, info.size);
  };
}
