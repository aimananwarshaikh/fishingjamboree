import { replay } from "@fishingjamboree/engine";
import { describe, expect, it } from "vitest";
import { content, connOf, harness, strip, V } from "./testHarness";
import type { Harness } from "./testHarness";

/** Plays the running game to its end with the `pick`-th legal action each time. */
function finish(h: Harness, code: string, conn = "c1") {
  for (let guard = 0; h.room(code).status === "playing"; guard += 1) {
    if (guard > 5_000) throw new Error("the game did not end");
    const actor = h.actor(conn);
    if (!actor) break;
    if (!h.room(code).seats.find((x) => x.seat === actor)?.connected) {
      h.advance(60_000); // the server misses a disconnected player's turn
      continue;
    }
    const legal = h.legal(connOf(actor), actor);
    h.intent(connOf(actor), strip(legal[guard % legal.length]!));
  }
  expect(h.room(code).status).toBe("finished");
}

describe("rematch", () => {
  it("takes the host and the connected players back to the lobby, and the next game has a new seed", () => {
    const h = harness();
    h.seeds.push("first-seed", "second-seed");
    const { code, tokens } = h.started(3);
    finish(h, code);
    const firstLog = h.core.replayLog(code)!;
    expect(firstLog.setup.seed).toBe("first-seed");
    h.clear();

    h.send("c1", { type: "rematch" });
    const room = h.room(code);
    expect(room).toMatchObject({ status: "lobby", host: "p1" });
    expect(room.seats.map((s) => [s.seat, s.connected, s.away, s.removed])).toEqual([
      ["p1", true, false, false],
      ["p2", true, false, false],
      ["p3", true, false, false],
    ]);
    for (const c of ["c1", "c2", "c3"]) expect(h.last(c, "room").room.status).toBe("lobby");
    expect(h.core.replayLog(code)).toBeNull();
    // The seat tokens still work.
    h.drop("c2");
    h.send("c2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("c2", "welcome")).toMatchObject({ seat: "p2", game: null });

    h.clear();
    h.send("c1", { type: "start" });
    expect(h.core.replayLog(code)!.setup.seed).toBe("second-seed");
    expect(h.last("c1", "update").seq).toBe(0);
    expect(h.last("c1", "update").view.round).toBe(1);
    expect(h.last("c1", "update").view.result).toBeNull();
    // A fresh reconnect budget and a working game to the end, replay matching.
    finish(h, code);
    const log = h.core.replayLog(code)!;
    expect(replay(content, log).state.phase.kind).toBe("gameOver");
  });

  it("only the host can ask, and only after a game", () => {
    const h = harness();
    const { code } = h.lobby(2);
    h.send("c1", { type: "rematch" });
    expect(h.last("c1", "error").code).toBe("game-not-finished");
    h.send("c1", { type: "start" });
    h.send("c1", { type: "rematch" });
    expect(h.last("c1", "error").code).toBe("game-not-finished");
    finish(h, code);
    h.send("c2", { type: "rematch" });
    expect(h.last("c2", "error").code).toBe("not-host");
    expect(h.room(code).status).toBe("finished");
    h.send("zz", { type: "rematch" });
    expect(h.last("zz", "error").code).toBe("not-seated");
  });

  it("drops removed players and players who are not connected; their tokens stop working", () => {
    const h = harness();
    const { code, tokens } = h.started(4);
    h.send("c1", { type: "kick", seat: "p2" });
    // p3 closes the tab for good; p4 stays.
    h.drop("c3");
    finish(h, code);
    h.clear();
    h.send("c1", { type: "rematch" });
    expect(h.room(code).seats.map((s) => s.seat)).toEqual(["p1", "p4"]);
    h.send("x2", { type: "rejoin", v: V, code, seatToken: tokens[1] });
    expect(h.last("x2", "error").code).toBe("bad-token");
    h.send("x3", { type: "rejoin", v: V, code, seatToken: tokens[2] });
    expect(h.last("x3", "error").code).toBe("bad-token");
    // A new player takes the lowest free seat.
    h.send("n", { type: "join", v: V, code, name: "Newcomer" });
    expect(h.last("n", "welcome").seat).toBe("p2");
    // Three connected players can start; the dropped players' stats are gone.
    h.send("c1", { type: "start" });
    expect(h.room(code).status).toBe("playing");
    expect(
      h
        .view("c1")
        .players.map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2", "p4"]);
  });

  it("keeps the lobby rules: Start needs the minimum number of players", () => {
    const h = harness();
    const { code } = h.started(2);
    h.drop("c2");
    // p2's missed turns remove them; the host plays on and wins as the last player.
    finish(h, code);
    h.send("c1", { type: "rematch" });
    h.clear();
    h.send("c1", { type: "start" });
    expect(h.last("c1", "error").code).toBe("not-enough-players");
  });

  it("can be asked again after the second game, and survives a save and restore", () => {
    const h = harness();
    const { code } = h.started(2);
    finish(h, code);
    h.send("c1", { type: "rematch" });
    const snapshot = h.core.snapshotRoom(code);
    expect(snapshot).toMatchObject({ status: "lobby", game: null });
    h.send("c1", { type: "start" });
    finish(h, code);
    h.send("c1", { type: "rematch" });
    expect(h.room(code).status).toBe("lobby");
  });
});
