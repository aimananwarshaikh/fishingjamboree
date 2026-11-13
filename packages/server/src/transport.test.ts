/**
 * Integration tests: real WebSocket clients against `createGameServer` on a
 * free port, with the real content and real (crypto) ids.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLegalActions, redactForClient, replay } from "@fishingjamboree/engine";
import type { Action, PlayerView } from "@fishingjamboree/engine";
import { cryptoIds } from "./ids";
import { PROTOCOL_VERSION as V } from "./protocol";
import type { CoreConfig } from "./core";
import type { SeatId } from "./protocol";
import { strip, content } from "./testHarness";
import { CLOSE_CODES, createGameServer } from "./transport";
import type { GameServer, TransportConfig } from "./transport";
import { eventually, TestClient } from "./wsTestClient";

let servers: GameServer[] = [];
let clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients) if (c.open) c.ws.terminate();
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  clients = [];
});

async function start(transport: Partial<TransportConfig> = {}, config: Partial<CoreConfig> = {}) {
  const server = await createGameServer({
    core: { content, ids: cryptoIds(), config },
    transport,
    host: "127.0.0.1",
  });
  servers.push(server);
  const disconnects = vi.spyOn(server.core, "disconnect");
  const url = `ws://127.0.0.1:${server.port()}`;
  const connect = async (options = {}) => {
    const client = await TestClient.connect(url, options);
    clients.push(client);
    return client;
  };
  return { server, disconnects, connect };
}

/** `create` + `join`s: client i holds seat p(i+1). */
async function lobby(connect: () => Promise<TestClient>, n: number) {
  const seats: TestClient[] = [];
  const host = await connect();
  host.send({ type: "create", v: V, name: "Ann" });
  const first = await host.waitFor("welcome");
  const code = first.room.code;
  const tokens = [first.seatToken];
  seats.push(host);
  for (let i = 1; i < n; i += 1) {
    const c = await connect();
    c.send({ type: "join", v: V, code: code.toLowerCase(), name: `Player ${i + 1}` });
    const welcome = await c.waitFor("welcome");
    expect(welcome.seat).toBe(`p${i + 1}`);
    tokens.push(welcome.seatToken);
    seats.push(c);
  }
  return { code, tokens, seats };
}

const seatOf = (seat: SeatId) => Number(seat.slice(1)) - 1;

const lastRoom = (c: TestClient) => c.messages.filter((m) => m.type === "room").at(-1);

