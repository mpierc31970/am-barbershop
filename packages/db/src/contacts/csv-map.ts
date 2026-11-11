// Contacts CSV column matching and specs (CONTACTS-01, D120, D-UI-P7-22; UI-SPEC "Contacts CSV
// import"). Pure. Any spreadsheet (Mailchimp, Square, Google Contacts, our own export) is
// matched column by column, then remapped to the canonical Name / Email / Phone / Tags header
// the P5 engine validates.
//   - there is never a consent column: an import never changes newsletter choices
//     (D-UI-P7-22, D132)
//   - the id column and the export-only columns are always dropped, so email inside the
//     caller's org is the only key (T-07-11-07)
import { InvalidInput } from "@cds/core";
import type { CsvColumn, CsvParsed, CsvSpec } from "@cds/core/csv";
import { isEmail, normaliseEmail } from "@cds/core/email";
import {
  NAME_MAX,
  PHONE_MAX,
  parseTagCell,
  readTags,
  type ConsentStatus,
  type ContactSource,
} from "./model";

export const CONTACT_IMPORT_TARGETS = Object.freeze([
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "tags",
  "skip",
] as const);
export type ContactImportTarget = (typeof CONTACT_IMPORT_TARGETS)[number];
/** One target per header column, aligned by index. */
export type ContactColumnMapping = ContactImportTarget[];

export const MATCH_EMAIL_COPY =
  "Match a column to Email. Every contact needs one.";

/** Header key: lower case, no spaces, hyphens, underscores or dots. */
function hkey(h: string): string {
  return h
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\-_.]+/g, "");
}

/** Alias (as hkey) -> target. Case- and space-insensitive. */
export const CONTACT_COLUMN_ALIASES: Readonly<
  Record<string, ContactImportTarget>
> = Object.freeze({
  email: "email",
  emailaddress: "email",
  mail: "email",
  emails: "email",
  name: "name",
  fullname: "name",
  contactname: "name",
  displayname: "name",
  firstname: "first_name",
  givenname: "first_name",
  first: "first_name",
  lastname: "last_name",
  surname: "last_name",
  familyname: "last_name",
  last: "last_name",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  mobilephone: "phone",
  cell: "phone",
  cellphone: "phone",
  telephone: "phone",
  tel: "phone",
  tags: "tags",
  tag: "tags",
  labels: "tags",
  label: "tags",
  groups: "tags",
});

/** Columns of our own export that never import (id, Newsletter, Source, Last activity, Added). */
const EXPORT_ONLY = new Set([
  "id",
  "newsletter",
  "source",
  "lastactivity",
  "added",
]);
/** Exact labels that need no matching step. */
const EXACT: Readonly<Record<string, ContactImportTarget>> = {
  name: "name",
  email: "email",
  phone: "phone",
  tags: "tags",
};

const norm = (h: string) =>
  h.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export function suggestContactColumns(
  header: readonly string[],
): ContactColumnMapping {
  const used = new Set<ContactImportTarget>();
  return header.map((h) => {
    const k = hkey(h);
    if (EXPORT_ONLY.has(k)) return "skip";
    const t = Object.hasOwn(CONTACT_COLUMN_ALIASES, k)
      ? CONTACT_COLUMN_ALIASES[k]!
      : "skip";
    if (t === "skip" || used.has(t)) return "skip";
    used.add(t);
    return t;
  });
}

/** True unless every header is an exact label (or our export's own) and one is Email. */
export function needsMatch(header: readonly string[]): boolean {
  let email = false;
  for (const h of header) {
    const n = norm(h);
    if (n === "") continue;
    if (EXPORT_ONLY.has(hkey(h))) continue;
    if (!Object.hasOwn(EXACT, n)) return true;
    if (EXACT[n] === "email") email = true;
  }
  return !email;
}

function checkMapping(
  header: readonly string[],
  mapping: unknown,
): ContactColumnMapping {
  if (!Array.isArray(mapping) || mapping.length !== header.length) {
    throw new InvalidInput("Match every column, then try again.");
  }
  for (const t of mapping) {
    if (!(CONTACT_IMPORT_TARGETS as readonly unknown[]).includes(t)) {
      throw new InvalidInput("Match every column, then try again.");
    }
  }
  return mapping as ContactColumnMapping;
}

export const CANONICAL_HEADER = Object.freeze([
  "Name",
  "Email",
  "Phone",
  "Tags",
]);

export type RemapResult =
  | { ok: true; header: string[]; rows: string[][] }
  | { ok: false; message: string };

