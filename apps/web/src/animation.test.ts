import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getActors,
  getLegalActions,
  redactForClient,
} from "@fishingjamboree/engine";
import type { GameEvent, GameState, PlayerView } from "@fishingjamboree/engine";
import { loadBundledContent } from "./content";
import {
  DURATION,
  MAX_LAG_MS,
  MY_TURN_LAG_MS,
  SKIP_LAG_MS,
  emptyQueue,
  enqueueUpdate,
  eventsToSteps,
  frameAt,
  queueEnd,
  resetQueue,
  stepDuration,
} from "./animation";
import type { AnimKind, AnimQueue, AnimStep } from "./animation";

const content = loadBundledContent();

/** A small deterministic generator, so test games are the same every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Update {
  seq: number;
  events: GameEvent[];
  before: PlayerView | null;
  view: PlayerView;
}

/** A whole game played by random legal actions, as the updates one viewer receives. */
function playGame(seed: string, players: string[], pick = lcg(7)): Update[] {
  const start = createGame(content, { seed, players });
  let state: GameState = start.state;
  const viewer = players[0]!;
  const updates: Update[] = [
    { seq: 0, events: start.events, before: null, view: redactForClient(state, viewer) },
  ];
  for (let i = 0; i < 5000 && state.phase.kind !== "gameOver"; i++) {
    const actor = getActors(state)[0]!;
    const legal = getLegalActions(content, state, actor);
    const action = legal[Math.floor(pick() * legal.length)]!;
    const res = applyAction(content, state, action);
    if (!res.ok) throw new Error(res.error.message);
    const before = updates[updates.length - 1]!.view;
    state = res.state;
    updates.push({
      seq: updates.length,
      events: res.events,
      before,
      view: redactForClient(state, viewer),
    });
  }
  return updates;
}

const games = [
  playGame("anim-a", ["p1", "p2"]),
  playGame("anim-b", ["p1", "p2", "p3"]),
  playGame("anim-c", ["p1", "p2", "p3", "p4"], lcg(99)),
];

/** The pose of each ship in a frame, as tile ids, for comparing with a view. */
function restingShips(q: AnimQueue, view: PlayerView, now: number) {
  const f = frameAt(q, view, now);
  return Object.fromEntries(
    [...f.ships].map(([p, pose]) => [p, pose.to === null ? pose.tile : -1]),
  );
}
function viewShips(view: PlayerView) {
  return Object.fromEntries(
    view.players.filter((p) => p.position !== null && !p.removed).map((p) => [p.id, p.position]),
  );
}

const ev = {
  moved: (player: string, path: number[]): GameEvent => ({
    type: "moved",
    player,
    from: path[0]!,
    to: path[path.length - 1]!,
    path,
  }),
  rolled: (player: string, die: number): GameEvent => ({
    type: "rolled",
    player,
    roll: { die, speedBonus: 0, eventModifier: 0, steps: die },
  }),
};

/** A view with ships at the given tiles (from a real game, so it is well formed). */
function viewWith(
  positions: Record<string, number | null>,
  goldenFish: PlayerView["goldenFish"] = null,
): PlayerView {
  const base = games[1]![5]!.view;
  return {
    ...base,
    goldenFish,
    players: base.players.map((p) => ({
      ...p,
      position: p.id in positions ? positions[p.id]! : p.position,
      removed: false,
    })),
  };
}

