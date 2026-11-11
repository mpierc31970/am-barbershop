// Contacts copy and view helpers (07-16; CONTACTS-01/02, D132, D236, D266; 07-UI-SPEC Contacts).
// Pure: no React, no database package (@cds/ui never depends on @cds/db). The view types
// structurally match 07-11's ContactRow / ContactEvent / ContactNote / ContactList, so the app
// passes the chokepoint's rows straight through. Copy is verbatim from 07-UI-SPEC.
//   - D132: nothing here subscribes anyone. The only consent action is "Mark as unsubscribed".
import type { BadgeTone } from "../Badge";

export type ConsentStatus = "none" | "unconfirmed" | "confirmed" | "withdrawn";

export type ConsentView = {
  status: ConsentStatus;
  at?: string;
  source?: string;
  wording?: string;
  form?: string;
};

export type ContactView = {
  id: string;
  email: string;
  name: string;
  phone: string;
  tags: string[];
  first_source: string;
  last_seen_at: string;
  consent: ConsentView;
  created: string;
};

export type ContactEventView = {
  id: string;
  kind: string;
  ref: string;
  summary: string;
  at: string;
};

export type ContactNoteView = {
  id: string;
  list: string;
  body: string;
  author: string;
  mine: boolean;
  created: string;
};

export type ContactListView = {
  id: string;
  name: string;
  kind: "house" | "renter";
};

// Tag limits: mirrors packages/db/src/contacts/model.ts; the chokepoint stays the authority.
export const TAG_MAX_LEN = 40;
export const TAGS_MAX = 20;

export const EMPTY_CONTACTS = Object.freeze({
  heading: "No contacts yet",
  body: "Everyone who sends a form on your site is saved here, merged by email. Add people yourself or import a list.",
  readOnlyBody:
    "Everyone who sends a form on your site is saved here, merged by email.",
});
export const EMPTY_IMPORT_HELPER =
  "Have a list in Excel or another mailing tool? Export it as CSV and import it here.";
export const FILTERED_EMPTY = "No contacts match these filters.";
export const ADD_HELPER =
  "To add people to your newsletter, they need to agree themselves, on a form or through the Newsletter add-on.";
export const IMPORT_NOTE =
  "Importing adds new contacts and updates details. It never removes anyone and never changes newsletter choices.";
export const IMPORT_CHOOSE_HINT =
  "Exports from Mailchimp, Square or Google Contacts work too.";
/** MATCH-EMAIL, verbatim from 07-11 MATCH_EMAIL_COPY (@cds/db stays out of the browser). */
export const MATCH_EMAIL_COPY =
  "Match a column to Email. Every contact needs one.";
export const TAG_ALL_LABEL = "Tag everyone in this file";
export const TAG_ALL_PLACEHOLDER = "like 'Spring fair 2026'";
export const SEARCH_PLACEHOLDER = "Search name, email or phone";
export const CLEAR_FILTERS = "Clear filters";
export const GONE_COPY =
  "This was removed or moved. Reload the page to see the latest.";

export const CONTACTS_COPY = Object.freeze({
  heading: "Contacts",
  add: "Add contact",
  addTitle: "Add contact",
  import: "Import",
  importFromSheet: "Import from a spreadsheet",
  importTitle: "Import contacts",
  singular: "contact",
  plural: "contacts",
  exportCsv: "Export CSV",
  template: "Download the template",
  save: "Save contact",
  discard: "Discard changes",
  deleteContact: "Delete contact",
  noName: "No name",
  details: "Details",
  newsletter: "Newsletter",
  history: "History",
  notes: "Notes",
  noHistory: "Nothing here yet.",
  noNotes: "No notes yet.",
  close: "Close",
  more: (label: string) => `More actions for ${label}`,
});

export const DELETE_CONTACT_COPY = Object.freeze({
  title: (label: string) => `Delete ${label}?`,
  body: "Their details, notes and history are removed. Messages they sent stay in your Inbox.",
  confirm: "Delete contact",
  keep: "Keep contact",
});

export const UNSUBSCRIBE_COPY = Object.freeze({
  action: "Mark as unsubscribed",
  title: (label: string) => `Mark ${label} as unsubscribed?`,
  body: "They won't get newsletters. Only they can sign up again, on a form.",
  confirm: "Mark as unsubscribed",
  keep: "Keep subscribed",
});

export const NOTE_COPY = Object.freeze({
  label: "Add a note",
  button: "Add note",
  you: "You",
  teammate: "A teammate",
  delete: "Delete note",
});

export const CONTACT_TOASTS = Object.freeze({
  saved: "Contact saved.",
  deleted: "Contact deleted.",
  unsubscribed: "Marked as unsubscribed.",
  noteAdded: "Note added.",
  noteDeleted: "Note deleted.",
  undo: "Undo",
});

export function importedToast(r: { added: number; updated: number }): string {
  return `Imported. ${r.added} added, ${r.updated} updated.`;
}

/** Newsletter badge per stored status; `none` shows an empty cell. Tones reuse P6's. */
export function newsletterBadge(
  status: ConsentStatus,
): { label: string; tone: BadgeTone } | null {
  switch (status) {
    case "confirmed":
      return { label: "Subscribed", tone: "confirmed" };
    case "unconfirmed":
      return { label: "Not confirmed", tone: "waiting" };
    case "withdrawn":
      return { label: "Unsubscribed", tone: "draft" };
    default:
      return null;
  }
}

