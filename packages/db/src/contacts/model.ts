// Contacts model helpers (CONTACTS-01/02, D236, D266, D271, D132). Pure; imported by the
// contacts chokepoint and unit tested.
//   - a touch can only ever supply agreement: the resulting status is `unconfirmed`. There is
//     no way to pass `confirmed` or `withdrawn` (D132: nothing subscribes anyone without their
//     own confirmation, which is P12's double opt-in)
//   - mergeConsent never lowers a status; fillBlanks never overwrites a stored value
import { InvalidInput } from "@cds/core";

export const CONTACT_SOURCES = Object.freeze([
  "form",
  "booking",
  "subscribe",
  "registration",
  "purchase",
  "import",
  "manual",
] as const);
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONSENT_STATUSES = Object.freeze([
  "none",
  "unconfirmed",
  "confirmed",
  "withdrawn",
] as const);
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export type MarketingConsent = {
  status: ConsentStatus;
  at?: string;
  source?: string;
  wording?: string;
  form?: string;
};

/** One touch of a person (form, booking, import...). Consent is agreement only (D132). */
export type ContactTouch = {
  email: unknown;
  name?: string;
  phone?: string;
  source: ContactSource;
  ref?: string;
  summary?: string;
  consent?: { wording: string; form?: string };
};

export const TAG_MAX_LEN = 40;
export const TAGS_MAX = 20;
export const NAME_MAX = 120;
export const PHONE_MAX = 40;
export const SUMMARY_MAX = 300;
export const REF_MAX = 64;
export const NOTE_MAX = 5000;
const WORDING_MAX = 1000;

/** Owner filter words -> stored status. */
export const CONSENT_FILTERS: Readonly<Record<string, ConsentStatus>> =
  Object.freeze({
    subscribed: "confirmed",
    unconfirmed: "unconfirmed",
    unsubscribed: "withdrawn",
    none: "none",
  });

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Strip control characters, trim, collapse runs of spaces, cut to `max`. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function isContactSource(v: unknown): v is ContactSource {
  return (
    typeof v === "string" && (CONTACT_SOURCES as readonly string[]).includes(v)
  );
}

function tagKey(t: string): string {
  return t.normalize("NFC").toLowerCase();
}

/** Owner-entered tags: trimmed, deduped (first casing kept); too long / too many -> InvalidInput. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new InvalidInput("Tags must be a list.");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") throw new InvalidInput("Tags must be text.");
    const t = item.replace(CONTROL, "").replace(/\s+/g, " ").trim();
    if (t === "") continue;
    if (t.length > TAG_MAX_LEN) {
      throw new InvalidInput(
        `Keep each tag under ${TAG_MAX_LEN} characters. Shorten "${t.slice(0, 20)}…".`,
      );
    }
    const k = tagKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  if (out.length > TAGS_MAX) {
    throw new InvalidInput(
      `A contact can have up to ${TAGS_MAX} tags. Remove some.`,
    );
  }
  return out;
}

/** Stored tags, read leniently (never throws): strings only, deduped. */
export function readTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.replace(CONTROL, "").replace(/\s+/g, " ").trim();
    if (t === "" || seen.has(tagKey(t))) continue;
    seen.add(tagKey(t));
    out.push(t);
  }
  return out;
}

/** Union of tag lists, first casing kept, in order. */
export function unionTags(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(tagKey(t))) continue;
      seen.add(tagKey(t));
      out.push(t);
    }
  }
  return out;
}

/** One spreadsheet cell of tags: split on `;` or `,`. */
export function parseTagCell(cell: string): string[] {
  return normalizeTags(cell.split(/[;,]/));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function consentStatusOf(raw: unknown): ConsentStatus {
  if (!isRecord(raw)) return "none";
  const s = raw.status;
  return typeof s === "string" &&
    (CONSENT_STATUSES as readonly string[]).includes(s)
    ? (s as ConsentStatus)
    : "none";
}

/** A stored consent value, field by field; malformed -> `{status: "none"}`. */
export function readConsent(raw: unknown): MarketingConsent {
  const status = consentStatusOf(raw);
  if (!isRecord(raw) || status === "none") return { status: "none" };
  const out: MarketingConsent = { status };
  for (const k of ["at", "source", "wording", "form"] as const) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Merge a touch's agreement into the stored consent. Never lowers: `confirmed` and an earlier
 * `unconfirmed` stay as they are. `none` and `withdrawn` become `unconfirmed` (a fresh explicit
 * tick; P12's double opt-in still gates any mail, D132).
 */
export function mergeConsent(
  existing: unknown,
  incoming:
    | { wording: string; form?: string; source: ContactSource; at: string }
    | undefined,
): MarketingConsent {
  const current = readConsent(existing);
  if (incoming === undefined) return current;
  if (current.status === "confirmed" || current.status === "unconfirmed") {
    return current;
  }
  const out: MarketingConsent = {
    status: "unconfirmed",
    at: incoming.at,
    source: incoming.source,
    wording: cleanText(incoming.wording, WORDING_MAX),
  };
  const form = cleanText(incoming.form, REF_MAX);
  if (form !== "") out.form = form;
  return out;
}

/** The name / phone patch for blank stored values only. Never overwrites. */
export function fillBlanks(
  existing: { name?: unknown; phone?: unknown },
  incoming: { name?: string; phone?: string },
): { name?: string; phone?: string } {
  const patch: { name?: string; phone?: string } = {};
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  const name = cleanText(incoming.name, NAME_MAX);
  const phone = cleanText(incoming.phone, PHONE_MAX);
  if (blank(existing.name) && name !== "") patch.name = name;
  if (blank(existing.phone) && phone !== "") patch.phone = phone;
  return patch;
}

/** A touch with every free-text field trimmed, stripped and cut to its column size. */
export function clampTouch(touch: ContactTouch): ContactTouch & {
  name: string;
  phone: string;
  ref: string;
  summary: string;
} {
  if (!isContactSource(touch.source)) {
    throw new InvalidInput("Unknown contact source.");
  }
  const out: ContactTouch & {
    name: string;
    phone: string;
    ref: string;
    summary: string;
  } = {
    email: touch.email,
    source: touch.source,
    name: cleanText(touch.name, NAME_MAX),
    phone: cleanText(touch.phone, PHONE_MAX),
    ref: cleanText(touch.ref, REF_MAX),
    summary: cleanText(touch.summary, SUMMARY_MAX),
  };
  if (touch.consent !== undefined) {
    if (!isRecord(touch.consent) || typeof touch.consent.wording !== "string") {
      throw new InvalidInput("Newsletter agreement needs its wording.");
    }
    const consent: { wording: string; form?: string } = {
      wording: cleanText(touch.consent.wording, WORDING_MAX),
    };
    const form = cleanText(touch.consent.form, REF_MAX);
    if (form !== "") consent.form = form;
    out.consent = consent;
  }
  return out;
}

/** DUP-CONTACT: the email already belongs to another contact of this org. */
export class ContactExists extends InvalidInput {
  readonly contactId: string;
  /** The contact's name, or its email when it has none (for "[Open <label>]"). */
  readonly label: string;
  constructor(email: string, contactId: string, name: string) {
    super(`${email} is already a contact.`);
    this.contactId = contactId;
    this.label = name.trim() !== "" ? name : email;
  }
}
