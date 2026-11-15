import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBundledContent } from "./content";
import {
  AWARD_REVEAL_AT,
  BILL_100,
  BILL_500,
  CARD_BACKS,
  TUMBLE_END,
  allArtPaths,
  awardLook,
  awardPosition,
  billStack,
  cardArt,
  cardFlip,
  cardIds,
  diceAngle,
  diceFace,
  envelope,
  fishTokenArt,
  fishTokens,
  pips,
  popScale,
  roundBar,
  stagger,
  upgradeTokenArt,
} from "./stepView";

const content = loadBundledContent();
const webArt = resolve(dirname(fileURLToPath(import.meta.url)), "../../../assets/web");

describe("art paths", () => {
  it("has art for every card in the content, and no art for a card that is not there", () => {
    expect(cardIds().sort()).toEqual(Object.keys(content.cards.cards).sort());
    for (const id of Object.keys(content.cards.cards)) expect(cardArt(id)).not.toBeNull();
    expect(cardArt("no-such-card")).toBeNull();
  });

  it("every art path has a web copy, and cards and tokens a 2x copy", () => {
    for (const path of allArtPaths()) {
      expect(existsSync(join(webArt, `${path}.webp`)), path).toBe(true);
      if (!path.startsWith("money/"))
        expect(existsSync(join(webArt, `${path}@2x.webp`)), path).toBe(true);
    }
  });

  it("each deck has a back, and every fish value in the game a token", () => {
    expect(Object.keys(CARD_BACKS).sort()).toEqual(["event", "risk", "safe"]);
    for (const value of [100, 300, 500, 700, 1000])
      expect(fishTokenArt(value)).toBe(`tokens/fish-${value}`);
    expect(fishTokenArt(200)).toBeNull();
    expect(upgradeTokenArt("speed")).toBe("tokens/upgrade-speed");
    // The fish values the content can produce all have a token.
    for (const card of Object.values(content.cards.cards)) {
      if (card.effect.kind === "fish" || card.effect.kind === "catchBonus") {
        expect(fishTokenArt(card.effect.value), card.id).not.toBeNull();
      }
      if (card.effect.kind === "goldenFish") expect(fishTokenArt(card.effect.value)).not.toBeNull();
    }
  });

  it("web copies are small (no source-size file slipped in)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    for (const file of walk(webArt)) {
      expect(file.endsWith(".webp"), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(120 * 1024);
    }
  });
});

describe("money", () => {
  it("makes $500 bills first, then $100 bills", () => {
    expect(billStack(0)).toEqual({ bills: [], hidden: 0 });
    expect(billStack(300).bills).toEqual([BILL_100, BILL_100, BILL_100]);
    expect(billStack(1200).bills).toEqual([BILL_500, BILL_500, BILL_100, BILL_100]);
  });

  it("caps the bills and says how much was left out", () => {
    const s = billStack(5000, 6);
    expect(s.bills).toHaveLength(6);
    expect(s.bills.every((b) => b === BILL_500)).toBe(true);
    expect(s.hidden).toBe(2000);
    expect(billStack(700, 6)).toEqual({ bills: [BILL_500, BILL_100, BILL_100], hidden: 0 });
  });

  it("caps fish tokens and counts those left out", () => {
    expect(fishTokens([100, 300])).toEqual({
      art: ["tokens/fish-100", "tokens/fish-300"],
      hidden: 0,
    });
    const r = fishTokens(
      Array.from({ length: 11 }, () => 100),
      8,
    );
    expect(r.art).toHaveLength(8);
    expect(r.hidden).toBe(3);
  });
});