describe("a whole game over WebSockets", () => {
  it("3 clients create, join, play to a scored result, with one disconnect and rejoin", async () => {
    // Clients answer instantly, so lift the rate limit for this test.
    const { server, disconnects, connect } = await start({ rateBurst: 1e6, ratePerSecond: 1e6 });
    const { code, tokens, seats } = await lobby(connect, 3);

    seats[0]!.send({ type: "start" });
    await Promise.all(seats.map((c) => c.waitFor("update", (m) => m.seq === 0)));

    const view = (c: TestClient): PlayerView => {
      if (!c.view) throw new Error("no view");
      return c.view;
    };
    const REJOIN_AT = 30;
    let seq = 0;
    let rejoined = false;
    for (;;) {
      const v = view(seats[0]!);
      const actor = v.phase.actors[0];
      if (!actor) break;
      if (seq > 5_000) throw new Error("the game did not end");

      if (seq === REJOIN_AT && !rejoined) {
        rejoined = true;
        // Bob's socket drops; the others are told.
        const bob = seats[1]!;
        bob.ws.close();
        await bob.closed;
        await seats[0]!.waitFor("room", (m) => m.room.seats[1]!.connected === false);
        await seats[2]!.waitFor("room", (m) => m.room.seats[1]!.connected === false);
        expect(disconnects).toHaveBeenCalledTimes(1);

        // Bob comes back on a new socket with his seat token.
        const back = await connect();
        back.send({ type: "rejoin", v: V, code, seatToken: tokens[1] });
        const welcome = await back.waitFor("welcome");
        expect(welcome).toMatchObject({ seat: "p2", seatToken: tokens[1] });
        expect(welcome.room.status).toBe("playing");
        expect(welcome.game?.seq).toBe(seq);
        expect(welcome.game?.view).toEqual({ ...view(seats[0]!), viewer: "p2" });
        for (const other of [seats[0]!, seats[2]!]) {
          await other.waitFor("room", (m) => m.room.rev === welcome.room.rev);
          expect(lastRoom(other)?.room.seats[1]?.connected).toBe(true);
        }
        expect(back.types()).toEqual(["welcome"]);
        seats[1] = back;
        continue;
      }

      const client = seats[seatOf(actor)]!;
      const legal: Action[] = getLegalActions(content, view(client), actor);
      const action = legal[(seq * 7 + 3) % legal.length]!;
      client.send({ type: "intent", clientActionId: `a${seq}`, seq, action: strip(action) });
      seq += 1;
      const target = seq;
      await Promise.all(seats.map((c) => c.waitFor("update", (m) => m.seq === target)));
    }

    expect(rejoined).toBe(true);
    const final = view(seats[0]!);
    expect(final.phase.kind).toBe("gameOver");
    expect(final.round).toBe(content.rules.rounds);
    expect(final.result?.scores).toHaveLength(3);
    expect(final.result?.winners.length).toBeGreaterThan(0);

    // Every client ends with the last update and then a room message saying "finished".
    for (const c of seats) {
      await c.waitFor("room", (m) => m.room.status === "finished");
      expect(c.types().slice(-2)).toEqual(["update", "room"]);
      expect(view(c).result).toEqual(final.result);
      expect(c.types()).not.toContain("rejected");
      expect(c.types().filter((t) => t.startsWith("error"))).toEqual([]);
    }

    // The server's replay log reproduces what every client saw.
    const log = server.core.replayLog(code)!;
    expect(log.actions).toHaveLength(seq);
    const replayed = replay(content, log);
    seats.forEach((c, i) => {
      expect(view(c)).toEqual(redactForClient(replayed.state, `p${i + 1}`));
    });

    // Nothing private reached a client: no seed, no RNG, no other seat's token.
    const everyone = [...clients];
    for (const c of everyone) {
      const own = c.messages.find((m) => m.type === "welcome");
      for (const m of c.messages) {
        const json = JSON.stringify(m);
        expect(json).not.toContain(log.setup.seed);
        expect(json).not.toContain('"rng"');
        for (const token of tokens) {
          if (own?.type === "welcome" && own.seatToken === token) continue;
          expect(json).not.toContain(token);
        }
      }
    }

    // Shutting down disconnects every socket from the core exactly once.
    const opened = server.connectionCount() + 1; // the 3 live ones + Bob's first socket
    await server.close();
    servers = [];
    const ids = disconnects.mock.calls.map((call) => call[0]);
    expect(ids).toHaveLength(opened);
    expect(new Set(ids).size).toBe(opened);
  });

  it("misses the turn of a player who stays away, on the tick timer, until they rejoin", async () => {
    const { connect } = await start(
      { rateBurst: 1e6, ratePerSecond: 1e6 },
      { reconnectGraceMs: 40, autoActionDelayMs: 5 },
    );
    const { code, tokens, seats } = await lobby(connect, 2);
    const [ann, bob] = seats as [TestClient, TestClient];
    ann.send({ type: "start" });
    await ann.waitFor("update", (m) => m.seq === 0);
    bob.ws.close();
    await ann.waitFor("room", (m) => !m.room.seats[1]!.connected);

    // Ann plays her turns; the server misses Bob's once his grace is over.
    const autos = () => ann.messages.filter((m) => m.type === "update" && m.auto).length;
    for (let guard = 0; autos() < 1; guard += 1) {
      if (guard > 500) throw new Error("the server never missed a turn for Bob");
      const v = ann.view!;
      const seq = v.actionCount;
      if (v.phase.actors[0] === "p1") {
        const action = getLegalActions(content, v, "p1")[0]!;
        ann.send({ type: "intent", clientActionId: `a${seq}`, seq, action: strip(action) });
      }
      await ann.waitFor("update", (m) => m.seq === seq + 1);
    }
    const auto = ann.messages.find((m) => m.type === "update" && m.auto);
    expect(auto).toMatchObject({ by: "p2", auto: true });
    expect(auto?.type === "update" && auto.events[0]).toEqual({ type: "turnMissed", player: "p2" });

    // Bob rejoins and gets the current game.
    const back = await connect();
    back.send({ type: "rejoin", v: V, code, seatToken: tokens[1] });
    const welcome = await back.waitFor("welcome");
    expect(welcome.game?.seq).toBeGreaterThanOrEqual(ann.view!.actionCount);
  });
});

