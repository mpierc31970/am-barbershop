// redirectResponse / redirectLocation (14-18 choice 2; P14-P6, T-14-18-02).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TENANT_PATH_HEADER,
  REDIRECT_CACHE_CONTROL,
  TENANT_PATH_HEADER,
  redirectLocation,
  redirectResponse,
} from "./redirect-host";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redirectLocation", () => {
  it("is https and keeps path + query", () => {
    expect(redirectLocation("www.acme.com", "/a/b", "?x=1&y=2")).toBe(
      "https://www.acme.com/a/b?x=1&y=2",
    );
    expect(redirectLocation("acme.com", "/", "")).toBe("https://acme.com/");
    expect(redirectLocation("acme.com", "/", "?")).toBe("https://acme.com/");
  });

  it("keeps http and the port for an http request outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      redirectLocation("demo.localhost", "/about", "?q=1", {
        protocol: "http:",
        port: "3000",
      }),
    ).toBe("http://demo.localhost:3000/about?q=1");
  });

  it("is always https without a port in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      redirectLocation("acme.com", "/x", "", { protocol: "http:", port: "80" }),
    ).toBe("https://acme.com/x");
  });

  it("refuses an invalid target (never a URL, path or userinfo)", () => {
    for (const bad of [
      "",
      "evil.com/x",
      "user@evil.com",
      "https://evil.com",
      "a b.com",
      `${"a".repeat(254)}`,
    ]) {
      expect(redirectLocation(bad, "/", ""), bad).toBeNull();
    }
  });

  it("a protocol-relative-looking path stays on the target host", () => {
    const loc = redirectLocation("acme.com", "//evil.com/x", "");
    expect(new URL(loc!).host).toBe("acme.com");
  });
});

describe("redirectResponse", () => {
  it("answers 301 with Location and a 5-minute public cache", () => {
    const res = redirectResponse("acme.com", "/sitemap.xml", "?a=1")!;
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://acme.com/sitemap.xml?a=1",
    );
    expect(res.headers.get("cache-control")).toBe(REDIRECT_CACHE_CONTROL);
    expect(REDIRECT_CACHE_CONTROL).toBe("public, max-age=300");
  });

  it("takes an explicit Cache-Control", () => {
    const res = redirectResponse("acme.com", "/", "", {}, "no-store")!;
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is null for an invalid target", () => {
    expect(redirectResponse("evil.com/x", "/", "")).toBeNull();
  });

  it("names the tenant path header", () => {
    expect(TENANT_PATH_HEADER).toBe("x-cds-tenant-path");
    expect(MAX_TENANT_PATH_HEADER).toBe(512);
  });
});
