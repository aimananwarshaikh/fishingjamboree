/** Reading the server's environment (main.ts). Pure, so it can be tested. */
import { DEFAULT_TRANSPORT_CONFIG } from "./transport";
import type { TransportConfig } from "./transport";

/** `PORT` as a TCP port (0 to 65535; 0 picks a free one), or why it is not one. */
export function parsePort(
  raw: string | undefined,
  fallback = 8787,
): { ok: true; port: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, port: fallback };
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, reason: `PORT=${raw} is not a whole number` };
  const port = Number(text);
  if (port > 65535) return { ok: false, reason: `PORT=${raw} is above 65535` };
  return { ok: true, port };
}

/** A whole number from 1 up (limits), or why it is not one. */
export function parseCount(
  name: string,
  raw: string | undefined,
  fallback: number,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || !Number.isSafeInteger(Number(text))) {
    return { ok: false, reason: `${name}=${raw} is not a whole number from 1 up` };
  }
  return { ok: true, value: Number(text) };
}

/** `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off` (any case); unset or blank is `fallback`. */
export function parseFlag(
  name: string,
  raw: string | undefined,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  const text = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return { ok: true, value: true };
  if (["0", "false", "no", "off"].includes(text)) return { ok: true, value: false };
  return { ok: false, reason: `${name}=${raw} is not 1/0 or true/false` };
}

/**
 * `ALLOWED_ORIGINS`: comma-separated page origins, `https://host[:port]`
 * (`http:` too, for local tests). Each is written as a browser sends it:
 * no path, no trailing slash. Unset or blank: any origin (`null`).
 */
export function parseOrigins(
  raw: string | undefined,
): { ok: true; origins: string[] | null } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, origins: null };
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const text = part.trim();
    if (text === "") continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, reason: `ALLOWED_ORIGINS: "${text}" is not an origin like https://host` };
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.origin !== text.toLowerCase()
    ) {
      return {
        ok: false,
        reason: `ALLOWED_ORIGINS: "${text}" must be an http(s) origin with no path or trailing slash (${url.origin})`,
      };
    }
    origins.push(url.origin);
  }
  return origins.length === 0
    ? { ok: false, reason: "ALLOWED_ORIGINS has no origin in it" }
    : { ok: true, origins };
}

export interface ServerSettings {
  port: number;
  host: string | undefined;
  contentDir: string | undefined;
  roomsDir: string | undefined;
  webDir: string | undefined;
  transport: Partial<TransportConfig>;
}

/** Everything `main.ts` reads from the environment; either all of it, or every problem found. */
export function readServerSettings(
  env: Record<string, string | undefined>,
): { ok: true; settings: ServerSettings } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const take = <T>(r: { ok: true; value: T } | { ok: false; reason: string }, fallback: T): T => {
    if (r.ok) return r.value;
    problems.push(r.reason);
    return fallback;
  };
  const port = parsePort(env.PORT);
  if (!port.ok) problems.push(port.reason);
  const defaults = DEFAULT_TRANSPORT_CONFIG;
  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  if (!origins.ok) problems.push(origins.reason);
  const transport: Partial<TransportConfig> = {
    maxConnections: take(
      parseCount("MAX_CONNECTIONS", env.MAX_CONNECTIONS, defaults.maxConnections),
      defaults.maxConnections,
    ),
    maxConnectionsPerIp: take(
      parseCount(
        "MAX_CONNECTIONS_PER_IP",
        env.MAX_CONNECTIONS_PER_IP,
        defaults.maxConnectionsPerIp,
      ),
      defaults.maxConnectionsPerIp,
    ),
    maxRooms: take(parseCount("MAX_ROOMS", env.MAX_ROOMS, defaults.maxRooms), defaults.maxRooms),
    maxBufferedBytes: take(
      parseCount("MAX_BUFFERED_BYTES", env.MAX_BUFFERED_BYTES, defaults.maxBufferedBytes),
      defaults.maxBufferedBytes,
    ),
    trustProxy: take(parseFlag("TRUST_PROXY", env.TRUST_PROXY, defaults.trustProxy), false),
    allowedOrigins: origins.ok ? origins.origins : null,
  };
  if (problems.length > 0 || !port.ok) return { ok: false, problems };
  const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v);
  return {
    ok: true,
    settings: {
      port: port.port,
      host: blank(env.HOST),
      contentDir: blank(env.CONTENT_DIR),
      roomsDir: blank(env.ROOMS_DIR),
      webDir: blank(env.WEB_DIR),
      transport,
    },
  };
}