describe("transport", () => {
  it("answers bad-message to text that is not JSON, and to binary frames, and stays open", async () => {
    const { connect } = await start();
    const c = await connect();
    c.ws.send("{not json");
    await c.waitFor("error", (m) => m.code === "bad-message");
    c.ws.send(Buffer.from(JSON.stringify({ type: "sync" })), { binary: true });
    await eventually(() => c.types().filter((t) => t === "error:bad-message").length === 2);
    c.send("a string");
    await eventually(() => c.types().filter((t) => t === "error:bad-message").length === 3);
    c.send({ type: "create", v: V, name: "Ann" });
    await c.waitFor("welcome");
    expect(c.open).toBe(true);
  });

  it("closes a socket that sends a frame over the size limit, and frees nothing else", async () => {
    const { connect, disconnects } = await start({ maxMessageBytes: 1024 });
    const { seats } = await lobby(connect, 2);
    const [ann, bob] = seats as [TestClient, TestClient];
    bob.send({ type: "sync", padding: "x".repeat(2000) });
    expect((await bob.closed).code).toBe(1009);
    await ann.waitFor("room", (m) => !m.room.seats[1]!.connected);
    expect(disconnects).toHaveBeenCalledTimes(1);
    // A message under the limit is fine.
    ann.send({ type: "sync", padding: "x".repeat(900) });
    await ann.waitFor("snapshot");
  });

  it("closes a socket that floods, after answering the messages within the limit", async () => {
    const { connect, disconnects } = await start({ rateBurst: 5, ratePerSecond: 1 });
    const c = await connect();
    for (let i = 0; i < 12; i += 1) c.send({ type: "sync" });
    const closed = await c.closed;
    expect(closed).toEqual({ code: CLOSE_CODES.rateLimited, reason: "rate limit" });
    expect(c.types()).toEqual(Array(5).fill("error:not-seated"));
    await eventually(() => disconnects.mock.calls.length === 1);
  });

  it("refills the rate limit over time", async () => {
    const { connect } = await start({ rateBurst: 2, ratePerSecond: 50 });
    const c = await connect();
    for (let i = 0; i < 6; i += 1) {
      c.send({ type: "sync" });
      await c.waitFor("error", () => c.types().length === i + 1);
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(c.open).toBe(true);
  });

  it("drops a socket that stops answering pings, and the room is told", async () => {
    const { connect, disconnects } = await start({ heartbeatIntervalMs: 60 });
    const ann = await connect();
    ann.send({ type: "create", v: V, name: "Ann" });
    const { room } = await ann.waitFor("welcome");
    const bob = await connect({ autoPong: false });
    bob.send({ type: "join", v: V, code: room.code, name: "Bob" });
    await bob.waitFor("welcome");
    expect((await bob.closed).code).toBe(1006);
    await ann.waitFor("room", (m) => m.room.seats.length === 2 && !m.room.seats[1]!.connected);
    // Ann answers pings and stays.
    await new Promise((r) => setTimeout(r, 200));
    expect(ann.open).toBe(true);
    expect(disconnects).toHaveBeenCalledTimes(1);
  });

  it("closes the old socket when a seat is opened on a new one, sending replaced first", async () => {
    const { connect, disconnects } = await start();
    const old = await connect();
    old.send({ type: "create", v: V, name: "Ann" });
    const welcome = await old.waitFor("welcome");
    const fresh = await connect();
    fresh.send({ type: "rejoin", v: V, code: welcome.room.code, seatToken: welcome.seatToken });
    await fresh.waitFor("welcome");
    expect(await old.closed).toEqual({ code: CLOSE_CODES.core, reason: "replaced" });
    expect(old.types()).toEqual(["welcome", "error:replaced"]);
    // The old socket's close reaches the core once and changes nothing.
    await eventually(() => disconnects.mock.calls.length === 1);
    fresh.send({ type: "sync" });
    const snapshot = await fresh.waitFor("snapshot");
    expect(snapshot.room.seats).toEqual([
      { seat: "p1", name: "Ann", connected: true, away: false, removed: false, awayInMs: null },
    ]);
  });

  it("refuses create with server-busy when the room cap is reached", async () => {
    const { connect } = await start({ maxRooms: 1 });
    const a = await connect();
    a.send({ type: "create", v: V, name: "Ann" });
    const { room } = await a.waitFor("welcome");
    const b = await connect();
    b.send({ type: "create", v: V, name: "Bob" });
    await b.waitFor("error", (m) => m.code === "server-busy");
    // Joining an existing room still works.
    b.send({ type: "join", v: V, code: room.code, name: "Bob" });
    await b.waitFor("welcome");
  });

  it("frees a lobby seat on the tick timer once the lobby grace is over", async () => {
    const { connect } = await start({}, { lobbyGraceMs: 30 });
    const { seats } = await lobby(connect, 2);
    const [ann, bob] = seats as [TestClient, TestClient];
    bob.ws.close();
    await ann.waitFor("room", (m) => m.room.seats.length === 1);
    expect(lastRoom(ann)).toMatchObject({ room: { seats: [{ seat: "p1" }] } });
  });
});
