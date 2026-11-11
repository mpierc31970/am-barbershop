// readFacts (08-12; ONB-03, CONTEXT A3-Q5, A4-Q2; T-08-12-02).
import { templateCopy, type AssemblyIntake } from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import { readFacts } from "./facts";

const HOURS = {
  mon: { open: false, ranges: [] },
  tue: { open: true, ranges: [{ start: "07:00", end: "15:00" }] },
  wed: { open: false, ranges: [] },
  thu: { open: false, ranges: [] },
  fri: { open: false, ranges: [] },
  sat: { open: false, ranges: [] },
  sun: { open: false, ranges: [] },
};

const p = <T>(value: T) => ({ value, source: "provided" as const });

const service = (id: string, name: string, is_published: boolean) => ({
  id,
  sortOrder: 0,
  name,
  description: "",
  price_display: "ask" as const,
  price_cents: null,
  duration_minutes: null,
  is_published,
});

const member = (id: string, name: string, is_published: boolean) => ({
  id,
  sortOrder: 0,
  photoId: null,
  name,
  role: "Baker",
  bio: "",
  is_published,
});

function intake(): AssemblyIntake {
  return {
    orgId: "org1",
    path: "standard",
    fields: {
      org_name: p("Rivera Bakery"),
      business_type: p("bakery"),
      tagline: p("Baked fresh at dawn"),
      headline: p("Bread worth getting up for"),
      about: p("We bake."),
      mission: p("Good bread."),
      address: p({
        street: "1200 South Congress Ave",
        city: "Austin",
        state: "TX",
        zip: "78704",
      }),
      service_area: p("Austin"),
      contact_method: p({
        phone: "(512) 555-0142",
        email: "hello@riverabakery.test",
      }),
      hours: p(HOURS),
    },
    team: [
      member("t1", "Ana", true),
      member("t2", "Hidden", false),
      member("t3", "Sam", true),
    ],
    services: [
      service("s1", "Cake", true),
      service("s2", "Draft", false),
      service("s3", "Bread box", true),
    ],
    media: {
      logo: { id: "L1", alt: "Rivera Bakery logo", alt_reviewed: true },
      hero: { id: "H1", alt: "Fresh loaves", alt_reviewed: true },
      gallery: [
        { id: "G1", alt: "Counter", alt_reviewed: true },
        { id: "G2", alt: "", alt_reviewed: false },
      ],
    },
    addonConfig: {},
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    moodboardProposal: null,
  };
}

