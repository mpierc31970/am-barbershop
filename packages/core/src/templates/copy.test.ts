// P8 (08-06): the free CopyWriter stand-in (CONTEXT A3-Q4; D-UI-P8-3, -10, -11, -12).
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES } from "../onboarding";
import { faqStartersFor } from "../content/presets";
import { COPY_PHRASES, copyGroupOf, templateCopy } from "./copy";
import type { AssemblyFacts } from "./types";

function facts(over: Partial<AssemblyFacts> = {}): AssemblyFacts {
  return {
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
    ...over,
  };
}

const NONE: ReadonlySet<string> = new Set();
const WITH_SERVICES: ReadonlySet<string> = new Set(["services"]);

describe("copyGroupOf", () => {
  it("reads the business type's copyGroup; unknown types fall back to other", () => {
    expect(copyGroupOf("bakery")).toBe("shop");
    expect(copyGroupOf("hair-salon")).toBe("studio");
    expect(copyGroupOf("nope")).toBe("other");
    expect(copyGroupOf("")).toBe("other");
  });
});

describe("templateCopy.servicesHeading", () => {
  const cases: [string, string][] = [
    ["therapist", "How we can help"],
    ["bakery", "What we offer"],
    ["cleaning-service", "Services"],
    ["hair-salon", "Services and prices"],
    ["nonprofit", "What we do"],
    ["other", "Services"],
    ["unknown-type", "Services"],
  ];
  it.each(cases)("%s -> %s", (id, heading) => {
    expect(templateCopy.servicesHeading(facts({ businessTypeId: id }))).toBe(
      heading,
    );
  });
});

describe("templateCopy.closingCta", () => {
  const cases: [string, string, string][] = [
    [
      "therapist",
      "Ready to talk?",
      "Call us, or send a message, and we'll find a time that suits you.",
    ],
    ["bakery", "Come and see us", "Call us with any question, or stop by."],
    [
      "home-services",
      "Tell us what you need",
      "Call us and we'll talk it through.",
    ],
    [
      "yoga-studio",
      "Ready for your next visit?",
      "Call us to book your visit.",
    ],
    [
      "event-host",
      "Get involved",
      "Call us to find out how you can take part.",
    ],
    ["other", "Get in touch", "Call us with any question."],
  ];
  it.each(cases)("%s", (id, heading, line) => {
    expect(templateCopy.closingCta(facts({ businessTypeId: id }))).toEqual({
      heading,
      line,
    });
  });
});

describe("templateCopy.heroSubtitle", () => {
  it("uses the tagline when given", () => {
    expect(
      templateCopy.heroSubtitle(
        facts({ tagline: "Fresh bread daily", businessTypeLabel: "Bakery" }),
      ),
    ).toBe("Fresh bread daily");
  });
  it("else '{type label} in {city}', else the label alone", () => {
    expect(
      templateCopy.heroSubtitle(
        facts({ businessTypeLabel: "Bakery", city: "Austin" }),
      ),
    ).toBe("Bakery in Austin");
    expect(
      templateCopy.heroSubtitle(facts({ businessTypeLabel: "Bakery" })),
    ).toBe("Bakery");
    expect(templateCopy.heroSubtitle(facts())).toBe("");
  });
});

describe("templateCopy.introHeading", () => {
  it("uses the headline, else 'About {Business}'", () => {
    expect(
      templateCopy.introHeading(
        facts({
          headline: "Bread the slow way",
          businessName: "Rivera Bakery",
        }),
      ),
    ).toBe("Bread the slow way");
    expect(
      templateCopy.introHeading(facts({ businessName: "Rivera Bakery" })),
    ).toBe("About Rivera Bakery");
  });
});

describe("templateCopy.faqAnswer", () => {
  it("answers booking questions from the phone, else points at the form", () => {
    const withPhone = facts({ phone: "512-555-0100" });
    expect(templateCopy.faqAnswer("How do I book?", withPhone, NONE)).toBe(
      "Call us at 512-555-0100, or send a message with the form below.",
    );
    expect(
      templateCopy.faqAnswer("How do I make an appointment?", withPhone, NONE),
    ).toBe("Call us at 512-555-0100, or send a message with the form below.");
    expect(templateCopy.faqAnswer("How do I book?", facts(), NONE)).toBe(
      "Send us a message with the form below and we'll get back to you.",
    );
  });

  it("answers 'Where are you?' from the street and city, or the city alone", () => {
    expect(
      templateCopy.faqAnswer(
        "Where are you?",
        facts({ street: "12 Oak St", city: "Austin" }),
        NONE,
      ),
    ).toBe("We're at 12 Oak St, Austin.");
    expect(
      templateCopy.faqAnswer("Where are you?", facts({ city: "Austin" }), NONE),
    ).toBe("We're in Austin.");
    expect(templateCopy.faqAnswer("Where are you?", facts(), NONE)).toBe("");
  });

  it("answers cost questions only when Home placed Services", () => {
    for (const q of ["What does it cost?", "What does a session cost?"]) {
      expect(templateCopy.faqAnswer(q, facts(), WITH_SERVICES)).toBe(
        "Our prices are listed under Services on our home page.",
      );
      expect(templateCopy.faqAnswer(q, facts(), NONE)).toBe("");
    }
  });

  it("never fills policy questions or unknown questions", () => {
    const f = facts({ phone: "1", street: "x", city: "y" });
    for (const q of [
      "Do you take walk-ins?",
      "What is your cancellation policy?",
      "What happens at the first visit?",
      "Anything else?",
    ]) {
      expect(templateCopy.faqAnswer(q, f, WITH_SERVICES)).toBe("");
    }
  });
});

describe("templateCopy guards (D-UI-P8-12)", () => {
  const BAD = [/lorem/i, /undefined/, /null/, /\{/];

  function everything(f: AssemblyFacts, placed: ReadonlySet<string>): string[] {
    const cta = templateCopy.closingCta(f);
    return [
      templateCopy.heroSubtitle(f),
      templateCopy.introHeading(f),
      templateCopy.servicesHeading(f),
      cta.heading,
      cta.line,
      ...faqStartersFor(f.businessTypeId).map((q) =>
        templateCopy.faqAnswer(q, f, placed),
      ),
    ];
  }

  for (const t of BUSINESS_TYPES) {
    it(`${t.id}: no leaks, deterministic, with complete or empty facts`, () => {
      const complete = facts({
        businessName: "Rivera Bakery",
        businessTypeId: t.id,
        businessTypeLabel: t.label,
        tagline: "Fresh every day",
        headline: "Made here",
        city: "Austin",
        street: "12 Oak St",
        phone: "512-555-0100",
        email: "hi@example.com",
      });
      const empty = facts({ businessTypeId: t.id });
      for (const [f, placed] of [
        [complete, WITH_SERVICES],
        [empty, NONE],
      ] as const) {
        const a = everything(f, placed);
        expect(everything({ ...f }, placed)).toEqual(a);
        for (const s of a) for (const re of BAD) expect(s).not.toMatch(re);
      }
    });
  }

  it("has a phrase row for every group", () => {
    expect(Object.keys(COPY_PHRASES).sort()).toEqual(
      ["community", "other", "practice", "service", "shop", "studio"].sort(),
    );
  });
});
