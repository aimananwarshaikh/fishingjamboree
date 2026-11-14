/**
 * Where saved rooms live (review P2-5): one JSON file per room in a directory,
 * `<CODE>.json`, written whole after each change (to a temporary file, then
 * renamed, so a crash mid-write never leaves half a file). The files hold
 * seat tokens and game seeds: they are created readable by the server's user
 * only, and must never be served.
 *
 * `RoomStore` is what the transport needs; another store (a database, for
 * deployment) can implement it without touching the core.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoomSnapshot } from "./snapshot";

/** One saved room as read back: its parsed JSON, or why it could not be read. */
export type StoredRoom = { file: string; data: unknown } | { file: string; error: string };

export interface RoomStore {
  /** Everything saved. Never throws for one bad entry: it comes back with `error`. */
  load(): StoredRoom[];
  save(snapshot: RoomSnapshot): void;
  remove(code: string): void;
  /** Moves an entry that could not be restored out of the way (kept for a look, never loaded again). */
  discard(file: string): void;
}

const FILE = /^([A-Z0-9]{1,16})\.json$/;

export function fileRoomStore(dir: string): RoomStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  /** What each file last held, so an unchanged room is not written again. */
  const written = new Map<string, string>();
  const pathOf = (code: string) => {
    if (!/^[A-Z0-9]{1,16}$/.test(code)) throw new Error(`not a room code: ${JSON.stringify(code)}`);
    return join(dir, `${code}.json`);
  };
  return {
    load() {
      const rooms: StoredRoom[] = [];
      for (const file of readdirSync(dir).sort()) {
        const match = FILE.exec(file);
        if (!match) continue;
        try {
          const text = readFileSync(join(dir, file), "utf8");
          rooms.push({ file, data: JSON.parse(text) as unknown });
          written.set(match[1]!, text);
        } catch (error) {
          rooms.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return rooms;
    },
    save(snapshot) {
      const path = pathOf(snapshot.code);
      const text = JSON.stringify(snapshot);
      if (written.get(snapshot.code) === text) return;
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, path);
      written.set(snapshot.code, text);
    },
    remove(code) {
      rmSync(pathOf(code), { force: true });
      written.delete(code);
    },
    discard(file) {
      const match = FILE.exec(file);
      if (!match) return;
      renameSync(join(dir, file), join(dir, `${file}.bad`));
      written.delete(match[1]!);
    },
  };
}