describe("readFacts", () => {
  it("reads a complete-style intake", () => {
    const f = readFacts(intake());
    expect(f.businessName).toBe("Rivera Bakery");
    expect(f.businessTypeId).toBe("bakery");
    expect(f.businessTypeLabel).toBe("Bakery");
    expect(f.copyGroup).toBe("shop");
    expect(f.tagline).toBe("Baked fresh at dawn");
    expect(f.headline).toBe("Bread worth getting up for");
    expect(f.about).toBe("We bake.");
    expect(f.mission).toBe("Good bread.");
    expect(f.city).toBe("Austin");
    expect(f.street).toBe("1200 South Congress Ave");
    expect(f.serviceArea).toBe("Austin");
    expect(f.phone).toBe("(512) 555-0142");
    expect(f.email).toBe("hello@riverabakery.test");
    expect(f.hasHours).toBe(true);
    expect(f.hasAddress).toBe(true);
  });

  it("copies media refs and their alt / alt_reviewed exactly, in order", () => {
    const f = readFacts(intake());
    expect(f.heroAsset).toEqual({
      id: "H1",
      alt: "Fresh loaves",
      alt_reviewed: true,
    });
    expect(f.logoAsset).toEqual({
      id: "L1",
      alt: "Rivera Bakery logo",
      alt_reviewed: true,
    });
    expect(f.galleryAssets).toEqual([
      { id: "G1", alt: "Counter", alt_reviewed: true },
      { id: "G2", alt: "", alt_reviewed: false },
    ]);
  });

  it("drops unpublished services and team members, keeping owner order", () => {
    const f = readFacts(intake());
    expect(f.services.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(f.team.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("reports field sources, fallbacks included", () => {
    const i = intake();
    i.fields.about = {
      value: "Rivera Bakery is a bakery.",
      source: "fallback",
    };
    const f = readFacts(i);
    expect(f.fieldSources.about).toBe("fallback");
    expect(f.fieldSources.org_name).toBe("provided");
    expect(f.about).toBe("Rivera Bakery is a bakery.");
  });

  it("a fallback hours text or address is not real hours / address", () => {
    const i = intake();
    i.fields.hours = { value: "Contact us for hours", source: "fallback" };
    i.fields.address = { value: null, source: "fallback" };
    const f = readFacts(i);
    expect(f.hasHours).toBe(false);
    expect(f.hasAddress).toBe(false);
    expect(f.city).toBe("");
  });

  it("all-closed hours are not hours", () => {
    const i = intake();
    i.fields.hours = p({ ...HOURS, tue: { open: false, ranges: [] } });
    expect(readFacts(i).hasHours).toBe(false);
  });

  it("a business_type fallback (the org name) is not a business type", () => {
    const i = intake();
    i.fields.business_type = { value: "Rivera Bakery", source: "fallback" };
    const f = readFacts(i);
    expect(f.businessTypeId).toBe("");
    expect(f.businessTypeLabel).toBe("");
    expect(f.copyGroup).toBe("other");
  });

  it("an unknown typed business type keeps its own words as the label", () => {
    const i = intake();
    i.fields.business_type = p("Candle maker");
    const f = readFacts(i);
    expect(f.businessTypeId).toBe("Candle maker");
    expect(f.businessTypeLabel).toBe("Candle maker");
    expect(f.copyGroup).toBe("other");
  });

  it('"Something else" (other) has no label, so no "Something else in {city}" (CR-B03)', () => {
    const i = intake();
    i.fields.business_type = p("other");
    const f = readFacts(i);
    expect(f.businessTypeId).toBe("other");
    expect(f.businessTypeLabel).toBe("");
    expect(f.copyGroup).toBe("other");
    expect(templateCopy.heroSubtitle({ ...f, tagline: "" })).not.toMatch(
      /Something else/,
    );
  });

  it("an empty object never throws and yields empty facts", () => {
    const f = readFacts({} as AssemblyIntake);
    expect(f).toMatchObject({
      businessName: "",
      businessTypeId: "",
      businessTypeLabel: "",
      tagline: "",
      headline: "",
      about: "",
      mission: "",
      city: "",
      street: "",
      serviceArea: "",
      phone: "",
      email: "",
      hasHours: false,
      hasAddress: false,
      heroAsset: null,
      logoAsset: null,
      galleryAssets: [],
      services: [],
      team: [],
      fieldSources: {},
    });
  });

  it("wrong-typed values degrade to empty, malformed refs are dropped", () => {
    const bad = {
      fields: {
        org_name: { value: 42, source: "provided" },
        tagline: { value: ["a"], source: "provided" },
        about: { value: { nested: "x" }, source: "provided" },
        address: { value: "1 Main St", source: "provided" },
        contact_method: { value: { phone: 5, email: null }, source: "weird" },
        hours: { value: [], source: "provided" },
        mission: "not an assembled value",
      },
      services: [null, 3, { id: 9, is_published: true }, "x"],
      team: "nope",
      media: {
        logo: { alt: "no id", alt_reviewed: true },
        hero: { id: "H1", alt: 7, alt_reviewed: "yes" },
        gallery: [null, { id: "" }, { id: "G1", alt: "Ok", alt_reviewed: 1 }],
      },
    } as unknown as AssemblyIntake;
    const f = readFacts(bad);
    expect(f.businessName).toBe("");
    expect(f.tagline).toBe("");
    expect(f.about).toBe("");
    expect(f.mission).toBe("");
    expect(f.city).toBe("");
    expect(f.phone).toBe("");
    expect(f.email).toBe("");
    expect(f.hasHours).toBe(false);
    expect(f.hasAddress).toBe(false);
    expect(f.services).toEqual([]);
    expect(f.team).toEqual([]);
    expect(f.logoAsset).toBeNull();
    expect(f.heroAsset).toEqual({ id: "H1", alt: "", alt_reviewed: false });
    expect(f.galleryAssets).toEqual([
      { id: "G1", alt: "Ok", alt_reviewed: false },
    ]);
    expect(f.fieldSources).not.toHaveProperty("contact_method");
    expect(f.fieldSources).not.toHaveProperty("mission");
  });

  it("never reads inherited properties", () => {
    const proto = { fields: { org_name: p("Evil") } };
    const f = readFacts(Object.create(proto) as AssemblyIntake);
    expect(f.businessName).toBe("");
  });
});
