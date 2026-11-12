import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./parse";

describe("parseClientMessage", () => {
  it.each([
    [{ type: "create", v: 1, name: "Ann" }],
    [{ type: "join", v: 1, code: "bcdf", name: "Ann" }],
    [{ type: "rejoin", v: 1, code: "BCDF", seatToken: "abc" }],
    [{ type: "start" }],
    [{ type: "sync" }],
    [{ type: "leave" }],
    [{ type: "intent", clientActionId: "1", seq: 0, action: { type: "roll" } }],
    [{ type: "intent", clientActionId: "1", seq: 3, action: { type: "move", to: 12 } }],
    [
      {
        type: "intent",
        clientActionId: "1",
        seq: 3,
        action: { type: "placeShip", dock: "cruise" },
      },
    ],
    [
      {
        type: "intent",
        clientActionId: "1",
        seq: 3,
        action: { type: "buyUpgrade", upgrade: "speed" },
      },
    ],
    [{ type: "intent", clientActionId: "1", seq: 3, action: { type: "useHelicopter" } }],
    [{ type: "intent", clientActionId: "1", seq: 3, action: { type: "endTurn" } }],
  ])("accepts %j unchanged", (message) => {
    expect(parseClientMessage(message)).toEqual({ ok: true, message });
  });

  it.each([
    ["not an object", "hello"],
    ["null", null],
    ["an array", [{ type: "start" }]],
    ["no type", { v: 1, name: "Ann" }],
    ["an unknown type", { type: "cheat" }],
    ["create without a version", { type: "create", name: "Ann" }],
    ["create with a non-string name", { type: "create", v: 1, name: 7 }],
    ["join without a code", { type: "join", v: 1, name: "Ann" }],
    ["join with a very long code", { type: "join", v: 1, code: "B".repeat(65), name: "Ann" }],
    ["rejoin without a token", { type: "rejoin", v: 1, code: "BCDF" }],
    ["intent without an id", { type: "intent", seq: 0, action: { type: "roll" } }],
    ["intent without a seq", { type: "intent", clientActionId: "1", action: { type: "roll" } }],
    [
      "intent with a negative seq",
      { type: "intent", clientActionId: "1", seq: -1, action: { type: "roll" } },
    ],
    [
      "intent with a fractional seq",
      { type: "intent", clientActionId: "1", seq: 1.5, action: { type: "roll" } },
    ],
    ["intent without an action", { type: "intent", clientActionId: "1", seq: 0 }],
    [
      "an unknown action type",
      { type: "intent", clientActionId: "1", seq: 0, action: { type: "win" } },
    ],
    [
      "move without a tile",
      { type: "intent", clientActionId: "1", seq: 0, action: { type: "move" } },
    ],
    [
      "move to a string",
      { type: "intent", clientActionId: "1", seq: 0, action: { type: "move", to: "12" } },
    ],
    [
      "placeShip without a dock",
      { type: "intent", clientActionId: "1", seq: 0, action: { type: "placeShip" } },
    ],
    [
      "an unknown upgrade",
      {
        type: "intent",
        clientActionId: "1",
        seq: 0,
        action: { type: "buyUpgrade", upgrade: "cannon" },
      },
    ],
  ])("refuses %s", (_what, message) => {
    const result = parseClientMessage(message);
    expect(result.ok).toBe(false);
  });

  it("drops fields the protocol does not define, such as a forged player", () => {
    const result = parseClientMessage({
      type: "intent",
      clientActionId: "1",
      seq: 2,
      admin: true,
      action: { type: "move", to: 5, player: "p1", extra: 1 },
    });
    expect(result).toEqual({
      ok: true,
      message: { type: "intent", clientActionId: "1", seq: 2, action: { type: "move", to: 5 } },
    });
  });
});
