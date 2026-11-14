/**
 * Review P3, server: player names are cleaned, `away` is cleared when a game
 * finishes, and seats sort by number. (Transport and main.ts items are in
 * transport.test.ts and config.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { cleanName, nameKey, seatNumber } from "./core";
import { harness, V } from "./testHarness";

describe("player names", () => {
  it("drops control, zero-width and direction characters and tidies spaces", () => {
    expect(cleanName("A\u0000n\u0007n", 20)).toBe("Ann");
    expect(cleanName("A​n‍n﻿", 20)).toBe("Ann");
    // Right-to-left override and isolates could flip the rest of a log line.
    expect(cleanName("‮Ann‬ ⁦Bob⁩", 20)).toBe("Ann Bob");
    expect(cleanName("  Ann 　 of\tCleves\n", 20)).toBe("Ann of Cleves");
  });

  it("normalises to NFC, so the same name typed two ways is one name", () => {
    expect(cleanName("José", 20)).toBe("José");
    expect(nameKey("José")).toBe(nameKey("JOSÉ"));
  });

  it("counts characters, not UTF-16 units; refuses empty and over-long names", () => {
    expect(cleanName("🐟".repeat(20), 20)).toBe("🐟".repeat(20));
    expect(cleanName("🐟".repeat(21), 20)).toBeNull();
    expect(cleanName("​‮ ", 20)).toBeNull();
    expect(cleanName("", 20)).toBeNull();
  });

  it("names that only differ by width or case are the same in a room", () => {
    expect(nameKey("Ａｎｎ")).toBe(nameKey("ann"));
    const h = harness();
    const { code } = h.lobby(1);
    h.send("c2", { type: "join", v: V, code, name: "player 1" });
    expect(h.last("c2", "error").code).toBe("name-taken");
    h.send("c3", { type: "join", v: V, code, name: "Ｐｌａｙｅｒ​ 1" });
    expect(h.last("c3", "error").code).toBe("name-taken");
  });

  it("the cleaned name is what everyone sees", () => {
    const h = harness();
    h.send("c1", { type: "create", v: V, name: "‮Ann​" });
    expect(h.last("c1", "welcome").room.seats[0]!.name).toBe("Ann");
  });
});

describe("seat order", () => {
  it("sorts by seat number, not as text (p10 after p9)", () => {
    const ids = ["p10", "p2", "p1", "p9"];
    expect([...ids].sort((a, b) => seatNumber(a) - seatNumber(b))).toEqual([
      "p1",
      "p2",
      "p9",
      "p10",
    ]);
  });
});

describe("away after the game", () => {
  it("is cleared for everyone when the game finishes", () => {
    const h = harness();
    const { code } = h.started(3);
    h.send("c3", { type: "leave" }); // away at once
    expect(h.room(code).seats[2]!.away).toBe(true);
    h.send("c1", { type: "kick", seat: "p2" });
    expect(h.room(code).status).toBe("playing");
    // p3 is away: their turns are missed until they are removed, and p1 is left.
    for (let guard = 0; h.room(code).status === "playing"; guard += 1) {
      if (guard > 100) throw new Error("the game did not end");
      h.advance(60_000);
    }
    expect(h.room(code).status).toBe("finished");
    expect(h.room(code).seats.map((s) => s.away)).toEqual([false, false, false]);
  });
});
