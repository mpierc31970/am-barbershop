// Core block group B registration (07-07; CONT-24, CONT-26, CONT-27, CONT-35; 08-05 adds
// services and team, TMPL-01, TMPL-02).
import { describe, expect, it } from "vitest";
import { trainingFor } from "../../../training";
import * as content from "../index";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { PublishedSection } from "../types";
import * as B from "./exports-b";
import { P7_SECTIONS_B } from "./group-b";

const TYPES = [
  "faq",
  "table",
  "icon-list",
  "hours",
  "map",
  "social",
  "services",
  "team",
];

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

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => [k, stripIds(v)]),
    );
  }
  return value;
}

describe("P7_SECTIONS_B", () => {
  it("registers the eight group B types right after group A", () => {
    expect(P7_SECTIONS_B.map((d) => d.type)).toEqual(TYPES);
    expect(Object.isFrozen(P7_SECTIONS_B)).toBe(true);
    const types = content
      .composeSectionRegistry(content.CORE_SECTIONS, [])
      .types();
    expect(types.slice(10, 10 + TYPES.length)).toEqual(TYPES);
  });

  it("has the UI-SPEC labels and descriptions", () => {
    expect(P7_SECTIONS_B.map((d) => [d.label, d.description])).toEqual([
      ["FAQ", "Questions visitors can open one at a time"],
      ["Table", "Rows and columns, pasted from a spreadsheet"],
      ["Icon list", "Short points, each with an icon"],
      ["Business hours", "Your opening hours, with 'Open now'"],
      ["Map", "Where to find you, with directions"],
      ["Social and sharing", "Your social links and share buttons"],
      ["Services", "Your services and prices, always up to date"],
      ["Our team", "The people customers will meet, from your team list"],
    ]);
  });

  it("full width, never owns the H1, no refs, defaults round-trip", () => {
    for (const def of P7_SECTIONS_B) {
      expect([...def.layouts], def.type).toEqual([...FULL_WIDTH_ONLY]);
      expect(def.headings, def.type).toEqual({
        ownsH1: false,
        blockHeading: "h2",
      });
      const d = def.defaultContent();
      expect(def.refsOf(d), def.type).toEqual({
        popups: [],
        forms: [],
        media: [],
      });
      expect(stripIds(def.validate(d, "full")), def.type).toEqual(stripIds(d));
    }
  });

  it("faq and icon-list defaults share no item ids", () => {
    for (const type of ["faq", "icon-list"]) {
      const def = P7_SECTIONS_B.find((d) => d.type === type)!;
      const a = def.defaultContent() as { items: { id: string }[] };
      const b = def.defaultContent() as { items: { id: string }[] };
      const ids = new Set(a.items.map((i) => i.id));
      expect(
        b.items.some((i) => ids.has(i.id)),
        type,
      ).toBe(false);
    }
  });

  it("only the hero owns the page H1 (CONT-35)", () => {
    const registry = content.composeSectionRegistry(content.CORE_SECTIONS, []);
    const page = P7_SECTIONS_B.map((def, i) => {
      const c = def.defaultContent() as Record<string, unknown>;
      return section(`b${i}`, def.type, { ...c, heading: "Something" });
    });
    expect(content.headingOwnerId(page, registry)).toBeNull();
    const hero = section("hero1", "hero", { heading: "Welcome" });
    expect(content.headingOwnerId([...page, hero], registry)).toBe("hero1");
  });

  it("each type has a block training entry with its requirement", () => {
    const req: Record<string, string> = {
      faq: "CONT-27",
      table: "CONT-26",
      "icon-list": "CONT-27",
      hours: "CONT-27",
      map: "CONT-24",
      social: "CONT-27",
      services: "TMPL-01",
      team: "TMPL-01",
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

describe("exports-b", () => {
  it("every exported name carries its block prefix", () => {
    const names = Object.keys(B);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(
        // 07-24: lowercase block prefixes (mapAddressQuery, hoursRows, socialShareHref) and
        // the three hours-status helpers the plan names (block-specific, no collision).
        // 08-04: Services and Our team (SERVICES_, TEAM_, servicesSection, teamSection).
        /^(MAP|TABLE|PRO_TABLE|FAQ|ICON_LIST|HOURS|SOCIAL|SERVICES|TEAM)_|^EMPTY_TABLE_PRO$|Map|Table|Faq|IconList|Hours|Social|Services|Team|^(faq|table|map|hours|social|services|team)[A-Z]|^(formatClock|openStatus|timeZoneLabel)$/,
      );
    }
  });

  it("@cds/core/content exposes the public names, not the definitions", () => {
    expect(typeof content.parseMapLink).toBe("function");
    expect(typeof content.faqEntries).toBe("function");
    expect(typeof content.tableIsEmpty).toBe("function");
    expect(content.ICON_LIST_ICON_IDS).toHaveLength(60);
    expect(content.TABLE_MAX_ROWS).toBe(200);
    expect(content).not.toHaveProperty("mapSection");
    expect(content).not.toHaveProperty("faqSection");
  });
});