describe("progress to look", () => {
  it("envelope fades in, holds and fades out, and stays in 0-1", () => {
    expect(envelope(0, 0.2, 0.8)).toBe(0);
    expect(envelope(0.1, 0.2, 0.8)).toBeCloseTo(0.5);
    expect(envelope(0.5, 0.2, 0.8)).toBe(1);
    expect(envelope(0.9, 0.2, 0.8)).toBeCloseTo(0.5);
    expect(envelope(1, 0.2, 0.8)).toBe(0);
    expect(envelope(-1)).toBe(0);
    expect(envelope(2)).toBe(0);
    expect(envelope(0, 0, 1)).toBe(1); // no fades: always on
    expect(envelope(1, 0, 1)).toBe(1);
  });

  it("popScale grows from 0.6 to 1", () => {
    expect(popScale(0)).toBeCloseTo(0.6);
    expect(popScale(1)).toBe(1);
    expect(popScale(5)).toBe(1);
  });

  it("the die tumbles the same way every time, then rests on the result", () => {
    for (const die of [1, 2, 3, 4, 5, 6]) {
      const faces = Array.from({ length: 30 }, (_, i) => diceFace((i / 30) * TUMBLE_END, die));
      expect(faces.every((f) => f >= 1 && f <= 6)).toBe(true);
      expect(new Set(faces).size).toBeGreaterThan(2);
      expect(faces).toEqual(
        Array.from({ length: 30 }, (_, i) => diceFace((i / 30) * TUMBLE_END, die)),
      );
      expect(diceFace(TUMBLE_END, die)).toBe(die);
      expect(diceFace(1, die)).toBe(die);
      // The last tumbling face is not already the result.
      expect(diceFace(TUMBLE_END - 0.001, die)).not.toBe(die);
    }
    expect(diceAngle(0)).toBeGreaterThan(diceAngle(0.5));
    expect(diceAngle(TUMBLE_END)).toBe(0);
    expect(diceAngle(1)).toBe(0);
  });

  it("a die face has as many pips as its number", () => {
    for (const face of [1, 2, 3, 4, 5, 6]) expect(pips(face)).toHaveLength(face);
    expect(pips(0)).toEqual([]);
  });

  it("a card shows its back, turns over in the middle, and ends on its face", () => {
    expect(cardFlip(0.1).angle).toBe(0);
    expect(cardFlip(0.4).angle).toBeGreaterThan(0);
    expect(cardFlip(0.4).angle).toBeLessThan(180);
    expect(cardFlip(0.6).angle).toBe(180);
    expect(cardFlip(0.5).opacity).toBe(1);
    expect(cardFlip(0).opacity).toBe(0);
    expect(cardFlip(1).opacity).toBe(0);
    // No back to turn: the face from the start.
    expect(cardFlip(0.1, false).angle).toBe(180);
  });

  it("stagger starts items one after another and ends them together", () => {
    expect(stagger(0, 0, 4)).toBe(0);
    expect(stagger(0.1, 3, 4)).toBe(0);
    expect(stagger(0.1, 0, 4)).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) expect(stagger(1, i, 4)).toBe(1);
    expect(stagger(0.5, 0, 1)).toBeCloseTo(0.5 / 0.6);
  });
});

describe("awards reveal", () => {
  it("shows the name first and the winners after a beat", () => {
    const early = awardLook(0.2);
    expect(early.titleOpacity).toBe(1);
    expect(early.resultOpacity).toBe(0);
    expect(early.revealed).toBe(false);
    expect(awardLook(AWARD_REVEAL_AT).revealed).toBe(true);
    const late = awardLook(1);
    expect(late.titleOpacity).toBe(1);
    expect(late.resultOpacity).toBe(1);
  });

  it("numbers an award by its place in the result", () => {
    const mk = (award: string) => ({ award, amount: 100, value: 1, qualified: [], winners: [] });
    const list = [mk("a"), mk("b"), mk("c")];
    expect(awardPosition(list, list[1]!)).toEqual({ n: 2, of: 3 });
    expect(awardPosition(list, mk("zzz"))).toBeNull();
  });
});

describe("roundBar", () => {
  it("fills with the round and marks the three event points", () => {
    const rb = roundBar(6, 20, [5, 10, 15]);
    expect(rb.fill).toBeCloseTo(0.3);
    expect(rb.marks).toEqual([
      { after: 5, at: 0.25, passed: true },
      { after: 10, at: 0.5, passed: false },
      { after: 15, at: 0.75, passed: false },
    ]);
  });

  it("round 5 has not passed its event yet; the last round fills the bar", () => {
    expect(roundBar(5, 20, [5]).marks[0]!.passed).toBe(false);
    expect(roundBar(20, 20, [5, 10, 15]).fill).toBe(1);
    expect(roundBar(20, 20, [5, 10, 15]).marks.every((m) => m.passed)).toBe(true);
    expect(roundBar(0, 0, []).fill).toBe(0);
  });

  it("uses the content's own numbers", () => {
    const rb = roundBar(1, content.rules.rounds, content.rules.eventAfterRounds);
    expect(rb.marks.map((m) => m.after)).toEqual([5, 10, 15]);
  });
});
