// ONB-11, D176, D215, D302: paths, business types and extras are data (invariant 2).
import { describe, expect, it } from "vitest";
import { ADDON_PATHS, ADDON_SLUG_RE } from "../addons/constants";
import {
  BUSINESS_TYPES,
  COPY_GROUPS,
  EXTRAS,
  PATHS,
  businessTypesFor,
  findBusinessType,
} from "./index";

describe("PATHS", () => {
  it("lists standard, studio, shop in order; shop is not available yet (D302)", () => {
    expect(PATHS.map((p) => p.id)).toEqual(["standard", "studio", "shop"]);
    expect(PATHS.map((p) => p.available)).toEqual([true, true, false]);
    expect(PATHS[2]?.whoFor).toBe("Selling products online first?");
  });

  it("uses the UI-SPEC path card copy", () => {
    expect(PATHS[0]).toMatchObject({
      label: "Standard",
      whoFor:
        "For practitioners, coaches, shops and services where clients don't book a staff member.",
      examples: "Therapists, consultants, tutors, bakeries, paint stores",
    });
    expect(PATHS[1]).toMatchObject({
      label: "Studio",
      whoFor:
        "For businesses where clients book a service with a member of your team.",
      examples: "Salons, spas, barbers, nails, lashes, massage, tattoo",
    });
  });
});

describe("BUSINESS_TYPES", () => {
  it("gives every type a copyGroup from the six allowed values (08-06, D-UI-P8-10)", () => {
    for (const t of BUSINESS_TYPES) expect(COPY_GROUPS).toContain(t.copyGroup);
    expect(findBusinessType("bakery")?.copyGroup).toBe("shop");
    expect(findBusinessType("hair-salon")?.copyGroup).toBe("studio");
    expect(findBusinessType("yoga-studio")?.copyGroup).toBe("studio");
    expect(findBusinessType("nonprofit")?.copyGroup).toBe("community");
    expect(findBusinessType("therapist")?.copyGroup).toBe("practice");
    expect(findBusinessType("home-services")?.copyGroup).toBe("service");
    expect(findBusinessType("other")?.copyGroup).toBe("other");
    for (const t of businessTypesFor("studio")) {
      if (t.id !== "other") expect(t.copyGroup).toBe("studio");
    }
  });

  it("has unique, slug-shaped ids", () => {
    const ids = BUSINESS_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ADDON_SLUG_RE);
  });

  it.each(["standard", "studio"] as const)(
    "%s has at most 20 real types plus Something else last",
    (path) => {
      const list = businessTypesFor(path);
      expect(list.length).toBeLessThanOrEqual(21);
      expect(list.length).toBeGreaterThanOrEqual(10);
      expect(list.at(-1)).toMatchObject({
        id: "other",
        label: "Something else",
        aup: "ok",
      });
      expect(list.filter((t) => t.id === "other")).toHaveLength(1);
    },
  );

  it("every type has a plural, an About seed and valid paths", () => {
    for (const t of BUSINESS_TYPES) {
      expect(t.plural.length, t.id).toBeGreaterThan(0);
      expect(t.aboutSeed, t.id).toContain("{name}");
      expect(t.paths.length, t.id).toBeGreaterThan(0);
      for (const p of t.paths) expect(ADDON_PATHS).toContain(p);
      for (const s of t.recommended) expect(s).toMatch(ADDON_SLUG_RE);
    }
  });

  it("flags reviewed-first types (D215): psychic/astrology and CBD on Standard", () => {
    const review = businessTypesFor("standard")
      .filter((t) => t.aup === "review")
      .map((t) => t.label.toLowerCase())
      .join(" | ");
    expect(review).toMatch(/astrolog|psychic|tarot/);
    expect(review).toMatch(/cbd/);
  });

  it("never recommends Appointments on Studio or Studio Booking on Standard (D177)", () => {
    for (const t of businessTypesFor("studio")) {
      if (!t.paths.includes("standard"))
        expect(t.recommended, t.id).not.toContain("appointments");
    }
    for (const t of businessTypesFor("standard")) {
      if (!t.paths.includes("studio"))
        expect(t.recommended, t.id).not.toContain("studio-booking");
    }
  });

  it("findBusinessType resolves only real ids", () => {
    expect(findBusinessType("other")?.label).toBe("Something else");
    expect(findBusinessType("nope")).toBeUndefined();
    expect(findBusinessType(42)).toBeUndefined();
    expect(findBusinessType("__proto__")).toBeUndefined();
  });
});

describe("EXTRAS", () => {
  it("lists the four priced extras as data (D181)", () => {
    expect(EXTRAS.map((e) => e.key)).toEqual([
      "copywriting",
      "logo-design",
      "sourced-photos",
      "rush-launch",
    ]);
    for (const e of EXTRAS) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });
});