/** The file as Name / Email / Phone / Tags. First + Last join into Name when Name is unmapped. */
export function remapToCanonical(
  parsed: { header: readonly string[]; rows: readonly (readonly string[])[] },
  mapping: unknown,
): RemapResult {
  const m = checkMapping(parsed.header, mapping);
  const at: Partial<Record<ContactImportTarget, number>> = {};
  m.forEach((t, i) => {
    if (t === "skip" || EXPORT_ONLY.has(hkey(parsed.header[i] ?? ""))) return;
    if (at[t] === undefined) at[t] = i;
  });
  if (at.email === undefined) return { ok: false, message: MATCH_EMAIL_COPY };
  const cell = (row: readonly string[], i: number | undefined) =>
    i === undefined ? "" : (row[i] ?? "");
  const rows = parsed.rows.map((row) => {
    let name = cell(row, at.name);
    if (at.name === undefined) {
      name = [cell(row, at.first_name).trim(), cell(row, at.last_name).trim()]
        .filter((p) => p !== "")
        .join(" ");
    }
    return [name, cell(row, at.email), cell(row, at.phone), cell(row, at.tags)];
  });
  return { ok: true, header: [...CANONICAL_HEADER], rows };
}

const ok = (value: unknown): CsvParsed => ({ ok: true, value });
const fail = (message: string): CsvParsed => ({ ok: false, message });
const str = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);

function maxText(max: number, label: string) {
  return (raw: string): CsvParsed => {
    const t = raw.trim().replace(/\s+/g, " ");
    return t.length > max
      ? fail(`${label} is longer than ${max} characters. Shorten it.`)
      : ok(t);
  };
}

function parseEmail(raw: string): CsvParsed {
  if (isEmail(raw)) return ok(normaliseEmail(raw));
  const shown = raw.trim().slice(0, 60);
  return fail(`"${shown}" isn't a complete email address.`);
}

const PHONE = /^\+?[\d\s().\-/]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;
function parsePhone(raw: string): CsvParsed {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t === "") return ok("");
  const digits = t.replace(/\D/g, "").length;
  if (t.length > PHONE_MAX || !PHONE.test(t) || digits < 3) {
    return fail(
      `Phone "${t.slice(0, 40)}" isn't a phone number. Leave it empty or fix it.`,
    );
  }
  return ok(t);
}

function parseTags(raw: string): CsvParsed {
  try {
    return ok(parseTagCell(raw));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    throw err;
  }
}
const formatTags = (v: unknown) => readTags(v).join("; ");

const tagsColumn: CsvColumn = {
  key: "tags",
  label: "Tags",
  required: false,
  example: "Spring fair; VIP",
  parse: parseTags,
  format: formatTags,
};

/** The import: Name, Email (required, the only key), Phone, Tags. No consent column. */
export const CONTACTS_IMPORT_CSV: CsvSpec = {
  collection: "contacts",
  columns: [
    {
      key: "name",
      label: "Name",
      required: false,
      example: "Maria Lopez",
      parse: maxText(NAME_MAX, "Name"),
      format: str,
    },
    {
      key: "email",
      label: "Email",
      required: true,
      example: "maria@example.com",
      parse: parseEmail,
      format: str,
    },
    {
      key: "phone",
      label: "Phone",
      required: false,
      example: "512 555 0142",
      parse: parsePhone,
      format: str,
    },
    tagsColumn,
  ],
  naturalKey: ["email"],
  singular: "contact",
  plural: "contacts",
};

const NEWSLETTER_LABELS: Readonly<Record<ConsentStatus, string>> = {
  confirmed: "Subscribed",
  unconfirmed: "Not confirmed",
  withdrawn: "Unsubscribed",
  none: "",
};
const SOURCE_LABELS: Readonly<Record<ContactSource, string>> = {
  form: "Form",
  booking: "Booking",
  subscribe: "Newsletter",
  registration: "Registration",
  purchase: "Purchase",
  import: "Import",
  manual: "Added by you",
};

function isoDate(v: unknown): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
    ? v.slice(0, 10)
    : "";
}
const label =
  (table: Readonly<Record<string, string>>) =>
  (v: unknown): string =>
    typeof v === "string" && Object.hasOwn(table, v) ? table[v]! : "";
const exportOnly = (
  key: string,
  lbl: string,
  format: (v: unknown) => string,
): CsvColumn => ({
  key,
  label: lbl,
  required: false,
  example: "",
  parse: (raw) => ok(raw),
  format,
});

/** The export: Name, Email, Phone, Tags, Newsletter, Source, Last activity, Added. */
export const CONTACTS_EXPORT_CSV: CsvSpec = {
  collection: "contacts",
  columns: [
    exportOnly("name", "Name", str),
    exportOnly("email", "Email", str),
    exportOnly("phone", "Phone", str),
    exportOnly("tags", "Tags", formatTags),
    exportOnly("newsletter", "Newsletter", label(NEWSLETTER_LABELS)),
    exportOnly("source", "Source", label(SOURCE_LABELS)),
    exportOnly("last_seen_at", "Last activity", isoDate),
    exportOnly("created", "Added", isoDate),
  ],
  naturalKey: ["email"],
  singular: "contact",
  plural: "contacts",
};
