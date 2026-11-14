import { describe, expect, it } from "vitest";
import { getLegalActions } from "@fishingjamboree/engine";
import type { GameEvent } from "@fishingjamboree/engine";
import { ServerCore } from "../../../packages/server/src/core";
import type { CoreConfig, Outbound } from "../../../packages/server/src/core";
import { PROTOCOL_VERSION as V } from "../../../packages/server/src/protocol";
import type { ClientMessage, RoomInfo, ServerMessage } from "../../../packages/server/src/protocol";
import { loadBundledContent } from "./content";
import { describeEvent } from "./describe";
import {
  KICKED_NOTICE,
  REPLACED_NOTICE,
  ROOM_CLOSED_NOTICE,
  awaySecondsLeft,
  bannerFor,
  initialState,
  intentSent,
  onServerMessage,
  turnSecondsLeft,
} from "./store";
import type { ClientState, Context } from "./store";

const content = loadBundledContent();
const ctx: Context = {
  contentHash: content.hash,
  rounds: content.rules.rounds,
  cardName: (c) => content.cards.cards[c]?.name ?? c,
  describe: (events: GameEvent[], room) =>
    events
      .map((e) =>
        describeEvent(e, content, (p) => room?.seats.find((s) => s.seat === p)?.name ?? p),
      )
      .filter((t): t is string => t !== null),
};

