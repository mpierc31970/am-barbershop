// Visitor payload parsing, answer validation, spam signals and answer formatting
// (CONT-25, D231, D271; RESEARCH Pitfall 8; 07-15).
//
// Hostile input: the payload is read with own-property checks only and never spread.
// payloadFromEntries returns null-prototype objects and drops prototype-polluting keys.
// Hidden fields take their value from the stored form, never from the payload.
// Pure and Edge-safe: no node:*, no @cds/db.
import { isEmail, normaliseEmail } from "../email/address";
import {
  ADDRESS_PARTS,
  CHOICE_ANSWER_COPY,
  DATE_ANSWER_COPY,
  DISPLAY_TYPES,
  EMAIL_ANSWER_COPY,
  FORM_HONEYPOT_NAME,
  FORM_NEWSLETTER_NAME,
  FORM_STARTED_NAME,
  FormErrors,
  MAX_ADDRESS_PART,
  MAX_ANSWER_BYTES,
  MAX_ANSWER_CHARS,
  MAX_FUTURE_MS,
  MIN_FILL_MS,
  NUMBER_ANSWER_COPY,
  PHONE_ANSWER_COPY,
  PRO_TYPES,
  TIME_ANSWER_COPY,
  TOO_LONG_ANSWER_COPY,
  capCopy,
  requiredCopy,
  formatFileSize,
  isFileAnswer,
  type AddressAnswer,
  type FormAnswer,
  type FormDefinition,
  type FormField,
  type ValidatedSubmission,
} from "./model";
import { isFieldVisible } from "./pro";

const BANNED_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_ENTRIES = 500;
const MAX_KEY = 100;

type Bag = Record<string, unknown>;

