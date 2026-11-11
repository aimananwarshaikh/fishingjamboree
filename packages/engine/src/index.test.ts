import { describe, expect, it } from "vitest";
import * as engine from "./index";
import type { Engine } from "./types";

describe("engine", () => {
  it("loads", () => {
    expect(engine.ENGINE_VERSION).toBe("0.0.0");
  });
});

// Stage 1c stubs. Delete each entry as the real implementation lands.
describe("engine stubs", () => {
  const names = [
    "compileContent",
    "createGame",
    "getActors",
    "getLegalActions",
    "applyAction",
    "redactForClient",
    "replay",
  ] as const satisfies readonly (keyof Engine)[];

  it.each(names)("%s throws not implemented", (name) => {
    const fn = engine[name] as (...args: unknown[]) => unknown;
    expect(() => fn()).toThrow(`${name}: not implemented`);
  });
});
