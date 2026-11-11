// Page h1 ownership (D-UI-11; CONT-13, CONT-35, D280: only the hero owns the H1).
import { describe, expect, it } from "vitest";
import { fixtureAddonSection } from "./__fixtures__/fixture-addon";
import {
  blockHeadingTag,
  headingOwnerId,
  sectionHasHeading,
  sectionOwnsH1,
} from "./headings";
import { CORE_SECTIONS, composeSectionRegistry } from "./registry";
import type { PublishedSection } from "./types";

const registry = composeSectionRegistry(CORE_SECTIONS, [fixtureAddonSection]);

function section(
  id: string,
  section_type: string,
  content: unknown,
): PublishedSection {
  return {
    id,
    section_type,
    row_layout: "full",
    content,
    settings: { background_variant: "main" },
  };
}

const columnsNoHeading = section("c1", "columns", {
  columns: [
    {
      id: "col1",
      items: [{ id: "i1", kind: "text", html: "<p>hi</p>" }],
    },
  ],
});
const columnsWithHeading = section("c2", "columns", {
  columns: [
    {
      id: "col1",
      items: [{ id: "i1", kind: "heading", text: "Meet Dana", level: 2 }],
    },
  ],
});
const hero = section("h1", "hero", { heading: "Welcome" });
const textOnly = section("t1", "text-only", { heading: "About", text: "" });
const cta = section("y", "cta-banner", { heading: "Book" });
const addon = section("q", "fixture-quote", { heading: "Kind words" });

describe("headingOwnerId (hero only)", () => {
  it("returns null for an empty page", () => {
    expect(headingOwnerId([], registry)).toBeNull();
  });

  it("finds the hero wherever it sits", () => {
    expect(headingOwnerId([columnsNoHeading, hero, textOnly], registry)).toBe(
      "h1",
    );
    expect(
      headingOwnerId(
        [columnsWithHeading, textOnly, cta, addon, hero],
        registry,
      ),
    ).toBe("h1");
  });

  it("never lets a columns block with a heading item own the h1", () => {
    expect(headingOwnerId([columnsWithHeading, hero], registry)).toBe("h1");
    expect(headingOwnerId([columnsWithHeading], registry)).toBeNull();
  });

  it("yields the h1 to the page title when the hero heading is blank", () => {
    const blank = section("h0", "hero", { heading: "   " });
    expect(headingOwnerId([blank, textOnly], registry)).toBeNull();
    expect(
      headingOwnerId([section("h9", "hero", { heading: "" })], registry),
    ).toBeNull();
  });

  it("ignores blank heading items (and still never picks columns)", () => {
    const blankItem = section("c3", "columns", {
      columns: [
        { id: "a", items: [{ id: "i", kind: "heading", text: "", level: 2 }] },
      ],
    });
    expect(headingOwnerId([blankItem, textOnly], registry)).toBeNull();
  });

  it("never lets text-image, cta-banner or an add-on block own it", () => {
    expect(
      headingOwnerId(
        [section("x", "text-image", { heading: "Story" })],
        registry,
      ),
    ).toBeNull();
    expect(headingOwnerId([cta], registry)).toBeNull();
    expect(headingOwnerId([addon], registry)).toBeNull();
  });

  it("skips unregistered section types, even with a heading", () => {
    expect(
      headingOwnerId(
        [section("z", "ghost", { heading: "Boo" }), hero],
        registry,
      ),
    ).toBe("h1");
    expect(
      headingOwnerId([section("z", "ghost", { heading: "Boo" })], registry),
    ).toBeNull();
  });

  it("returns null when the page has no hero", () => {
    expect(headingOwnerId([columnsNoHeading], registry)).toBeNull();
    expect(headingOwnerId([textOnly, cta], registry)).toBeNull();
  });

  it("picks only the first hero on legacy two-hero data", () => {
    const second = section("h2", "hero", { heading: "Again" });
    expect(headingOwnerId([textOnly, hero, second], registry)).toBe("h1");
  });

  it("property: every registered type at every position", () => {
    const types = registry.types();
    const filler = types.map((t, i) => {
      const def = registry.get(t)!;
      const raw = def.defaultContent();
      const content =
        typeof raw === "object" &&
        raw !== null &&
        Object.prototype.hasOwnProperty.call(raw, "heading")
          ? { ...(raw as Record<string, unknown>), heading: `Heading ${i}` }
          : raw;
      return section(`s-${t}`, t, content);
    });
    const nonHero = filler.filter((s) => s.section_type !== "hero");
    const heroSection = filler.find((s) => s.section_type === "hero")!;
    for (const t of types) {
      const probe = filler.find((s) => s.section_type === t)!;
      const rest = nonHero.filter((s) => s !== probe);
      for (let pos = 0; pos <= rest.length; pos++) {
        // A page of non-hero blocks with T inserted at `pos`.
        const page = [...rest.slice(0, pos), probe, ...rest.slice(pos)];
        const owner = headingOwnerId(page, registry);
        if (t === "hero") expect(owner, `${t}@${pos}`).toBe(heroSection.id);
        else expect(owner, `${t}@${pos}`).toBeNull();
        // The same page with a hero present: the hero always wins.
        const withHero =
          t === "hero"
            ? page
            : [...page.slice(0, pos), heroSection, ...page.slice(pos)];
        expect(headingOwnerId(withHero, registry), `${t}+hero@${pos}`).toBe(
          heroSection.id,
        );
      }
    }
  });
});

describe("sectionHasHeading", () => {
  it("is unchanged: heading field or a non-blank heading item", () => {
    expect(sectionHasHeading({ heading: "x" })).toBe(true);
    expect(sectionHasHeading(columnsWithHeading.content)).toBe(true);
    expect(sectionHasHeading(columnsNoHeading.content)).toBe(false);
    expect(sectionHasHeading(null)).toBe(false);
  });
});

describe("sectionOwnsH1", () => {
  it("is true for the hero only", () => {
    for (const t of registry.types()) {
      expect(sectionOwnsH1(registry, t), t).toBe(t === "hero");
    }
    expect(sectionOwnsH1(registry, "ghost")).toBe(false);
    expect(sectionOwnsH1(registry, 5)).toBe(false);
    expect(sectionOwnsH1(registry, null)).toBe(false);
  });
});

describe("blockHeadingTag", () => {
  it("returns h1 for the owner, the block heading otherwise", () => {
    expect(blockHeadingTag(registry, "hero", true)).toBe("h1");
    expect(blockHeadingTag(registry, "text-only", false)).toBe("h2");
    expect(blockHeadingTag(registry, "fixture-quote", false)).toBe("h2");
    expect(blockHeadingTag(registry, "ghost", false)).toBeNull();
    expect(blockHeadingTag(registry, "ghost", true)).toBeNull();
  });

  it("returns null for a block whose blockHeading is none", () => {
    const none = composeSectionRegistry(CORE_SECTIONS, [
      {
        ...fixtureAddonSection,
        headings: { ownsH1: false, blockHeading: "none" },
      },
    ]);
    expect(blockHeadingTag(none, "fixture-quote", false)).toBeNull();
  });
});
