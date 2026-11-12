import { describe, expect, it } from "vitest";
import { redactForClient, replay } from "@fishingjamboree/engine";
import { connOf, content, harness, SEED, strip } from "./testHarness";
import type { Harness } from "./testHarness";

/** A seat that is not the one deciding. */
const bystander = (h: Harness, seats: number): string => {
  const actor = h.actor("c1");
  for (let i = 1; i <= seats; i += 1) if (`p${i}` !== actor) return `p${i}`;
  throw new Error("no bystander");
};

/** The deciding seat plays its `pick`-th legal action through the protocol. */
function playOne(h: Harness, pick = 0) {
  const actor = h.actor("c1");
  if (!actor) throw new Error("the game is over");
  const legal = h.legal(connOf(actor), actor);
  const action = legal[pick % legal.length];
  if (!action) throw new Error("no legal action");
  h.intent(connOf(actor), strip(action));
}

describe("intents", () => {
  it("applies a legal action and sends everyone the update with their own view", () => {
    const h = harness();
    h.started(3);
    const actor = h.actor("c1")!;
    const action = h.legal(connOf(actor), actor)[0]!;
    const out = h.intent(connOf(actor), strip(action), 0, "my-id");
    expect(out).toHaveLength(3);
    for (const seat of ["p1", "p2", "p3"]) {
      const messages = h.take(connOf(seat));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: "update", seq: 1, by: actor, auto: false });
      const update = h.view(connOf(seat));
      expect(update.viewer).toBe(seat);
      expect(update.actionCount).toBe(1);
    }
    expect(h.sent.filter((o) => o.kind === "send" && o.message.type === "rejected")).toEqual([]);
  });

  it("sends the same events to every seat", () => {
    const h = harness();
    h.started(3);
    playOne(h);
    const events = ["c1", "c2", "c3"].map((c) => h.last(c, "update").events);
    expect(events[0]!.length).toBeGreaterThan(0);
    expect(events[1]).toEqual(events[0]);
    expect(events[2]).toEqual(events[0]);
  });

  it("rejects an action from a seat whose turn it is not, telling only that seat", () => {
    const h = harness();
    const { code } = h.started(3);
    const other = bystander(h, 3);
    const actor = h.actor("c1")!;
    const action = h.legal(connOf(actor), actor)[0]!;
    const out = h.intent(connOf(other), strip(action), 0, "x1");
    expect(out).toEqual([
      {
        kind: "send",
        to: connOf(other),
        message: {
          type: "rejected",
          clientActionId: "x1",
          seq: 0,
          error: { code: "not-your-turn", message: expect.any(String) },
        },
      },
    ]);
    expect(h.core.replayLog(code)?.actions).toEqual([]);
  });

  it("takes the player from the seat, never from the message", () => {
    const h = harness();
    const { code } = h.started(3);
    const other = bystander(h, 3);
    const actor = h.actor("c1")!;
    const action = h.legal(connOf(actor), actor)[0]!;
    // The bystander sends the actor's action, `player` field and all.
    h.send(connOf(other), { type: "intent", clientActionId: "x", seq: 0, action });
    expect(h.last(connOf(other), "rejected").error.code).toBe("not-your-turn");
    expect(h.core.replayLog(code)?.actions).toEqual([]);
    // The actor's own action is logged under the actor's seat even with a forged player.
    h.send(connOf(actor), {
      type: "intent",
      clientActionId: "y",
      seq: 0,
      action: { ...action, player: other },
    });
    expect(h.core.replayLog(code)?.actions).toEqual([action]);
  });

  it("rejects an action that is not legal, with the engine's reason", () => {
    const h = harness();
    h.started(3);
    const actor = h.actor("c1")!;
    expect(h.view("c1").phase.kind).toBe("placeShip");
    h.intent(connOf(actor), { type: "roll" }, 0, "r");
    expect(h.last(connOf(actor), "rejected")).toMatchObject({
      clientActionId: "r",
      seq: 0,
      error: { code: "wrong-phase" },
    });
    h.intent(connOf(actor), { type: "placeShip", dock: "no-such-dock" }, 0, "d");
    expect(h.last(connOf(actor), "rejected").error.code).toBe("illegal-action");
    expect(h.got("c1", "update")).toHaveLength(0);
  });

  it("rejects an intent made on an older view as stale, so a repeated intent applies once", () => {
    const h = harness();
    const { code } = h.started(3);
    const actor = h.actor("c1")!;
    const conn = connOf(actor);
    const action = strip(h.legal(conn, actor)[0]!);
    h.intent(conn, action, 0, "first");
    // After placing in setup the same seat decides next (it must roll).
    expect(h.actor("c1")).toBe(actor);
    h.intent(conn, { type: "roll" }, 0, "late");
    expect(h.last(conn, "rejected")).toMatchObject({
      clientActionId: "late",
      seq: 1,
      error: { code: "stale" },
    });
    h.intent(conn, { type: "roll" }, 1, "now");
    h.intent(conn, { type: "roll" }, 1, "again");
    expect(h.last(conn, "rejected")).toMatchObject({ clientActionId: "again", seq: 2 });
    expect(h.core.replayLog(code)?.actions).toHaveLength(2);
    // A seq from the future is refused too.
    h.intent(conn, { type: "endTurn" }, 99, "future");
    expect(h.last(conn, "rejected").error.code).toBe("stale");
  });

  it("rejects an intent before the game has started", () => {
    const h = harness();
    h.lobby(2);
    h.send("c1", { type: "intent", clientActionId: "early", seq: 0, action: { type: "roll" } });
    expect(h.last("c1", "rejected")).toMatchObject({
      clientActionId: "early",
      seq: 0,
      error: { code: "no-game" },
    });
  });

  it("answers bad-message to a malformed action and leaves the game alone", () => {
    const h = harness();
    const { code } = h.started(2);
    const conn = connOf(h.actor("c1")!);
    h.send(conn, { type: "intent", clientActionId: "1", seq: 0, action: { type: "move", to: {} } });
    expect(h.last(conn, "error").code).toBe("bad-message");
    expect(h.core.replayLog(code)?.actions).toEqual([]);
  });
});

