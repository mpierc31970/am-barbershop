import { describe, expect, it } from "vitest";
import {
  classifyHost,
  isReservedHost,
  normalizeHost,
  parsePlatformHosts,
} from "./host";

describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("CDS.NeedToBeEdgy.com:443")).toBe(
      "cds.needtobeedgy.com",
    );
  });
  it("strips a trailing dot", () => {
    expect(normalizeHost("example.com.")).toBe("example.com");
  });
  it("returns null for empty or missing input", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
  it("keeps bracketed IPv6 and strips its port", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });
});

describe("parsePlatformHosts", () => {
  it("defaults to localhost and the dev platform domain", () => {
    const s = parsePlatformHosts();
    expect(s.has("localhost")).toBe(true);
    expect(s.has("cds.needtobeedgy.com")).toBe(true);
  });
  it("normalizes entries and drops empties", () => {
    const s = parsePlatformHosts(" A.com , ,b.com:80");
    expect([...s].sort()).toEqual(["a.com", "b.com"]);
  });
  it("uses the default for a blank value outside production", () => {
    expect(parsePlatformHosts("  ", false).has("localhost")).toBe(true);
  });
  it("throws in production when the value is missing or blank (WR-01)", () => {
    expect(() => parsePlatformHosts(undefined, true)).toThrow(/PLATFORM_HOSTS/);
    expect(() => parsePlatformHosts("", true)).toThrow(/PLATFORM_HOSTS/);
    expect(() => parsePlatformHosts(" , ", true)).toThrow(/PLATFORM_HOSTS/);
  });
  it("throws when a set value lists no hosts", () => {
    expect(() => parsePlatformHosts(" , ", false)).toThrow(/PLATFORM_HOSTS/);
  });
  it("uses the explicit value in production", () => {
    const s = parsePlatformHosts("cds.example.com", true);
    expect([...s]).toEqual(["cds.example.com"]);
  });
});

describe("classifyHost", () => {
  const platform = parsePlatformHosts();

  it("classifies platform hosts (port ignored)", () => {
    expect(classifyHost("localhost:3000", platform)).toEqual({
      kind: "platform",
    });
    expect(classifyHost("cds.needtobeedgy.com", platform)).toEqual({
      kind: "platform",
    });
  });

  it("classifies any other valid host as a tenant", () => {
    expect(classifyHost("acme-yoga.com", platform)).toEqual({
      kind: "tenant",
      host: "acme-yoga.com",
    });
  });

  it("never suffix-matches platform hosts (T-01-04)", () => {
    expect(classifyHost("evil.cds.needtobeedgy.com", platform)).toEqual({
      kind: "tenant",
      host: "evil.cds.needtobeedgy.com",
    });
  });

  it.each([
    null,
    undefined,
    "",
    "bad host",
    "a/b",
    "..com",
    "exa_mple.com",
    ".example.com",
    "a..b.com",
  ])("rejects %s as invalid", (raw) => {
    expect(classifyHost(raw, platform)).toEqual({ kind: "invalid" });
  });

  it("rejects hosts longer than 253 characters", () => {
    expect(classifyHost(`${"a".repeat(250)}.com`, platform)).toEqual({
      kind: "invalid",
    });
  });

  it.each([
    "-.com",
    "-",
    "a-.b",
    "-a.b",
    "example.com-",
    `${"a".repeat(64)}.com`,
    "82.180.132.176",
    "82.180.132.176:443",
    "[::1]",
    "[::1]:3000",
    "[2001:db8::1]",
    "::1",
  ])("rejects %s as a tenant host (WR-03)", (raw) => {
    expect(classifyHost(raw, platform)).toEqual({ kind: "invalid" });
  });

  it.each(["127.1", "1387037872", "0x7f.1", "foo.123", "a.0x1f", "0x7f"])(
    "rejects %s as a tenant host (IN-08)",
    (raw) => {
      expect(classifyHost(raw, platform)).toEqual({ kind: "invalid" });
    },
  );

  it.each(["cafe.example", "bad.cafe", "0xide.com", "123.example.com"])(
    "still accepts %s as a tenant host (IN-08)",
    (host) => {
      expect(classifyHost(host, platform)).toEqual({ kind: "tenant", host });
    },
  );

  it("accepts a 63-character label and hyphens inside labels", () => {
    const host = `${"a".repeat(63)}.my-site.co.uk`;
    expect(classifyHost(host, platform)).toEqual({ kind: "tenant", host });
  });

  it("accepts an IP literal only when it is listed as a platform host", () => {
    const withIps = parsePlatformHosts("[::1],127.0.0.1");
    expect(classifyHost("[::1]:3000", withIps)).toEqual({ kind: "platform" });
    expect(classifyHost("127.0.0.1:3000", withIps)).toEqual({
      kind: "platform",
    });
    expect(classifyHost("10.0.0.1", withIps)).toEqual({ kind: "invalid" });
  });
});

describe("isReservedHost (WR-04)", () => {
  const platform = new Set(["localhost", "cds.needtobeedgy.com"]);
  it.each([
    "cds.needtobeedgy.com",
    "evil.cds.needtobeedgy.com",
    "connectionsdesignstudios.com",
    "www.connectionsdesignstudios.com",
    "other-tenant.sites.connectionsdesignstudios.com",
    "A.SITES.ConnectionsDesignStudios.com.",
    "x.localhost",
  ])("reserves %s", (h) => {
    expect(isReservedHost(h, platform)).toBe(true);
  });
  it.each([
    "example.com",
    "needtobeedgy.com",
    "notconnectionsdesignstudios.com",
    "shop.example.org",
  ])("does not reserve %s", (h) => {
    expect(isReservedHost(h, platform)).toBe(false);
  });
});
