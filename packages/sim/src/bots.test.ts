import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getLegalActions,
  redactForClient,
  type PlayerAction,
} from "@fishingjamboree/engine";
import { BOT_NAMES, BOTS, botByName, type Bot, type BotInput } from "./bots";
import { playGame } from "./play";
import { content } from "./testContent";

const seatsFor = (bot: string, n: number) => Array.from({ length: n }, () => bot);

describe("bots", () => {
  it("has the four styles", () => {
    expect(BOT_NAMES).toEqual(["random", "greedy", "cautious", "risk-taker"]);
    expect(() => botByName("nobody")).toThrow(/unknown bot/);
  });

  // playGame throws if a bot picks an action that is not in the legal list or a game does not end.
  for (const bot of BOT_NAMES) {
    for (const n of [2, 3, 4]) {
      it(`${bot}: ${n}-player games end and every choice is legal`, () => {
        for (let g = 0; g < 8; g += 1) {
          const { state, record } = playGame(content, {
            seed: `legal-${bot}-${n}-${g}`,
            bots: seatsFor(bot, n),
          });
          expect(state.phase.kind).toBe("gameOver");
          expect(state.round).toBe(content.rules.rounds);
          expect(record.scores).toHaveLength(n);
        }
      });
    }
  }

  it("mixed tables end too", () => {
    for (let g = 0; g < 10; g += 1) {
      const { state } = playGame(content, {
        seed: `mixed-${g}`,
        bots: ["greedy", "cautious", "risk-taker", "random"],
      });
      expect(state.phase.kind).toBe("gameOver");
    }
  });

  it("is deterministic: the same seed plays the same game", () => {
    for (const bot of BOT_NAMES) {
      const spec = { seed: `det-${bot}`, bots: [bot, "greedy", "cautious"] };
      const a = playGame(content, spec);
      const b = playGame(content, spec);
      expect(b.actions).toEqual(a.actions);
      expect(b.record).toEqual(a.record);
    }
  });

  it("another seed plays another game", () => {
    const a = playGame(content, { seed: "one", bots: ["random", "random"] });
    const b = playGame(content, { seed: "two", bots: ["random", "random"] });
    expect(b.actions).not.toEqual(a.actions);
  });

  it("sees only the redacted view, and only the view decides its choice", () => {
    // Wrap each bot: check what it is given, and that a JSON copy of the view gives the same choice.
    for (const name of BOT_NAMES) {
      const inner = BOTS[name] as Bot;
      const created = createGame(content, { seed: `view-${name}`, players: ["p1", "p2", "p3"] });
      let state = created.state;
      let steps = 0;
      while (state.phase.kind !== "gameOver" && steps < 400) {
        const actor = state.phase.actors[0] as string;
        const view = redactForClient(state, actor);
        const legal = getLegalActions(content, state, actor);
        expect(view).not.toHaveProperty("rng");
        expect(view).not.toHaveProperty("awards");
        expect(view.decks.risk).not.toHaveProperty("draw");
        const input: BotInput = { content, view, legal, seed: "x" };
        const choice = inner.choose(input);
        const copy = inner.choose({ ...input, view: JSON.parse(JSON.stringify(view)) });
        expect(copy).toEqual(choice);
        expect(legal).toContainEqual(choice);
        const result = applyAction(content, state, choice as PlayerAction);
        if (!result.ok) throw new Error(result.error.message);
        state = result.state;
        steps += 1;
      }
    }
  });
});

describe("bot styles behave as named", () => {
  // 30 games each with every seat on one style: compare the style's habits.
  const habits = (bot: string) => {
    let risk = 0;
    let wins = 0;
    let upgrades = 0;
    let seats = 0;
    for (let g = 0; g < 30; g += 1) {
      const { record } = playGame(content, { seed: `habit-${g}`, bots: [bot, bot, bot] });
      for (const s of record.scores) {
        risk += s.stats.riskDraws;
        upgrades += +s.speed + +s.capacity;
        seats += 1;
      }
    }
    for (let g = 0; g < 30; g += 1) {
      const { record } = playGame(content, { seed: `vs-${g}`, bots: [bot, "random", "random"] });
      if (record.winners.includes("p1")) wins += 1;
    }
    return { risk: risk / seats, upgrades: upgrades / seats, wins };
  };
  const h = Object.fromEntries(BOT_NAMES.map((b) => [b, habits(b)]));

  it("cautious draws fewer Risk cards than greedy, and greedy fewer than the risk-taker", () => {
    expect(h.cautious!.risk).toBeLessThan(h.greedy!.risk);
    expect(h.greedy!.risk).toBeLessThan(h["risk-taker"]!.risk);
  });

  it("cautious buys at most the Capacity upgrade", () => {
    expect(h.cautious!.upgrades).toBeLessThanOrEqual(1);
  });

  it("each heuristic bot beats two random bots most of the time", () => {
    for (const bot of ["greedy", "cautious", "risk-taker"])
      expect(h[bot]!.wins).toBeGreaterThan(20);
  });
});
