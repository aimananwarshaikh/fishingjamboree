/**
 * B5 hardening over real sockets: the Origin allow-list, the connection caps
 * (in all and per address, with and without a trusted proxy), the one-line log
 * of each refused connection, and dropping a socket that does not read.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cryptoIds } from "./ids";
import { PROTOCOL_VERSION as V } from "./protocol";
import { content } from "./testHarness";
import { clientIp, createGameServer } from "./transport";
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

async function start(transport: Partial<TransportConfig>) {
  const lines: string[] = [];
  const server = await createGameServer({
    core: { content, ids: cryptoIds() },
    transport,
    host: "127.0.0.1",
    log: (line) => lines.push(line),
  });
  servers.push(server);
  const url = `ws://127.0.0.1:${server.port()}`;
  const connect = async (headers: Record<string, string> = {}) => {
    const client = await TestClient.connect(url, { headers });
    clients.push(client);
    return client;
  };
  /** The message of the failed upgrade (`Unexpected server response: 403`), or "open". */
  const attempt = async (headers: Record<string, string> = {}) => {
    try {
      await connect(headers);
      return "open";
    } catch (error) {
      return (error as Error).message;
    }
  };
  return { server, lines, connect, attempt };
}

describe("Origin allow-list", () => {
  const allowed = ["https://play.example.com", "http://localhost:5173"];

  it("lets an allowed origin in (any letter case) and refuses any other with 403", async () => {
    const { attempt, lines } = await start({ allowedOrigins: allowed });
    expect(await attempt({ Origin: "https://play.example.com" })).toBe("open");
    expect(await attempt({ Origin: "HTTPS://Play.Example.com" })).toBe("open");
    expect(await attempt({ Origin: "http://localhost:5173" })).toBe("open");
    for (const bad of [
      "https://evil.example",
      "http://play.example.com", // wrong scheme
      "https://play.example.com:8443", // wrong port
      "https://play.example.com.evil.example",
      "null", // sandboxed frames, file://
    ]) {
      expect(await attempt({ Origin: bad })).toContain("403");
    }
    expect(lines.filter((l) => l.startsWith("refused connection"))).toHaveLength(5);
  });

  it("lets a client with no Origin header in: it is not a browser, and can forge one anyway", async () => {
    const { attempt } = await start({ allowedOrigins: allowed });
    expect(await attempt()).toBe("open");
  });

  it("accepts any origin when there is no list", async () => {
    const { attempt } = await start({ allowedOrigins: null });
    expect(await attempt({ Origin: "https://anything.example" })).toBe("open");
  });

  it("refuses before any game traffic: a refused page gets no welcome", async () => {
    const { server, attempt } = await start({ allowedOrigins: allowed });
    expect(await attempt({ Origin: "https://evil.example" })).toContain("403");
    expect(server.connectionCount()).toBe(0);
    expect(server.core.roomCodes()).toHaveLength(0);
  });
});

