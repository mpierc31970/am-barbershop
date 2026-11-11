// Core block group A registration (07-06; CONT-22, CONT-23, CONT-27, CONT-35).
import { describe, expect, it } from "vitest";
import { trainingFor } from "../../../training";
import * as content from "../index";
import { FULL_WIDTH_ONLY } from "../layouts";
import * as A from "./exports-a";
import { P7_SECTIONS_A } from "./group-a";

const TYPES = ["gallery", "slider", "tabs", "logo-strip", "stats"];

describe("P7_SECTIONS_A", () => {
  it("registers the five group A types", () => {
    expect(P7_SECTIONS_A.map((d) => d.type)).toEqual(TYPES);
    expect(Object.isFrozen(P7_SECTIONS_A)).toBe(true);
    const types = content
      .composeSectionRegistry(content.CORE_SECTIONS, [])
      .types();
    expect(types.slice(5, 10)).toEqual(TYPES);
  });

  it("has the UI-SPEC labels and descriptions", () => {
    expect(P7_SECTIONS_A.map((d) => [d.label, d.description])).toEqual([
      ["Gallery", "A grid, mosaic or slideshow of photos"],
      ["Slider", "Slides that change, each with its own content"],
      ["Tabs", "Content split under a few tabs"],
      ["Logo strip", "Logos of clients, partners or press"],
      ["Stats", "A few numbers worth knowing"],
    ]);
  });

  it("is full width only and never owns the page H1 (CONT-35)", () => {
    for (const def of P7_SECTIONS_A) {
      expect([...def.layouts], def.type).toEqual([...FULL_WIDTH_ONLY]);
      expect(def.headings, def.type).toEqual({
        ownsH1: false,
        blockHeading: "h2",
      });
      expect(() => def.validate(def.defaultContent(), "full")).not.toThrow();
    }
  });

  it("each type has a block training entry with its requirement", () => {
    const req: Record<string, string> = {
      gallery: "CONT-22",
      slider: "CONT-23",
      tabs: "CONT-27",
      "logo-strip": "CONT-27",
      stats: "CONT-27",
    };
    for (const type of TYPES) {
      expect(trainingFor(type), type).toMatchObject({
        kind: "block",
        requirement: req[type],
        howTo: `docs/how-to/block-${type}.md`,
        video: null,
      });
    }
  });
});

describe("exports-a", () => {
  it("every exported name carries its block prefix", () => {
    const names = Object.keys(A);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(
        // 07-20: a lowercase leading prefix (sliderIntervalMs, tabsVisiblePanels) counts too.
        /^(GALLERY|SLIDER|TABS|LOGO_STRIP|STATS)_|Gallery|Slider|Tabs|LogoStrip|Stats|^(gallery|slider|tabs|logoStrip|stats)[A-Z]/,
      );
    }
  });

  it("@cds/core/content exposes the four public names of each block", () => {
    for (const block of ["Gallery", "Slider", "Tabs", "LogoStrip", "Stats"]) {
      const c = content as Record<string, unknown>;
      expect(typeof c[`validate${block}Content`], block).toBe("function");
      expect(typeof c[`default${block}Content`], block).toBe("function");
    }
    expect(content.GALLERY_LIMITS.maxImages).toBe(200);
    expect(content.LOGO_STRIP_LIMITS.maxLogos).toBe(16);
    expect(content.STATS_LIMITS.maxItems).toBe(6);
    expect(content.SLIDER_LIMITS.maxSlides).toBe(10);
    expect(content.TABS_LIMITS.maxTabs).toBe(6);
    expect(content).not.toHaveProperty("validatePanels");
    expect(content).not.toHaveProperty("gallerySection");
  });
});