describe("eventsToSteps", () => {
  it("turns each kind of event into its step, in order", () => {
    const before = viewWith({ p1: 10, p2: 20, p3: 30 }, { spot: 1, tile: 33, value: 500 });
    const steps = eventsToSteps(
      [
        { type: "turnStarted", player: "p1", round: 3 },
        ev.rolled("p1", 3),
        ev.moved("p1", [10, 11, 12, 33]),
        { type: "goldenFishTaken", player: "p1", spot: 1, value: 500 },
        { type: "cardDrawn", player: "p1", deck: "risk", card: "shark" },
        { type: "fishLost", player: "p1", fish: [100], reason: "shark" },
        { type: "fined", player: "p1", amount: 200, paid: 100, tokensTaken: 1 },
        { type: "playerRemoved", player: "p2", reason: "kicked" },
        { type: "turnEnded", player: "p1" },
      ],
      before,
    );
    expect(steps.map((s) => s.kind)).toEqual([
      "dice",
      "move",
      "goldenFish",
      "card",
      "fishLost",
      "fine",
      "removed",
    ]);
    expect(steps[2]).toEqual({
      kind: "goldenFish",
      what: "taken",
      player: "p1",
      fish: { spot: 1, tile: 33, value: 500 },
    });
    // The removed ship fades out where it was.
    expect(steps[6]).toEqual({ kind: "removed", player: "p2", tile: 20 });
  });

  it("follows ships and the Golden Fish through the update", () => {
    const steps = eventsToSteps(
      [
        { type: "shipPlaced", player: "p1", dock: "start-left", tile: 155, reason: "setup" },
        { type: "goldenFishPlaced", spot: 2, tile: 96, value: 700 },
        { type: "goldenFishRemoved", spot: 2, reason: "event-expired" },
        { type: "playerRemoved", player: "p1", reason: "missed-turns" },
      ],
      null,
    );
    expect(steps).toEqual([
      { kind: "place", player: "p1", tile: 155 },
      { kind: "goldenFish", what: "placed", player: null, fish: { spot: 2, tile: 96, value: 700 } },
      {
        kind: "goldenFish",
        what: "removed",
        player: null,
        fish: { spot: 2, tile: 96, value: 700 },
      },
      { kind: "removed", player: "p1", tile: 155 },
    ]);
  });

  it("gives one award step per award, before the end of the game", () => {
    const last = games.map((g) => g[g.length - 1]!);
    for (const u of last) {
      const steps = eventsToSteps(u.events, u.before);
      const awards = u.events.filter((e) => e.type === "awardGiven").length;
      expect(awards).toBeGreaterThan(0);
      expect(steps.filter((s) => s.kind === "award")).toHaveLength(awards);
      expect(steps[steps.length - 1]!.kind).toBe("gameEnd");
    }
  });

  it("covers every kind of step over a few whole games", () => {
    const seen = new Set<AnimKind>();
    for (const g of games)
      for (const u of g) for (const s of eventsToSteps(u.events, u.before)) seen.add(s.kind);
    // Kinds random play reaches in these seeds; the rest are unit-tested above.
    for (const k of [
      "place",
      "dice",
      "move",
      "card",
      "fish",
      "sale",
      "round",
      "event",
      "award",
      "gameEnd",
    ] as AnimKind[])
      expect(seen, k).toContain(k);
  });
});