describe("sync", () => {
  it("returns the room and the current game as the asking seat sees it", () => {
    const h = harness();
    const { code } = h.started(3);
    playOne(h);
    h.clear();
    h.send("c2", { type: "sync" });
    const snapshot = h.last("c2", "snapshot");
    expect(snapshot.room).toEqual(h.room(code));
    expect(snapshot.game?.seq).toBe(1);
    expect(snapshot.game?.view.viewer).toBe("p2");
    expect(h.take("c1")).toEqual([]);
  });

  it("has no game in the lobby", () => {
    const h = harness();
    h.lobby(2);
    h.send("c2", { type: "sync" });
    expect(h.last("c2", "snapshot").game).toBeNull();
  });
});

describe("a whole game over the protocol", () => {
  it.each([2, 3, 4])("%i players reach a scored result that the replay log reproduces", (n) => {
    const h = harness();
    const { code, tokens } = h.started(n);
    const seqs: number[] = [];
    for (let guard = 0; h.actor("c1") !== undefined; guard += 1) {
      if (guard > 5_000) throw new Error("the game did not end");
      const before = h.view("c1").actionCount;
      playOne(h, before * 7 + n);
      seqs.push(h.last("c1", "update").seq);
      h.clear();
    }

    // One update per action, numbered 1, 2, 3, ... with no gap.
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    const final = h.view("c1");
    expect(final.phase.kind).toBe("gameOver");
    expect(final.round).toBe(content.rules.rounds);
    expect(final.result?.scores).toHaveLength(n);
    expect(h.room(code).status).toBe("finished");

    // The last action's update is followed by a room message saying "finished".
    const tail = h.sent.slice(-2 * n).map((o) => (o.kind === "send" ? o.message.type : o.kind));
    expect(tail).toEqual([...Array(n).fill("update"), ...Array(n).fill("room")]);

    const log = h.core.replayLog(code)!;
    expect(log.setup).toEqual({ seed: SEED, players: final.players.map((p) => p.id).sort() });
    expect(log.actions).toHaveLength(seqs.length);
    const replayed = replay(content, log);
    for (let i = 1; i <= n; i += 1) {
      expect(h.view(`c${i}`)).toEqual(redactForClient(replayed.state, `p${i}`));
    }

    // Nothing private ever left the server.
    const seat = (conn: string) => Number(conn.slice(1)) - 1;
    for (const o of h.sent) {
      if (o.kind !== "send") continue;
      const json = JSON.stringify(o.message);
      expect(json).not.toContain(SEED);
      expect(json).not.toContain('"rng"');
      expect(json).not.toContain('"draw"');
      tokens.forEach((token, i) => {
        if (i !== seat(o.to)) expect(json).not.toContain(`"${token}"`);
      });
    }

    // The game is over: intents are refused, and a late sync still works.
    h.intent("c1", { type: "roll" }, final.actionCount, "after");
    expect(h.last("c1", "rejected").error.code).toBe("game-over");
    h.send("c2", { type: "sync" });
    expect(h.last("c2", "snapshot").game?.view.result).toEqual(final.result);
  });
});
