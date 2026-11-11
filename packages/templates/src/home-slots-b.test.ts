// 08-13 Task 2: hours-location, contact and closing-cta slots + the registry sweep of all
// seven Home slots over both fixtures (TMPL-01..03; CONTEXT A1-Q3; D-UI-P8-7, -8, -12).
import type { ColumnsContent } from "@cds/core/content";
import {
  SLOT_LABELS,
  type AssemblyIntake,
  type Slot,
} from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import { COMPLETE_INTAKE, MINIMAL_INTAKE } from "../test/fixtures";
import { makeEnv, TEST_SECTIONS } from "../test/registry";
import { closingCtaSlot } from "./slots/closing-cta";
import { contactSlot } from "./slots/contact";
import { heroSlot } from "./slots/hero";
import { hoursLocationSlot } from "./slots/hours-location";
import { introSlot } from "./slots/intro";
import { proofSlot } from "./slots/proof";
import { servicesSlot } from "./slots/services";

const HOME_SLOTS: readonly Slot[] = [
  heroSlot,
  introSlot,
  servicesSlot,
  proofSlot,
  hoursLocationSlot,
  contactSlot,
  closingCtaSlot,
];

const HELPER_LINE = "Add your address and phone in Settings";

function withField(
  base: AssemblyIntake,
  id: string,
  value: unknown,
  source: "provided" | "fallback" = "provided",
): AssemblyIntake {
  return { ...base, fields: { ...base.fields, [id]: { value, source } } };
}

const NO_ADDRESS = withField(COMPLETE_INTAKE, "address", null, "fallback");
const NO_HOURS = withField(
  COMPLETE_INTAKE,
  "hours",
  "Contact us for hours",
  "fallback",
);

function items(content: unknown) {
  return (content as ColumnsContent).columns.flatMap((c) => c.items);
}

