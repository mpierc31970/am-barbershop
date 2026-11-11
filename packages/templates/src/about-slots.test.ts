// 08-14 Task 1: the About-only slots (about, team, gallery, faq) and the slot barrel
// (TMPL-01, TMPL-02; CONTEXT A3-Q2, A3-Q5, A4-Q2; D-UI-P8-11, -21, -22).
import type { AddonManifest } from "@cds/core/addons";
import type { FaqBlockContent, GalleryContent } from "@cds/core/content";
import {
  SLOT_LABELS,
  type AssemblyIntake,
  type AssemblyTeamMember,
} from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import {
  COMPLETE_INTAKE,
  COMPLETE_WITH_UNREVIEWED_PHOTO,
  MINIMAL_INTAKE,
} from "../test/fixtures";
import { FAKE_PROOF_MANIFEST, makeEnv, TEST_SECTIONS } from "../test/registry";
import { aboutSlot } from "./slots/about";
import { faqSlot } from "./slots/faq";
import { gallerySlot } from "./slots/gallery";
import { ALL_SLOTS } from "./slots/index";
import { teamSlot } from "./slots/team";

const aboutEnv = (o: Parameters<typeof makeEnv>[0] = {}) =>
  makeEnv({ pageKey: "about", ...o });

function withField(
  base: AssemblyIntake,
  id: string,
  value: unknown,
  source: "provided" | "fallback" = "provided",
): AssemblyIntake {
  return { ...base, fields: { ...base.fields, [id]: { value, source } } };
}

const ABOUT_CONTRIB: AddonManifest = {
  ...FAKE_PROOF_MANIFEST,
  slug: "fake-about",
  name: "Fake about",
  templateSlots: [
    {
      slot: "about",
      page: "about",
      section_type: "fake-proof-block",
      content: () => ({ heading: "Our credentials" }),
    },
  ],
};

function validates(
  blocks: readonly {
    section_type: string;
    row_layout: string;
    content: unknown;
  }[],
) {
  for (const b of blocks) {
    const def = TEST_SECTIONS.get(b.section_type);
    expect(def, b.section_type).toBeDefined();
    expect(() => def!.validate(b.content, b.row_layout as never)).not.toThrow();
  }
}

