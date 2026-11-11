// ONB-02, D312, D-UI-P6-17, PD-24: "what's still needed", stage status and progress are one
// pure function family over an IntakeSnapshot.
import { describe, expect, it } from "vitest";
import type { AddonManifest, AddonRegistry } from "../addons/types";
import {
  addonIntakeFields,
  emptyWeeklyHours,
  fallbackText,
  setupProgress,
  stageStatus,
  stillNeeded,
  type IntakeSnapshot,
} from "./index";

function snapshot(over: Partial<IntakeSnapshot> = {}): IntakeSnapshot {
  return {
    orgName: "Rivera Bakery",
    path: "standard",
    profile: {
      tagline: "",
      business_type: "",
      business_type_other: "",
      description: "",
      phone: "",
      public_email: "maria@gmail.com",
      address: { street: "", city: "", state: "", zip: "" },
      service_area: "",
      time_zone: "America/Chicago",
      hours: null,
      socials: [],
      about: "",
      mission: "",
      headline: "",
      font_pairing: "",
      ga4_id: "",
      legal_name: "",
      privacy_contact: "",
      legal_region: "",
    },
    answers: {
      domain_choice: "later",
      domain: "",
      registrar: "",
      domain_ideas: "",
      gbp: "",
    },
    counts: { services: 0, team: 0, gallery: 0, moodboard: 0 },
    media: { logo: false, hero: false, photosMissingAlt: 0 },
    email: { defaultConfirmed: true, bouncing: 0 },
    addonIntake: {},
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    stagesSaved: [],
    ...over,
  };
}

const ids = (items: { fieldId: string }[]) => items.map((i) => i.fieldId);

describe("stillNeeded (ONB-02)", () => {
  it("an almost-empty snapshot has no required gaps and lists the optional fallbacks", () => {
    const { required, optional } = stillNeeded(snapshot());
    expect(required).toEqual([]);
    for (const id of [
      "tagline",
      "logo",
      "hours",
      "about",
      "services",
      "team",
      "hero",
      "moodboard",
      "domain_choice",
    ]) {
      expect(ids(optional), id).toContain(id);
    }
    for (const item of optional) {
      expect(item.ownerText?.length, item.fieldId).toBeGreaterThan(0);
    }
  });

  it("missing contact method and time zone are required", () => {
    const s = snapshot();
    const { required } = stillNeeded({
      ...s,
      profile: { ...s.profile, public_email: "", time_zone: "" },
    });
    expect(ids(required)).toEqual(["contact_method", "time_zone"]);
    expect(required[0]!.href).toBe("/hub/setup/contact#field-contact_method");
    expect(required[0]!.stage).toBe("contact");
  });

  it("a phone alone meets the contact requirement", () => {
    const s = snapshot();
    const { required } = stillNeeded({
      ...s,
      profile: { ...s.profile, public_email: "", phone: "512 555 0100" },
    });
    expect(ids(required)).not.toContain("contact_method");
  });

  it("a saved photo without a description is required (D280)", () => {
    const { required } = stillNeeded(
      snapshot({ media: { logo: false, hero: true, photosMissingAlt: 1 } }),
    );
    expect(ids(required)).toContain("photo_descriptions");
  });

  it("a bouncing email route is required (D173)", () => {
    const { required } = stillNeeded(
      snapshot({ email: { defaultConfirmed: true, bouncing: 1 } }),
    );
    expect(ids(required)).toContain("email_delivery");
  });

  it("filled items leave the optional list", () => {
    const s = snapshot();
    const { optional } = stillNeeded({
      ...s,
      profile: { ...s.profile, tagline: "Sourdough baked daily" },
      media: { logo: true, hero: true, photosMissingAlt: 0 },
      counts: { services: 3, team: 0, gallery: 0, moodboard: 1 },
    });
    for (const id of ["tagline", "logo", "hero", "services", "moodboard"]) {
      expect(ids(optional)).not.toContain(id);
    }
  });

  it("hours count as provided only when a day is open", () => {
    const s = snapshot();
    const closed = stillNeeded({
      ...s,
      profile: { ...s.profile, hours: emptyWeeklyHours() },
    });
    expect(ids(closed.optional)).toContain("hours");
    const hours = emptyWeeklyHours();
    hours.mon = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
    const open = stillNeeded({ ...s, profile: { ...s.profile, hours } });
    expect(ids(open.optional)).not.toContain("hours");
  });
});

