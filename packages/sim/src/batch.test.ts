import { describe, expect, it } from "vitest";
import { applyOverrides, makeSpecs, normaliseAwardPaths, parseOverride } from "./batch";
import { compileOrThrow } from "./content";
import { raw } from "./testContent";

describe("makeSpecs", () => {
  it("rotates the bots over the seats", () => {
    const specs = makeSpecs({ seed: "s", players: [2, 3], games: 3, bots: ["a", "b", "c"] });
    expect(specs.map((s) => s.bots)).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["a", "b", "c"],
      ["b", "c", "a"],
      ["c", "a", "b"],
    ]);
    expect(specs[0]!.seed).toBe("s-2p-0");
    expect(new Set(specs.map((s) => s.seed)).size).toBe(specs.length);
  });
});

describe("content overrides", () => {
  it("parses JSON values and falls back to strings", () => {
    expect(parseOverride("rules.rounds=12")).toEqual({ path: ["rules", "rounds"], value: 12 });
    expect(parseOverride("a.b=x")).toEqual({ path: ["a", "b"], value: "x" });
    expect(() => parseOverride("nothing")).toThrow();
  });

  it("changes a copy, never the original", () => {
    const before = JSON.stringify(raw);
    const changed = applyOverrides(raw, [
      "rules.upgrades.speed.price=300",
      "cards.decks.risk.shark=2",
    ]);
    expect(changed.rules.upgrades.speed.price).toBe(300);
    expect(changed.cards.decks.risk.shark).toBe(2);
    expect(JSON.stringify(raw)).toBe(before);
    expect(compileOrThrow(changed).rules.upgrades.speed.price).toBe(300);
  });

  it("refuses a path that does not exist, but lets a deck gain a card", () => {
    expect(() => applyOverrides(raw, ["rules.upgrade.speed.price=300"])).toThrow(/not an object/);
    expect(() => applyOverrides(raw, ["rules.speedPrice=300"])).toThrow(/does not exist/);
    expect(applyOverrides(raw, ["cards.decks.risk.fish+2=1"]).cards.decks.risk["fish+2"]).toBe(1);
  });

  it("names awards by id", () => {
    const sets = normaliseAwardPaths(raw, ["awards.daredevil.amount=250", "awards.budget=800"]);
    const changed = applyOverrides(raw, sets);
    expect(changed.awards.awards.find((a) => a.id === "daredevil")!.amount).toBe(250);
    expect(changed.awards.budget).toBe(800);
    expect(() => normaliseAwardPaths(raw, ["awards.nobody.amount=1"])).toThrow(/no award/);
  });
});
