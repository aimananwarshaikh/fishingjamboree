import { describe, expect, it } from "vitest";
import { parsePort } from "./config";

describe("parsePort", () => {
  it("defaults to 8787 when unset or blank", () => {
    expect(parsePort(undefined)).toEqual({ ok: true, port: 8787 });
    expect(parsePort("  ")).toEqual({ ok: true, port: 8787 });
  });

  it("takes a port from 0 to 65535", () => {
    expect(parsePort("9000")).toEqual({ ok: true, port: 9000 });
    expect(parsePort(" 0 ")).toEqual({ ok: true, port: 0 });
    expect(parsePort("65535")).toEqual({ ok: true, port: 65535 });
  });

  it("refuses anything else, saying why", () => {
    for (const bad of ["abc", "80.5", "-1", "1e3", "0x50", "8787abc"]) {
      expect(parsePort(bad)).toMatchObject({ ok: false, reason: expect.stringContaining(bad) });
    }
    expect(parsePort("65536")).toMatchObject({ ok: false, reason: /above 65535/ });
  });
});
