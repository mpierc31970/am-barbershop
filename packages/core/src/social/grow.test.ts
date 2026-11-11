import { describe, expect, it } from "vitest";
import { COPY_GROUPS } from "../onboarding/business-types";
import { SOCIAL_SOURCE_KEYS } from "../analytics/attribution";
import { GROW_CHECKLIST, growCategoryFor, growTipsFor } from "./grow";

describe("GROW_CHECKLIST", () => {
  it("has unique ids and plain non-empty text", () => {
    const ids = GROW_CHECKLIST.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GROW_CHECKLIST) {
      expect(t.text.trim().length).toBeGreaterThan(0);
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("covers every preset platform with about four tips, plus every-account tips", () => {
    for (const key of SOCIAL_SOURCE_KEYS) {
      const n = GROW_CHECKLIST.filter((t) => t.platform === key).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(GROW_CHECKLIST.some((t) => t.platform === "all")).toBe(true);
  });

  it("uses only known business categories", () => {
    for (const t of GROW_CHECKLIST) {
      if (t.categories === "all") continue;
      for (const c of t.categories) expect(COPY_GROUPS).toContain(c);
    }
  });
});

describe("growTipsFor", () => {
  it("returns instagram + every-account tips, no tiktok", () => {
    const tips = growTipsFor(["instagram"], "studio");
    expect(tips.some((t) => t.platform === "instagram")).toBe(true);
    expect(tips.some((t) => t.platform === "all")).toBe(true);
    expect(tips.some((t) => t.platform === "tiktok")).toBe(false);
  });

  it("filters by category but keeps all-category tips", () => {
    for (const t of growTipsFor(["instagram", "yelp"], "shop")) {
      if (t.categories !== "all") expect(t.categories).toContain("shop");
    }
    const practice = growTipsFor(["instagram"], "practice");
    const studio = growTipsFor(["instagram"], "studio");
    expect(practice.map((t) => t.id)).not.toEqual(studio.map((t) => t.id));
  });

  it("returns only every-account tips with no platforms, in checklist order", () => {
    const tips = growTipsFor([], "other");
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every((t) => t.platform === "all")).toBe(true);
    const order = GROW_CHECKLIST.map((t) => t.id);
    const idx = tips.map((t) => order.indexOf(t.id));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("ignores unknown platforms and an unknown category", () => {
    const tips = growTipsFor(["myspace", "custom"], "nope");
    expect(
      tips.every((t) => t.platform === "all" && t.categories === "all"),
    ).toBe(true);
  });
});

describe("growCategoryFor", () => {
  it("maps an intake business type to its copy group", () => {
    expect(growCategoryFor("hair-salon")).toBe("studio");
    expect(growCategoryFor("bakery")).toBe("shop");
    expect(growCategoryFor("therapist")).toBe("practice");
    expect(growCategoryFor("unknown-type")).toBe("other");
    expect(growCategoryFor(undefined)).toBe("other");
  });
});
