/**
 * Review P2-5 on disk and over real sockets: `fileRoomStore` (one JSON file
 * per room) and a server restarted on the same folder.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLegalActions, redactForClient, replay } from "@fishingjamboree/engine";
import type { Action } from "@fishingjamboree/engine";
import { cryptoIds } from "./ids";
import { PROTOCOL_VERSION as V } from "./protocol";
import { fileRoomStore } from "./roomStore";
import type { RoomSnapshot } from "./snapshot";
import { content, harness, strip } from "./testHarness";
import { createGameServer } from "./transport";
import type { GameServer } from "./transport";
import { TestClient } from "./wsTestClient";

let dirs: string[] = [];
let servers: GameServer[] = [];
let clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients) if (c.open) c.ws.terminate();
  await Promise.all(servers.map((s) => s.close()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  servers = [];
  clients = [];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fj-rooms-"));
  dirs.push(dir);
  return dir;
}

/** A lobby snapshot from a real core. */
function lobbySnapshot(): RoomSnapshot {
  const h = harness();
  const { code } = h.lobby(2);
  return h.core.snapshotRoom(code)!;
}

describe("fileRoomStore", () => {
  it("saves one private file per room and reads it back", () => {
    const dir = tempDir();
    const store = fileRoomStore(dir);
    const snap = lobbySnapshot();
    store.save(snap);
    expect(readdirSync(dir)).toEqual([`${snap.code}.json`]);
    expect(statSync(join(dir, `${snap.code}.json`)).mode & 0o077).toBe(0);
    expect(fileRoomStore(dir).load()).toEqual([{ file: `${snap.code}.json`, data: snap }]);
    store.remove(snap.code);
    expect(readdirSync(dir)).toEqual([]);
    store.remove(snap.code); // already gone: fine
  });

  it("does not write a room again when nothing in it changed", () => {
    const dir = tempDir();
    const store = fileRoomStore(dir);
    const snap = lobbySnapshot();
    store.save(snap);
    const path = join(dir, `${snap.code}.json`);
    writeFileSync(path, "marker");
    store.save(snap);
    expect(readFileSync(path, "utf8")).toBe("marker");
    store.save({ ...snap, rev: snap.rev + 1 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ rev: snap.rev + 1 });
  });

  it("reports unreadable files without throwing, ignores other files, and moves bad ones aside", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "BAD1.json"), "{ not json");
    writeFileSync(join(dir, "BCDF.json.tmp"), "half a write");
    writeFileSync(join(dir, "notes.txt"), "hello");
    const store = fileRoomStore(dir);
    const loaded = store.load();
    expect(loaded).toEqual([{ file: "BAD1.json", error: expect.any(String) }]);
    store.discard("BAD1.json");
    expect(readdirSync(dir).sort()).toEqual(["BAD1.json.bad", "BCDF.json.tmp", "notes.txt"]);
    expect(store.load()).toEqual([]);
  });

  it("refuses a code that is not a room code (no paths)", () => {
    const store = fileRoomStore(tempDir());
    expect(() => store.remove("../x")).toThrow();
    expect(() => store.save({ ...lobbySnapshot(), code: "../x" })).toThrow();
  });
});

