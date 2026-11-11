// 08-13 Task 1: hero, intro, services and proof slots (TMPL-01, TMPL-02, TMPL-03;
// CONTEXT A1-Q2..Q4, A3-Q5, A4-Q2; D-UI-P8-1..-4, -15, -20).
import { defineAddon, type AddonManifest } from "@cds/core/addons";
import {
  validateHero,
  type ColumnsContent,
  type HeroContent,
} from "@cds/core/content";
import { SLOT_LABELS, type AssemblyIntake } from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import { COMPLETE_INTAKE, MINIMAL_INTAKE } from "../test/fixtures";
import { FAKE_PROOF_MANIFEST, makeEnv, TEST_SECTIONS } from "../test/registry";
import { heroSlot } from "./slots/hero";
import { introSlot } from "./slots/intro";
import { proofSlot } from "./slots/proof";
import { servicesSlot } from "./slots/services";

const HERO = COMPLETE_INTAKE.media.hero!;
const GALLERY = COMPLETE_INTAKE.media.gallery;

function withMedia(
  base: AssemblyIntake,
  media: Partial<AssemblyIntake["media"]>,
): AssemblyIntake {
  return { ...base, media: { ...base.media, ...media } };
}

function withField(
  base: AssemblyIntake,
  id: string,
  value: unknown,
  source: "provided" | "fallback" = "provided",
): AssemblyIntake {
  return { ...base, fields: { ...base.fields, [id]: { value, source } } };
}

function validateAll(
  blocks: readonly {
    section_type: string;
    row_layout: string;
    content: unknown;
  }[],
) {
  return blocks.map((b) => {
    const def = TEST_SECTIONS.get(b.section_type);
    expect(def, b.section_type).toBeDefined();
    return def!.validate(b.content, b.row_layout as never);
  });
}

function items(content: unknown) {
  return (content as ColumnsContent).columns.flatMap((c) => c.items);
}

describe("slot identity", () => {
  it("each slot has its key and the staff label", () => {
    for (const s of [heroSlot, introSlot, servicesSlot, proofSlot]) {
      expect(s.label).toBe(SLOT_LABELS[s.name]);
    }
    expect(heroSlot.name).toBe("hero");
    expect(introSlot.name).toBe("intro");
    expect(servicesSlot.name).toBe("services");
    expect(proofSlot.name).toBe("proof");
  });
});

describe("hero slot", () => {
  it("complete: business name H1, tagline, trust line, photo with intake alt, two buttons", () => {
    const r = heroSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0]!;
    expect(b.section_type).toBe("hero");
    expect(b.row_layout).toBe("full");
    const c = b.content as HeroContent;
    expect(c.heading).toBe("Rivera Bakery");
    expect(c.heading_accent).toBe("");
    expect(c.subtitle).toBe("Baked fresh at dawn");
    expect(c.trust_text).toBe("Serving Austin and Travis County");
    expect(c.image_asset).toBe(HERO.id);
    expect(c.image_alt).toBe("Fresh loaves cooling on the bakery counter");
    expect(c.cta_primary_text).toBe("Get in touch");
    expect(c.cta_primary_link).toBe("/#form-I1");
    expect(c.cta_secondary_text).toBe("Call (512) 555-0142");
    expect(c.cta_secondary_link).toBe("tel:5125550142");
    expect(r.unreviewedAlt ?? []).toEqual([]);
  });

  it("minimal: text-only hero, no call button, fallback note", () => {
    const r = heroSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.source).toBe("fallback");
    expect(r.note).toBe("No main photo: text-only hero");
    const c = r.blocks[0]!.content as HeroContent;
    expect(c.heading).toBe("Juniper Tutoring");
    expect(c.image_asset ?? "").toBe("");
    expect(c.cta_secondary_text ?? "").toBe("");
    expect(c.cta_secondary_link ?? "").toBe("");
    expect(c.trust_text ?? "").toBe("");
    expect(c.cta_primary_link).toBe("/#form-I1");
  });

  it("no business name: H1 'Welcome', Default used with a note (IN-B05)", () => {
    const intake: AssemblyIntake = {
      ...COMPLETE_INTAKE,
      fields: {
        ...COMPLETE_INTAKE.fields,
        org_name: { value: "", source: "fallback" },
      },
    };
    const r = heroSlot.fill(intake, makeEnv());
    expect((r.blocks[0]!.content as HeroContent).heading).toBe("Welcome");
    expect(r.source).toBe("fallback");
    expect(r.note).toBe('No business name: heading "Welcome"');
  });

  it("an undescribed hero photo is left off (text-only hero) and reported by id (WR-B03)", () => {
    const intake = withMedia(COMPLETE_INTAKE, {
      hero: { ...HERO, alt: "", alt_reviewed: false },
    });
    const r = heroSlot.fill(intake, makeEnv());
    expect(r.unreviewedAlt).toEqual([HERO.id]);
    const c = r.blocks[0]!.content as HeroContent;
    expect(c.image_asset ?? "").toBe("");
    expect(c.image_alt ?? "").toBe("");
    expect(r.source).toBe("fallback");
    expect(r.note).toBe("Main photo has no description: text-only hero");
    // The stored block validates (a library photo with no alt would not).
    expect(() => validateHero(c)).not.toThrow();
  });
});

