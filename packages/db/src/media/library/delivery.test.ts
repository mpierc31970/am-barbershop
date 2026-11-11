// getMediaDelivery (07-12; CONTEXT Area 1 Q2).
import { afterEach, describe, expect, it } from "vitest";
import { appDelivery } from "../store/app-delivery";
import { getMediaDelivery, resetMediaDeliveryForTests } from "./delivery";

const ASSET = { id: "asset1", orgId: "orga", kind: "image" as const };
const BUNNY = {
  CDS_MEDIA_CDN: "bunny",
  BUNNY_PULL_ZONE_HOST: "media.example.b-cdn.net",
  BUNNY_TOKEN_KEY: "tok",
  BUNNY_API_KEY: "api",
};

afterEach(() => {
  resetMediaDeliveryForTests();
  delete process.env.CDS_MEDIA_CDN;
});

describe("getMediaDelivery", () => {
  it("unset or app is the app stand-in", () => {
    expect(getMediaDelivery({}).name).toBe("app");
    expect(getMediaDelivery({ CDS_MEDIA_CDN: "app" })).toBe(appDelivery);
    expect(getMediaDelivery({ CDS_MEDIA_CDN: "" }).name).toBe("app");
  });

  it("bunny with its three variables; protected URLs are the app's", () => {
    const d = getMediaDelivery(BUNNY);
    expect(d.name).toBe("bunny");
    expect(d.urlFor(ASSET, "w960")).toMatch(
      /^https:\/\/media\.example\.b-cdn\.net\//,
    );
    const p = { protected: { pageId: "page1" } };
    expect(d.urlFor(ASSET, "w960", p)).toBe(
      appDelivery.urlFor(ASSET, "w960", p),
    );
  });

  it("bunny without its variables throws names only at first urlFor", () => {
    const d = getMediaDelivery({ CDS_MEDIA_CDN: "bunny" });
    expect(() => d.urlFor(ASSET, "w960")).toThrow(
      /BUNNY_PULL_ZONE_HOST, BUNNY_TOKEN_KEY, BUNNY_API_KEY/,
    );
  });

  it.each(["cloudflare", " app", "APP", "bunny "])("throws on %j", (value) => {
    expect(() => getMediaDelivery({ CDS_MEDIA_CDN: value })).toThrow(
      "CDS_MEDIA_CDN must be app or bunny",
    );
  });

  it("caches the process-env instance per value", () => {
    process.env.CDS_MEDIA_CDN = "bunny";
    const a = getMediaDelivery();
    expect(getMediaDelivery()).toBe(a);
    resetMediaDeliveryForTests();
    expect(getMediaDelivery()).not.toBe(a);
  });
});
