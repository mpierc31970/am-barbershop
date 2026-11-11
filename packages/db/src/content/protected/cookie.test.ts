// Gate cookie fixed vectors (CONT-28; 07-32 choice 4; T-07-32-02).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GATE_COOKIE_TTL_S,
  gateCookieName,
  gateCookieValid,
  mintGateCookie,
} from "./cookie";

const ORG = "orgaaaaaaaaaaa1";
const PAGE = "pageaaaaaaaaaa1";
const NOW = new Date("2026-10-05T12:00:00Z");
const VALUE = "1791244800.uAf0s0SYp7VXBYUYWotT8n6YNlog4QTr4gGJz_nnDZo";

const saved = process.env.CDS_MEDIA_TOKEN_SECRET;
beforeAll(() => {
  process.env.CDS_MEDIA_TOKEN_SECRET = "k".repeat(32);
});
afterAll(() => {
  if (saved === undefined) delete process.env.CDS_MEDIA_TOKEN_SECRET;
  else process.env.CDS_MEDIA_TOKEN_SECRET = saved;
});

const valid = (over: Partial<Parameters<typeof gateCookieValid>[0]> = {}) =>
  gateCookieValid({
    orgId: ORG,
    pageId: PAGE,
    version: 3,
    value: VALUE,
    now: NOW,
    ...over,
  });

describe("gate cookie", () => {
  it("names the cookie after the page and refuses a bad id", () => {
    expect(gateCookieName("abc123def456ghi")).toBe("cds_pp_abc123def456ghi");
    expect(() => gateCookieName("../x")).toThrow();
  });

  it("mints the pinned value, 12 h ahead", () => {
    const c = mintGateCookie({
      orgId: ORG,
      pageId: PAGE,
      version: 3,
      now: NOW,
    });
    expect(c).toEqual({ name: `cds_pp_${PAGE}`, value: VALUE, maxAge: 43200 });
    expect(GATE_COOKIE_TTL_S).toBe(43200);
    expect(Number(VALUE.split(".")[0])).toBe(NOW.getTime() / 1000 + 43200);
  });

  it("is valid for exactly that org, page and version before exp", () => {
    expect(valid()).toBe(true);
    expect(valid({ now: new Date(NOW.getTime() + 43199_000) })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(valid({ now: new Date(NOW.getTime() + 43200_000) })).toBe(false);
    // exp more than 12 h ahead of now
    expect(valid({ now: new Date(NOW.getTime() - 1000) })).toBe(false);
    expect(valid({ version: 4 })).toBe(false);
    expect(valid({ pageId: "pageaaaaaaaaaa2" })).toBe(false);
    expect(valid({ orgId: "orgaaaaaaaaaaa2" })).toBe(false);
    const sig = VALUE.split(".")[1]!;
    const flipped = `${VALUE.split(".")[0]}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    expect(valid({ value: flipped })).toBe(false);
    expect(valid({ value: VALUE.replace(".", "") })).toBe(false);
    expect(valid({ value: `abc.${sig}` })).toBe(false);
    expect(valid({ value: "" })).toBe(false);
    expect(valid({ value: undefined })).toBe(false);
  });

  it("a rotated secret signs everyone out", () => {
    process.env.CDS_MEDIA_TOKEN_SECRET = "z".repeat(32);
    try {
      expect(valid()).toBe(false);
    } finally {
      process.env.CDS_MEDIA_TOKEN_SECRET = "k".repeat(32);
    }
  });
});