describe("intro slot", () => {
  it("complete: Photo left, text right (40-60) with first gallery photo, excerpt, button", () => {
    const r = introSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0]!;
    expect(b.section_type).toBe("columns");
    expect(b.row_layout).toBe("40-60");
    const cols = (b.content as ColumnsContent).columns;
    const img = cols[0]!.items[0]!;
    expect(img).toMatchObject({
      kind: "image",
      asset: GALLERY[0]!.id,
      alt: "Sourdough loaves with a dark crust",
    });
    const right = cols[1]!.items;
    expect(right.map((i) => i.kind)).toEqual(["heading", "text", "button"]);
    expect(right[0]).toMatchObject({ text: "Bread worth getting up for" });
    expect(right[1]).toMatchObject({
      html: "<p>Rivera Bakery is a family bakery in Austin. Every loaf is shaped by hand and baked before sunrise.</p>",
    });
    expect(right[2]).toMatchObject({
      text: "More about us",
      link: "/about",
      style: "secondary",
    });
    expect(r.unreviewedAlt ?? []).toEqual([]);
  });

  it("no headline: 'About {Business}'", () => {
    const intake = withField(COMPLETE_INTAKE, "headline", null, "fallback");
    const r = introSlot.fill(intake, makeEnv());
    expect(items(r.blocks[0]!.content)[1]).toMatchObject({
      text: "About Rivera Bakery",
    });
  });

  it("no gallery: one full-width block with heading, excerpt and button", () => {
    const r = introSlot.fill(
      withMedia(COMPLETE_INTAKE, { gallery: [] }),
      makeEnv(),
    );
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0]!;
    expect(b.row_layout).toBe("full");
    expect(items(b.content).map((i) => i.kind)).toEqual([
      "heading",
      "text",
      "button",
    ]);
    expect(items(b.content).some((i) => i.kind === "image")).toBe(false);
  });

  it("about fell back: the fallback sentence, Default used", () => {
    const intake = withField(
      COMPLETE_INTAKE,
      "about",
      "Rivera Bakery is a bakery in Austin.",
      "fallback",
    );
    const r = introSlot.fill(intake, makeEnv());
    expect(r.source).toBe("fallback");
    expect(JSON.stringify(r.blocks)).toContain(
      "Rivera Bakery is a bakery in Austin.",
    );
  });

  it("no about text at all: left out", () => {
    const r = introSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toHaveLength(0);
    expect(r.note).toBe("No about text");
  });

  it("first gallery photo with an unreviewed description is reported by id", () => {
    const intake = withMedia(COMPLETE_INTAKE, {
      gallery: GALLERY.map((g, i) =>
        i === 0 ? { ...g, alt_reviewed: false } : g,
      ),
    });
    const r = introSlot.fill(intake, makeEnv());
    expect(r.unreviewedAlt).toEqual([GALLERY[0]!.id]);
  });

  it("a photo with no description is not placed (a column image needs alt); next one is", () => {
    const intake = withMedia(COMPLETE_INTAKE, {
      gallery: GALLERY.map((g, i) =>
        i === 0 ? { ...g, alt: "", alt_reviewed: false } : g,
      ),
    });
    const r = introSlot.fill(intake, makeEnv());
    expect(items(r.blocks[0]!.content)[0]).toMatchObject({
      asset: GALLERY[1]!.id,
      alt: GALLERY[1]!.alt,
    });
    validateAll(r.blocks);
  });

  it("escapes markup in the About answer (T-08-13-01)", () => {
    const intake = withField(
      COMPLETE_INTAKE,
      "about",
      "<script>alert(1)</script> We bake.",
    );
    const r = introSlot.fill(intake, makeEnv());
    const html = JSON.stringify(r.blocks);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("services slot", () => {
  it("complete: cards, limit 6, '3 of 3', phrase-table heading", () => {
    const r = servicesSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("provided");
    expect(r.note).toBe("3 of 3");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.section_type).toBe("services");
    expect(r.blocks[0]!.content).toMatchObject({
      heading: "What we offer",
      display: "cards",
      limit: 6,
    });
  });

  it("one service: list", () => {
    const intake = {
      ...COMPLETE_INTAKE,
      services: COMPLETE_INTAKE.services.slice(0, 1),
    };
    const r = servicesSlot.fill(intake, makeEnv());
    expect(r.blocks[0]!.content).toMatchObject({ display: "list" });
    expect(r.note).toBe("1 of 1");
  });

  it("three without descriptions: list", () => {
    const intake = {
      ...COMPLETE_INTAKE,
      services: COMPLETE_INTAKE.services.map((s) => ({
        ...s,
        description: "",
      })),
    };
    const r = servicesSlot.fill(intake, makeEnv());
    expect(r.blocks[0]!.content).toMatchObject({ display: "list" });
  });

  it("more than six: '6 of N'", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...COMPLETE_INTAKE.services[0]!,
      id: `svcmany${String(i).padStart(8, "0")}`,
      sortOrder: i,
    }));
    const r = servicesSlot.fill(
      { ...COMPLETE_INTAKE, services: many },
      makeEnv(),
    );
    expect(r.note).toBe("6 of 8");
  });

  it("none: left out", () => {
    const r = servicesSlot.fill(MINIMAL_INTAKE, makeEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toHaveLength(0);
    expect(r.note).toBe("No services yet");
  });
});

