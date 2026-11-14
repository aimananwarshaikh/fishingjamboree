/**
 * Which game server the client talks to (review P3: `?server=` could send the
 * seat token anywhere). Pure, so it can be tested.
 *
 * - Default: the page's own host on port 8787, `wss` on an `https` page.
 * - `?server=ws://host:port` overrides it only in a dev build (`pnpm dev:web`),
 *   or, in a production build, when the server's origin is on the allow-list
 *   set at build time: `VITE_ALLOWED_SERVERS=wss://a.example,wss://b.example`.
 * - Only `ws:` and `wss:` are ever used, and only `wss:` from an `https` page.
 *
 * Anything else is ignored and the default is used: the client then never
 * sends a saved seat token to a server it was not built for.
 */

export interface PageLocation {
  search: string;
  protocol: string;
  hostname: string;
}

export interface ServerUrlOptions {
  /** A dev build (`import.meta.env.DEV`). */
  dev: boolean;
  /** Origins (`wss://host[:port]`) a production build may be pointed at. */
  allowed: readonly string[];
}

export interface ResolvedServer {
  url: string;
  /** Why `?server=` was not used, or `null` if there was none or it was used. */
  ignored: string | null;
}

const DEFAULT_PORT = 8787;

/** `ws:`/`wss:` URL → its origin (`wss://host:port`, port only when not the default), or `null`. */
function wsOrigin(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.host}`;
}

/** Reads `VITE_ALLOWED_SERVERS`: a comma-separated list; anything not `ws:`/`wss:` is dropped. */
export function parseAllowList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => wsOrigin(s.trim()))
    .filter((o): o is string => o !== null);
}

export function resolveServerUrl(page: PageLocation, options: ServerUrlOptions): ResolvedServer {
  const secure = page.protocol === "https:";
  const fallback = `${secure ? "wss" : "ws"}://${page.hostname || "localhost"}:${DEFAULT_PORT}`;
  const asked = new URLSearchParams(page.search).get("server");
  if (!asked) return { url: fallback, ignored: null };
  const ignore = (why: string) => ({
    url: fallback,
    ignored: `?server=${asked} ignored: ${why}; using ${fallback}`,
  });
  const origin = wsOrigin(asked);
  if (origin === null) return ignore("not a ws:// or wss:// address");
  if (secure && origin.startsWith("ws:")) return ignore("an https page can only use wss://");
  if (!options.dev && !options.allowed.includes(origin)) {
    return ignore("that server is not allowed in this build");
  }
  return { url: asked, ignored: null };
}
