// Section registry (CONT-02, CONT-32, D32, D281, invariant 5; T-03-06).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { fixtureAddonSection } from "./__fixtures__/fixture-addon";
import { P7_SECTIONS_A } from "./blocks/group-a";
import { P7_SECTIONS_B } from "./blocks/group-b";
import { ALL_LAYOUTS } from "./layouts";
import {
  CORE_SECTIONS,
  assertSectionType,
  composeSectionRegistry,
  emptyRefs,
  popupIdsOf,
  unionRefs,
} from "./registry";
import type { SectionType, SectionTypeDefinition } from "./registry";
import type { ColumnsContent } from "./types";

const core = () => composeSectionRegistry(CORE_SECTIONS, []);

describe("CORE_SECTIONS", () => {
  it("lists the base types first, then group A, then group B", () => {
    const base = ["columns", "hero", "text-image", "text-only", "cta-banner"];
    expect(core().types().slice(0, 5)).toEqual(base);
    expect(core().types()).toEqual([
      ...base,
      ...P7_SECTIONS_A.map((d) => d.type),
      ...P7_SECTIONS_B.map((d) => d.type),
    ]);
  });

  it("has the UI-SPEC labels", () => {
    expect(CORE_SECTIONS.slice(0, 5).map((d) => d.label)).toEqual([
      "Columns",
      "Hero",
      "Text & image",
      "Text",
      "Call to action",
    ]);
    // Group labels are pinned in blocks/group-a.test.ts / group-b.test.ts.
    for (const def of CORE_SECTIONS) expect(def.label.trim()).not.toBe("");
  });

  it("has no custom (raw HTML) type (CONT-32)", () => {
    expect(CORE_SECTIONS.map((d) => d.type)).not.toContain("custom");
    expect(core().get("custom")).toBeUndefined();
  });

  it("makes columns the only type with more than one layout (invariant 6)", () => {
    for (const def of CORE_SECTIONS) {
      if (def.type === "columns")
        expect([...def.layouts]).toEqual([...ALL_LAYOUTS]);
      else expect([...def.layouts]).toEqual(["full"]);
    }
  });

  it("default content validates cleanly for every type", () => {
    for (const def of CORE_SECTIONS) {
      const layout = def.layouts[0]!;
      expect(
        () => def.validate(def.defaultContent(), layout),
        def.type,
      ).not.toThrow();
    }
  });

  it("columns default content has fresh column ids per call", () => {
    const cols = core().get("columns")!;
    const a = cols.defaultContent() as ColumnsContent;
    const b = cols.defaultContent() as ColumnsContent;
    expect(a.columns[0]!.id).not.toBe(b.columns[0]!.id);
  });

  it("columns validate normalizes to the layout", () => {
    const cols = core().get("columns")!;
    const out = cols.validate(
      {
        columns: [
          { id: "a", items: [] },
          { id: "b", items: [] },
          { id: "c", items: [] },
        ],
      },
      "50-50",
    ) as ColumnsContent;
    expect(out.columns).toHaveLength(2);
  });
});

describe("composeSectionRegistry", () => {
  it("accepts a fixture add-on contribution", () => {
    const reg = composeSectionRegistry(CORE_SECTIONS, [fixtureAddonSection]);
    expect(reg.types()).toContain("fixture-quote");
    expect(assertSectionType(reg, "fixture-quote").label).toBe(
      "Quote (fixture)",
    );
    expect(
      reg.get("fixture-quote")!.validate({ text: " hi ", evil: 1 }, "full"),
    ).toEqual({
      text: "hi",
    });
  });

  it("rejects a duplicate type", () => {
    const dup: SectionTypeDefinition = { ...fixtureAddonSection, type: "hero" };
    expect(() => composeSectionRegistry(CORE_SECTIONS, [dup])).toThrow(
      InvalidInput,
    );
    expect(() =>
      composeSectionRegistry(CORE_SECTIONS, [
        fixtureAddonSection,
        fixtureAddonSection,
      ]),
    ).toThrow(InvalidInput);
  });

  it("rejects a custom contribution", () => {
    const custom: SectionTypeDefinition = {
      ...fixtureAddonSection,
      type: "custom",
    };
    expect(() => composeSectionRegistry(CORE_SECTIONS, [custom])).toThrow(
      InvalidInput,
    );
  });

  it("rejects malformed type ids and bad layout lists", () => {
    for (const type of ["", "Hero", "has space", "__proto__", "toString"]) {
      const bad: SectionTypeDefinition = { ...fixtureAddonSection, type };
      expect(() => composeSectionRegistry(CORE_SECTIONS, [bad]), type).toThrow(
        InvalidInput,
      );
    }
    const noLayouts: SectionTypeDefinition = {
      ...fixtureAddonSection,
      layouts: [],
    };
    expect(() => composeSectionRegistry(CORE_SECTIONS, [noLayouts])).toThrow(
      InvalidInput,
    );
  });
});

