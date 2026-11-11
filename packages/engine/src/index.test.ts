import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine", () => {
  it("loads", () => {
    expect(ENGINE_VERSION).toBe("0.0.0");
  });
});
