// P8 (08-06): free deterministic CopyWriter stand-in (CONTEXT A3-Q4); strings verbatim from
// 08-UI-SPEC; states facts only, never claims. Missing facts give "" or the next branch, never
// an interpolated empty value (D-UI-P8-12). Paid AI polish swaps in behind the same port
// (GO-LIVE, selector `getCopyWriter` in @cds/db).
import {
  COPY_GROUPS,
  findBusinessType,
  type CopyGroup,
} from "../onboarding/business-types";
import type { AssemblyFacts, CopyWriter } from "./types";

type Phrases = {
  servicesHeading: string;
  ctaHeading: string;
  ctaLine: string;
};

/** One phrase row per copyGroup (D-UI-P8-10). */
export const COPY_PHRASES: Readonly<Record<CopyGroup, Readonly<Phrases>>> =
  Object.freeze({
    practice: {
      servicesHeading: "How we can help",
      ctaHeading: "Ready to talk?",
      ctaLine:
        "Call us, or send a message, and we'll find a time that suits you.",
    },
    shop: {
      servicesHeading: "What we offer",
      ctaHeading: "Come and see us",
      ctaLine: "Call us with any question, or stop by.",
    },
    service: {
      servicesHeading: "Services",
      ctaHeading: "Tell us what you need",
      ctaLine: "Call us and we'll talk it through.",
    },
    studio: {
      servicesHeading: "Services and prices",
      ctaHeading: "Ready for your next visit?",
      ctaLine: "Call us to book your visit.",
    },
    community: {
      servicesHeading: "What we do",
      ctaHeading: "Get involved",
      ctaLine: "Call us to find out how you can take part.",
    },
    other: {
      servicesHeading: "Services",
      ctaHeading: "Get in touch",
      ctaLine: "Call us with any question.",
    },
  });

/** The copyGroup of a business type id; unknown types fall back to "other". */
export function copyGroupOf(typeId: unknown): CopyGroup {
  return findBusinessType(typeId)?.copyGroup ?? "other";
}

function groupOf(f: AssemblyFacts): CopyGroup {
  const g = f.copyGroup;
  if (typeof g === "string" && (COPY_GROUPS as readonly string[]).includes(g)) {
    return g as CopyGroup;
  }
  return copyGroupOf(f.businessTypeId);
}

const t = (v: string | undefined): string => (v ?? "").trim();

// Starter strings from faqStartersFor (content/presets.ts), matched exactly (D-UI-P8-11).
const BOOKING_QUESTIONS: ReadonlySet<string> = new Set([
  "How do I book?",
  "How do I make an appointment?",
]);
const WHERE_QUESTION = "Where are you?";
const COST_QUESTIONS: ReadonlySet<string> = new Set([
  "What does it cost?",
  "What does a session cost?",
]);

export const templateCopy: CopyWriter = Object.freeze<CopyWriter>({
  heroSubtitle(f) {
    const tagline = t(f.tagline);
    if (tagline !== "") return tagline;
    const label = t(f.businessTypeLabel);
    const city = t(f.city);
    if (label !== "" && city !== "") return `${label} in ${city}`;
    return label;
  },

  introHeading(f) {
    const headline = t(f.headline);
    if (headline !== "") return headline;
    const name = t(f.businessName);
    if (name !== "") return `About ${name}`;
    return "About us";
  },

  servicesHeading(f) {
    return COPY_PHRASES[groupOf(f)].servicesHeading;
  },

  closingCta(f) {
    const p = COPY_PHRASES[groupOf(f)];
    return { heading: p.ctaHeading, line: p.ctaLine };
  },

  faqAnswer(question, f, placed) {
    if (BOOKING_QUESTIONS.has(question)) {
      const phone = t(f.phone);
      if (phone !== "") {
        return `Call us at ${phone}, or send a message with the form below.`;
      }
      return "Send us a message with the form below and we'll get back to you.";
    }
    if (question === WHERE_QUESTION) {
      const street = t(f.street);
      const city = t(f.city);
      // City alone is still a fact (the map is placed from it too; IN-B06).
      if (street === "") return city !== "" ? `We're in ${city}.` : "";
      if (city !== "") return `We're at ${street}, ${city}.`;
      return `We're at ${street}.`;
    }
    if (COST_QUESTIONS.has(question)) {
      return placed.has("services")
        ? "Our prices are listed under Services on our home page."
        : "";
    }
    return "";
  },
});
