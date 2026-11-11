import { describe, expect, it } from "vitest";
import { SOCIAL_SOURCE_KEYS } from "../analytics/attribution";
import {
  PRESET_CODES,
  RESERVED_BIO_SLUGS,
  SOCIAL_PRESETS,
  SOCIAL_URL_MAX,
  bioLinkPath,
  customCodeFor,
  findPreset,
  isPresetCode,
  isPresetKey,
  validateSocialUrl,
} from "./presets";

describe("SOCIAL_PRESETS", () => {
  it("has ten presets in D198 order matching the attribution social keys (drift)", () => {
    expect(SOCIAL_PRESETS.map((p) => p.key)).toEqual([...SOCIAL_SOURCE_KEYS]);
  });

  it("uses the fixed D199 bio codes", () => {
    expect(PRESET_CODES).toEqual([
      "fb",
      "ig",
      "tt",
      "yt",
      "li",
      "pin",
      "x",
      "th",
      "yelp",
      "nd",
    ]);
    expect(new Set(PRESET_CODES).size).toBe(10);
  });

  it("gives every preset a label and at least one host", () => {
    for (const p of SOCIAL_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hosts.length).toBeGreaterThan(0);
    }
    expect(findPreset("youtube")?.hosts).toContain("youtu.be");
  });

  it("maps icons to the existing P7 brand keys where they exist", () => {
    expect(findPreset("instagram")?.icon).toBe("instagram");
    expect(findPreset("x")?.icon).toBe("x");
    expect(findPreset("yelp")?.icon).toBeNull();
  });

  it("reserves every preset code plus go", () => {
    expect(RESERVED_BIO_SLUGS).toEqual([...PRESET_CODES, "go"]);
    expect(isPresetCode("ig")).toBe(true);
    expect(isPresetCode("go")).toBe(false);
    expect(isPresetKey("instagram")).toBe(true);
    expect(isPresetKey("custom")).toBe(false);
    expect(isPresetKey("__proto__")).toBe(false);
  });
});

describe("validateSocialUrl", () => {
  it("accepts a preset URL on the platform's host or a subdomain", () => {
    expect(
      validateSocialUrl("instagram", "https://www.instagram.com/rivera"),
    ).toEqual({
      ok: true,
      url: "https://www.instagram.com/rivera",
    });
    expect(
      validateSocialUrl("instagram", "  https://instagram.com/rivera  ").ok,
    ).toBe(true);
    expect(
      validateSocialUrl("facebook", "https://m.facebook.com/rivera").ok,
    ).toBe(true);
    expect(validateSocialUrl("x", "https://twitter.com/rivera").ok).toBe(true);
  });

  it("refuses http and other schemes", () => {
    expect(validateSocialUrl("instagram", "http://instagram.com/x")).toEqual({
      ok: false,
      reason: "https",
    });
    expect(validateSocialUrl("custom", "javascript:alert(1)")).toEqual({
      ok: false,
      reason: "https",
    });
  });

  it("refuses a preset URL on a foreign host", () => {
    expect(
      validateSocialUrl("instagram", "https://evil.com/instagram.com"),
    ).toEqual({
      ok: false,
      reason: "host",
    });
    expect(
      validateSocialUrl("instagram", "https://notinstagram.com/x").ok,
    ).toBe(false);
    expect(
      validateSocialUrl("instagram", "https://instagram.com.evil.com/x").ok,
    ).toBe(false);
  });

  it("refuses unparseable, empty and too-long input", () => {
    expect(validateSocialUrl("instagram", "not a url")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(validateSocialUrl("instagram", "")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(validateSocialUrl("instagram", 42 as unknown as string)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const long = "https://instagram.com/" + "a".repeat(SOCIAL_URL_MAX);
    expect(validateSocialUrl("instagram", long)).toEqual({
      ok: false,
      reason: "length",
    });
  });

  it("refuses credentials in the URL", () => {
    expect(
      validateSocialUrl("instagram", "https://user:pw@instagram.com/x").ok,
    ).toBe(false);
  });

  it("accepts a custom https URL on any host but the tenant's own", () => {
    expect(validateSocialUrl("custom", "https://myshop.etsy.com").ok).toBe(
      true,
    );
    expect(
      validateSocialUrl("custom", "https://riverabakery.com/shop", {
        ownHost: "riverabakery.com",
      }),
    ).toEqual({ ok: false, reason: "host" });
    expect(
      validateSocialUrl("custom", "https://www.riverabakery.com/shop", {
        ownHost: "RiveraBakery.com",
      }).ok,
    ).toBe(false);
  });

  it("refuses an unknown platform", () => {
    expect(validateSocialUrl("myspace", "https://myspace.com/x")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("bioLinkPath", () => {
  it("uses the root code for presets", () => {
    expect(bioLinkPath({ platform: "instagram" })).toBe("/ig");
  });

  it("falls back to /go/<code> when a page owns the slug (Pitfall 19)", () => {
    expect(bioLinkPath({ platform: "instagram", fallback: true })).toBe(
      "/go/ig",
    );
  });

  it("puts custom accounts under /go", () => {
    expect(bioLinkPath({ platform: "custom", short_code: "etsy" })).toBe(
      "/go/etsy",
    );
  });
});

describe("customCodeFor", () => {
  it("slugifies and suffixes when taken", () => {
    expect(customCodeFor("My Etsy!", [])).toBe("my-etsy");
    expect(customCodeFor("My Etsy!", ["my-etsy"])).toBe("my-etsy-2");
    expect(customCodeFor("My Etsy!", ["my-etsy", "my-etsy-2"])).toBe(
      "my-etsy-3",
    );
  });

  it("never returns a preset code or go", () => {
    expect(customCodeFor("IG", [])).not.toBe("ig");
    expect(PRESET_CODES).not.toContain(customCodeFor("IG", []));
    expect(customCodeFor("Go", [])).not.toBe("go");
    expect(customCodeFor("X", [])).not.toBe("x");
  });

  it("caps at 20 chars and uses only [a-z0-9-]", () => {
    const code = customCodeFor("A Very Long Shop Name On Etsy Dot Com", []);
    expect(code.length).toBeLessThanOrEqual(20);
    expect(code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const taken = customCodeFor("A Very Long Shop Name On Etsy Dot Com", [
      code,
    ]);
    expect(taken.length).toBeLessThanOrEqual(20);
    expect(taken).not.toBe(code);
  });

  it("falls back to a non-empty code for symbol-only labels", () => {
    expect(customCodeFor("!!!", [])).toMatch(/^[a-z0-9-]+$/);
    expect(customCodeFor("Café Ñ", [])).toBe("cafe-n");
  });
});
