import { describe, expect, it } from "vitest";
import { chargeFine, gainFish, loseFish, sellFish } from "./economy";
import { compiledContent, rawContent } from "./testContent";
import { content, ctxFor, started, withPlayer } from "./testHelpers";
import type { PlayerState } from "./types";

const setup = (patch: Partial<PlayerState>, c = content) => {
  const ctx = ctxFor(withPlayer(started(2), 0, patch), c);
  return { ctx, player: ctx.state.players[0]!, id: ctx.state.players[0]!.id };
};

describe("gainFish and capacity", () => {
  it("loads everything when there is room", () => {
    const { ctx, player, id } = setup({ fish: [300] });
    gainFish(ctx, player, [100, 100]);
    expect(player.fish).toEqual([300, 100, 100]);
    expect(ctx.events).toEqual([
      { type: "fishGained", player: id, kept: [100, 100], lost: [], bonus: 0 },
    ]);
  });

  it("loses what does not fit (rulebook example: 4 fish, +2 Fish, keep one)", () => {
    const { ctx, player, id } = setup({ fish: [100, 100, 100, 100] });
    gainFish(ctx, player, [100, 100]);
    expect(player.fish).toHaveLength(5);
    expect(ctx.events).toEqual([
      { type: "fishGained", player: id, kept: [100], lost: [100], bonus: 0 },
    ]);
  });

  it("a big fish on a full ship is lost; nothing is swapped out", () => {
    const { ctx, player, id } = setup({ fish: [100, 100, 100, 100, 100] });
    gainFish(ctx, player, [700]);
    expect(player.fish).toEqual([100, 100, 100, 100, 100]);
    expect(ctx.events).toEqual([
      { type: "fishGained", player: id, kept: [], lost: [700], bonus: 0 },
    ]);
  });

  it("the Capacity upgrade holds 8", () => {
    const { ctx, player } = setup({
      fish: [100, 100, 100, 100, 100, 100],
      upgrades: { speed: false, capacity: true },
    });
    gainFish(ctx, player, [100, 100, 100]);
    expect(player.fish).toHaveLength(8);
    expect(ctx.events[0]).toMatchObject({ kept: [100, 100], lost: [100] });
  });

  it("the card's fish load before bonus fish, so the bonus is lost first", () => {
    const { ctx, player, id } = setup({ fish: [100, 100, 100, 100] });
    gainFish(ctx, player, [500], [100]);
    expect(player.fish).toEqual([100, 100, 100, 100, 500]);
    expect(ctx.events).toEqual([
      { type: "fishGained", player: id, kept: [500], lost: [100], bonus: 1 },
    ]);
  });

  it("reports nothing when there is nothing to load (a plain Boot)", () => {
    const { ctx, player } = setup({ fish: [100] });
    gainFish(ctx, player, []);
    expect(ctx.events).toEqual([]);
    expect(player.fish).toEqual([100]);
  });
});

describe("loseFish", () => {
  it("takes the cheapest first and keeps the rest in order", () => {
    const { ctx, player, id } = setup({ fish: [500, 100, 300, 100, 700] });
    loseFish(ctx, player, 3, "shark");
    expect(player.fish).toEqual([500, 700]);
    expect(ctx.events).toEqual([
      { type: "fishLost", player: id, fish: [100, 100, 300], reason: "shark" },
    ]);
  });

  it("takes everything when there are fewer than asked", () => {
    const { ctx, player } = setup({ fish: [700, 300] });
    loseFish(ctx, player, 3, "shark");
    expect(player.fish).toEqual([]);
    expect(ctx.events[0]).toMatchObject({ fish: [300, 700] });
  });

  it("reports nothing for an empty ship", () => {
    const { ctx, player } = setup({ fish: [] });
    loseFish(ctx, player, 3, "shark");
    expect(ctx.events).toEqual([]);
  });
});

describe("chargeFine", () => {
  const cases: [string, number, number, number, { cash: number; tokens: number; paid: number }][] =
    [
      ["enough cash", 300, 0, 200, { cash: 100, tokens: 0, paid: 200 }],
      ["exactly enough", 200, 0, 200, { cash: 0, tokens: 0, paid: 200 }],
      ["part cash", 100, 0, 200, { cash: 0, tokens: 1, paid: 100 }],
      ["no cash", 0, 0, 200, { cash: 0, tokens: 2, paid: 0 }],
      ["already holding tokens", 0, 3, 100, { cash: 0, tokens: 4, paid: 0 }],
    ];
  it.each(cases)("%s", (_name, cash, fineTokens, amount, want) => {
    const { ctx, player, id } = setup({ cash, fineTokens, fish: [300] });
    chargeFine(ctx, player, amount);
    expect(player.cash).toBe(want.cash);
    expect(player.fineTokens).toBe(want.tokens);
    expect(player.fish).toEqual([300]);
    expect(ctx.events).toEqual([
      { type: "fined", player: id, amount, paid: want.paid, tokensTaken: want.tokens - fineTokens },
    ]);
  });

  it("rounds an odd remainder up to a whole token", () => {
    const { ctx, player } = setup({ cash: 50 });
    chargeFine(ctx, player, 200);
    expect(player).toMatchObject({ cash: 0, fineTokens: 2 });
  });
});

describe("sellFish", () => {
  it("banks the value of every fish", () => {
    const { ctx, player, id } = setup({ cash: 100, fish: [100, 700] });
    sellFish(ctx, player, "dock");
    expect(player).toMatchObject({ cash: 900, fish: [] });
    expect(ctx.events).toEqual([
      { type: "fishSold", player: id, fish: [100, 700], total: 800, via: "dock" },
    ]);
  });

  it("pays fine tokens out of the sale first", () => {
    const { ctx, player, id } = setup({ fineTokens: 1, fish: [500, 700] });
    sellFish(ctx, player, "dock");
    expect(player).toMatchObject({ cash: 1100, fineTokens: 0 });
    expect(ctx.events[1]).toEqual({ type: "fineTokensPaid", player: id, tokens: 1, amount: 100 });
  });

  it("pays what the sale covers and keeps the other tokens", () => {
    const { ctx, player } = setup({ fineTokens: 5, fish: [100, 100] });
    sellFish(ctx, player, "dock");
    expect(player).toMatchObject({ cash: 0, fineTokens: 3 });
  });

  it("with no fish nothing happens", () => {
    const { ctx, player } = setup({ fineTokens: 2 });
    sellFish(ctx, player, "dock");
    expect(ctx.events).toEqual([]);
    expect(player).toMatchObject({ cash: 0, fineTokens: 2 });
  });

  it("uses the token value from the content", () => {
    const raw = rawContent();
    raw.rules.fineTokenValue = 200;
    const { ctx, player } = setup({ fineTokens: 2, fish: [300] }, compiledContent(raw));
    sellFish(ctx, player, "helicopter");
    expect(player).toMatchObject({ cash: 100, fineTokens: 1 });
    expect(ctx.events[0]).toMatchObject({ via: "helicopter" });
  });
});
