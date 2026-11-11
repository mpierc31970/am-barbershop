// 08-14 Task 2: the `standard-v1` template, TEMPLATES / templateFor, and the full-template run
// over both fixtures (TMPL-01..03; CONTEXT A1-Q1, A1-Q5, A3-Q1/Q2, A4-Q2; D-UI-P8-5, -12, -21).
import {
  assertTemplateShape,
  assignBands,
  photoPolishLine,
  type AssemblyIntake,
  type SiteTemplate,
  type SlotResult,
} from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import { COMPLETE_INTAKE, MINIMAL_INTAKE } from "../test/fixtures";
import { makeEnv, TEST_SECTIONS } from "../test/registry";
import { STANDARD_V1, TEMPLATES, templateFor } from "./index";

const HOME_ORDER = [
  "hero",
  "intro",
  "services",
  "proof",
  "hours-location",
  "contact",
  "closing-cta",
];
const ABOUT_ORDER = ["about", "team", "gallery", "faq", "contact"];

type PageRun = {
  key: string;
  results: (SlotResult & { slot: string })[];
};

/**
 * What the orchestrator (08-16) does: pages in order, slots in order; `placed` grows across
 * the whole site (About's FAQ sees Home's Services), `pagePlaced` only within the page
 * (one map per page).
 */
function run(t: SiteTemplate, intake: AssemblyIntake): PageRun[] {
  const sitePlaced = new Set<string>();
  const out: PageRun[] = [];
  for (const page of t.pages) {
    const pagePlaced = new Set<string>();
    const results: PageRun["results"] = [];
    for (const slot of page.slots) {
      const r = slot.fill(
        intake,
        makeEnv({
          templateId: t.id,
          pageKey: page.key,
          placed: new Set(sitePlaced),
          pagePlaced: new Set(pagePlaced),
        }),
      );
      results.push({ ...r, slot: slot.name });
      if (r.blocks.length > 0) {
        sitePlaced.add(slot.name);
        pagePlaced.add(slot.name);
      }
    }
    out.push({ key: page.key, results });
  }
  return out;
}

const placedOf = (p: PageRun) =>
  p.results.filter((r) => r.blocks.length > 0).map((r) => r.slot);