describe("a server restarted on the same folder", () => {
  async function start(dir: string, lines: string[] = []) {
    const server = await createGameServer({
      core: { content, ids: cryptoIds(), config: { turnTimeoutMs: null } },
      transport: { rateBurst: 1e6, ratePerSecond: 1e6 },
      host: "127.0.0.1",
      store: fileRoomStore(dir),
      log: (line) => lines.push(line),
    });
    servers.push(server);
    const url = `ws://127.0.0.1:${server.port()}`;
    const connect = async () => {
      const client = await TestClient.connect(url);
      clients.push(client);
      return client;
    };
    return { server, connect, lines };
  }

  /** The client holding the deciding seat plays its first legal action and waits for the update. */
  async function act(seats: TestClient[]) {
    const view = seats[0]!.view!;
    const actor = view.phase.actors[0]!;
    const client = seats[Number(actor.slice(1)) - 1]!;
    const action = getLegalActions(content, client.view!, actor)[0] as Action;
    const seq = client.view!.actionCount;
    client.send({ type: "intent", clientActionId: `a${seq}`, seq, action: strip(action) });
    await Promise.all(seats.map((c) => c.waitFor("update", (m) => m.seq === seq + 1)));
  }

  it("keeps the game: players rejoin with their tokens and play on to the end", async () => {
    const dir = tempDir();
    const first = await start(dir);
    const host = await first.connect();
    host.send({ type: "create", v: V, name: "Ann" });
    const w1 = await host.waitFor("welcome");
    const code = w1.room.code;
    const guest = await first.connect();
    guest.send({ type: "join", v: V, code, name: "Bob" });
    const w2 = await guest.waitFor("welcome");
    host.send({ type: "start" });
    await Promise.all([host, guest].map((c) => c.waitFor("update", (m) => m.seq === 0)));
    for (let i = 0; i < 6; i += 1) await act([host, guest]);
    const before = first.server.core.replayLog(code)!;
    expect(before.actions).toHaveLength(6);
    // The file on disk is the room as it is now.
    const onDisk = JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as RoomSnapshot;
    expect(onDisk.game!.log).toEqual(before);
    await first.server.close();
    servers = servers.filter((s) => s !== first.server);

    const second = await start(dir);
    expect(second.lines).toContain("restored 1 of 1 saved rooms");
    expect(second.server.core.replayLog(code)).toEqual(before);
    const a = await second.connect();
    const b = await second.connect();
    a.send({ type: "rejoin", v: V, code, seatToken: w1.seatToken });
    b.send({ type: "rejoin", v: V, code, seatToken: w2.seatToken });
    const [ra] = await Promise.all([a.waitFor("welcome"), b.waitFor("welcome")]);
    expect(ra.game!.seq).toBe(6);
    expect(ra.game!.view).toEqual(redactForClient(replay(content, before).state, "p1"));
    for (let guard = 0; second.server.core.roomInfo(code)!.status === "playing"; guard += 1) {
      if (guard > 5_000) throw new Error("the game never ended");
      await act([a, b]);
    }
    const log = second.server.core.replayLog(code)!;
    expect(replay(content, log).state.phase.kind).toBe("gameOver");
    expect(log.actions.slice(0, 6)).toEqual(before.actions);
    // No client ever saw the seed or an RNG state.
    const seen = JSON.stringify([host, guest, a, b].map((c) => c.messages));
    expect(seen).not.toContain(log.setup.seed);
    expect(seen).not.toContain('"rng"');
  });

  it("skips and logs a corrupt or unrestorable file, moves it aside, and serves the rest", async () => {
    const dir = tempDir();
    const good = lobbySnapshot();
    writeFileSync(join(dir, `${good.code}.json`), JSON.stringify(good));
    writeFileSync(join(dir, "ZZZZ.json"), "{ cut off");
    writeFileSync(join(dir, "YYYY.json"), JSON.stringify({ ...good, code: "YYYY", seats: [] }));
    const { server, connect, lines } = await start(dir);
    expect(server.core.roomCodes()).toEqual([good.code]);
    expect(lines.some((l) => l.includes("ZZZZ.json") && l.includes("unreadable"))).toBe(true);
    expect(lines.some((l) => l.includes("YYYY.json") && l.includes("skipped"))).toBe(true);
    expect(lines).toContain("restored 1 of 3 saved rooms");
    expect(readdirSync(dir).sort()).toEqual([
      `${good.code}.json`,
      "YYYY.json.bad",
      "ZZZZ.json.bad",
    ]);
    // The server works: a new room can be made and is saved.
    const c = await connect();
    c.send({ type: "create", v: V, name: "Cy" });
    const w = await c.waitFor("welcome");
    expect(readdirSync(dir)).toContain(`${w.room.code}.json`);
  });

  it("deletes the file when the room goes", async () => {
    const dir = tempDir();
    const { connect } = await start(dir);
    const c = await connect();
    c.send({ type: "create", v: V, name: "Ann" });
    const w = await c.waitFor("welcome");
    expect(readdirSync(dir)).toEqual([`${w.room.code}.json`]);
    c.send({ type: "leave" });
    await c.waitFor("left");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a folder that cannot be read does not stop the server", async () => {
    const lines: string[] = [];
    const server = await createGameServer({
      core: { content, ids: cryptoIds() },
      host: "127.0.0.1",
      log: (line) => lines.push(line),
      store: {
        load: () => {
          throw new Error("disk on fire");
        },
        save: () => {
          throw new Error("disk full");
        },
        remove: () => {},
        discard: () => {},
      },
    });
    servers.push(server);
    expect(lines.some((l) => l.includes("disk on fire"))).toBe(true);
    const c = await TestClient.connect(`ws://127.0.0.1:${server.port()}`);
    clients.push(c);
    c.send({ type: "create", v: V, name: "Ann" });
    await c.waitFor("welcome");
    expect(lines.some((l) => l.includes("could not save") && l.includes("disk full"))).toBe(true);
  });
});
