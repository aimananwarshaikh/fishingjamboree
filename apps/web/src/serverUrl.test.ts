/**
 * Review P3: `?server=` could send the seat token to any server. It is now
 * honoured only in a dev build, or for a server on the build's allow-list.
 */
import { describe, expect, it } from "vitest";
import { parseAllowList, resolveServerUrl } from "./serverUrl";
import type { PageLocation } from "./serverUrl";

const page = (search = "", protocol = "http:", hostname = "game.example"): PageLocation => ({
  search,
  protocol,
  hostname,
});

describe("resolveServerUrl", () => {
  it("defaults to the page's host on port 8787, wss on an https page", () => {
    expect(resolveServerUrl(page(), { dev: false, allowed: [] })).toEqual({
      url: "ws://game.example:8787",
      ignored: null,
    });
    expect(resolveServerUrl(page("", "https:"), { dev: false, allowed: [] }).url).toBe(
      "wss://game.example:8787",
    );
    expect(resolveServerUrl(page("", "http:", ""), { dev: false, allowed: [] }).url).toBe(
      "ws://localhost:8787",
    );
  });

  it("a dev build takes any ws or wss server", () => {
    const r = resolveServerUrl(page("?server=ws://10.0.0.5:9000"), { dev: true, allowed: [] });
    expect(r).toEqual({ url: "ws://10.0.0.5:9000", ignored: null });
  });

  it("a production build ignores a server that is not on the allow-list", () => {
    const r = resolveServerUrl(page("?server=wss://evil.example"), {
      dev: false,
      allowed: ["wss://play.example"],
    });
    expect(r.url).toBe("ws://game.example:8787");
    expect(r.ignored).toMatch(/not allowed/);
  });

  it("a production build takes a server on the allow-list (by origin)", () => {
    const opts = { dev: false, allowed: ["wss://play.example", "wss://beta.example:8443"] };
    expect(resolveServerUrl(page("?server=wss://play.example/", "https:"), opts).url).toBe(
      "wss://play.example/",
    );
    expect(resolveServerUrl(page("?server=wss://beta.example:8443", "https:"), opts).url).toBe(
      "wss://beta.example:8443",
    );
    // Same host, another port: not the same server.
    expect(
      resolveServerUrl(page("?server=wss://play.example:9999", "https:"), opts).ignored,
    ).toMatch(/not allowed/);
  });

  it("never anything but ws: or wss:, even in dev", () => {
    for (const bad of ["http://x.example", "javascript:alert(1)", "not a url", "//x.example"]) {
      const r = resolveServerUrl(page(`?server=${encodeURIComponent(bad)}`), {
        dev: true,
        allowed: [],
      });
      expect(r.url).toBe("ws://game.example:8787");
      expect(r.ignored).not.toBeNull();
    }
  });

  it("an https page only talks to wss", () => {
    const r = resolveServerUrl(page("?server=ws://play.example", "https:"), {
      dev: false,
      allowed: ["ws://play.example"],
    });
    expect(r.url).toBe("wss://game.example:8787");
    expect(r.ignored).toMatch(/wss/);
  });

  it("an empty ?server= is the default, with nothing to report", () => {
    expect(resolveServerUrl(page("?server="), { dev: false, allowed: [] })).toEqual({
      url: "ws://game.example:8787",
      ignored: null,
    });
  });
});

describe("parseAllowList", () => {
  it("reads a comma-separated list of ws/wss origins and drops the rest", () => {
    expect(
      parseAllowList(" wss://a.example , ws://b.example:9000/x,http://c.example,,junk"),
    ).toEqual(["wss://a.example", "ws://b.example:9000"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });
});
