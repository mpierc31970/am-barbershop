// MapEmbed adapter (07-24; CONT-24, D230; T-07-24-02): one URL builder (core mapFrameUrl).
import { mapDirectionsUrl, mapFrameUrl } from "@cds/core/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapEmbed } from "./map-embed";

const KEY = "AIzaSyA-valid_key_1234567890abcdef";

afterEach(() => vi.restoreAllMocks());

describe("createMapEmbed", () => {
  it("no key: the keyless stand-in frame", () => {
    const m = createMapEmbed({ env: {} });
    expect(m.keyed).toBe(false);
    expect(m.frameKey).toBeUndefined();
    expect(m.embedUrl({ query: "12 Main St" })).toBe(mapFrameUrl("12 Main St"));
    expect(m.embedUrl({ query: "12 Main St" })).toContain("output=embed");
  });

  it("a valid key: the Maps Embed API", () => {
    const m = createMapEmbed({ env: { GOOGLE_MAPS_EMBED_KEY: ` ${KEY} ` } });
    expect(m.keyed).toBe(true);
    expect(m.frameKey).toBe(KEY);
    const url = m.embedUrl({ query: "12 Main St" });
    expect(url).toBe(mapFrameUrl("12 Main St", KEY));
    expect(url).toContain("/maps/embed/v1/place");
  });

  it.each(["short", "has space in the middle of it ok"])(
    "a malformed key (%s) warns once and falls back",
    (bad) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const m = createMapEmbed({ env: { GOOGLE_MAPS_EMBED_KEY: bad } });
      expect(m.keyed).toBe(false);
      expect(m.frameKey).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(m.embedUrl({ query: "x" })).toBe(mapFrameUrl("x"));
    },
  );

  it("an unusable query gives an empty URL", () => {
    const m = createMapEmbed({ env: {} });
    expect(m.embedUrl({ query: "" })).toBe("");
    expect(m.embedUrl({ query: "a\u0000b" })).toBe("");
  });

  it("directions use the core builder", () => {
    const m = createMapEmbed({ env: {} });
    expect(m.directionsUrl("12 Main St, Austin")).toBe(
      mapDirectionsUrl("12 Main St, Austin"),
    );
  });
});