function own(raw: Bag, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function isPlainBag(v: unknown): v is Bag {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Fold form entries (FormData or URLSearchParams) into a payload: repeated keys become
 * arrays, `id.part` keys become a nested object (address answers). Non-string values (files)
 * and keys with a prototype segment are dropped. The result has a null prototype.
 */
export function payloadFromEntries(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  const out = Object.create(null) as Bag;
  let n = 0;
  for (const [rawKey, value] of entries) {
    if (++n > MAX_ENTRIES) break;
    if (typeof rawKey !== "string" || typeof value !== "string") continue;
    if (rawKey.length === 0 || rawKey.length > MAX_KEY) continue;
    const parts = rawKey.split(".");
    if (
      parts.length > 2 ||
      parts.some((p) => p === "" || BANNED_SEGMENTS.has(p))
    )
      continue;
    const [key, sub] = parts as [string, string | undefined];
    const existing = own(out, key);
    if (sub !== undefined) {
      if (existing !== undefined && !isPlainBag(existing)) continue;
      const obj = (existing as Bag | undefined) ?? (Object.create(null) as Bag);
      obj[sub] = value;
      out[key] = obj;
      continue;
    }
    if (existing === undefined) out[key] = value;
    else if (typeof existing === "string") out[key] = [existing, value];
    else if (Array.isArray(existing)) existing.push(value);
  }
  return out;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function scalar(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

const PHONE_CHARS = /^[+()0-9 .-]+$/;
const NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function realDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function isTicked(v: unknown): boolean {
  if (v === true) return true;
  if (Array.isArray(v)) return v.some(isTicked);
  return typeof v === "string" && ["on", "true", "1", "yes"].includes(v.trim());
}

function isEmptyAnswer(v: FormAnswer | undefined): boolean {
  if (v === undefined || v === false || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object")
    return ADDRESS_PARTS.every((p) => (v as AddressAnswer)[p] === "");
  return false;
}

/** Over 10,000 characters (the copy) or 10 KB of UTF-8 (the byte cap). */
function tooLong(v: FormAnswer): boolean {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_ANSWER_CHARS || utf8Bytes(s) > MAX_ANSWER_BYTES;
}

/**
 * Validate a visitor's answers against the stored fields (or a definition: with
 * `proActive`, its Forms Pro rules hide fields; inactive, rules are ignored). Returns fresh
 * data keyed by field id plus a label snapshot, or throws FormErrors keyed by field id.
 * Unknown keys, display fields and hidden-by-rule answers are dropped; empty answers are not
 * stored.
 */
export function validateSubmission(
  form: readonly FormField[] | Pick<FormDefinition, "fields" | "pro">,
  payload: unknown,
  opts: { proActive?: boolean } = {},
): ValidatedSubmission {
  const fields: readonly FormField[] = Array.isArray(form)
    ? form
    : (form as Pick<FormDefinition, "fields">).fields;
  const proActive = opts.proActive === true;
  const rules =
    proActive && !Array.isArray(form)
      ? ((form as Pick<FormDefinition, "pro">).pro?.rules ?? [])
      : [];
  const p: Bag = isPlainBag(payload) ? payload : {};
  const data: Record<string, FormAnswer> = {};
  const labels: Record<string, string> = {};
  const errors: Record<string, string> = {};
  let email: string | null = null;
  let name: string | null = null;
  let phone: string | null = null;

  for (const f of fields) {
    if (DISPLAY_TYPES.has(f.type) || PRO_TYPES.has(f.type)) continue;
    // Forms Pro (10-34): a field hidden by a rule is never required and its answer is
    // dropped (T-10-34-04). Rules read only earlier, visible answers (already in data).
    if (rules.length > 0 && !isFieldVisible(rules, f.id, data)) continue;
    const raw = own(p, f.id);
    const fail = (msg: string) => {
      errors[f.id] ??= msg;
    };
    let answer: FormAnswer | undefined;

    switch (f.type) {
      case "hidden":
        answer = f.value;
        break;
      case "short_text":
      case "long_text":
      case "name":
        answer = scalar(raw);
        break;
      case "email": {
        const s = scalar(raw);
        if (s !== "") {
          if (isEmail(s)) answer = normaliseEmail(s);
          else fail(EMAIL_ANSWER_COPY);
        }
        break;
      }
      case "phone": {
        const s = scalar(raw);
        if (s !== "") {
          const digits = s.replace(/\D/g, "").length;
          if (PHONE_CHARS.test(s) && digits >= 7 && digits <= 15) answer = s;
          else fail(PHONE_ANSWER_COPY);
        }
        break;
      }
      case "number": {
        const s = scalar(raw);
        if (s !== "") {
          if (NUMBER_RE.test(s) && Number.isFinite(Number(s))) answer = s;
          else fail(NUMBER_ANSWER_COPY);
        }
        break;
      }
      case "date": {
        const s = scalar(raw);
        if (s !== "") {
          if (realDate(s)) answer = s;
          else fail(DATE_ANSWER_COPY);
        }
        break;
      }
      case "time": {
        const s = scalar(raw);
        if (s !== "") {
          if (TIME_RE.test(s)) answer = s;
          else fail(TIME_ANSWER_COPY);
        }
        break;
      }
      case "dropdown":
      case "radio": {
        const s = scalar(raw);
        if (s !== "") {
          if (f.options.includes(s)) answer = s;
          else fail(CHOICE_ANSWER_COPY);
        }
        break;
      }
      case "checkboxes": {
        const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
        const picked = new Set<string>();
        let bad = false;
        for (const item of list.slice(0, f.options.length + 5)) {
          const s = scalar(item);
          if (s === "") continue;
          if (f.options.includes(s)) picked.add(s);
          else bad = true;
        }
        if (list.length > f.options.length + 5 || bad) fail(CHOICE_ANSWER_COPY);
        else answer = f.options.filter((o) => picked.has(o));
        break;
      }
      case "yes_no": {
        const s = scalar(raw).toLowerCase();
        if (s !== "") {
          if (s === "yes" || s === "no") answer = s;
          else fail(CHOICE_ANSWER_COPY);
        }
        break;
      }
      case "agreement":
        answer = isTicked(raw) ? true : false;
        break;
      case "address": {
        const r: Bag = isPlainBag(raw) ? raw : {};
        const a = {} as AddressAnswer;
        for (const part of ADDRESS_PARTS) {
          const s = scalar(own(r, part));
          if (s.length > MAX_ADDRESS_PART) fail(capCopy(MAX_ADDRESS_PART));
          a[part] = s.slice(0, MAX_ADDRESS_PART);
        }
        answer = a;
        break;
      }
    }

    if (errors[f.id] !== undefined) continue;
    if (answer === undefined || isEmptyAnswer(answer)) {
      if (f.required) fail(requiredCopy(f.label));
      continue;
    }
    if (tooLong(answer)) {
      fail(TOO_LONG_ANSWER_COPY);
      continue;
    }
    data[f.id] = answer;
    labels[f.id] = f.label;
    if (f.type === "email" && email === null) email = answer as string;
    if (f.type === "name" && name === null) name = answer as string;
    if (f.type === "phone" && phone === null) phone = answer as string;
  }

  if (Object.keys(errors).length > 0) throw new FormErrors(errors);
  return {
    data,
    labels,
    email,
    name,
    phone,
    newsletter: isTicked(own(p, FORM_NEWSLETTER_NAME)),
  };
}

export type SpamReason = "honeypot" | "no-start" | "future" | "too-fast";

/** Pitfall 8: honeypot, missing / forged start time, or under 3 s = spam. */
export function spamSignals(input: {
  honeypot: unknown;
  started: unknown;
  now: Date | number;
}): SpamReason[] {
  const reasons: SpamReason[] = [];
  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  const hp = input.honeypot;
  if (
    (typeof hp === "string" && hp.trim() !== "") ||
    (Array.isArray(hp) && hp.length > 0) ||
    isPlainBag(hp)
  ) {
    reasons.push("honeypot");
  }
  const s = input.started;
  let started: number | null = null;
  if (typeof s === "string" && /^\d{1,16}$/.test(s.trim())) {
    started = Number(s.trim());
  } else if (typeof s === "number" && Number.isSafeInteger(s) && s >= 0) {
    started = s;
  }
  if (started === null) reasons.push("no-start");
  else if (started - now > MAX_FUTURE_MS) reasons.push("future");
  else if (now - started < MIN_FILL_MS) reasons.push("too-fast");
  return reasons;
}

/** The payload's honeypot and start-time values, for spamSignals. */
export function spamInputOf(payload: unknown): {
  honeypot: unknown;
  started: unknown;
} {
  const p: Bag = isPlainBag(payload) ? payload : {};
  return {
    honeypot: own(p, FORM_HONEYPOT_NAME),
    started: own(p, FORM_STARTED_NAME),
  };
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value === true) return "Agreed";
  if (value === false || value === null || value === undefined) return "";
  if (Array.isArray(value))
    return value.filter((v) => typeof v === "string").join(", ");
  // 10-38: a file answer reads "name (size)" in the email, the Inbox and the CSV.
  if (isFileAnswer(value))
    return `${value.name} (${formatFileSize(value.size)})`;
  if (isPlainBag(value)) {
    return ADDRESS_PARTS.map((p) => own(value, p))
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join("\n");
  }
  return "";
}

/** The one display string for an answer (email, Inbox, CSV). */
export function formatAnswer(
  field: Pick<FormField, "type"> | null | undefined,
  value: unknown,
): string {
  if (field?.type === "yes_no") {
    if (value === "yes") return "Yes";
    if (value === "no") return "No";
  }
  if (field?.type === "agreement") return isTicked(value) ? "Agreed" : "";
  return formatValue(value);
}

/**
 * Answers in display order: current fields first (form order), then answers whose field no
 * longer exists, labelled from the snapshot. Skips `_` keys and empty values.
 */
export function answersForDisplay(
  fields: readonly FormField[],
  data: unknown,
  labels: unknown,
): { id: string; label: string; value: string }[] {
  const d: Bag = isPlainBag(data) ? data : {};
  const l: Bag = isPlainBag(labels) ? labels : {};
  const out: { id: string; label: string; value: string }[] = [];
  const done = new Set<string>();
  for (const f of fields) {
    if (DISPLAY_TYPES.has(f.type)) continue;
    done.add(f.id);
    const value = formatAnswer(f, own(d, f.id));
    if (value === "") continue;
    out.push({ id: f.id, label: f.label, value });
  }
  for (const key of Object.keys(d)) {
    if (key.startsWith("_") || done.has(key)) continue;
    const value = formatValue(own(d, key));
    if (value === "") continue;
    const snap = own(l, key);
    out.push({
      id: key,
      label: typeof snap === "string" && snap !== "" ? snap : key,
      value,
    });
  }
  return out;
}