/** A real ServerCore with simulated browser tabs, each holding a `ClientState`. */
function table(config: Partial<CoreConfig> = {}) {
  let tokens = 0;
  let time = 0;
  // The tabs' clock runs 5 s ahead of the server's: countdowns must not care.
  const tabCtx: Context = { ...ctx, now: () => time + 5_000 };
  const core = new ServerCore({
    content,
    now: () => time,
    config,
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
      states.set(o.to, onServerMessage(s, o.message as ServerMessage, tabCtx));
    }
  };
  const tab = (id: string) => {
    states.set(id, initialState);
    return {
      id,
      state: () => states.get(id)!,
      send: (msg: ClientMessage) => route(core.handleMessage(id, msg)),
      drop: () => route(core.disconnect(id)),
      /** Sends the first legal action twice with the same `seq`, like a double click. */
      doubleFirst: () => {
        const g = states.get(id)!.game!;
        const seat = states.get(id)!.session!.seat;
        const { player: _p, ...action } = getLegalActions(content, g.view, seat)[0]!;
        void _p;
        for (let n = 0; n < 2; n++) {
          const clientActionId = `c-${++counter}`;
          states.set(id, intentSent(states.get(id)!, clientActionId));
          route(core.handleMessage(id, { type: "intent", clientActionId, seq: g.seq, action }));
        }
      },
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
  /** Moves the clock and runs whatever the server has due (grace, automatic actions). */
  const advance = (ms: number) => {
    time += ms;
    route(core.tick());
  };
  return { core, tab, advance, tabNow: () => time + 5_000 };
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

describe("three tabs (stage 6b)", () => {
  it("double clicks are quiet, a closed tab has its turns missed after the grace, all tabs finish", () => {
    // Longer than the grace, so only Cy (away) is played for here.
    const { tab, advance } = table({ turnTimeoutMs: 90_000 });
    const tabs = [tab("a"), tab("b"), tab("c")];
    const [ann, bob, cy] = tabs as [
      ReturnType<typeof tab>,
      ReturnType<typeof tab>,
      ReturnType<typeof tab>,
    ];
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    cy.send({ type: "join", v: V, code: "BCDF", name: "Cy" });
    ann.send({ type: "start" });
    const bySeat = { p1: ann, p2: bob, p3: cy } as Record<string, ReturnType<typeof tab>>;

    // Ten double clicks: each applies once, and the second is rejected as stale, quietly.
    for (let i = 0; i < 10; i++) {
      const before = ann.state().game!.seq;
      bySeat[ann.state().game!.view.phase.actors[0]!]!.doubleFirst();
      expect(ann.state().game!.seq).toBe(before + 1);
      for (const t of tabs) {
        expect(t.state().notice).toBeNull();
        expect(t.state().pending).toBeNull();
      }
    }

    // Cy closes the tab. During the grace Cy is shown disconnected, then away.
    cy.drop();
    const cySeat = () => ann.state().room!.seats.find((s) => s.seat === "p3")!;
    expect(cySeat()).toMatchObject({ connected: false, away: false });
    advance(60_000);
    expect(cySeat()).toMatchObject({ connected: false, away: true });
    expect(bob.state().room!.seats[2]).toMatchObject({ away: true });

    const live = [ann, bob];
    for (let i = 0; i < 2000; i++) {
      const view = ann.state().game!.view;
      if (view.phase.kind === "gameOver") break;
      const actor = view.phase.actors[0]!;
      if (actor === "p3") advance(2_000);
      else bySeat[actor]!.actFirst();
      expect(ann.state().game?.seq).toBe(bob.state().game?.seq);
    }
    for (const t of live) {
      expect(t.state().game!.view.phase.kind).toBe("gameOver");
      expect(t.state().room!.status).toBe("finished");
      expect(t.state().notice).toBeNull();
    }
    const log = ann.state().log.map((l) => l.text);
    expect(log.some((t) => t.startsWith("Cy") && t.endsWith("(auto)"))).toBe(true);
    expect(log.some((t) => t.startsWith("Bob") && t.endsWith("(auto)"))).toBe(false);
    // The last update showed the game-over banner.
    expect(ann.state().banner?.title).toBe("Game over");
  });
});

describe("turn timer and reconnect grace (P1-2)", () => {
  it("shows the seconds left on the tab's own clock, and misses the turn of a player who does not act", () => {
    const { tab, advance, tabNow } = table();
    const ann = tab("a");
    const bob = tab("b");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    expect(turnSecondsLeft(ann.state(), tabNow())).toBeNull();
    ann.send({ type: "start" });
    expect(turnSecondsLeft(ann.state(), tabNow())).toBe(90);
    expect(ann.state().room!.timers.turnTimeoutMs).toBe(90_000);
    advance(15_500);
    expect(turnSecondsLeft(bob.state(), tabNow())).toBe(75);
    const actor = ann.state().game!.view.phase.actors[0]!;
    advance(74_500);
    expect(ann.state().game!.seq).toBe(1);
    // The next turn starts a fresh 90 s.
    expect(turnSecondsLeft(ann.state(), tabNow())).toBe(90);
    const log = ann.state().log.map((l) => l.text);
    const who = actor === "p1" ? "Ann" : "Bob";
    expect(log).toContain(`${who} ran out of time and misses the turn. (auto)`);
  });

  it("counts down a dropped player's grace, then shows them away", () => {
    const { tab, advance, tabNow } = table({ turnTimeoutMs: null });
    const ann = tab("a");
    const bob = tab("b");
    const cy = tab("c");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    cy.send({ type: "join", v: V, code: "BCDF", name: "Cy" });
    ann.send({ type: "start" });
    expect(turnSecondsLeft(ann.state(), tabNow())).toBeNull();
    cy.drop();
    expect(awaySecondsLeft(ann.state(), "p3", tabNow())).toBe(60);
    expect(awaySecondsLeft(ann.state(), "p2", tabNow())).toBeNull();
    advance(20_000);
    expect(awaySecondsLeft(ann.state(), "p3", tabNow())).toBe(40);
    advance(40_000);
    expect(ann.state().room!.seats[2]).toMatchObject({ away: true, awayInMs: null });
    expect(awaySecondsLeft(ann.state(), "p3", tabNow())).toBeNull();
  });
});

describe("removing a player (designer, 2026-11-13)", () => {
  it("the host removes a player: their tab goes back to the start screen, the others see it", () => {
    const { tab } = table();
    const ann = tab("a");
    const bob = tab("b");
    const cy = tab("c");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    cy.send({ type: "join", v: V, code: "BCDF", name: "Cy" });
    ann.send({ type: "start" });
    ann.send({ type: "kick", seat: "p3" });
    expect(cy.state().session).toBeNull();
    expect(cy.state().notice).toBe(KICKED_NOTICE);
    for (const t of [ann, bob]) {
      expect(t.state().room!.seats[2]).toMatchObject({ removed: true, connected: false });
      expect(t.state().log.map((l) => l.text)).toContain(
        "Cy is removed from the game by the host.",
      );
      expect(t.state().notice).toBeNull();
    }
    // Two players are left, so the game goes on.
    expect(ann.state().room!.status).toBe("playing");
    ann.send({ type: "kick", seat: "p2" });
    expect(ann.state().room!.status).toBe("finished");
    expect(ann.state().log.map((l) => l.text)).toContain(
      "Game over. Ann is the last player left and wins.",
    );
  });
});

describe("rejoin from another tab or device (P1-1)", () => {
  it("a new tab takes the seat with the saved token; the old tab lets it go and gets nothing more", () => {
    const { tab } = table();
    const ann = tab("a");
    const bob = tab("b");
    ann.send({ type: "create", v: V, name: "Ann" });
    bob.send({ type: "join", v: V, code: "BCDF", name: "Bob" });
    ann.send({ type: "start" });
    const bySeat = { p1: ann, p2: bob } as Record<string, ReturnType<typeof tab>>;
    for (let i = 0; i < 5; i++) bySeat[ann.state().game!.view.phase.actors[0]!]!.actFirst();
    const token = ann.state().session!.seatToken;
    const seq = ann.state().game!.seq;

    // Ann opens the rejoin link on a phone while the laptop tab is still open.
    const phone = tab("a-phone");
    phone.send({ type: "rejoin", v: V, code: "bcdf", seatToken: token });
    expect(phone.state().session).toEqual({ code: "BCDF", seat: "p1", seatToken: token });
    expect(phone.state().game?.seq).toBe(seq);

    // The old tab is back on the start screen with a clear message.
    expect(ann.state().session).toBeNull();
    expect(ann.state().game).toBeNull();
    expect(ann.state().notice).toBe(REPLACED_NOTICE);

    // Play goes on from the phone; the old tab hears nothing more.
    bySeat.p1 = phone;
    for (let i = 0; i < 5; i++) bySeat[phone.state().game!.view.phase.actors[0]!]!.actFirst();
    expect(phone.state().game!.seq).toBe(seq + 5);
    expect(bob.state().game!.seq).toBe(seq + 5);
    expect(ann.state().game).toBeNull();
    expect(bob.state().room!.seats[0]).toMatchObject({ name: "Ann", connected: true });
  });
});

describe("banners", () => {
  it("round start, event card and game over", () => {
    const round: GameEvent = { type: "roundStarted", round: 6 } as GameEvent;
    expect(bannerFor([round], ctx, 0)).toEqual({ id: 1, title: "Round 6 of 20", detail: null });
    const drawn = { type: "eventDrawn", afterRound: 5, card: "helicopter" } as unknown as GameEvent;
    expect(bannerFor([drawn, round], ctx, 4)).toEqual({
      id: 5,
      title: "Round 6 of 20",
      detail: "Event: Helicopter",
    });
    const ended = { type: "gameEnded" } as unknown as GameEvent;
    expect(bannerFor([ended], ctx, 1)?.title).toBe("Game over");
    expect(bannerFor([{ type: "turnEnded" } as unknown as GameEvent], ctx, 1)).toBeNull();
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
    timers: { turnTimeoutMs: 60_000, reconnectGraceMs: 60_000, reconnectBudgetMs: 120_000 },
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
    turnTimeLeftMs: 60_000,
  });
  const SESSION = { code: "BCDF", seat: "p1" as const, seatToken: "t" };
  const withGame = (seq: number): ClientState => ({
    ...initialState,
    game: { seq, view: view(seq), turnTimeLeftMs: 60_000 },
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
      { type: "snapshot", room: room(5), game: { seq: 6, view: view(6), turnTimeLeftMs: 1_000 } },
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

  it("a server error clears pending so the buttons work again (P2-4)", () => {
    const pending: ClientState = { ...withGame(3), session: SESSION, pending: "c-1" };
    const after = onServerMessage(
      pending,
      { type: "error", code: "server-error", message: "the server hit an error; try again" },
      ctx,
    );
    expect(after.pending).toBeNull();
    expect(after.game?.seq).toBe(3);
    expect(after.session).toEqual(SESSION);
    expect(after.notice).toBe("the server hit an error; try again");
  });

  it("a closed room sends the tab back to the start screen with a notice (P2-4)", () => {
    const pending: ClientState = { ...withGame(3), session: SESSION, pending: "c-1" };
    const after = onServerMessage(
      pending,
      { type: "error", code: "room-closed", message: "closed" },
      ctx,
    );
    expect(after.session).toBeNull();
    expect(after.game).toBeNull();
    expect(after.pending).toBeNull();
    expect(after.notice).toBe(ROOM_CLOSED_NOTICE);
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
