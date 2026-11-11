// Intake field validators (ONB-01, T-06-12). Pure. Allow-listed keys only (unknown keys are
// dropped), length caps, http(s)-only URLs, GA4 pattern, hours and time zones. Every throw is
// an InvalidInput whose message is owner-facing UI copy.
import { isDomainName, normaliseEmail } from "../email/address";
import { InvalidInput } from "../errors";
import { findBusinessType } from "../onboarding/business-types";
import { FONT_PAIRINGS } from "../theme/pairings";
import { validateHours, validateTimeZone } from "./hours";
import {
  SOCIAL_PLATFORMS,
  type Address,
  type BusinessProfileValues,
  type IntakeAnswers,
  type SocialLink,
} from "./snapshot";

export const PROFILE_LIMITS = Object.freeze({
  tagline: 80,
  business_type_other: 80,
  description: 200,
  phone: 40,
  service_area: 120,
  about: 2000,
  mission: 600,
  headline: 120,
  legal_name: 120,
  legal_region: 60,
  social_url: 300,
  socials: 10,
});

export const SERVICE_DURATIONS = [15, 30, 45, 60, 75, 90, 120] as const;
export const PRICE_DISPLAYS = ["fixed", "from", "free", "ask"] as const;
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number];
export const REGISTRARS = [
  "hostinger",
  "godaddy",
  "namecheap",
  "squarespace",
  "cloudflare",
  "other",
  "not_sure",
] as const;

const MAX_PRICE_CENTS = 10_000_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function asRecord(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new InvalidInput(
      "We couldn't read that change. Refresh and try again.",
    );
  }
  return raw;
}

const has = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);

// C0 and C1 controls except tab, line feed and carriage return (A-WR-10).
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function text(raw: unknown, max: number, label: string): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") {
    throw new InvalidInput(`${label} must be text.`);
  }
  const v = raw.trim();
  if (v.length > max) {
    throw new InvalidInput(
      `Keep ${label.toLowerCase()} to ${max.toLocaleString("en-US")} characters or fewer.`,
    );
  }
  // A-WR-10: control characters (other than tab and line breaks) are never real text and
  // can carry terminal escape sequences into the staff CLIs.
  if (CONTROL_RE.test(v)) {
    throw new InvalidInput(
      `Remove the hidden control characters from ${label.toLowerCase()}.`,
    );
  }
  return v;
}

function optionalEmail(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string" && raw.trim() === "") return "";
  return normaliseEmail(raw);
}

function phone(raw: unknown): string {
  const v = text(raw, PROFILE_LIMITS.phone, "Phone");
  if (v === "") return v;
  const digits = v.replace(/\D/g, "").length;
  if (!/^[0-9+().\s-]+(\s*(x|ext\.?)\s*\d{1,6})?$/i.test(v) || digits < 7) {
    throw new InvalidInput(
      "That doesn't look like a phone number. Check it and try again.",
    );
  }
  return v;
}

function httpUrl(raw: unknown): string {
  const v = text(raw, PROFILE_LIMITS.social_url, "Link");
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new InvalidInput(
      "Enter the full link, starting with https://, like https://instagram.com/yourname.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidInput(
      "Enter the full link, starting with https://, like https://instagram.com/yourname.",
    );
  }
  return v;
}

function address(raw: unknown): Address {
  if (!isRecord(raw)) {
    throw new InvalidInput(
      "We couldn't read that address. Check it and try again.",
    );
  }
  return {
    street: text(raw.street, 120, "Street"),
    city: text(raw.city, 80, "City"),
    state: text(raw.state, 60, "State"),
    zip: text(raw.zip, 20, "ZIP"),
  };
}

function socials(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) {
    throw new InvalidInput(
      "We couldn't read your social links. Refresh and try again.",
    );
  }
  if (raw.length > PROFILE_LIMITS.socials) {
    throw new InvalidInput(
      `You can add up to ${PROFILE_LIMITS.socials} social links.`,
    );
  }
  return raw.map((r: unknown): SocialLink => {
    const platform = isRecord(r) ? r.platform : undefined;
    if (
      typeof platform !== "string" ||
      !(SOCIAL_PLATFORMS as readonly string[]).includes(platform)
    ) {
      throw new InvalidInput("Pick a platform from the list.");
    }
    return {
      platform: platform as SocialLink["platform"],
      url: httpUrl(isRecord(r) ? r.url : undefined),
    };
  });
}

function businessType(raw: unknown): string {
  const v = text(raw, 60, "Business type");
  if (v === "" || findBusinessType(v)) return v;
  throw new InvalidInput("Pick a business type from the list.");
}

function fontPairing(raw: unknown): string {
  const v = text(raw, 60, "Style");
  if (v === "" || FONT_PAIRINGS.some((p) => p.id === v)) return v;
  throw new InvalidInput("Pick one of the styles shown.");
}

function ga4(raw: unknown): string {
  const v = text(raw, 20, "Google Analytics ID").toUpperCase();
  if (v === "" || /^G-[A-Z0-9]{4,12}$/.test(v)) return v;
  throw new InvalidInput(
    "A Google Analytics ID looks like G-XXXXXXXXXX. Check it and try again.",
  );
}

