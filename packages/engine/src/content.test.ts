import { describe, expect, it } from "vitest";
import { compileContent } from "./content";
import { hashJson } from "./hash";
import { compiledContent, rawContent } from "./testContent";
import type { RawContent, Tile } from "./types";

/** Compiles a mutated copy of the real content and returns its issues. */
function issuesAfter(mutate: (raw: RawContent) => void) {
  const raw = rawContent();
  mutate(raw);
  const result = compileContent(raw);
  if (result.ok) throw new Error("expected the content to be rejected");
  return result.issues;
}

function expectIssue(mutate: (raw: RawContent) => void, path: string, message?: RegExp) {
  const issues = issuesAfter(mutate);
  const match = issues.find((i) => i.path === path && (!message || message.test(i.message)));
  expect(match, `issues were ${JSON.stringify(issues)}`).toBeDefined();
}

const setRow = (rows: string[], y: number, x: number, ch: string) => {
  const row = rows[y]!;
  rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
};

describe("compileContent: the real content", () => {
  const content = compiledContent();
  const { board } = content;
  const id = (x: number, y: number) => y * board.width + x;
  const tile = (x: number, y: number) => board.tiles[id(x, y)];
  const count = (pred: (t: Tile) => boolean) =>
    board.tiles.filter((t): t is Tile => t !== null && pred(t)).length;

  it("compiles", () => {
    const result = compileContent(rawContent());
    expect(result.ok, JSON.stringify(!result.ok && result.issues)).toBe(true);
  });

  it("is the traced 8x20 board", () => {
    expect([board.width, board.height]).toEqual([8, 20]);
    expect(board.tiles).toHaveLength(160);
    expect(count((t) => t.terrain === "risk" && t.area === "davy-jones-locker")).toBe(25);
    expect(count((t) => t.terrain === "risk" && t.area === "shipwreck-bay")).toBe(8);
    expect(count((t) => t.terrain === "island")).toBe(9);
    expect(count((t) => t.terrain === "dock")).toBe(3);
    for (const zone of [1, 2, 3]) {
      expect(count((t) => t.terrain === "sea" && t.zone === zone)).toBeGreaterThan(0);
    }
  });

  it("places the docks: two starting docks on the bottom pier, the cruise dock top right", () => {
    expect(board.docks).toEqual([
      { id: "cruise", kind: "cruise", tile: id(7, 1) },
      { id: "start-left", kind: "starting", tile: id(3, 19) },
      { id: "start-right", kind: "starting", tile: id(4, 19) },
    ]);
    expect(tile(3, 19)).toMatchObject({ terrain: "dock", dock: "start-left" });
  });

  it("places fishing spots 1-3 as overlays on sea tiles", () => {
    expect(board.fishingSpots).toEqual([
      { spot: 1, tile: id(0, 4) },
      { spot: 2, tile: id(0, 12) },
      { spot: 3, tile: id(7, 14) },
    ]);
    expect(tile(0, 4)).toMatchObject({ terrain: "sea", zone: 3, fishingSpot: 1 });
    expect(tile(0, 12)).toMatchObject({ terrain: "sea", zone: 2, fishingSpot: 2 });
    expect(tile(7, 14)).toMatchObject({ terrain: "sea", zone: 2, fishingSpot: 3 });
    expect(tile(1, 4)).toMatchObject({ fishingSpot: null });
  });

  it("puts sea tiles in their zones and gives other tiles none", () => {
    expect(tile(4, 17)).toMatchObject({ terrain: "sea", zone: 1 });
    expect(tile(7, 7)).toMatchObject({ terrain: "sea", zone: 2 });
    expect(tile(2, 0)).toMatchObject({ terrain: "sea", zone: 3 });
    expect(tile(0, 9)).not.toHaveProperty("zone");
    expect(tile(0, 0)).toBeNull();
  });

  it("lists orthogonal neighbours (up, right, down, left), skipping off-board and island", () => {
    // Left starting dock: up is sea, right is the other dock, left is off-board.
    expect(board.neighbours[id(3, 19)]).toEqual([id(3, 18), id(4, 19)]);
    // Next to the island: (2,11) has island (3,11) to the right and (2,12) below.
    expect(board.neighbours[id(2, 11)]).toEqual([id(2, 10), id(1, 11)]);
    // A corner of the board.
    expect(board.neighbours[id(7, 0)]).toEqual([id(7, 1), id(6, 0)]);
    // Island and off-board tiles have no neighbours.
    expect(board.neighbours[id(4, 12)]).toEqual([]);
    expect(board.neighbours[id(0, 0)]).toEqual([]);
    // Neighbourship is symmetric.
    board.neighbours.forEach((ns, a) => {
      for (const b of ns) expect(board.neighbours[b]).toContain(a);
    });
  });

  it("connects every passable tile (no unreachable water)", () => {
    const start = id(3, 19);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const n of board.neighbours[queue.shift()!]!) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(count((t) => t.terrain !== "island"));
  });

  it("converts the confirmed card counts and rules", () => {
    const { decks, cards } = content.cards;
    expect(decks.safe).toEqual({ boot: 4, "fish+1": 4, "fish+2": 4, "fish+3": 4, "fine-100": 2 });
    expect(decks.risk).toEqual({
      boot: 2,
      "fish+3": 2,
      "fine-200": 2,
      "fish-300": 3,
      "fish-500": 2,
      "fish-700": 1,
      shark: 3,
      "sinking-boat": 1,
    });
    expect(Object.keys(decks.event)).toHaveLength(11);
    expect(Object.values(decks.event).every((n) => n === 1)).toBe(true);
    expect(cards["boot"]!.effect).toEqual({ kind: "fish", count: 0, value: 100 });
    expect(cards["shark"]!.effect).toEqual({ kind: "shark", count: 3 });
    expect(cards["movement-1"]!.effect).toEqual({ kind: "movement", delta: -1 });
    expect(content.rules.upgrades.speed).toEqual({ price: 200, rollBonus: 2 });
    expect(content.rules.upgrades.capacity).toEqual({ price: 200, capacity: 8 });
  });

  it("hashes the raw content, independent of key order", () => {
    const raw = rawContent();
    expect(content.hash).toBe(hashJson(raw));
    expect(content.hash).toMatch(/^[0-9a-f]{32}$/);
    const reordered = {
      awards: raw.awards,
      rules: raw.rules,
      cards: raw.cards,
      board: raw.board,
    } as RawContent;
    expect(compiledContent(reordered).hash).toBe(content.hash);
    raw.rules.upgrades.speed.price = 300;
    expect(compiledContent(raw).hash).not.toBe(content.hash);
  });

  it("shares no objects with the raw input", () => {
    const raw = rawContent();
    const compiled = compiledContent(raw);
    raw.rules.rounds = 99;
    raw.cards.decks.safe["boot"] = 99;
    expect(compiled.rules.rounds).toBe(20);
    expect(compiled.cards.decks.safe["boot"]).toBe(4);
  });
});