describe("connection limits", () => {
  it("refuses the connection over maxConnections with 503 and accepts again once one closes", async () => {
    const { server, connect, attempt } = await start({
      maxConnections: 2,
      maxConnectionsPerIp: 100,
    });
    const a = await connect();
    await connect();
    expect(await attempt()).toContain("503");
    a.ws.close();
    await eventually(() => server.connectionCount() === 1);
    expect(await attempt()).toBe("open");
  });

  it("refuses an address over maxConnectionsPerIp with 429 and frees the count on close", async () => {
    const { server, connect, attempt } = await start({
      maxConnections: 100,
      maxConnectionsPerIp: 2,
    });
    const a = await connect();
    await connect();
    expect(await attempt()).toContain("429");
    a.ws.close();
    await eventually(() => server.connectionCount() === 1);
    expect(await attempt()).toBe("open");
  });

  it("counts sockets that were dropped by the server too (heartbeat, rate limit)", async () => {
    const { server, connect, attempt } = await start({
      maxConnectionsPerIp: 1,
      rateBurst: 1,
      ratePerSecond: 0.001,
    });
    const a = await connect();
    a.send({ type: "nope" });
    a.send({ type: "nope" });
    await a.closed;
    await eventually(() => server.connectionCount() === 0);
    expect(await attempt()).toBe("open");
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    const { attempt } = await start({ maxConnectionsPerIp: 1, trustProxy: false });
    expect(await attempt({ "X-Forwarded-For": "10.0.0.1" })).toBe("open");
    expect(await attempt({ "X-Forwarded-For": "10.0.0.2" })).toContain("429");
  });

  it("behind a trusted proxy counts per forwarded address, by the last entry (a client cannot forge it)", async () => {
    const { attempt } = await start({ maxConnectionsPerIp: 1, trustProxy: true });
    expect(await attempt({ "X-Forwarded-For": "1.1.1.1, 10.0.0.1" })).toBe("open");
    expect(await attempt({ "X-Forwarded-For": "2.2.2.2, 10.0.0.2" })).toBe("open");
    // A different forged first entry does not make it a new address.
    expect(await attempt({ "X-Forwarded-For": "3.3.3.3, 10.0.0.1" })).toContain("429");
  });

  it("falls back to the socket address when a trusted proxy sent no header", () => {
    const req = { headers: {}, socket: { remoteAddress: "10.9.9.9" } } as never;
    expect(clientIp(req, true)).toBe("10.9.9.9");
    expect(clientIp(req, false)).toBe("10.9.9.9");
    const forwarded = { headers: { "x-forwarded-for": " , 4.4.4.4 " }, socket: {} } as never;
    expect(clientIp(forwarded, true)).toBe("4.4.4.4");
  });
});

describe("refusal log", () => {
  it("writes one line per refused connection, with the address and reason, and nothing private", async () => {
    const { attempt, lines, connect } = await start({
      allowedOrigins: ["https://play.example.com"],
    });
    const host = await connect({ Origin: "https://play.example.com" });
    host.send({ type: "create", v: V, name: "SecretName" });
    const welcome = await host.waitFor("welcome");
    await attempt({ Origin: "https://evil.example" });
    const refused = lines.filter((l) => l.includes("refused connection"));
    expect(refused).toEqual([
      "refused connection from 127.0.0.1: origin not allowed (https://evil.example)",
    ]);
    const all = lines.join("\n");
    expect(all).not.toContain(welcome.seatToken);
    expect(all).not.toContain("SecretName");
  });

  it("does not let a flood of refusals flood the log", async () => {
    const { attempt, lines } = await start({ allowedOrigins: ["https://play.example.com"] });
    for (let i = 0; i < 25; i += 1) await attempt({ Origin: "https://evil.example" });
    expect(lines.filter((l) => l.includes("refused connection from"))).toHaveLength(10);
  });
});

describe("backpressure", () => {
  it("drops a socket whose send buffer is over the limit, tells the room, and spares the others", async () => {
    const { server, connect, lines } = await start({ maxBufferedBytes: 10_000 });
    const host = await connect();
    host.send({ type: "create", v: V, name: "Ann" });
    const { room } = await host.waitFor("welcome");
    const slow = await connect();
    slow.send({ type: "join", v: V, code: room.code, name: "Slow" });
    await slow.waitFor("welcome");

    // The server-side socket of `slow` reports a backlog, as one that is not reading would.
    const [, serverSide] = [...server.wss.clients];
    Object.defineProperty(serverSide, "bufferedAmount", { get: () => 5_000_000 });

    const third = await connect();
    third.send({ type: "join", v: V, code: room.code, name: "Cy" });
    await third.waitFor("welcome");
    await slow.closed;
    await eventually(() => server.connectionCount() === 2);

    expect(lines.some((l) => l.includes("not reading"))).toBe(true);
    // The others were sent the update that dropped it, and the seat is just disconnected.
    const last = host.messages.filter((m) => m.type === "room").at(-1);
    expect(last?.type === "room" && last.room.seats.map((s) => s.connected)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("does not drop a socket with a small backlog", async () => {
    const { server, connect } = await start({ maxBufferedBytes: 10_000 });
    const host = await connect();
    host.send({ type: "create", v: V, name: "Ann" });
    await host.waitFor("welcome");
    const [serverSide] = [...server.wss.clients];
    Object.defineProperty(serverSide, "bufferedAmount", { get: () => 9_999 });
    host.send({ type: "sync" });
    await host.waitFor("snapshot");
    expect(host.open).toBe(true);
  });
});