/** Every string value anywhere in a block tree. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object")
    for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe("slot identity", () => {
  it("names and staff labels", () => {
    expect(hoursLocationSlot.name).toBe("hours-location");
    expect(contactSlot.name).toBe("contact");
    expect(closingCtaSlot.name).toBe("closing-cta");
    for (const s of [hoursLocationSlot, contactSlot, closingCtaSlot]) {
      expect(s.label).toBe(SLOT_LABELS[s.name]);
    }
  });
});

describe("hours-location slot", () => {
  it("complete: Hours then Map, provided", () => {
    const r = hoursLocationSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks.map((b) => b.section_type)).toEqual(["hours", "map"]);
    expect(r.blocks[0]!.content).toMatchObject({
      heading: "Opening hours",
      show_open_now: true,
    });
    expect(r.blocks[1]!.content).toMatchObject({
      heading: "Find us",
      location: "",
      show_directions: true,
    });
  });

  it("address only: both blocks, Default used", () => {
    const r = hoursLocationSlot.fill(NO_HOURS, makeEnv());
    expect(r.source).toBe("fallback");
    expect(r.note).toBe("No hours: shows 'Contact us for hours.'");
    expect(r.blocks.map((b) => b.section_type)).toEqual(["hours", "map"]);
  });

  it("hours only: Hours, no Map", () => {
    const r = hoursLocationSlot.fill(NO_ADDRESS, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks.map((b) => b.section_type)).toEqual(["hours"]);
  });

  it("neither: left out", () => {
    const r = hoursLocationSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toHaveLength(0);
    expect(r.note).toBe("No hours or address");
  });
});

describe("contact slot", () => {
  it("Home after a map was placed: only the Columns block", () => {
    const r = contactSlot.fill(
      COMPLETE_INTAKE,
      makeEnv({
        placed: new Set(["hero", "hours-location"]),
        pagePlaced: new Set(["hero", "hours-location"]),
      }),
    );
    expect(r.source).toBe("provided");
    expect(r.blocks.map((b) => b.section_type)).toEqual(["columns"]);
    expect(r.blocks[0]!.row_layout).toBe("60-40");
  });

  it("a map placed on another page only (site-wide `placed`) keeps this page's map (IN-B01)", () => {
    const r = contactSlot.fill(
      COMPLETE_INTAKE,
      makeEnv({ pageKey: "about", placed: new Set(["hours-location"]) }),
    );
    expect(r.blocks.map((b) => b.section_type)).toEqual(["columns", "map"]);
  });

  it("no map placed yet and an address: Columns + Map", () => {
    const r = contactSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.blocks.map((b) => b.section_type)).toEqual(["columns", "map"]);
  });

  it("hours-location placed but no address: Columns only (no map anywhere)", () => {
    const r = contactSlot.fill(
      NO_ADDRESS,
      makeEnv({ placed: new Set(["hours-location"]) }),
    );
    expect(r.blocks.map((b) => b.section_type)).toEqual(["columns"]);
  });

  it("no address: Columns only", () => {
    const r = contactSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.blocks.map((b) => b.section_type)).toEqual(["columns"]);
  });

  it("form item names the contact form; right column has a mailto: line", () => {
    const r = contactSlot.fill(COMPLETE_INTAKE, makeEnv());
    const all = items(r.blocks[0]!.content);
    expect(all.find((i) => i.kind === "form")).toMatchObject({
      id: "I1",
      form_id: "F1",
    });
    const right = (r.blocks[0]!.content as ColumnsContent).columns[1]!.items;
    const html = right.map((i) => (i.kind === "text" ? i.html : "")).join("");
    expect(html).toContain("1200 South Congress Ave, Austin");
    // tel: and mailto: are Button links, which survive the rich-text sanitizer (WR-B01).
    const links = right.map((i) => (i.kind === "button" ? i.link : ""));
    expect(links).toContain("mailto:hello@riverabakery.test");
    expect(links).toContain("tel:5125550142");
  });

  it("minimal: email line, never the owner helper line", () => {
    const r = contactSlot.fill(MINIMAL_INTAKE, makeEnv());
    const json = JSON.stringify(r.blocks);
    expect(json).toContain("mailto:juniper.tutoring@gmail.com");
    expect(json).not.toContain(HELPER_LINE);
  });

  it("no contact details at all: still placed, no helper line", () => {
    const bare = withField(MINIMAL_INTAKE, "contact_method", {
      phone: "",
      email: "",
    });
    const r = contactSlot.fill(bare, makeEnv());
    expect(r.blocks).toHaveLength(1);
    expect(r.source).toBe("fallback");
    expect(JSON.stringify(r.blocks)).not.toContain(HELPER_LINE);
    expect(() =>
      TEST_SECTIONS.get("columns")!.validate(
        r.blocks[0]!.content,
        r.blocks[0]!.row_layout,
      ),
    ).not.toThrow();
  });
});

describe("closing-cta slot", () => {
  it("phone: CTA banner with the group phrases and Call {phone}", () => {
    const r = closingCtaSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.section_type).toBe("cta-banner");
    expect(r.blocks[0]!.content).toMatchObject({
      heading: "Come and see us",
      description: "Call us with any question, or stop by.",
      button_text: "Call (512) 555-0142",
      button_link: "tel:5125550142",
    });
  });

  it("no phone: left out", () => {
    const r = closingCtaSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toHaveLength(0);
    expect(r.note).toBe("No phone number");
  });
});

describe("registry sweep: all seven Home slots over both fixtures", () => {
  for (const [name, intake] of [
    ["COMPLETE", COMPLETE_INTAKE],
    ["MINIMAL", MINIMAL_INTAKE],
  ] as const) {
    it(`${name}: every block validates, keeps its fields, and leaks nothing`, () => {
      const placed = new Set<string>();
      const all: unknown[] = [];
      let maps = 0;
      for (const slot of HOME_SLOTS) {
        const r = slot.fill(
          intake,
          makeEnv({
            activeAddons: new Set(["fake-proof"]),
            placed: new Set(placed),
            // One page: what is placed so far is also this page's (as fillTemplate passes).
            pagePlaced: new Set(placed),
          }),
        );
        for (const b of r.blocks) {
          const def = TEST_SECTIONS.get(b.section_type);
          expect(def, b.section_type).toBeDefined();
          let validated: unknown;
          expect(() => {
            validated = def!.validate(b.content, b.row_layout);
          }).not.toThrow();
          expect(validated).toMatchObject(b.content as object);
          if (b.section_type === "map") maps++;
          all.push(b);
        }
        if (r.source !== "omitted") placed.add(slot.name);
      }
      expect(maps).toBeLessThanOrEqual(1);
      expect(placed.has("hero")).toBe(true);
      expect(placed.has("contact")).toBe(true);

      const json = JSON.stringify(all);
      expect(json.toLowerCase()).not.toContain("lorem");
      expect(json).not.toContain(HELPER_LINE);
      for (const s of strings(all)) {
        expect(s, s).not.toMatch(/\bundefined\b/);
        expect(s, s).not.toMatch(/\bnull\b/);
        expect(s, s).not.toContain("{");
      }
    });
  }
});