describe("about slot", () => {
  it("complete with mission: About text (no heading) then 'Our mission'", () => {
    const r = aboutSlot.fill(COMPLETE_INTAKE, aboutEnv());
    expect(r.source).toBe("provided");
    expect(r.blocks.map((b) => b.section_type)).toEqual([
      "text-only",
      "text-only",
    ]);
    expect(r.blocks[0]!.content).toMatchObject({
      heading: "",
      text: "<p>Rivera Bakery is a family bakery in Austin. Every loaf is shaped by hand and baked before sunrise.</p>",
    });
    expect(r.blocks[1]!.content).toMatchObject({
      heading: "Our mission",
      text: "<p>Good bread, made slowly, for the whole neighborhood.</p>",
    });
    validates(r.blocks);
  });

  it("escapes markup in About text", () => {
    const r = aboutSlot.fill(
      withField(COMPLETE_INTAKE, "about", "<script>x</script> & co"),
      aboutEnv(),
    );
    const text = (r.blocks[0]!.content as { text: string }).text;
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("no mission: one block", () => {
    const r = aboutSlot.fill(
      withField(COMPLETE_INTAKE, "mission", null, "fallback"),
      aboutEnv(),
    );
    expect(r.blocks).toHaveLength(1);
  });

  it("About from the business-type sentence: Default used", () => {
    const intake = withField(
      withField(MINIMAL_INTAKE, "business_type", "tutor"),
      "about",
      "Juniper Tutoring is a tutor.",
      "fallback",
    );
    const r = aboutSlot.fill(intake, aboutEnv());
    expect(r.source).toBe("fallback");
    expect(r.note).toBe("No About answer: sentence from the business type");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.content).toMatchObject({
      heading: "",
      text: "<p>Juniper Tutoring is a tutor.</p>",
    });
  });

  it("minimal (no About text, no type sentence): left out", () => {
    const r = aboutSlot.fill(MINIMAL_INTAKE, aboutEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toEqual([]);
  });

  it("an active about contributor follows the text blocks; proof-only does not", () => {
    const env = aboutEnv({
      addons: { list: () => [FAKE_PROOF_MANIFEST, ABOUT_CONTRIB] },
      activeAddons: new Set(["fake-proof", "fake-about"]),
    });
    const r = aboutSlot.fill(COMPLETE_INTAKE, env);
    expect(r.blocks.map((b) => b.section_type)).toEqual([
      "text-only",
      "text-only",
      "fake-proof-block",
    ]);
    expect(r.blocks[2]!.content).toEqual({ heading: "Our credentials" });
    validates(r.blocks);
  });

  it("an inactive contributor is not placed", () => {
    const env = aboutEnv({
      addons: { list: () => [ABOUT_CONTRIB] },
    });
    expect(aboutSlot.fill(COMPLETE_INTAKE, env).blocks).toHaveLength(2);
  });
});

describe("team slot", () => {
  it("two published: 'Our team', note 2", () => {
    const r = teamSlot.fill(COMPLETE_INTAKE, aboutEnv());
    expect(r.source).toBe("provided");
    expect(r.note).toBe("2");
    expect(r.blocks).toEqual([
      {
        section_type: "team",
        row_layout: "full",
        content: { heading: "Our team", show_roles: true, show_bios: true },
      },
    ]);
    validates(r.blocks);
  });

  it("one published: 'Meet {name}'", () => {
    const one: AssemblyTeamMember[] = [
      { ...COMPLETE_INTAKE.team[0]!, name: "Jo Rivera" },
      { ...COMPLETE_INTAKE.team[1]!, is_published: false },
    ];
    const r = teamSlot.fill({ ...COMPLETE_INTAKE, team: one }, aboutEnv());
    expect(r.note).toBe("1");
    expect(r.blocks[0]!.content).toMatchObject({ heading: "Meet Jo Rivera" });
  });

  it("one published member with a malformed name never throws: 'Our team' (WR-B02)", () => {
    for (const name of [undefined, null, 42, {}]) {
      const one = [
        { ...COMPLETE_INTAKE.team[0]!, name },
      ] as unknown as AssemblyTeamMember[];
      const r = teamSlot.fill({ ...COMPLETE_INTAKE, team: one }, aboutEnv());
      expect(r.source).toBe("provided");
      expect(r.blocks[0]!.content).toMatchObject({ heading: "Our team" });
    }
  });

  it("none published: left out", () => {
    const r = teamSlot.fill(MINIMAL_INTAKE, aboutEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toEqual([]);
  });
});

describe("gallery slot", () => {
  it("one photo: the note says '1 photo' (IN-B06)", () => {
    const one = {
      ...COMPLETE_INTAKE,
      media: {
        ...COMPLETE_INTAKE.media,
        gallery: COMPLETE_INTAKE.media.gallery.slice(0, 1),
      },
    };
    expect(gallerySlot.fill(one, aboutEnv()).note).toBe("1 photo");
  });

  it("complete: one mosaic gallery with the refs' alt, in order", () => {
    const r = gallerySlot.fill(COMPLETE_INTAKE, aboutEnv());
    expect(r.source).toBe("provided");
    expect(r.note).toBe("3 photos");
    expect(r.blocks).toHaveLength(1);
    const c = r.blocks[0]!.content as GalleryContent;
    expect(r.blocks[0]!.section_type).toBe("gallery");
    expect(c).toMatchObject({
      display: "mosaic",
      heading: "Our work",
      per_page: 12,
      lightbox: true,
    });
    expect(c.images.map((i) => i.asset)).toEqual(
      COMPLETE_INTAKE.media.gallery.map((g) => g.id),
    );
    c.images.forEach((img, i) => {
      const ref = COMPLETE_INTAKE.media.gallery[i]!;
      expect(img.alt).toBe(ref.alt);
      expect(img.alt_reviewed).toBe(ref.alt_reviewed);
      expect(img.caption).toBe("");
      expect(img.id).not.toBe("");
    });
    expect(new Set(c.images.map((i) => i.id)).size).toBe(3);
    expect(r.unreviewedAlt ?? []).toEqual([]);
    expect(r.polish ?? []).toEqual([]);
    validates(r.blocks);
  });

  it("an unreviewed photo keeps alt_reviewed false and is reported by id", () => {
    const r = gallerySlot.fill(COMPLETE_WITH_UNREVIEWED_PHOTO, aboutEnv());
    const c = r.blocks[0]!.content as GalleryContent;
    expect(c.images[1]!.alt_reviewed).toBe(false);
    expect(r.unreviewedAlt).toEqual(["mediarvgall0002"]);
    expect(r.polish ?? []).toEqual([]);
    validates(r.blocks);
  });

  it("minimal: left out", () => {
    const r = gallerySlot.fill(MINIMAL_INTAKE, aboutEnv());
    expect(r.source).toBe("omitted");
    expect(r.blocks).toEqual([]);
  });
});

describe("faq slot", () => {
  const answers = (r: ReturnType<typeof faqSlot.fill>) =>
    (r.blocks[0]!.content as FaqBlockContent).items.map((i) => [
      i.question,
      i.answer,
    ]);

  it("bakery with phone, address and Services placed: all three answered", () => {
    const r = faqSlot.fill(
      COMPLETE_INTAKE,
      aboutEnv({ placed: new Set(["services"]) }),
    );
    expect(r.source).toBe("provided");
    expect(answers(r)).toEqual([
      [
        "How do I book?",
        "<p>Call us at (512) 555-0142, or send a message with the form below.</p>",
      ],
      [
        "Where are you?",
        "<p>We&#39;re at 1200 South Congress Ave, Austin.</p>",
      ],
      [
        "What does it cost?",
        "<p>Our prices are listed under Services on our home page.</p>",
      ],
    ]);
    expect(r.polish ?? []).toEqual([]);
    validates(r.blocks);
  });

  it("no Services placed: prices unanswered and reported", () => {
    const r = faqSlot.fill(COMPLETE_INTAKE, aboutEnv());
    expect(answers(r)[2]![1]).toBe("");
    expect(r.polish).toEqual([
      "Questions and answers · 1 of 3 need answers; they stay hidden until answered",
    ]);
  });

  it("minimal (email only): booking answered from the form line, the rest empty", () => {
    const r = faqSlot.fill(MINIMAL_INTAKE, aboutEnv());
    expect(r.source).toBe("provided");
    expect(answers(r)).toEqual([
      [
        "How do I book?",
        "<p>Send us a message with the form below and we&#39;ll get back to you.</p>",
      ],
      ["Where are you?", ""],
      ["What does it cost?", ""],
    ]);
    expect(r.polish).toEqual([
      "Questions and answers · 2 of 3 need answers; they stay hidden until answered",
    ]);
    validates(r.blocks);
  });
});

describe("slot barrel", () => {
  it("ALL_SLOTS holds all 11 slots keyed by name", () => {
    const keys = Object.keys(ALL_SLOTS);
    expect(keys.sort()).toEqual(Object.keys(SLOT_LABELS).sort());
    expect(keys).toHaveLength(11);
    for (const [k, s] of Object.entries(ALL_SLOTS)) {
      expect(s.name).toBe(k);
      expect(s.label).toBe(SLOT_LABELS[k]);
    }
  });
});