export const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  form: "Form",
  import: "Import",
  manual: "Added by you",
  booking: "Booking",
  subscribe: "Newsletter",
  registration: "Registration",
  purchase: "Purchase",
});

export type FilterOption = { value: string; label: string };

/** v1.0 core sources. Add-ons append theirs in their phases (labels already exist above). */
export const SOURCE_FILTER_OPTIONS: readonly FilterOption[] = Object.freeze([
  { value: "", label: "All sources" },
  { value: "form", label: "Form" },
  { value: "import", label: "Import" },
  { value: "manual", label: "Added by you" },
]);

export const NEWSLETTER_FILTER_OPTIONS: readonly FilterOption[] = Object.freeze(
  [
    { value: "", label: "Any" },
    { value: "subscribed", label: "Subscribed" },
    { value: "unconfirmed", label: "Not confirmed" },
    { value: "unsubscribed", label: "Unsubscribed" },
    { value: "none", label: "Not signed up" },
  ],
);

/** ColumnMatchStep "Goes to" options, UI-SPEC order. */
export const CONTACT_MATCH_TARGETS: readonly FilterOption[] = Object.freeze([
  { value: "name", label: "Name" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "tags", label: "Tags" },
  { value: "skip", label: "Don't import" },
]);

// Fixed English month names, so "Sep" never becomes "Sept" across ICU versions.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type DateParts = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
};

function partsOf(iso: string, timeZone: string): DateParts | null {
  if (typeof iso !== "string" || iso === "") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const read = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = read(timeZone || "UTC");
  } catch {
    p = read("UTC");
  }
  const num = (t: Intl.DateTimeFormatPartTypes) =>
    Number(p.find((x) => x.type === t)?.value ?? "0");
  return {
    day: num("day"),
    month: num("month"),
    year: num("year"),
    hour: num("hour") % 24,
    minute: num("minute"),
  };
}

/** "12 Sep, 2:14 pm" in the business's time zone; "" for a bad date. */
export function formatWhen(iso: string, timeZone: string): string {
  const p = partsOf(iso, timeZone);
  if (!p) return "";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "am" : "pm";
  return `${p.day} ${MONTHS[p.month - 1] ?? ""}, ${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

/** "12 Sep 2026" in the business's time zone; "" for a bad date. */
export function formatDay(iso: string, timeZone: string): string {
  const p = partsOf(iso, timeZone);
  if (!p) return "";
  return `${p.day} ${MONTHS[p.month - 1] ?? ""} ${p.year}`;
}

const WORDING_SHOWN = 160;

function agreedWhere(
  source: string | undefined,
  formName: string | null | undefined,
): string {
  if (source === "form" || source === undefined || source === "") {
    return formName
      ? `Agreed on the ${formName} form`
      : "Agreed on a form on your site";
  }
  const label = SOURCE_LABELS[source];
  return label ? `Agreed through ${label}` : "Agreed";
}

/**
 * The drawer's read-only Newsletter line, e.g.
 * "Not confirmed · Agreed on a form on your site, 12 Sep, 2:14 pm: 'Send me news…'".
 */
export function consentLine(
  consent: ConsentView,
  opts: { formName?: string | null; timeZone: string },
): string {
  const badge = newsletterBadge(consent.status);
  if (!badge) return "Not signed up";
  const when = consent.at ? formatWhen(consent.at, opts.timeZone) : "";
  if (consent.status === "withdrawn") {
    return when ? `${badge.label} · ${when}` : badge.label;
  }
  let line = `${badge.label} · ${agreedWhere(consent.source, opts.formName)}`;
  if (when) line += `, ${when}`;
  const wording = (consent.wording ?? "").trim();
  if (wording) {
    const shown =
      wording.length > WORDING_SHOWN
        ? `${wording.slice(0, WORDING_SHOWN - 1)}…`
        : wording;
    line += `: '${shown}'`;
  }
  return line;
}

/** Only an agreement or a confirmed subscription can be withdrawn (D132). */
export function canUnsubscribe(status: ConsentStatus): boolean {
  return status === "unconfirmed" || status === "confirmed";
}

/** Table chips: the first two, then "+N". */
export function tagChips(tags: readonly string[]): {
  shown: string[];
  more: number;
} {
  return { shown: tags.slice(0, 2), more: Math.max(0, tags.length - 2) };
}

export function countLine(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "contact" : "contacts"}`;
}

export type EventIconName = "Mail" | "Upload" | "UserPlus" | "Circle";

export function eventIcon(kind: string): EventIconName {
  switch (kind) {
    case "form":
      return "Mail";
    case "import":
      return "Upload";
    case "manual":
      return "UserPlus";
    default:
      return "Circle";
  }
}

/** The contact's name, else its email. */
export function contactLabel(c: Pick<ContactView, "name" | "email">): string {
  return c.name.trim() !== "" ? c.name : c.email;
}

/**
 * Note author: contacts readers have no member-name read, so a note shows "You" for the
 * reader's own and "A teammate" for everyone else's.
 */
export function noteAuthor(note: Pick<ContactNoteView, "mine">): string {
  return note.mine ? NOTE_COPY.you : NOTE_COPY.teammate;
}
