// Credential record rules (ADDON-02, ADDON-06, ADDON-08; CONTEXT A5-Q2; T-05-44, T-05-45).
// Pure. addonRepo (@cds/db) runs validate on every save and CSV row, then screens textsOf and
// urlsOf. Deny by default: only the fields below survive, unknown keys are dropped, an
// organization key is refused (the org always comes from the context), and every message
// is owner-facing copy ("what + how").
import { InvalidInput } from "@cds/core";
import type { AddonRecordSpec } from "@cds/core/addons";
import { dayOf } from "./expiry";

export const TITLE_MAX = 160;
export const ISSUER_MAX = 160;
export const CATEGORY_MAX = 60;
export const NUMBER_MAX = 80;
export const VERIFY_URL_MAX = 2000;

export const COPY = {
  titleEmpty: "Title is empty. Add the credential's name.",
  titleLong: "Title is longer than 160 characters.",
  issuerEmpty: "Issued by is empty. Add who issued it.",
  issuerLong: "Issued by is longer than 160 characters.",
  categoryLong: "Group is longer than 60 characters.",
  numberLong: "Number is longer than 80 characters.",
  issuedDate: "Issued isn't a date. Use a date like 2019-06-01.",
  expiresDate: "Expires isn't a date. Use a date like 2027-03-14.",
  expiresBeforeIssued:
    "Expires is before Issued. Check the dates, or leave Expires empty.",
  verifyUrl: "Verify link must start with https:// or http://.",
  verifyLong: "Verify link is longer than 2,000 characters.",
  organization: "A credential can't name an organization.",
  malformed: "That credential couldn't be read. Try again.",
} as const;

/** The stored shape of one credential (validator output). Dates are "YYYY-MM-DD" or "". */
export type CredentialValues = {
  title: string;
  issuer: string;
  category: string;
  credential_number: string;
  show_number: boolean;
  issued_on: string;
  expires_on: string;
  verify_url: string;
  is_published: boolean;
};

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function field(raw: Record<string, unknown>, key: string): unknown {
  return hasOwn(raw, key) ? raw[key] : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function capped(v: unknown, max: number, message: string): string {
  const s = str(v);
  if (s.length > max) throw new InvalidInput(message);
  return s;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * "" for blank, else a real calendar day as "YYYY-MM-DD". Accepts "2027-03-14", PocketBase's
 * "2027-03-14 00:00:00.000Z", and the US "3/14/2027" Excel writes when it reformats a date
 * column. Anything else throws `message`.
 */
export function parseDate(v: unknown, message: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new InvalidInput(message);
  const s = v.trim();
  if (s === "") return "";
  const us = US_DATE.exec(s);
  const candidate = us
    ? `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`
    : s;
  const day = dayOf(candidate);
  if (day === "") throw new InvalidInput(message);
  return day;
}

/** "" or an absolute http(s) URL, stored as typed (trimmed). */
export function parseVerifyUrl(v: unknown): string {
  const s = str(v);
  if (s === "") return "";
  if (s.length > VERIFY_URL_MAX) throw new InvalidInput(COPY.verifyLong);
  if (!/^https?:\/\//i.test(s)) throw new InvalidInput(COPY.verifyUrl);
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("scheme");
    }
  } catch {
    throw new InvalidInput(COPY.verifyUrl);
  }
  return s;
}

export function validateCredential(raw: unknown): CredentialValues {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput(COPY.malformed);
  }
  const r = raw as Record<string, unknown>;
  if (hasOwn(r, "organization")) throw new InvalidInput(COPY.organization);

  const title = str(field(r, "title"));
  if (title === "") throw new InvalidInput(COPY.titleEmpty);
  if (title.length > TITLE_MAX) throw new InvalidInput(COPY.titleLong);

  const issuer = str(field(r, "issuer"));
  if (issuer === "") throw new InvalidInput(COPY.issuerEmpty);
  if (issuer.length > ISSUER_MAX) throw new InvalidInput(COPY.issuerLong);

  const category = capped(
    field(r, "category"),
    CATEGORY_MAX,
    COPY.categoryLong,
  );
  const credential_number = capped(
    field(r, "credential_number"),
    NUMBER_MAX,
    COPY.numberLong,
  );
  const issued_on = parseDate(field(r, "issued_on"), COPY.issuedDate);
  const expires_on = parseDate(field(r, "expires_on"), COPY.expiresDate);
  if (issued_on !== "" && expires_on !== "" && expires_on < issued_on) {
    throw new InvalidInput(COPY.expiresBeforeIssued);
  }
  const verify_url = parseVerifyUrl(field(r, "verify_url"));

  return {
    title,
    issuer,
    category,
    credential_number,
    show_number: bool(field(r, "show_number"), false),
    issued_on,
    expires_on,
    verify_url,
    is_published: bool(field(r, "is_published"), true),
  };
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

export const CREDENTIAL_RECORDS: AddonRecordSpec = {
  singular: "credential",
  plural: "credentials",
  validate: (raw) => validateCredential(raw),
  textsOf: (v) =>
    [s(v.title), s(v.issuer), s(v.category), s(v.credential_number)].filter(
      (t) => t !== "",
    ),
  urlsOf: (v) => [s(v.verify_url)].filter((u) => u !== ""),
  title: (v) => s(v.title),
  publishedField: "is_published",
  orderField: "sort_order",
  groupField: "category",
};
