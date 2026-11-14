/** Reading the server's environment (main.ts). Pure, so it can be tested. */

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