describe("enqueueUpdate: timing", () => {
  const update = (seq: number, events: GameEvent[], before: PlayerView | null = null) => ({
    seq,
    events,
    before,
  });

  it("plays steps one after another from the time the update arrived", () => {
    const q = enqueueUpdate(
      resetQueue(emptyQueue, 0),
      update(1, [ev.rolled("p1", 3), ev.moved("p1", [1, 2, 3, 4])]),
      1000,
    );
    expect(q.seq).toBe(1);
    expect(q.steps.map((s) => [s.step.kind, s.start, s.end])).toEqual([
      ["dice", 1000, 1000 + DURATION.dice],
      ["move", 1000 + DURATION.dice, 1000 + DURATION.dice + 3 * DURATION.move],
    ]);
    expect(queueEnd(q)).toBe(1000 + DURATION.dice + 3 * DURATION.move);
  });

  it("queues a second update after what is still playing", () => {
    let q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, [ev.rolled("p1", 3)]), 0);
    q = enqueueUpdate(q, update(2, [ev.moved("p1", [1, 2])]), 500);
    expect(q.steps.map((s) => [s.seq, s.start, s.end])).toEqual([
      [1, 0, DURATION.dice],
      [2, DURATION.dice, DURATION.dice + DURATION.move],
    ]);
  });

  it("drops finished steps and keeps ids unique", () => {
    let q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, [ev.rolled("p1", 3)]), 0);
    q = enqueueUpdate(q, update(2, [ev.rolled("p2", 4)]), 10_000);
    expect(q.steps).toHaveLength(1);
    expect(q.steps[0]!.start).toBe(10_000);
    expect(q.steps[0]!.id).toBeGreaterThan(1);
  });

  it("resets on a gap: the view is shown as it is", () => {
    const q = enqueueUpdate(resetQueue(emptyQueue, 3), update(5, [ev.rolled("p1", 3)]), 0);
    expect(q).toEqual({ ...resetQueue(emptyQueue, 5), nextId: q.nextId });
    expect(q.steps).toEqual([]);
  });

  it("takes the first update of a game with no seq yet", () => {
    const q = enqueueUpdate(emptyQueue, update(0, [ev.rolled("p1", 3)]), 0);
    expect(q.seq).toBe(0);
    expect(q.steps).toHaveLength(1);
  });

  it("plays faster when behind, so everything is shown within MAX_LAG_MS", () => {
    const long = Array.from({ length: 6 }, () => ev.moved("p1", [1, 2, 3, 4, 5, 6, 7]));
    const normal = long.reduce((t) => t + 6 * DURATION.move, 0);
    expect(normal).toBeGreaterThan(MAX_LAG_MS);
    expect(normal).toBeLessThan(SKIP_LAG_MS);
    const q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, long), 0);
    expect(q.steps).toHaveLength(6);
    expect(queueEnd(q)).toBeCloseTo(MAX_LAG_MS, 5);
  });

  it("catches up harder when it is this player's turn (their timer is running)", () => {
    const events = [ev.rolled("p1", 3), ev.moved("p1", [1, 2, 3, 4]), ev.rolled("p2", 2)];
    const q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, events), 0, { myTurn: true });
    expect(queueEnd(q)).toBeCloseTo(MY_TURN_LAG_MS, 5);
    // Not shortened when it fits.
    const short = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, [ev.moved("p1", [1, 2])]), 0, {
      myTurn: true,
    });
    expect(queueEnd(short)).toBe(DURATION.move);
  });

  it("does not shorten the step already playing", () => {
    let q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, [ev.rolled("p1", 3)]), 0);
    q = enqueueUpdate(q, update(2, [ev.moved("p1", [1, 2, 3, 4, 5, 6, 7])]), 100, { myTurn: true });
    expect(q.steps[0]!.end).toBe(DURATION.dice);
    expect(queueEnd(q)).toBeCloseTo(100 + MY_TURN_LAG_MS, 5);
  });

  it("skips to the view when far behind", () => {
    const lots = Array.from({ length: 40 }, () => ev.moved("p1", [1, 2, 3, 4, 5, 6, 7]));
    const q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, lots), 0);
    expect(q.steps).toEqual([]);
    expect(q.seq).toBe(1);
  });

  it("drops steps that would be too fast to see", () => {
    let q: AnimQueue = resetQueue(emptyQueue, 0);
    // Just under the skip limit, but far over MY_TURN_LAG_MS.
    const many = Array.from({ length: 12 }, () => ev.moved("p1", [1, 2, 3, 4, 5, 6, 7]));
    q = enqueueUpdate(q, update(1, many), 0, { myTurn: true });
    expect(q.steps).toEqual([]);
  });

  it("never shortens or skips the awards reveal", () => {
    const last = games[0]![games[0]!.length - 1]!;
    const lots = Array.from({ length: 40 }, () => ev.moved("p1", [1, 2, 3, 4, 5, 6, 7]));
    const q = enqueueUpdate(
      resetQueue(emptyQueue, 0),
      update(1, [...lots, ...last.events], last.before),
      0,
      {
        myTurn: true,
      },
    );
    const awards = q.steps.filter((s) => s.step.kind === "award");
    expect(awards.length).toBeGreaterThan(0);
    for (const a of awards) expect(a.end - a.start).toBe(DURATION.award);
    expect(q.steps.some((s) => s.step.kind === "move")).toBe(false);
  });

  it("holds the result back until the last award and the game-over step are over", () => {
    const last = games[0]![games[0]!.length - 1]!;
    const q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, last.events, last.before), 0, {});
    const reveal = q.steps.filter((s) => s.step.kind === "award" || s.step.kind === "gameEnd");
    expect(reveal.length).toBeGreaterThan(1);
    const end = Math.max(...reveal.map((s) => s.end));
    // The view already has the result when the update arrives.
    expect(last.view.result).not.toBeNull();
    expect(frameAt(q, last.view, 0).revealing).toBe(true);
    // During every award, and in the gap before the first one starts.
    for (const s of reveal)
      expect(frameAt(q, last.view, (s.start + s.end) / 2).revealing).toBe(true);
    expect(frameAt(q, last.view, end - 1).revealing).toBe(true);
    expect(frameAt(q, last.view, end).revealing).toBe(false);
    expect(frameAt(q, last.view, end + 60_000).revealing).toBe(false);
  });

  it("does not hold anything back after a refresh or in an ordinary turn", () => {
    const last = games[0]![games[0]!.length - 1]!;
    // A refresh after the end: no queue, the result shows at once.
    expect(frameAt(resetQueue(emptyQueue, last.seq), last.view, 0).revealing).toBe(false);
    // An ordinary update: steps play, but there is nothing to reveal.
    const u = games[0]![3]!;
    const q = enqueueUpdate(
      resetQueue(emptyQueue, u.seq - 1),
      update(u.seq, u.events, u.before),
      0,
      {},
    );
    expect(frameAt(q, u.view, 0).revealing).toBe(false);
  });

  it("with reduced motion the reveal is still held until it has played", () => {
    const last = games[0]![games[0]!.length - 1]!;
    const q = enqueueUpdate(resetQueue(emptyQueue, 0), update(1, last.events, last.before), 0, {
      reducedMotion: true,
    });
    expect(frameAt(q, last.view, 10).revealing).toBe(true);
    expect(frameAt(q, last.view, queueEnd(q)!).revealing).toBe(false);
  });

  it("plays only the awards with reduced motion", () => {
    const last = games[0]![games[0]!.length - 1]!;
    const q = enqueueUpdate(
      resetQueue(emptyQueue, 0),
      update(1, [ev.rolled("p1", 3), ...last.events], last.before),
      0,
      {
        reducedMotion: true,
      },
    );
    expect(new Set(q.steps.map((s) => s.step.kind))).toEqual(new Set(["award", "gameEnd"]));
  });
});