type ProfileKey = keyof BusinessProfileValues;
const PROFILE_FIELDS: {
  [K in ProfileKey]: (raw: unknown) => BusinessProfileValues[K];
} = {
  tagline: (r) => text(r, PROFILE_LIMITS.tagline, "The tagline"),
  business_type: businessType,
  business_type_other: (r) =>
    text(r, PROFILE_LIMITS.business_type_other, "The business type"),
  description: (r) => text(r, PROFILE_LIMITS.description, "The description"),
  phone,
  public_email: optionalEmail,
  address,
  service_area: (r) => text(r, PROFILE_LIMITS.service_area, "The service area"),
  time_zone: validateTimeZone,
  hours: (r) => (r === null ? null : validateHours(r)),
  socials,
  about: (r) => text(r, PROFILE_LIMITS.about, "About"),
  mission: (r) => text(r, PROFILE_LIMITS.mission, "The mission"),
  headline: (r) => text(r, PROFILE_LIMITS.headline, "The headline"),
  font_pairing: fontPairing,
  ga4_id: ga4,
  legal_name: (r) => text(r, PROFILE_LIMITS.legal_name, "The legal name"),
  privacy_contact: optionalEmail,
  legal_region: (r) => text(r, PROFILE_LIMITS.legal_region, "State / country"),
};

/** Allow-listed keys only; each present key is validated, unknown keys are dropped. */
export function validateProfilePatch(
  raw: unknown,
): Partial<BusinessProfileValues> {
  const o = asRecord(raw);
  const out: Partial<Record<ProfileKey, unknown>> = {};
  for (const key of Object.keys(PROFILE_FIELDS) as ProfileKey[]) {
    if (has(o, key)) out[key] = PROFILE_FIELDS[key](o[key]);
  }
  return out as Partial<BusinessProfileValues>;
}

/** "https://www.RiveraBakery.com/shop" -> "riverabakery.com"; "" stays "". */
export function normaliseDomain(raw: unknown): string {
  const v = text(raw, 300, "The web address").toLowerCase();
  if (v === "") return "";
  const host = v
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!isDomainName(host)) {
    throw new InvalidInput(
      "That doesn't look like a web address. Try something like riverabakery.com.",
    );
  }
  return host;
}

function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  throw new InvalidInput(message);
}

export function validateAnswersPatch(raw: unknown): Partial<IntakeAnswers> {
  const o = asRecord(raw);
  const out: Partial<IntakeAnswers> = {};
  if (has(o, "domain_choice")) {
    out.domain_choice = oneOf(
      o.domain_choice,
      ["have", "need", "later"] as const,
      "Pick one of the web address options.",
    );
  }
  if (has(o, "domain")) out.domain = normaliseDomain(o.domain);
  if (has(o, "registrar")) {
    out.registrar =
      o.registrar === "" || o.registrar === null
        ? ""
        : oneOf(
            o.registrar,
            REGISTRARS,
            "Pick where you bought it from the list.",
          );
  }
  if (has(o, "domain_ideas")) {
    out.domain_ideas = text(o.domain_ideas, 300, "Your ideas");
  }
  if (has(o, "gbp")) {
    out.gbp = oneOf(
      o.gbp,
      ["yes", "no", "not_sure", ""] as const,
      "Pick Yes, No or Not sure.",
    );
  }
  return out;
}

export type TeamMemberInput = {
  name: string;
  role: string;
  bio: string;
  is_published: boolean;
};

export type ServiceInput = {
  name: string;
  description: string;
  price_display: PriceDisplay;
  price_cents: number | null;
  duration_minutes: number | null;
  is_published: boolean;
};

function published(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== "boolean") {
    throw new InvalidInput("Show on site must be on or off.");
  }
  return raw;
}

function requiredName(raw: unknown): string {
  const v = text(raw, 80, "The name");
  if (v === "") throw new InvalidInput("Add a name.");
  return v;
}

export function validateTeamMember(raw: unknown): TeamMemberInput {
  const o = asRecord(raw);
  return {
    name: requiredName(o.name),
    role: text(o.role, 80, "The role"),
    bio: text(o.bio, 600, "The bio"),
    is_published: published(o.is_published),
  };
}

export function validateService(raw: unknown): ServiceInput {
  const o = asRecord(raw);
  const price_display = oneOf(
    o.price_display,
    PRICE_DISPLAYS,
    "Pick Fixed price, Starting at, Free or Ask for a price.",
  );
  let price_cents: number | null = null;
  if (price_display === "fixed" || price_display === "from") {
    const p = o.price_cents;
    if (
      typeof p !== "number" ||
      !Number.isInteger(p) ||
      p <= 0 ||
      p > MAX_PRICE_CENTS
    ) {
      throw new InvalidInput("Add a price, like 45 or 45.00.");
    }
    price_cents = p;
  }
  const d = o.duration_minutes;
  let duration_minutes: number | null = null;
  if (d !== undefined && d !== null) {
    if (
      typeof d !== "number" ||
      !(SERVICE_DURATIONS as readonly number[]).includes(d)
    ) {
      throw new InvalidInput(
        "Pick a duration from the list, or leave it empty.",
      );
    }
    duration_minutes = d;
  }
  return {
    name: requiredName(o.name),
    description: text(o.description, 600, "The description"),
    price_display,
    price_cents,
    duration_minutes,
    is_published: published(o.is_published),
  };
}