describe("compileContent: rejects bad content", () => {
  it("not an object", () => {
    const result = compileContent(null as unknown as RawContent);
    expect(result.ok).toBe(false);
  });

  describe("board", () => {
    it("wrong number of rows", () =>
      expectIssue((r) => r.board.terrain.pop(), "board.terrain", /20 strings/));
    it("row of the wrong width", () =>
      expectIssue((r) => (r.board.zones[3] += "-"), "board.zones[3]", /8 characters/));
    it("unknown terrain character", () =>
      expectIssue((r) => setRow(r.board.terrain, 7, 0, "X"), "board.terrain[7]", /"X"/));
    it("unknown zone character", () =>
      expectIssue((r) => setRow(r.board.zones, 7, 0, "4"), "board.zones[7]", /"4"/));
    it("sea tile without a zone", () =>
      expectIssue((r) => setRow(r.board.zones, 7, 0, "-"), "board.zones[7]", /no zone/));
    it("non-sea tile with a zone", () =>
      expectIssue((r) => setRow(r.board.zones, 11, 3, "2"), "board.zones[11]", /zone "-"/));
    it("off-board tile with a zone", () =>
      expectIssue((r) => setRow(r.board.zones, 0, 0, "3"), "board.zones[0]", /zone "-"/));
    it("dock tile with no docks entry", () =>
      expectIssue((r) => r.board.docks.shift(), "board.terrain[1]", /no docks entry/));
    it("docks entry not on a D tile", () =>
      expectIssue((r) => (r.board.docks[0]!.y = 0), "board.docks[0]", /not a "D"/));
    it("docks entry off the board", () =>
      expectIssue((r) => (r.board.docks[0]!.x = 8), "board.docks[0]", /on the board/));
    it("two entries for one dock tile", () =>
      expectIssue(
        (r) => r.board.docks.push({ id: "extra", kind: "cruise", x: 7, y: 1 }),
        "board.docks[3]",
        /second dock/,
      ));
    it("duplicate dock id", () =>
      expectIssue((r) => (r.board.docks[2]!.id = "start-left"), "board.docks[2].id", /duplicate/));
    it("bad dock kind", () =>
      expectIssue(
        (r) => ((r.board.docks[0] as { kind: string }).kind = "pier"),
        "board.docks[0].kind",
      ));
    it("fewer than two starting docks", () =>
      expectIssue((r) => (r.board.docks[1]!.kind = "cruise"), "board.docks", /two starting/));
    it("fishing spot on the island", () =>
      expectIssue(
        (r) => r.board.fishingSpots.push({ spot: 4, x: 4, y: 12 }),
        "board.fishingSpots[3]",
        /sea or risk/,
      ));
    it("duplicate fishing spot number", () =>
      expectIssue(
        (r) => (r.board.fishingSpots[1]!.spot = 1),
        "board.fishingSpots[1].spot",
        /duplicate/,
      ));
    it("two fishing spots on one tile", () =>
      expectIssue(
        (r) => r.board.fishingSpots.push({ spot: 4, x: 0, y: 4 }),
        "board.fishingSpots[3]",
        /second spot/,
      ));
    it("zone names that are not strings", () =>
      expectIssue(
        (r) => ((r.board.zoneNames as Record<string, unknown>)["1"] = 5),
        "board.zoneNames",
      ));
  });

  describe("cards", () => {
    it("card id that differs from its key", () =>
      expectIssue((r) => (r.cards.cards["boot"]!.id = "Boot"), "cards.cards.boot.id"));
    it("card without a name", () =>
      expectIssue((r) => (r.cards.cards["boot"]!.name = ""), "cards.cards.boot.name"));
    it("unknown effect kind", () =>
      expectIssue(
        (r) => ((r.cards.cards["boot"]!.effect as { kind: string }).kind = "kraken"),
        "cards.cards.boot.effect.kind",
      ));
    it("non-integer money", () =>
      expectIssue(
        (r) => (r.cards.cards["fish-300"]!.effect = { kind: "fish", count: 1, value: 299.5 }),
        "cards.cards.fish-300.effect.value",
      ));
    it("Golden Fish for a spot that is not on the board", () =>
      expectIssue(
        (r) =>
          (r.cards.cards["golden-fish-3"]!.effect = { kind: "goldenFish", spot: 9, value: 1000 }),
        "cards.cards.golden-fish-3.effect.spot",
        /no fishing spot 9/,
      ));
    it("catch bonus for a zone that is not on the board", () =>
      expectIssue(
        (r) =>
          (r.cards.cards["catch-bonus-1"]!.effect = {
            kind: "catchBonus",
            zone: 7,
            count: 1,
            value: 100,
          }),
        "cards.cards.catch-bonus-1.effect.zone",
        /no zone 7/,
      ));
    it("bad Shark Repellent area", () =>
      expectIssue(
        (r) => ((r.cards.cards["shark-repellent"]!.effect as { area: string }).area = "lagoon"),
        "cards.cards.shark-repellent.effect.area",
      ));
    it("unknown card in a deck", () =>
      expectIssue((r) => (r.cards.decks.safe["kraken"] = 1), "cards.decks.safe.kraken", /unknown/));
    it("zero copies", () =>
      expectIssue((r) => (r.cards.decks.safe["boot"] = 0), "cards.decks.safe.boot", /at least 1/));
    it("event card in the risk deck", () =>
      expectIssue(
        (r) => (r.cards.decks.risk["tsunami"] = 1),
        "cards.decks.risk.tsunami",
        /risk deck/,
      ));
    it("draw card in the event deck", () =>
      expectIssue(
        (r) => (r.cards.decks.event["shark"] = 1),
        "cards.decks.event.shark",
        /event deck/,
      ));
    it("missing deck", () =>
      expectIssue(
        (r) => delete (r.cards.decks as Partial<RawContent["cards"]["decks"]>).event,
        "cards.decks.event",
      ));
    it("unknown deck", () =>
      expectIssue(
        (r) => ((r.cards.decks as Record<string, unknown>)["bonus"] = { boot: 1 }),
        "cards.decks.bonus",
      ));
    it("empty deck", () => expectIssue((r) => (r.cards.decks.event = {}), "cards.decks.event"));
  });

  describe("rules", () => {
    it("maxPlayers below minPlayers", () =>
      expectIssue((r) => (r.rules.maxPlayers = 1), "rules.maxPlayers"));
    it("event rounds out of order", () =>
      expectIssue((r) => (r.rules.eventAfterRounds = [10, 5]), "rules.eventAfterRounds[1]"));
    it("event round after the last round", () =>
      expectIssue((r) => (r.rules.eventAfterRounds = [5, 21]), "rules.eventAfterRounds[1]"));
    it("a one-sided die (the roll-off could never break a tie)", () =>
      expectIssue((r) => (r.rules.dieSides = 1), "rules.dieSides"));
    it("negative starting cash", () =>
      expectIssue((r) => (r.rules.startingCash = -100), "rules.startingCash"));
    it("non-integer upgrade price", () =>
      expectIssue((r) => (r.rules.upgrades.speed.price = 199.99), "rules.upgrades.speed.price"));
    it("missing capacity upgrade", () =>
      expectIssue(
        (r) => delete (r.rules.upgrades as Partial<RawContent["rules"]["upgrades"]>).capacity,
        "rules.upgrades.capacity",
      ));
  });

  it("reports every problem at once", () => {
    const issues = issuesAfter((r) => {
      r.rules.dieSides = 0;
      r.cards.decks.safe["boot"] = 0;
      setRow(r.board.zones, 7, 0, "-");
    });
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["rules.dieSides", "cards.decks.safe.boot", "board.zones[7]"]),
    );
  });
});
