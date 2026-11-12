import { describe, expect, it } from "vitest";
import { content, harness, V } from "./testHarness";

describe("creating a room", () => {
  it("seats the creator at p1 as host and sends a welcome with the code and a seat token", () => {
    const h = harness();
    const out = h.send("c1", { type: "create", v: V, name: "Ann" });
    expect(out).toHaveLength(1);
    const welcome = h.last("c1", "welcome");
    expect(welcome).toMatchObject({
      v: V,
      seat: "p1",
      seatToken: "token-1",
      contentHash: content.hash,
      game: null,
      room: {
        code: "BCDB",
        status: "lobby",
        host: "p1",
        seats: [{ seat: "p1", name: "Ann", connected: true }],
        minPlayers: content.rules.minPlayers,
        maxPlayers: content.rules.maxPlayers,
        rev: 0,
      },
    });
    expect(h.core.roomCodes()).toEqual(["BCDB"]);
  });

  it("gives each room its own code, trying again when a code is taken", () => {
    const h = harness({}, ["BCDF", "BCDF", "BCDF", "GHJK"]);
    h.send("c1", { type: "create", v: V, name: "Ann" });
    h.send("c2", { type: "create", v: V, name: "Bob" });
    expect(h.last("c1", "welcome").room.code).toBe("BCDF");
    expect(h.last("c2", "welcome").room.code).toBe("GHJK");
  });

  it("answers server-busy when no free code can be found", () => {
    const h = harness(
      {},
      Array.from({ length: 30 }, () => "BCDF"),
    );
    h.send("c1", { type: "create", v: V, name: "Ann" });
    h.send("c2", { type: "create", v: V, name: "Bob" });
    expect(h.last("c2", "error").code).toBe("server-busy");
    expect(h.core.roomCodes()).toEqual(["BCDF"]);
  });

  it("tidies the name and refuses an empty or over-long one", () => {
    const h = harness();
    h.send("c1", { type: "create", v: V, name: "  Ann   of\tCleves " });
    expect(h.last("c1", "welcome").room.seats[0]?.name).toBe("Ann of Cleves");
    h.send("c2", { type: "create", v: V, name: "   " });
    expect(h.last("c2", "error").code).toBe("name-invalid");
    h.send("c3", { type: "create", v: V, name: "x".repeat(21) });
    expect(h.last("c3", "error").code).toBe("name-invalid");
    expect(h.core.roomCodes()).toHaveLength(1);
  });
});

describe("joining by code", () => {
  it("fills seats p1 to p4 in order and tells the others each time", () => {
    const h = harness();
    const { code } = h.lobby(1);
    h.clear();
    h.send("c2", { type: "join", v: V, code, name: "Bob" });
    expect(h.last("c2", "welcome")).toMatchObject({ seat: "p2", seatToken: "token-2", game: null });
    expect(h.got("c2", "room")).toHaveLength(0);
    expect(h.last("c1", "room").room).toEqual(h.last("c2", "welcome").room);
    expect(h.last("c1", "room").room.rev).toBe(1);

    h.send("c3", { type: "join", v: V, code, name: "Cy" });
    h.send("c4", { type: "join", v: V, code, name: "Di" });
    expect(h.room(code).seats.map((s) => [s.seat, s.name])).toEqual([
      ["p1", "Player 1"],
      ["p2", "Bob"],
      ["p3", "Cy"],
      ["p4", "Di"],
    ]);
    expect(h.got("c1", "room")).toHaveLength(3);
    expect(h.room(code).host).toBe("p1");
  });

  it("accepts the code in any case and with spaces around it", () => {
    const h = harness();
    const { code } = h.lobby(1);
    h.send("c2", { type: "join", v: V, code: ` ${code.toLowerCase()} `, name: "Bob" });
    expect(h.last("c2", "welcome").seat).toBe("p2");
  });

  it("refuses a fifth player", () => {
    const h = harness();
    const { code } = h.lobby(4);
    h.send("c5", { type: "join", v: V, code, name: "Eve" });
    expect(h.last("c5", "error").code).toBe("room-full");
    expect(h.room(code).seats).toHaveLength(4);
  });

  it("refuses an unknown code, a bad name and a name already in the room", () => {
    const h = harness();
    const { code } = h.lobby(2);
    h.send("x1", { type: "join", v: V, code: "ZZZZ", name: "Eve" });
    expect(h.last("x1", "error").code).toBe("room-not-found");
    h.send("x2", { type: "join", v: V, code, name: "" });
    expect(h.last("x2", "error").code).toBe("name-invalid");
    h.send("x3", { type: "join", v: V, code, name: "player 2" });
    expect(h.last("x3", "error").code).toBe("name-taken");
    expect(h.room(code).seats).toHaveLength(2);
  });

  it("refuses another protocol version on create, join and rejoin", () => {
    const h = harness();
    const { code, tokens } = h.lobby(1);
    h.send("x1", { type: "create", v: V + 1, name: "Eve" });
    h.send("x2", { type: "join", v: V + 1, code, name: "Eve" });
    h.send("x3", { type: "rejoin", v: 0, code, seatToken: tokens[0] });
    for (const conn of ["x1", "x2", "x3"]) {
      expect(h.last(conn, "error").code).toBe("unsupported-version");
    }
    expect(h.core.roomCodes()).toEqual([code]);
    expect(h.room(code).seats).toHaveLength(1);
  });

  it("refuses a second seat for a connection that already has one", () => {
    const h = harness();
    const { code, tokens } = h.lobby(2);
    h.send("c2", { type: "create", v: V, name: "Bob" });
    h.send("c2", { type: "join", v: V, code, name: "Bob" });
    h.send("c2", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.got("c2", "error").map((e) => e.code)).toEqual([
      "already-seated",
      "already-seated",
      "already-seated",
    ]);
    expect(h.core.roomCodes()).toEqual([code]);
  });
});

