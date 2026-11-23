import { describe, expect, it } from "vitest";
import { actionAttr, isRobotPage, robotSnapshot } from "./robotHook";
import { initialState } from "./store";

describe("robot hook (B7)", () => {
  it("is on only for ?robot=1", () => {
    expect(isRobotPage("?robot=1")).toBe(true);
    expect(isRobotPage("?robot=1&server=x")).toBe(true);
    expect(isRobotPage("")).toBe(false);
    expect(isRobotPage("?robot=0")).toBe(false);
  });

  it("publishes only what the tab already has", () => {
    const snap = robotSnapshot(initialState);
    expect(snap).toEqual({
      connection: initialState.connection,
      seat: null,
      room: null,
      seq: null,
      view: null,
      pending: false,
      notice: null,
      log: [],
    });
  });

  it("writes an action as JSON for data-action", () => {
    expect(JSON.parse(actionAttr({ type: "roll", player: "p1" }))).toEqual({
      type: "roll",
      player: "p1",
    });
  });
});