describe("assertSectionType", () => {
  it("returns a registered definition", () => {
    expect(assertSectionType(core(), "hero").type).toBe("hero");
  });

  it("rejects unknown, inherited and custom types", () => {
    for (const type of [
      "toString",
      "custom",
      "constructor",
      "__proto__",
      "nope",
      "",
    ]) {
      expect(() => assertSectionType(core(), type), type).toThrow(InvalidInput);
    }
  });

  it("rejects a non-string type", () => {
    expect(() => assertSectionType(core(), 5 as unknown as string)).toThrow(
      InvalidInput,
    );
  });
});

describe("content walkers", () => {
  const reg = core();
  const columns = reg.get("columns")!;
  const content = columns.validate(
    {
      columns: [
        {
          id: "c1",
          items: [
            { id: "h", kind: "heading", text: "Title" },
            { id: "t", kind: "text", html: "<p>Body</p>" },
            { id: "l", kind: "list", items: ["one"] },
            { id: "m", kind: "image", url: "https://x.test/a.jpg", alt: "Alt" },
            { id: "b", kind: "button", text: "Go", link: "/go" },
            {
              id: "p",
              kind: "button",
              text: "Open",
              action: "popup",
              popup_id: "pop1",
            },
            {
              id: "k",
              kind: "countdown",
              target_at: "2027-01-01T00:00:00Z",
              zero_message: "Now",
            },
          ],
        },
      ],
    },
    "full",
  );

  it("columns textsOf walks every item", () => {
    expect(columns.textsOf(content)).toEqual(
      expect.arrayContaining([
        "Title",
        "<p>Body</p>",
        "one",
        "Alt",
        "Go",
        "Open",
        "Now",
      ]),
    );
  });

  it("columns urlsOf, refsOf and the popupIdsOf wrapper", () => {
    expect(columns.urlsOf(content).sort()).toEqual([
      "/go",
      "https://x.test/a.jpg",
    ]);
    expect(columns.refsOf(content)).toEqual({
      popups: ["pop1"],
      forms: [],
      media: [],
    });
    expect(popupIdsOf(columns, content)).toEqual(["pop1"]);
    expect(columns.refsOf(undefined)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
  });

  it("columns mapRichText touches only text items, without mutating", () => {
    const mapped = columns.mapRichText(content, (h) =>
      h.toUpperCase(),
    ) as ColumnsContent;
    const items = mapped.columns[0]!.items;
    expect(items.find((i) => i.id === "t")).toMatchObject({
      html: "<P>BODY</P>",
    });
    expect(items.find((i) => i.id === "h")).toMatchObject({ text: "Title" });
    expect((content as ColumnsContent).columns[0]!.items[1]).toMatchObject({
      html: "<p>Body</p>",
    });
  });

  it("text types map their rich text field; hero and CTA have none", () => {
    const textOnly = reg.get("text-only")!;
    const v = textOnly.validate({ heading: "H", text: "<p>x</p>" }, "full");
    expect(textOnly.mapRichText(v, () => "Y")).toEqual({
      heading: "H",
      text: "Y",
    });
    const ti = reg.get("text-image")!;
    const tiv = ti.validate(
      {
        text: "<p>x</p>",
        cta_link: "/a",
        image_url: "https://x.test/i.png",
        image_alt: "i",
      },
      "full",
    );
    expect(ti.mapRichText(tiv, () => "Y")).toMatchObject({ text: "Y" });
    expect(ti.urlsOf(tiv).sort()).toEqual(["/a", "https://x.test/i.png"]);
    const hero = reg.get("hero")!;
    const hv = hero.validate({ heading: "Hi", cta_primary_link: "/b" }, "full");
    expect(hero.mapRichText(hv, () => "Y")).toEqual(hv);
    expect(hero.textsOf(hv)).toContain("Hi");
    expect(hero.urlsOf(hv)).toEqual(["/b"]);
    expect(hero.refsOf(hv)).toEqual({ popups: [], forms: [], media: [] });
    expect(hero.refsOf({ image_asset: "abc123def456ghi" })).toEqual({
      popups: [],
      forms: [],
      media: ["abc123def456ghi"],
    });
    expect(hero.refsOf({ image_asset: "" })).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    const cta = reg.get("cta-banner")!;
    expect(cta.urlsOf(cta.validate({ button_link: "/c" }, "full"))).toEqual([
      "/c",
    ]);
  });
});

describe("SectionTypeMap augmentation (type level)", () => {
  it("lets an add-on's declare module extend SectionType", () => {
    // tsc runs over this file: this line only compiles because the fixture add-on
    // augments SectionTypeMap by declaration merging (CONT-02).
    const t: SectionType = "fixture-quote";
    const core: SectionType = "columns";
    expect([t, core]).toEqual(["fixture-quote", "columns"]);
  });
});

describe("heading contract (CONT-35)", () => {
  it("makes the hero the only core type that owns the H1", () => {
    const owners = CORE_SECTIONS.filter((d) => d.headings.ownsH1);
    expect(owners.map((d) => d.type)).toEqual(["hero"]);
    expect(core().get("hero")!.headings).toEqual({
      ownsH1: true,
      blockHeading: "h2",
    });
    expect(fixtureAddonSection.headings.ownsH1).toBe(false);
  });

  it("every core type declares refsOf returning three arrays", () => {
    for (const def of CORE_SECTIONS) {
      const refs = def.refsOf(def.defaultContent());
      expect(refs, def.type).toEqual({ popups: [], forms: [], media: [] });
    }
    expect(fixtureAddonSection.refsOf({ text: "x" })).toEqual(emptyRefs());
  });

  it("refuses a non-hero type that claims the H1", () => {
    const thief: SectionTypeDefinition = {
      ...fixtureAddonSection,
      headings: { ownsH1: true, blockHeading: "h2" },
    };
    expect(() => composeSectionRegistry(CORE_SECTIONS, [thief])).toThrow(
      /cannot own the page H1/,
    );
  });

  it("refuses missing headings, a bad blockHeading or a missing refsOf", () => {
    const noHeadings = {
      ...fixtureAddonSection,
      headings: undefined,
    } as unknown as SectionTypeDefinition;
    const badTag = {
      ...fixtureAddonSection,
      headings: { ownsH1: false, blockHeading: "h1" },
    } as unknown as SectionTypeDefinition;
    const badOwns = {
      ...fixtureAddonSection,
      headings: { ownsH1: "yes", blockHeading: "h2" },
    } as unknown as SectionTypeDefinition;
    const noRefs = {
      ...fixtureAddonSection,
      refsOf: undefined,
    } as unknown as SectionTypeDefinition;
    for (const bad of [noHeadings, badTag, badOwns, noRefs]) {
      expect(() => composeSectionRegistry(CORE_SECTIONS, [bad])).toThrow(
        InvalidInput,
      );
    }
    const none: SectionTypeDefinition = {
      ...fixtureAddonSection,
      headings: { ownsH1: false, blockHeading: "none" },
    };
    expect(() => composeSectionRegistry(CORE_SECTIONS, [none])).not.toThrow();
  });

  it("refuses a contribution missing any contract function (WR-B04)", () => {
    for (const fn of [
      "defaultContent",
      "validate",
      "mapRichText",
      "textsOf",
      "urlsOf",
      "refsOf",
    ]) {
      const bad = {
        ...fixtureAddonSection,
        [fn]: undefined,
      } as unknown as SectionTypeDefinition;
      expect(() => composeSectionRegistry(CORE_SECTIONS, [bad])).toThrow(
        `needs a ${fn} function`,
      );
    }
  });

  it("emptyRefs returns fresh arrays each call", () => {
    const a = emptyRefs();
    a.popups.push("x");
    expect(emptyRefs()).toEqual({ popups: [], forms: [], media: [] });
  });

  it("unionRefs de-duplicates per key in first-seen order", () => {
    expect(
      unionRefs([
        { popups: ["b", "a"], forms: ["f1"], media: [] },
        { popups: ["a", "c", ""], forms: [], media: ["m1", "m1"] },
        {
          popups: [5 as unknown as string],
          forms: ["f1", "f2"],
          media: ["m2"],
        },
      ]),
    ).toEqual({
      popups: ["b", "a", "c"],
      forms: ["f1", "f2"],
      media: ["m1", "m2"],
    });
    expect(unionRefs([])).toEqual(emptyRefs());
  });
});