describe("frameAt", () => {
  const q0 = resetQueue(emptyQueue, 0);

  it("is the view when nothing is queued", () => {
    const view = viewWith({ p1: 10, p2: 20, p3: null }, { spot: 1, tile: 33, value: 500 });
    const f = frameAt(q0, view, 0);
    expect(f.current).toBeNull();
    expect(f.busy).toBe(false);
    expect(restingShips(q0, view, 0)).toEqual({ p1: 10, p2: 20 });
    expect(f.goldenFish).toEqual(view.goldenFish);
  });

  it("holds a ship back until its move plays, then sails it tile by tile", () => {
    const after = viewWith({ p1: 4, p2: 20, p3: 30 });
    const q = enqueueUpdate(
      q0,
      { seq: 1, events: [ev.rolled("p1", 3), ev.moved("p1", [1, 2, 3, 4])], before: null },
      0,
    );
    // During the dice: still on its first tile.
    expect(frameAt(q, after, 100).ships.get("p1")).toEqual({ tile: 1, to: null, t: 0, opacity: 1 });
    expect(frameAt(q, after, 100).current?.step.kind).toBe("dice");
    // Half way along the second leg.
    const mid = DURATION.dice + 1.5 * DURATION.move;
    const pose = frameAt(q, after, mid).ships.get("p1")!;
    expect(pose.tile).toBe(2);
    expect(pose.to).toBe(3);
    expect(pose.t).toBeCloseTo(0.5, 5);
    expect(frameAt(q, after, mid).current?.progress).toBeCloseTo(0.5, 5);
    // Done: where the view says.
    const end = queueEnd(q)!;
    expect(frameAt(q, after, end).ships.get("p1")).toEqual({ tile: 4, to: null, t: 0, opacity: 1 });
    expect(frameAt(q, after, end).busy).toBe(false);
    // Other ships are where the view says all along.
    expect(frameAt(q, after, 100).ships.get("p2")?.tile).toBe(20);
  });

  it("shows a placed ship only once its step plays, fading in", () => {
    const after = viewWith({ p1: 155 });
    const q = enqueueUpdate(
      q0,
      {
        seq: 1,
        events: [
          ev.rolled("p2", 1),
          { type: "shipPlaced", player: "p1", dock: "start-left", tile: 155, reason: "setup" },
        ],
        before: null,
      },
      0,
    );
    expect(frameAt(q, after, 10).ships.has("p1")).toBe(false);
    const half = frameAt(q, after, DURATION.dice + DURATION.place / 2).ships.get("p1")!;
    expect(half.tile).toBe(155);
    expect(half.opacity).toBeCloseTo(0.5, 5);
  });

  it("tows a Sinking Boat ship to its dock", () => {
    const after = viewWith({ p1: 155 });
    const q = enqueueUpdate(
      q0,
      {
        seq: 1,
        events: [{ type: "shipRelocated", player: "p1", from: 40, to: 155, dock: "start-left" }],
        before: null,
      },
      0,
    );
    expect(frameAt(q, after, 0).ships.get("p1")).toEqual({ tile: 40, to: 155, t: 0, opacity: 1 });
    expect(frameAt(q, after, DURATION.relocate / 2).ships.get("p1")!.t).toBeCloseTo(0.5, 5);
  });

  it("keeps a removed player's ship until its step, then fades it out", () => {
    const before = viewWith({ p2: 20 });
    const after: PlayerView = {
      ...before,
      players: before.players.map((p) =>
        p.id === "p2" ? { ...p, position: null, removed: true } : p,
      ),
    };
    const q = enqueueUpdate(
      q0,
      {
        seq: 1,
        events: [ev.rolled("p1", 2), { type: "playerRemoved", player: "p2", reason: "kicked" }],
        before,
      },
      0,
    );
    expect(frameAt(q, after, 0).ships.get("p2")?.opacity).toBe(1);
    expect(
      frameAt(q, after, DURATION.dice + DURATION.removed / 2).ships.get("p2")?.opacity,
    ).toBeCloseTo(0.5, 5);
    expect(frameAt(q, after, queueEnd(q)!).ships.has("p2")).toBe(false);
  });

  it("keeps the Golden Fish on the board until the ship has sailed onto it", () => {
    const fish = { spot: 1, tile: 33, value: 500 };
    const before = viewWith({ p1: 10 }, fish);
    const after = viewWith({ p1: 33 }, null);
    const q = enqueueUpdate(
      q0,
      {
        seq: 1,
        events: [
          ev.moved("p1", [10, 11, 33]),
          { type: "goldenFishTaken", player: "p1", spot: 1, value: 500 },
        ],
        before,
      },
      0,
    );
    expect(frameAt(q, after, 10).goldenFish).toEqual(fish);
    expect(frameAt(q, after, 2 * DURATION.move + 10).goldenFish).toEqual(fish); // being taken
    expect(frameAt(q, after, queueEnd(q)!).goldenFish).toBeNull();
  });

  it("shows a new Golden Fish only once its step plays", () => {
    const fish = { spot: 2, tile: 96, value: 700 };
    const after = viewWith({}, fish);
    const q = enqueueUpdate(
      q0,
      {
        seq: 1,
        events: [
          { type: "roundStarted", round: 6 },
          { type: "goldenFishPlaced", ...fish },
        ],
        before: viewWith({}),
      },
      0,
    );
    expect(frameAt(q, after, 10).goldenFish).toBeNull();
    expect(frameAt(q, after, DURATION.round + 10).goldenFish).toEqual(fish);
  });
});

