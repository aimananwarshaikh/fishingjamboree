import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getActors,
  getLegalActions,
  redactForClient,
} from "@fishingjamboree/engine";
import type { GameState, PlayerView } from "@fishingjamboree/engine";
import { loadBundledContent } from "./content";
import { eventsToSteps } from "./animation";
import type { AnimStep } from "./animation";
import { awardOutcome, stepCaption } from "./describe";

const content = loadBundledContent();
const name = (p: string) => ({ p1: "Ann", p2: "Bob", p3: "Cy" })[p] ?? p;

describe("stepCaption", () => {
  it("leaves to the board what the board shows", () => {
    const silent: AnimStep[] = [
      { kind: "place", player: "p1", tile: 1 },
      { kind: "move", player: "p1", path: [1, 2] },
      { kind: "relocate", player: "p1", from: 1, to: 2 },
      { kind: "round", round: 3 },
      { kind: "event", card: "tsunami", afterRound: 5 },
    ];
    for (const s of silent) expect(stepCaption(s, content, name)).toBeNull();
  });

  it("names the player and the numbers", () => {
    expect(
      stepCaption(
        { kind: "dice", player: "p1", roll: { die: 4, speedBonus: 1, eventModifier: 0, steps: 5 } },
        content,
        name,
      ),
    ).toBe("Ann rolls 4 (+1) = 5");
    expect(
      stepCaption(
        { kind: "fine", player: "p2", amount: 200, paid: 100, tokensTaken: 1 },
        content,
        name,
      ),
    ).toBe("Bob is fined $200");
    expect(
      stepCaption(
        { kind: "sale", player: "p2", fish: [100, 300], total: 400, via: "dock" },
        content,
        name,
      ),
    ).toBe("Bob sells for $400");
  });

  it("gives clean text for every step of a few whole games", () => {
    for (const [seed, players] of [
      ["cap-a", ["p1", "p2"]],
      ["cap-b", ["p1", "p2", "p3"]],
    ] as const) {
      let state: GameState = createGame(content, { seed, players: [...players] }).state;
      let before: PlayerView | null = null;
      let n = 0;
      for (let i = 0; i < 5000 && state.phase.kind !== "gameOver"; i++) {
        const actor = getActors(state)[0]!;
        const legal = getLegalActions(content, state, actor);
        const res = applyAction(content, state, legal[i % legal.length]!);
        if (!res.ok) throw new Error(res.error.message);
        for (const step of eventsToSteps(res.events, before)) {
          const text = stepCaption(step, content, name);
          if (text !== null) {
            n++;
            expect(text).not.toMatch(/undefined|NaN|\[object|null/);
          }
        }
        state = res.state;
        before = redactForClient(state, "p1");
      }
      expect(n).toBeGreaterThan(50);
    }
  });
});

describe("stepCaption: fish", () => {
  it("does not say '+no fish' when everything was lost to capacity", () => {
    const fish = (kept: number[], lost: number[]): AnimStep => ({
      kind: "fish",
      player: "p1",
      kept,
      lost,
      bonus: 0,
    });
    expect(stepCaption(fish([100], []), content, name)).toBe("Ann: +1 fish ($100)");
    expect(stepCaption(fish([], [100, 100]), content, name)).toMatch(/^Ann: .* lost \(full\)$/);
    expect(stepCaption(fish([100], [300]), content, name)).toMatch(
      /^Ann: \+1 fish \(\$100\), .* lost \(full\)$/,
    );
  });
});

describe("awardOutcome", () => {
  const base = { award: "big-haul", amount: 300, value: 7 };
  it("names the paid winners and the amount", () => {
    expect(awardOutcome({ ...base, qualified: ["p1", "p2"], winners: ["p1", "p2"] }, name)).toEqual(
      {
        who: "Ann and Bob",
        amount: 300,
        note: null,
      },
    );
  });
  it("says so when the qualified players are not paid", () => {
    expect(awardOutcome({ ...base, qualified: ["p3"], winners: [] }, name)).toEqual({
      who: "Cy",
      amount: null,
      note: "not paid (not in the game at the end)",
    });
  });
  it("says nobody when nobody qualified", () => {
    expect(awardOutcome({ ...base, value: null, qualified: [], winners: [] }, name)).toEqual({
      who: "Nobody",
      amount: null,
      note: null,
    });
  });
});
