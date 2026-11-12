import { describe, expect, it } from "vitest";
import { getLegalActions } from "@fishingjamboree/engine";
import type { GameEvent } from "@fishingjamboree/engine";
import { ServerCore } from "../../../packages/server/src/core";
import type { Outbound } from "../../../packages/server/src/core";
import { PROTOCOL_VERSION as V } from "../../../packages/server/src/protocol";
import type { ClientMessage, RoomInfo, ServerMessage } from "../../../packages/server/src/protocol";
import { loadBundledContent } from "./content";
import { describeEvent } from "./describe";
import { initialState, intentSent, onServerMessage } from "./store";
import type { ClientState, Context } from "./store";

const content = loadBundledContent();
const ctx: Context = {
  contentHash: content.hash,
  describe: (events: GameEvent[], room) =>
    events
      .map((e) =>
        describeEvent(e, content, (p) => room?.seats.find((s) => s.seat === p)?.name ?? p),
      )
      .filter((t): t is string => t !== null),
};

/** A real ServerCore with simulated browser tabs, each holding a `ClientState`. */
function table() {
  let tokens = 0;
  const core = new ServerCore({
    content,
    now: () => 0,
    ids: {
      roomCode: () => "BCDF",
      seatToken: () => `tok-${++tokens}`,
      gameSeed: () => "web-test-seed",
    },
  });
  const states = new Map<string, ClientState>();
  let counter = 0;

  const route = (out: Outbound[]) => {
    for (const o of out) {
      if (o.kind !== "send") continue;
      const s = states.get(o.to) ?? initialState;
      states.set(o.to, onServerMessage(s, o.message as ServerMessage, ctx));
    }
  };
  const tab = (id: string) => {
    states.set(id, initialState);
    return {
      id,
      state: () => states.get(id)!,
      send: (msg: ClientMessage) => route(core.handleMessage(id, msg)),
      drop: () => route(core.disconnect(id)),
      /** What the UI does on a button click: the first legal action from its own view. */
      actFirst: () => {
        const g = states.get(id)!.game!;
        const seat = states.get(id)!.session!.seat;
        const legal = getLegalActions(content, g.view, seat);
        const { player: _p, ...action } = legal[0]!;
        void _p;
        const clientActionId = `c-${++counter}`;
        states.set(id, intentSent(states.get(id)!, clientActionId));
        route(
          core.handleMessage(id, {
            type: "intent",
            clientActionId,
            seq: g.seq,
            action,
          }),
        );
      },
    };
  };
  return { core, tab };
}

describe("web client state against the real server core", () => {
  it("two tabs join the same room and see the lobby", () => {
    const { tab } = table();
    const ann = tab("a");
    const bob = tab("b");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "bcdf", name: "Bob" });

    for (const t of [ann, bob]) {
      expect(t.state().room?.code).toBe("BCDF");
      expect(t.state().room?.seats.map((s) => s.name)).toEqual(["Ann", "Bob"]);
      expect(t.state().contentMismatch).toBe(false);
    }
    expect(ann.state().session?.seat).toBe("p1");
    expect(bob.state().session?.seat).toBe("p2");
  });

  it("plays a whole game: both tabs stay in step, the log has no junk, a rejoin catches up", () => {
    const { tab } = table();
    const ann = tab("a");
    const bob = tab("b");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    ann.send({ type: "start" });
    expect(ann.state().game?.seq).toBe(0);

    for (let i = 0; i < 300; i++) {
      const a = ann.state();
      if (a.game!.view.phase.kind === "gameOver") break;
      const actor = a.game!.view.phase.actors[0];
      (actor === "p1" ? ann : bob).actFirst();
      expect(ann.state().game?.seq).toBe(bob.state().game?.seq);
      expect(ann.state().game?.view.actionCount).toBe(ann.state().game?.seq);
      expect(ann.state().pending).toBeNull();
      expect(bob.state().pending).toBeNull();
    }
    expect(ann.state().game!.view.phase.kind).toBe("gameOver");
    expect(ann.state().game!.view.result?.winners.length).toBeGreaterThan(0);
    expect(ann.state().notice).toBeNull();

    const text = ann.state().log.map((l) => l.text);
    expect(text.some((t) => t.includes("rolls"))).toBe(true);
    expect(text.some((t) => t.startsWith("Game over"))).toBe(true);
    expect(text.join("\n")).not.toMatch(/undefined|NaN|\[object/);

    // Bob's tab is closed and reopened: rejoin gives the current game.
    const seq = bob.state().game!.seq;
    bob.drop();
    const bob2 = tab("b2");
    bob2.send({
      type: "rejoin",
      v: V,
      code: "BCDF",
      seatToken: bob.state().session!.seatToken,
    });
    expect(bob2.state().session?.seat).toBe("p2");
    expect(bob2.state().game?.seq).toBe(seq);
    expect(bob2.state().game?.view.viewer).toBe("p2");
  });
});