describe("proof slot", () => {
  it("no active add-on: left out", () => {
    const r = proofSlot.fill(COMPLETE_INTAKE, makeEnv());
    expect(r.source).toBe("omitted");
    expect(r.note).toBe("No add-on installed");
    expect(r.blocks).toHaveLength(0);
  });

  it("active fake-proof: its contribution is placed", () => {
    const r = proofSlot.fill(
      COMPLETE_INTAKE,
      makeEnv({ activeAddons: new Set(["fake-proof"]) }),
    );
    expect(r.source).toBe("provided");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({
      section_type: "fake-proof-block",
      row_layout: "full",
      content: { heading: "Kind words" },
    });
  });

  it("a contribution sees only its own intake slice (invariant 4, WR-B04)", () => {
    let seen: unknown = null;
    const spy: AddonManifest = defineAddon({
      ...FAKE_PROOF_MANIFEST,
      templateSlots: [
        {
          slot: "proof",
          section_type: "fake-proof-block",
          content: (input) => {
            seen = input;
            return { heading: "Kind words" };
          },
        },
      ],
    });
    const intake: AssemblyIntake = {
      ...COMPLETE_INTAKE,
      fields: {
        ...COMPLETE_INTAKE.fields,
        "addon_fake-proof_note": { value: "mine", source: "provided" },
        addon_other_secret: { value: "theirs", source: "provided" },
      },
      addonConfig: {
        "fake-proof": { fields: { a: 1 }, records: [] },
        other: { fields: { secret: "x" }, records: [{ b: 2 }] },
      },
    };
    proofSlot.fill(
      intake,
      makeEnv({
        activeAddons: new Set(["fake-proof"]),
        addons: { list: () => [spy] },
      }),
    );
    const input = seen as Record<string, unknown> & {
      fields: Record<string, unknown>;
    };
    expect(Object.keys(input).sort()).toEqual(
      ["addonConfig", "fields", "orgId", "path"].sort(),
    );
    expect(input.orgId).toBe(COMPLETE_INTAKE.orgId);
    expect(input.addonConfig).toEqual({ fields: { a: 1 }, records: [] });
    expect(input.fields["addon_fake-proof_note"]).toBeDefined();
    expect(input.fields.addon_other_secret).toBeUndefined();
    expect(input.fields.org_name).toBeDefined();
    expect(JSON.stringify(input)).not.toContain("secret");
  });

  it("a contribution that throws or fails validation is dropped with a polish line (WR-B05)", () => {
    const section = FAKE_PROOF_MANIFEST.sections[0]!;
    const broken = (
      content: () => unknown,
      validate = section.validate,
    ): AddonManifest =>
      defineAddon({
        ...FAKE_PROOF_MANIFEST,
        sections: [{ ...section, validate }],
        templateSlots: [
          { slot: "proof", section_type: "fake-proof-block", content },
        ],
      });
    for (const m of [
      broken(() => {
        throw new Error("boom");
      }),
      broken(
        () => ({ heading: "Bad" }),
        () => {
          throw new Error("invalid");
        },
      ),
    ]) {
      const env = makeEnv({
        activeAddons: new Set(["fake-proof"]),
        addons: { list: () => [m, FAKE_PROOF_MANIFEST] },
      });
      const r = proofSlot.fill(COMPLETE_INTAKE, env);
      expect(r.polish).toEqual(["Proof · Fake proof could not be placed"]);
      // The healthy contribution is still placed.
      expect(r.blocks).toHaveLength(1);
      expect(r.source).toBe("provided");
      const alone = proofSlot.fill(
        COMPLETE_INTAKE,
        makeEnv({
          activeAddons: new Set(["fake-proof"]),
          addons: { list: () => [m] },
        }),
      );
      expect(alone.source).toBe("omitted");
      expect(alone.blocks).toHaveLength(0);
      expect(alone.polish).toEqual(["Proof · Fake proof could not be placed"]);
    }
  });

  it("a contribution for another page is skipped", () => {
    const aboutOnly: AddonManifest = defineAddon({
      ...FAKE_PROOF_MANIFEST,
      templateSlots: [
        {
          slot: "proof",
          page: "about",
          section_type: "fake-proof-block",
          content: () => ({ heading: "About only" }),
        },
      ],
    });
    const env = makeEnv({
      activeAddons: new Set(["fake-proof"]),
      addons: { list: () => [aboutOnly] },
    });
    const r = proofSlot.fill(COMPLETE_INTAKE, env);
    expect(r.source).toBe("omitted");
    const onAbout = proofSlot.fill(COMPLETE_INTAKE, {
      ...env,
      pageKey: "about",
    });
    expect(onAbout.blocks).toHaveLength(1);
  });
});

describe("registry validation (hero, intro, services, proof)", () => {
  for (const [name, intake] of [
    ["COMPLETE", COMPLETE_INTAKE],
    ["MINIMAL", MINIMAL_INTAKE],
  ] as const) {
    it(`${name}: every block validates and keeps image fields`, () => {
      const env = makeEnv({ activeAddons: new Set(["fake-proof"]) });
      for (const slot of [heroSlot, introSlot, servicesSlot, proofSlot]) {
        const r = slot.fill(intake, env);
        const validated = validateAll(r.blocks);
        validated.forEach((v, i) => {
          expect(v).toMatchObject(r.blocks[i]!.content as object);
        });
      }
      const hero = heroSlot.fill(intake, env).blocks[0]!;
      const v = TEST_SECTIONS.get("hero")!.validate(
        hero.content,
        "full",
      ) as HeroContent;
      expect(v.image_asset).toBe(
        (hero.content as HeroContent).image_asset ?? "",
      );
      expect(v.image_alt).toBe((hero.content as HeroContent).image_alt ?? "");
    });
  }
});
