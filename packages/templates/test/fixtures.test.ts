// The P6 seed fixtures and the shared test registry (08-12; TMPL-02, TMPL-03).
import { describe, expect, it } from "vitest";
import { readFacts } from "../src/facts";
import { slotInputFor } from "../src/slots/contributions";
import {
  COMPLETE_INTAKE,
  COMPLETE_WITH_UNREVIEWED_PHOTO,
  MINIMAL_INTAKE,
} from "./fixtures";
import { FAKE_PROOF_MANIFEST, makeEnv, TEST_SECTIONS } from "./registry";

describe("COMPLETE_INTAKE (seedCompleteIntake)", () => {
  const f = readFacts(COMPLETE_INTAKE);

  it("reads every core fact", () => {
    expect(f.businessName).toBe("Rivera Bakery");
    expect(f.businessTypeId).toBe("bakery");
    expect(f.businessTypeLabel).toBe("Bakery");
    expect(f.city).toBe("Austin");
    expect(f.phone).toBe("(512) 555-0142");
    expect(f.email).toBe("hello@riverabakery.test");
    expect(f.hasHours).toBe(true);
    expect(f.hasAddress).toBe(true);
    expect(f.services).toHaveLength(3);
    expect(f.team).toHaveLength(2);
  });

  it("every field is provided", () => {
    expect(
      Object.entries(COMPLETE_INTAKE.fields)
        .filter(([, v]) => v.source !== "provided")
        .map(([k]) => k),
    ).toEqual([]);
  });

  it("carries the seed's own photo descriptions", () => {
    expect(f.heroAsset).toEqual({
      id: COMPLETE_INTAKE.media.hero!.id,
      alt: "Fresh loaves cooling on the bakery counter",
      alt_reviewed: true,
    });
    expect(f.logoAsset?.alt).toBe("Rivera Bakery logo");
    expect(f.galleryAssets.map((g) => g.alt)).toEqual([
      "Sourdough loaves with a dark crust",
      "A three-tier celebration cake",
      "The bakery front on South Congress",
    ]);
    expect(f.galleryAssets.every((g) => g.alt_reviewed)).toBe(true);
  });
});

describe("COMPLETE_WITH_UNREVIEWED_PHOTO", () => {
  it("clears only the second gallery photo's description", () => {
    const f = readFacts(COMPLETE_WITH_UNREVIEWED_PHOTO);
    expect(f.galleryAssets[1]).toEqual({
      id: COMPLETE_INTAKE.media.gallery[1]!.id,
      alt: "",
      alt_reviewed: false,
    });
    expect(f.galleryAssets[0]!.alt_reviewed).toBe(true);
    expect(f.heroAsset?.alt_reviewed).toBe(true);
    // The base fixture is untouched.
    expect(COMPLETE_INTAKE.media.gallery[1]!.alt_reviewed).toBe(true);
  });
});

describe("MINIMAL_INTAKE (seedMinimalIntake)", () => {
  it("required fields only, everything else a fallback", () => {
    const f = readFacts(MINIMAL_INTAKE);
    expect(f.businessName).toBe("Juniper Tutoring");
    expect(f.email).toBe("juniper.tutoring@gmail.com");
    expect(f.businessTypeId).toBe("");
    expect(f.heroAsset).toBeNull();
    expect(f.logoAsset).toBeNull();
    expect(f.galleryAssets).toEqual([]);
    expect(f.services).toEqual([]);
    expect(f.team).toEqual([]);
    expect(f.hasHours).toBe(false);
    expect(f.hasAddress).toBe(false);
    for (const id of ["org_name", "path", "time_zone", "contact_method"]) {
      expect(f.fieldSources[id], id).toBe("provided");
    }
    for (const id of ["logo", "about", "hero", "hours", "team", "services"]) {
      expect(f.fieldSources[id], id).toBe("fallback");
    }
  });
});

describe("test registry and env", () => {
  it("composes real core sections with the fake add-on section", () => {
    for (const t of ["services", "team", "hero", "fake-proof-block"]) {
      expect(TEST_SECTIONS.get(t), t).toBeDefined();
    }
    expect(
      TEST_SECTIONS.get("fake-proof-block")!.validate(
        { heading: " Kind words ", evil: 1 },
        "full",
      ),
    ).toEqual({ heading: "Kind words" });
  });

  it("makeEnv gives a SlotEnv over the fake manifest", () => {
    const env = makeEnv();
    expect(env.addons.list()).toContain(FAKE_PROOF_MANIFEST);
    expect(env.refs.contactFormId).toBe("F1");
    expect(env.refs.contactFormItemId).toBe("I1");
    expect(env.pageKey).toBe("home");
    expect(env.placed.size).toBe(0);
    expect(env.activeAddons.size).toBe(0);
    expect(env.copy.introHeading(readFacts(COMPLETE_INTAKE))).not.toBe("");
  });

  it("makeEnv applies overrides", () => {
    const env = makeEnv({
      pageKey: "about",
      activeAddons: new Set(["fake-proof"]),
    });
    expect(env.pageKey).toBe("about");
    expect(env.activeAddons.has("fake-proof")).toBe(true);
  });

  it("the fake manifest contributes the proof slot", () => {
    const [slot] = FAKE_PROOF_MANIFEST.templateSlots!;
    expect(slot!.slot).toBe("proof");
    expect(slot!.section_type).toBe("fake-proof-block");
    expect(slot!.content(slotInputFor(COMPLETE_INTAKE, "fake-proof"))).toEqual({
      heading: "Kind words",
    });
  });
});
