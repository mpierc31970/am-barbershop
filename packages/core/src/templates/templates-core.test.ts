// @cds/core/templates contract (08-01; TMPL-01, TMPL-03; CONTEXT A1-Q1/Q2/Q5, A4-Q2;
// D-UI-P8-5, D-UI-P8-27; RESEARCH R-1).
import { describe, expect, expectTypeOf, it } from "vitest";
import { InvalidInput } from "../errors";
import type { PresetBlock } from "../content/presets";
import {
  assertTemplateShape,
  assignBands,
  photoPolishLine,
  pickTemplate,
  slotLabel,
  SLOT_LABELS,
  SOURCE_WORDS,
  type AssemblyIntake,
  type SiteTemplate,
  type Slot,
  type TemplatePage,
} from "./index";

const block = (t = "text"): PresetBlock => ({
  section_type: t,
  row_layout: "full",
  content: {},
});

describe("assignBands (D-UI-P8-5)", () => {
  it("Home: hero alternate, then placed slots alternate starting main", () => {
    const out = assignBands(
      [
        { slot: "hero", blocks: [block("hero")] },
        { slot: "intro", blocks: [block()] },
        { slot: "services", blocks: [block()] },
        { slot: "contact", blocks: [block()] },
      ],
      { hasHero: true },
    );
    expect(out.map((r) => [r.slot, r.band])).toEqual([
      ["hero", "alternate"],
      ["intro", "main"],
      ["services", "alternate"],
      ["contact", "main"],
    ]);
  });

  it("a two-block slot stays on one band; omitted slots do not advance", () => {
    const out = assignBands(
      [
        { slot: "hero", blocks: [block("hero")] },
        { slot: "intro", blocks: [block()] },
        { slot: "proof", blocks: [] },
        { slot: "hours-location", blocks: [block("hours"), block("map")] },
        { slot: "contact", blocks: [block()] },
      ],
      { hasHero: true },
    );
    expect(out.map((r) => [r.slot, r.band, r.blocks.length])).toEqual([
      ["hero", "alternate", 1],
      ["intro", "main", 1],
      ["hours-location", "alternate", 2],
      ["contact", "main", 1],
    ]);
  });

  it("About (no hero): first placed slot alternate, then main, alternate", () => {
    const out = assignBands(
      [
        { slot: "about", blocks: [block()] },
        { slot: "team", blocks: [] },
        { slot: "gallery", blocks: [block("gallery")] },
        { slot: "faq", blocks: [block("faq")] },
      ],
      { hasHero: false },
    );
    expect(out.map((r) => [r.slot, r.band])).toEqual([
      ["about", "alternate"],
      ["gallery", "main"],
      ["faq", "alternate"],
    ]);
  });

  it("returns new objects and never mutates its input", () => {
    const input = [
      { slot: "hero", blocks: [block("hero")] },
      { slot: "intro", blocks: [block()] },
    ];
    const snapshot = JSON.stringify(input);
    const out = assignBands(input, { hasHero: true });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[0]).not.toBe(input[0]);
    expect(input[0]).not.toHaveProperty("band");
  });
});

describe("labels (D-UI-P8-27, A4-Q2)", () => {
  it("slot labels and source words", () => {
    expect(slotLabel("hours-location")).toBe("Hours and map");
    expect(slotLabel("closing-cta")).toBe("Call to action");
    expect(slotLabel("unknown-x")).toBe("unknown-x");
    expect(SOURCE_WORDS.fallback).toBe("Default used");
    expect(SOURCE_WORDS.provided).toBe("Filled");
    expect(SOURCE_WORDS.omitted).toBe("Left out");
    expect(Object.isFrozen(SLOT_LABELS)).toBe(true);
    expect(Object.keys(SLOT_LABELS)).toHaveLength(11);
  });

  it("photoPolishLine dedupes by asset id", () => {
    expect(photoPolishLine(["a", "b", "a"])).toBe(
      "Photos · 2 need a reviewed description",
    );
    expect(photoPolishLine([])).toBeNull();
  });
});

const slot = (name: string): Slot => ({
  name,
  label: name,
  fill: () => ({ blocks: [], source: "omitted" }),
});
const page = (
  key: string,
  slug: string,
  slots: Slot[] = [slot("a")],
): TemplatePage => ({
  key,
  slug,
  title: () => key,
  navLabel: key,
  inNav: true,
  slots,
});
const template = (over: Partial<SiteTemplate> = {}): SiteTemplate => ({
  id: "t1",
  version: 1,
  label: "T1",
  paths: ["standard"],
  pages: [page("home", "home"), page("about", "about")],
  ...over,
});

describe("assertTemplateShape (A1-Q5)", () => {
  it("a valid two-page template passes", () => {
    expect(() => assertTemplateShape(template())).not.toThrow();
  });

  it.each<[string, Partial<SiteTemplate>]>([
    ["no home page", { pages: [page("about", "about")] }],
    [
      "duplicate page key",
      { pages: [page("home", "home"), page("home", "other")] },
    ],
    [
      "duplicate page slug",
      { pages: [page("home", "home"), page("about", "home")] },
    ],
    [
      "duplicate slot names",
      { pages: [page("home", "home", [slot("hero"), slot("hero")])] },
    ],
    ["version 0", { version: 0 }],
    ["version 1.5", { version: 1.5 }],
    ["empty paths", { paths: [] }],
  ])("rejects %s", (_name, over) => {
    expect(() => assertTemplateShape(template(over))).toThrow(InvalidInput);
  });
});

describe("pickTemplate", () => {
  const a = template({ id: "a", paths: ["standard"] });
  const b = template({ id: "b", paths: ["studio", "standard"] });
  it("returns the first template listing the path", () => {
    expect(pickTemplate([a, b], "studio")?.id).toBe("b");
    expect(pickTemplate([a, b], "standard")?.id).toBe("a");
  });
  it("undefined when none lists the path", () => {
    expect(pickTemplate([a, b], "shop")).toBeUndefined();
  });
});

describe("AssemblyIntake (R-1): db's getIntakeForAssembly shape is assignable", () => {
  it("compiles with services, team, addonConfig keys and media refs", () => {
    const fromDb = {
      orgId: "o1",
      path: "standard",
      fields: { org_name: { value: "Rivera", source: "provided" as const } },
      team: [
        {
          id: "t1",
          sortOrder: 0,
          photoId: null as string | null,
          name: "Ana",
          role: "Owner",
          bio: "",
          is_published: true,
        },
      ],
      services: [
        {
          id: "s1",
          sortOrder: 0,
          name: "Cut",
          description: "",
          price_display: "fixed" as const,
          price_cents: null as number | null,
          duration_minutes: null as number | null,
          is_published: true,
        },
      ],
      media: {
        logo: null,
        hero: { id: "m1", alt: "Fresh loaves", alt_reviewed: true },
        gallery: [{ id: "m2", alt: "", alt_reviewed: false }],
      },
      addonConfig: {
        testimonials: { fields: {}, records: [], keys: ["k1"] } as {
          fields: Record<string, unknown>;
          records: Record<string, unknown>[];
          keys?: string[];
        },
      },
      selections: {
        addons: [] as string[],
        extras: [] as string[],
        carePlan: false,
        cadence: "monthly" as const,
      },
      moodboardProposal: null,
    };
    const a: AssemblyIntake = fromDb;
    expectTypeOf(a.media.hero).toEqualTypeOf<{
      id: string;
      alt: string;
      alt_reviewed: boolean;
    } | null>();
    expect(a.orgId).toBe("o1");
  });
});