/** Every string value anywhere in a block tree. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object")
    for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe("TEMPLATES and templateFor", () => {
  it("ships exactly one template, standard-v1, and every entry passes the shape check", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["standard-v1"]);
    expect(Object.isFrozen(TEMPLATES)).toBe(true);
    for (const t of TEMPLATES)
      expect(() => assertTemplateShape(t)).not.toThrow();
  });

  it("standard-v1: version 1, standard + studio, Home then About in the fixed slot orders", () => {
    expect(STANDARD_V1).toMatchObject({
      id: "standard-v1",
      version: 1,
      label: "Standard",
      paths: ["standard", "studio"],
    });
    expect(STANDARD_V1.pages.map((p) => p.key)).toEqual(["home", "about"]);
    const [home, about] = STANDARD_V1.pages;
    expect(home!.slots.map((s) => s.name)).toEqual(HOME_ORDER);
    expect(about!.slots.map((s) => s.name)).toEqual(ABOUT_ORDER);
    expect(home).toMatchObject({ slug: "home", navLabel: "Home", inNav: true });
    expect(about).toMatchObject({
      slug: "about",
      navLabel: "About",
      inNav: true,
    });
  });

  it("page titles", () => {
    const [home, about] = STANDARD_V1.pages;
    expect(home!.title(COMPLETE_INTAKE)).toBe("Home");
    expect(about!.title(COMPLETE_INTAKE)).toBe("About Rivera Bakery");
    expect(about!.title(MINIMAL_INTAKE)).toBe("About Juniper Tutoring");
    const noName: AssemblyIntake = {
      ...MINIMAL_INTAKE,
      fields: {
        ...MINIMAL_INTAKE.fields,
        org_name: { value: "", source: "provided" },
      },
    };
    expect(about!.title(noName)).toBe("About us");
  });

  it("selects by path; Shop has no template in v1.0", () => {
    expect(templateFor("standard")).toBe(STANDARD_V1);
    expect(templateFor("studio")).toBe(STANDARD_V1);
    expect(templateFor("shop")).toBeUndefined();
    expect(templateFor("x")).toBeUndefined();
  });
});

describe.each([
  ["COMPLETE", COMPLETE_INTAKE],
  ["MINIMAL", MINIMAL_INTAKE],
] as const)("full run: %s", (name, intake) => {
  const pages = run(STANDARD_V1, intake);
  const [home, about] = pages;

  it("every block validates against the composed registry", () => {
    for (const p of pages) {
      for (const r of p.results) {
        for (const b of r.blocks) {
          const def = TEST_SECTIONS.get(b.section_type);
          expect(def, `${p.key}/${r.slot}/${b.section_type}`).toBeDefined();
          let validated: unknown;
          expect(() => {
            validated = def!.validate(b.content, b.row_layout);
          }).not.toThrow();
          expect(validated).toMatchObject(b.content as object);
        }
      }
    }
  });

  it("Home has exactly one hero, About none; one map per page at most", () => {
    const types = (p: PageRun) =>
      p.results.flatMap((r) => r.blocks.map((b) => b.section_type));
    expect(types(home!).filter((t) => t === "hero")).toHaveLength(1);
    expect(types(about!).filter((t) => t === "hero")).toHaveLength(0);
    for (const p of pages) {
      expect(types(p).filter((t) => t === "map").length).toBeLessThanOrEqual(1);
    }
  });

  it("bands: Home hero alternate then main/alternate; About starts alternate", () => {
    const homeBands = assignBands(home!.results, { hasHero: true });
    expect(homeBands[0]).toMatchObject({ slot: "hero", band: "alternate" });
    homeBands.slice(1).forEach((b, i) => {
      expect(b.band).toBe(i % 2 === 0 ? "main" : "alternate");
    });
    const aboutBands = assignBands(about!.results, { hasHero: false });
    aboutBands.forEach((b, i) => {
      expect(b.band).toBe(i % 2 === 0 ? "alternate" : "main");
    });
  });

  it("no placeholder text leaks", () => {
    const all = strings(pages.flatMap((p) => p.results.map((r) => r.blocks)));
    for (const s of all) {
      expect(s.toLowerCase(), name).not.toContain("lorem");
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("Add your address and phone in Settings");
      expect(s).not.toContain("{");
    }
  });

  it("placed slots", () => {
    if (name === "COMPLETE") {
      expect(placedOf(home!)).toEqual([
        "hero",
        "intro",
        "services",
        "hours-location",
        "contact",
        "closing-cta",
      ]);
      expect(placedOf(about!)).toEqual(ABOUT_ORDER);
    } else {
      // MINIMAL: no phone, address, hours, About, services, team or photos.
      expect(placedOf(home!)).toEqual(["hero", "contact"]);
      expect(placedOf(about!)).toEqual(["faq", "contact"]);
    }
  });
});

describe("full run: details", () => {
  it("COMPLETE About contact keeps its map (Home's map is on another page)", () => {
    const [, about] = run(STANDARD_V1, COMPLETE_INTAKE);
    const contact = about!.results.find((r) => r.slot === "contact")!;
    expect(contact.blocks.map((b) => b.section_type)).toEqual([
      "columns",
      "map",
    ]);
  });

  it("COMPLETE About FAQ answers prices because Home placed Services", () => {
    const [, about] = run(STANDARD_V1, COMPLETE_INTAKE);
    const faq = about!.results.find((r) => r.slot === "faq")!;
    expect(faq.polish ?? []).toEqual([]);
  });

  it("photo polish is counted once per asset across Home and About", () => {
    const first = COMPLETE_INTAKE.media.gallery[0]!;
    const intake: AssemblyIntake = {
      ...COMPLETE_INTAKE,
      media: {
        ...COMPLETE_INTAKE.media,
        gallery: COMPLETE_INTAKE.media.gallery.map((g, i) =>
          i === 0 ? { ...g, alt_reviewed: false } : g,
        ),
      },
    };
    const pages = run(STANDARD_V1, intake);
    const ids = pages.flatMap((p) =>
      p.results.flatMap((r) => [...(r.unreviewedAlt ?? [])]),
    );
    // Placed twice: Home intro and About gallery.
    expect(ids.filter((id) => id === first.id)).toHaveLength(2);
    expect(photoPolishLine(ids)).toBe("Photos · 1 need a reviewed description");
    for (const p of pages) {
      for (const r of p.results) {
        for (const line of r.polish ?? []) {
          expect(line).not.toContain("need a reviewed description");
        }
      }
    }
  });
});