describe("stageStatus and setupProgress (D-UI-P6-17, D312)", () => {
  it("a stage never saved is not_started", () => {
    expect(stageStatus(snapshot(), "business").status).toBe("not_started");
  });

  it("a saved stage with a required gap is started", () => {
    const s = snapshot({ stagesSaved: ["contact"] });
    const r = stageStatus(
      { ...s, profile: { ...s.profile, time_zone: "" } },
      "contact",
    );
    expect(r.status).toBe("started");
    expect(r.required).toBe(1);
  });

  it("a saved stage with only optional gaps is done and counts them", () => {
    const s = snapshot({
      stagesSaved: ["people"],
      counts: { services: 0, team: 0, gallery: 0, moodboard: 0 },
    });
    // people has team only; add one add-on records field for a second optional gap
    const extra = addonIntakeFields(registry(), {
      ...s.selections,
      addons: ["testimonials"],
    });
    const r = stageStatus(s, "people", extra);
    expect(r).toEqual({ status: "done", required: 0, optional: 2 });
  });

  it("setupProgress counts done stages out of 7", () => {
    const s = snapshot({ stagesSaved: ["business", "contact", "email"] });
    expect(setupProgress(s)).toEqual({ done: 3, total: 7 });
    expect(
      setupProgress({ ...s, email: { defaultConfirmed: true, bouncing: 2 } }),
    ).toEqual({ done: 2, total: 7 });
  });
});

function registry(): AddonRegistry {
  const testimonials = {
    slug: "testimonials",
    name: "Testimonials",
    intake: {
      records: {
        collection: "testimonials",
        csv: "testimonials",
        label: "Paste or import your testimonials",
        addOneLabel: "Add one by one",
      },
    },
  } as unknown as AddonManifest;
  const plain = { slug: "plain", name: "Plain" } as unknown as AddonManifest;
  const all = [testimonials, plain];
  return {
    get: (slug: unknown) => all.find((m) => m.slug === slug),
    list: () => all,
  } as unknown as AddonRegistry;
}

describe("addonIntakeFields (CONTEXT A3-Q5)", () => {
  it("adds one optional people field per selected add-on with an intake records step", () => {
    const fields = addonIntakeFields(registry(), {
      addons: ["testimonials", "plain", "missing"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    });
    expect(fields.map((f) => f.id)).toEqual(["addon_testimonials_records"]);
    const f = fields[0]!;
    expect(f.stage).toBe("people");
    expect(f.required).not.toBe(true);
    expect("fallback" in f && f.fallback.rule).toBe("no-section");
    expect(f.present(snapshot())).toBe(false);
    expect(
      f.present(
        snapshot({ addonIntake: { testimonials: { records: 4, fields: {} } } }),
      ),
    ).toBe(true);
  });
});

describe("fallbackText", () => {
  it("about-from-type builds from the business type seed, name and city", () => {
    const s = snapshot();
    const text = fallbackText("about-from-type", {
      ...s,
      profile: {
        ...s.profile,
        business_type: "bakery",
        address: { street: "", city: "Austin", state: "TX", zip: "" },
      },
    });
    expect(text).toBe("Rivera Bakery is a family bakery in Austin.");
  });

  it("omit gives null; business-name and contact-for-hours give text", () => {
    expect(fallbackText("omit", snapshot())).toBeNull();
    expect(fallbackText("business-name", snapshot())).toBe("Rivera Bakery");
    expect(fallbackText("contact-for-hours", snapshot())).toBe(
      "Contact us for hours",
    );
  });
});
