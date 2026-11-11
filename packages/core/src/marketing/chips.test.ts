// Closed colour code (UI-SPEC "The closed colour code"; 15-05 choice 4).
import { describe, expect, it } from "vitest";
import { ADDON_CHIPS, ADDON_RING, PATH_CHIPS, addonChip } from "./chips";

describe("PATH_CHIPS", () => {
  it("fixes the path colours", () => {
    expect(PATH_CHIPS).toEqual({
      standard: "cobalt",
      studio: "berry",
      shop: "outline",
    });
  });
});

describe("ADDON_CHIPS", () => {
  it("fixes builder-pro, credentials, testimonials as No. 01-03", () => {
    expect(ADDON_CHIPS["builder-pro"]).toEqual({ chip: "marigold", number: 1 });
    expect(ADDON_CHIPS["credentials"]).toEqual({ chip: "violet", number: 2 });
    expect(ADDON_CHIPS["testimonials"]).toEqual({ chip: "teal", number: 3 });
  });
  it("uses only ring colours", () => {
    for (const c of Object.values(ADDON_CHIPS)) {
      expect(ADDON_RING).toContain(c.chip);
    }
  });
});

describe("addonChip", () => {
  const listing = [
    "testimonials",
    "newsletter",
    "builder-pro",
    "events",
    "credentials",
    "store",
    "chatbot",
  ] as const;

  it("returns the fixed three whatever the listing order", () => {
    expect(addonChip("builder-pro", listing)).toEqual({
      chip: "marigold",
      number: 1,
    });
    expect(addonChip("testimonials", [])).toEqual({ chip: "teal", number: 3 });
  });

  it("gives unknown slugs the next ring colour and number by listing order", () => {
    expect(addonChip("newsletter", listing)).toEqual({
      chip: "rose",
      number: 4,
    });
    expect(addonChip("events", listing)).toEqual({ chip: "sky", number: 5 });
    expect(addonChip("store", listing)).toEqual({
      chip: "marigold",
      number: 6,
    });
    expect(addonChip("chatbot", listing)).toEqual({
      chip: "violet",
      number: 7,
    });
  });

  it("is deterministic across calls", () => {
    const a = listing.map((s) => addonChip(s, listing));
    const b = listing.map((s) => addonChip(s, [...listing]));
    expect(a).toEqual(b);
  });

  it("numbers a slug missing from the listing after every listed one", () => {
    expect(addonChip("mystery", listing)).toEqual({ chip: "teal", number: 8 });
  });

  it("never gives two listed add-ons the same number", () => {
    const numbers = listing.map((s) => addonChip(s, listing).number);
    expect(new Set(numbers).size).toBe(listing.length);
  });
});