describe("messages the core cannot act on", () => {
  it("answers bad-message to a malformed message", () => {
    const h = harness();
    h.send("c1", { type: "nonsense" });
    h.send("c1", "create");
    expect(h.got("c1", "error").map((e) => e.code)).toEqual(["bad-message", "bad-message"]);
  });

  it("answers not-seated to start, intent, sync and leave from a connection with no seat", () => {
    const h = harness();
    h.lobby(2);
    h.send("x", { type: "start" });
    h.send("x", { type: "intent", clientActionId: "1", seq: 0, action: { type: "roll" } });
    h.send("x", { type: "sync" });
    h.send("x", { type: "leave" });
    expect(h.take("x").map((m) => (m.type === "error" ? m.code : m.type))).toEqual([
      "not-seated",
      "not-seated",
      "not-seated",
      "not-seated",
    ]);
  });
});

describe("leaving the lobby", () => {
  it("frees the seat for the next player and tells the others", () => {
    const h = harness();
    const { code } = h.lobby(3);
    h.clear();
    h.send("c2", { type: "leave" });
    expect(h.take("c2")).toEqual([{ type: "left" }]);
    expect(h.last("c1", "room").room.seats.map((s) => s.seat)).toEqual(["p1", "p3"]);
    h.send("c5", { type: "join", v: V, code, name: "Eve" });
    expect(h.last("c5", "welcome").seat).toBe("p2");
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p2", "p3"]);
  });

  it("lets the same connection join again after leaving", () => {
    const h = harness();
    const { code } = h.lobby(2);
    h.send("c2", { type: "leave" });
    h.send("c2", { type: "join", v: V, code, name: "Bob" });
    expect(h.last("c2", "welcome").seat).toBe("p2");
  });

  it("passes the host role to the lowest remaining seat", () => {
    const h = harness();
    const { code } = h.lobby(3);
    h.send("c1", { type: "leave" });
    expect(h.room(code).host).toBe("p2");
    expect(h.last("c3", "room").room.host).toBe("p2");
  });

  it("deletes the room when the last player leaves, and the old token stops working", () => {
    const h = harness();
    const { code, tokens } = h.lobby(1);
    h.send("c1", { type: "leave" });
    expect(h.core.roomCodes()).toEqual([]);
    h.send("c1", { type: "rejoin", v: V, code, seatToken: tokens[0] });
    expect(h.last("c1", "error").code).toBe("room-not-found");
  });
});

describe("starting", () => {
  it("is for the host only", () => {
    const h = harness();
    const { code } = h.lobby(3);
    h.send("c2", { type: "start" });
    expect(h.last("c2", "error").code).toBe("not-host");
    expect(h.room(code).status).toBe("lobby");
  });

  it("needs the minimum number of players", () => {
    const h = harness();
    const { code } = h.lobby(1);
    h.send("c1", { type: "start" });
    expect(h.last("c1", "error").code).toBe("not-enough-players");
    expect(h.room(code).status).toBe("lobby");
  });

  it("waits for every seated player to be connected", () => {
    const h = harness();
    const { code, tokens } = h.lobby(3);
    h.drop("c3");
    h.send("c1", { type: "start" });
    expect(h.last("c1", "error").code).toBe("players-disconnected");
    h.send("c3b", { type: "rejoin", v: V, code, seatToken: tokens[2] });
    h.send("c1", { type: "start" });
    expect(h.room(code).status).toBe("playing");
  });

  it.each([2, 3, 4])("starts a %i-player game: room update, then update seq 0", (n) => {
    const h = harness();
    const { code } = h.lobby(n);
    h.clear();
    h.send("c1", { type: "start" });
    for (let i = 1; i <= n; i += 1) {
      const conn = `c${i}`;
      const messages = h.take(conn);
      expect(messages.map((m) => m.type)).toEqual(["room", "update"]);
      const [room, update] = messages;
      if (room?.type !== "room" || update?.type !== "update") throw new Error("unreachable");
      expect(room.room.status).toBe("playing");
      expect(update).toMatchObject({ seq: 0, by: null, auto: false });
      expect(update.events[0]).toMatchObject({ type: "gameStarted" });
      expect(update.view.viewer).toBe(`p${i}`);
      expect(update.view.actionCount).toBe(0);
      expect(update.view.players.map((p) => p.id).sort()).toEqual(
        Array.from({ length: n }, (_, k) => `p${k + 1}`),
      );
    }
    expect(h.core.replayLog(code)?.setup.players).toEqual(
      Array.from({ length: n }, (_, k) => `p${k + 1}`),
    );
  });

  it("happens once, and nobody can join afterwards", () => {
    const h = harness();
    const { code } = h.started(2);
    h.send("c1", { type: "start" });
    expect(h.last("c1", "error").code).toBe("game-started");
    h.send("c9", { type: "join", v: V, code, name: "Eve" });
    expect(h.last("c9", "error").code).toBe("game-started");
    expect(h.room(code).seats).toHaveLength(2);
  });
});
