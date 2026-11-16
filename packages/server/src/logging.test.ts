/** B5: one log line per room created, started and finished, and nothing private in them. */
import { describe, expect, it } from "vitest";
import { harness, V } from "./testHarness";

describe("room log lines", () => {
  it("logs created, started and finished once each, without names or tokens", () => {
    const lines: string[] = [];
    const h = harness({}, ["KTBM"], { log: (l) => lines.push(l) });
    const { tokens } = h.lobby(3);
    expect(lines).toEqual(["room KTBM created (1 rooms)"]);
    h.send("c1", { type: "start" });
    expect(lines).toEqual(["room KTBM created (1 rooms)", "room KTBM started with 3 players"]);
    // The host removes the two others: the last player standing wins, and the game is finished.
    h.send("c1", { type: "kick", seat: "p2" });
    h.send("c1", { type: "kick", seat: "p3" });
    expect(lines.at(-1)).toBe("room KTBM finished");
    expect(lines.filter((l) => l.includes("finished"))).toHaveLength(1);
    const all = lines.join("\n");
    for (const secret of [...tokens, "Player 1", "Player 2"]) expect(all).not.toContain(secret);
  });

  it("does not log a failed create or a refused start", () => {
    const lines: string[] = [];
    const h = harness({}, [], { log: (l) => lines.push(l) });
    h.send("c1", { type: "create", v: V, name: "" });
    h.lobby(1);
    h.send("c1", { type: "start" });
    expect(lines.some((l) => l.includes("started"))).toBe(false);
  });
});