describe("whole games", () => {
  it("always ends on the view, and starts each update where the last one ended", () => {
    for (const g of games) {
      let q: AnimQueue = emptyQueue;
      let now = 0;
      for (const u of g) {
        q = enqueueUpdate(q, u, now);
        // When the update arrives, ships are drawn where the previous view had them
        // (unless the queue was skipped).
        if (u.before && q.steps.length > 0 && q.steps[0]!.start >= now) {
          for (const [p, tile] of Object.entries(restingShips(q, u.view, now))) {
            const s = q.steps.find((x) => x.end > now && "player" in x.step && x.step.player === p);
            if (s && s.step.kind === "move") expect(tile).toBe(s.step.path[0]);
          }
        }
        // Once it has played, the board is the view.
        const end = queueEnd(q) ?? now;
        expect(restingShips(q, u.view, end)).toEqual(viewShips(u.view));
        expect(frameAt(q, u.view, end).goldenFish).toEqual(u.view.goldenFish);
        expect(frameAt(q, u.view, end).busy).toBe(false);
        // Steps never overlap.
        for (let i = 1; i < q.steps.length; i++)
          expect(q.steps[i]!.start).toBeGreaterThanOrEqual(q.steps[i - 1]!.end - 1e-9);
        // The next update arrives a little later, often before this one has played.
        now += 700;
      }
    }
  });

  it("is never more than MAX_LAG_MS (or the awards) behind", () => {
    for (const g of games) {
      let q: AnimQueue = emptyQueue;
      let now = 0;
      for (const u of g) {
        q = enqueueUpdate(q, u, now);
        const reveal = q.steps
          .filter((s) => s.step.kind === "award" || s.step.kind === "gameEnd")
          .reduce((t, s) => t + (s.end - s.start), 0);
        expect((queueEnd(q) ?? now) - now - reveal).toBeLessThanOrEqual(MAX_LAG_MS + 1e-6);
        now += 300;
      }
    }
  });

  it("every step has a positive length", () => {
    for (const g of games)
      for (const u of g)
        for (const s of eventsToSteps(u.events, u.before))
          expect(stepDuration(s as AnimStep)).toBeGreaterThan(0);
  });
});
