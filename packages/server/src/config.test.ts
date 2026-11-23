import { describe, expect, it } from "vitest";
import { parseCount, parseFlag, parseOrigins, parsePort, readServerSettings } from "./config";

describe("parsePort", () => {
  it("defaults to 8787 when unset or blank", () => {
    expect(parsePort(undefined)).toEqual({ ok: true, port: 8787 });
    expect(parsePort("  ")).toEqual({ ok: true, port: 8787 });
  });

  it("takes a port from 0 to 65535", () => {
    expect(parsePort("9000")).toEqual({ ok: true, port: 9000 });
    expect(parsePort(" 0 ")).toEqual({ ok: true, port: 0 });
    expect(parsePort("65535")).toEqual({ ok: true, port: 65535 });
  });

  it("refuses anything else, saying why", () => {
    for (const bad of ["abc", "80.5", "-1", "1e3", "0x50", "8787abc"]) {
      expect(parsePort(bad)).toMatchObject({ ok: false, reason: expect.stringContaining(bad) });
    }
    expect(parsePort("65536")).toMatchObject({ ok: false, reason: /above 65535/ });
  });
});

describe("parseCount and parseFlag", () => {
  it("take a whole number from 1 up, or a flag, with a default when unset", () => {
    expect(parseCount("X", undefined, 7)).toEqual({ ok: true, value: 7 });
    expect(parseCount("X", " 12 ", 7)).toEqual({ ok: true, value: 12 });
    for (const bad of ["0", "-1", "1.5", "ten", "1e3", "99999999999999999999"]) {
      expect(parseCount("X", bad, 7)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("X="),
      });
    }
    expect(parseFlag("F", undefined, false)).toEqual({ ok: true, value: false });
    expect(parseFlag("F", "TRUE", false)).toEqual({ ok: true, value: true });
    expect(parseFlag("F", "0", true)).toEqual({ ok: true, value: false });
    expect(parseFlag("F", "maybe", false)).toMatchObject({ ok: false });
  });
});

describe("parseOrigins", () => {
  it("is unset (any origin) when blank", () => {
    expect(parseOrigins(undefined)).toEqual({ ok: true, origins: null });
    expect(parseOrigins("  ")).toEqual({ ok: true, origins: null });
  });

  it("takes comma-separated origins, trimmed", () => {
    expect(parseOrigins("https://a.example, http://localhost:5173,")).toEqual({
      ok: true,
      origins: ["https://a.example", "http://localhost:5173"],
    });
  });

  it("refuses what a browser would never send, saying which entry", () => {
    for (const bad of [
      "a.example",
      "https://a.example/",
      "https://a.example/play",
      "wss://a.example",
      "*",
      ",",
    ]) {
      expect(parseOrigins(bad)).toMatchObject({ ok: false });
    }
    expect(parseOrigins("https://a.example/play")).toMatchObject({
      reason: expect.stringContaining("https://a.example/play"),
    });
  });
});

describe("readServerSettings", () => {
  it("has working defaults for an empty environment", () => {
    const r = readServerSettings({});
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.settings).toMatchObject({ port: 8787, host: undefined, roomsDir: undefined });
    expect(r.settings.transport).toMatchObject({
      maxConnections: 200,
      maxConnectionsPerIp: 12,
      trustProxy: false,
      allowedOrigins: null,
    });
  });

  it("reads every variable", () => {
    const r = readServerSettings({
      PORT: "9000",
      HOST: "0.0.0.0",
      CONTENT_DIR: "/c",
      ROOMS_DIR: "/data/rooms",
      WEB_DIR: "/srv/web",
      ALLOWED_ORIGINS: "https://play.example.com",
      TRUST_PROXY: "1",
      MAX_CONNECTIONS: "50",
      MAX_CONNECTIONS_PER_IP: "6",
      MAX_ROOMS: "20",
      MAX_BUFFERED_BYTES: "65536",
    });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.settings).toMatchObject({
      port: 9000,
      host: "0.0.0.0",
      contentDir: "/c",
      roomsDir: "/data/rooms",
      webDir: "/srv/web",
    });
    expect(r.settings.transport).toEqual({
      allowedOrigins: ["https://play.example.com"],
      trustProxy: true,
      maxConnections: 50,
      maxConnectionsPerIp: 6,
      maxRooms: 20,
      maxBufferedBytes: 65536,
    });
  });

  it("reads the testing timers only when set (B7)", () => {
    const none = readServerSettings({});
    expect(none.ok && none.settings.core).toEqual({});
    expect(none.ok && "heartbeatIntervalMs" in none.settings.transport).toBe(false);
    const r = readServerSettings({
      TURN_TIMEOUT_MS: "20000",
      RECONNECT_GRACE_MS: "8000",
      RECONNECT_BUDGET_MS: "16000",
      HEARTBEAT_MS: "3000",
    });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.settings.core).toEqual({
      turnTimeoutMs: 20000,
      reconnectGraceMs: 8000,
      reconnectBudgetMs: 16000,
    });
    expect(r.settings.transport.heartbeatIntervalMs).toBe(3000);
    const bad = readServerSettings({ TURN_TIMEOUT_MS: "0", HEARTBEAT_MS: "soon" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(2);
  });

  it("reports every problem at once, and starts nothing on any of them", () => {
    const r = readServerSettings({
      PORT: "x",
      MAX_CONNECTIONS: "0",
      ALLOWED_ORIGINS: "nope",
      TRUST_PROXY: "maybe",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toHaveLength(4);
  });
});
