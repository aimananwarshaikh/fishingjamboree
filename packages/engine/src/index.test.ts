import { describe, expect, it } from "vitest";
import * as engine from "./index";

describe("engine", () => {
  it("loads", () => {
    expect(engine.ENGINE_VERSION).toBe("0.0.0");
  });
});