describe("store rules for seq and rev", () => {
  const view = (n: number) =>
    ({ viewer: "p1", actionCount: n }) as unknown as NonNullable<ClientState["game"]>["view"];
  const room = (rev: number): RoomInfo => ({
    code: "BCDF",
    status: "playing",
    host: "p1",
    seats: [],
    minPlayers: 2,
    maxPlayers: 4,
    rev,
  });
  const roomMsg = (rev: number): ServerMessage => ({ type: "room", room: room(rev) });
  const update = (seq: number): ServerMessage => ({
    type: "update",
    seq,
    by: null,
    auto: false,
    events: [],
    view: view(seq),
  });
  const withGame = (seq: number): ClientState => ({
    ...initialState,
    game: { seq, view: view(seq) },
  });

  it("applies the next update, ignores old and repeated ones, asks for sync on a gap", () => {
    expect(onServerMessage(withGame(3), update(4), ctx).game?.seq).toBe(4);
    expect(onServerMessage(withGame(3), update(3), ctx).game?.seq).toBe(3);
    expect(onServerMessage(withGame(3), update(2), ctx).game?.seq).toBe(3);
    const gap = onServerMessage(withGame(3), update(6), ctx);
    expect(gap.game?.seq).toBe(3);
    expect(gap.needsSync).toBe(true);
  });

  it("a snapshot repairs a gap", () => {
    const gap = onServerMessage(withGame(3), update(6), ctx);
    const fixed = onServerMessage(
      gap,
      { type: "snapshot", room: room(5), game: { seq: 6, view: view(6) } },
      ctx,
    );
    expect(fixed.game?.seq).toBe(6);
    expect(fixed.needsSync).toBe(false);
  });

  it("keeps the room with the higher rev", () => {
    const s1 = onServerMessage(initialState, roomMsg(5), ctx);
    expect(onServerMessage(s1, roomMsg(4), ctx).room?.rev).toBe(5);
    expect(onServerMessage(s1, roomMsg(6), ctx).room?.rev).toBe(6);
  });

  it("stale rejections are quiet; other rejections show the message", () => {
    const pending: ClientState = { ...initialState, pending: "c-1" };
    const stale = onServerMessage(
      pending,
      {
        type: "rejected",
        clientActionId: "c-1",
        seq: 9,
        error: { code: "stale", message: "old" },
      },
      ctx,
    );
    expect(stale.pending).toBeNull();
    expect(stale.notice).toBeNull();
    const bad = onServerMessage(
      pending,
      {
        type: "rejected",
        clientActionId: "c-1",
        seq: 9,
        error: { code: "not-your-turn", message: "Not your turn" },
      },
      ctx,
    );
    expect(bad.notice).toBe("Not your turn");
  });

  it("flags content that differs from the server's", () => {
    const s = onServerMessage(
      initialState,
      {
        type: "welcome",
        v: V,
        seat: "p1",
        seatToken: "t",
        contentHash: "other",
        room: room(0),
        game: null,
      },
      ctx,
    );
    expect(s.contentMismatch).toBe(true);
  });
});
