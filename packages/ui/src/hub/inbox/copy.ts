// Inbox copy and view helpers (07-19; CONT-25, D231, D271, D311, D-UI-P7-20; 07-UI-SPEC "Inbox
// (/hub/inbox)", copy table EMPTY-INBOX / Filtered empty, "Destructive actions" Delete message).
// Pure: no React, no database package (@cds/ui never depends on @cds/db). The view types
// structurally match 07-15's SubmissionRow / SubmissionDetail, so the app passes the
// chokepoint's rows straight through. Copy is verbatim from 07-UI-SPEC; the three toasts are
// 07-19 choice 11 (UI-SPEC names them but gives no words).
//   - Names here are prefixed (INBOX_*, message*) because @cds/ui/hub `export *`s every P7
//     barrel, and Contacts already owns FILTERED_EMPTY, SEARCH_PLACEHOLDER and GONE_COPY.
//   - mailtoHref is the only way a visitor-typed address reaches an href (T-07-19-07).
import { isEmail } from "@cds/core/email";
import { formatDay, formatWhen } from "../contacts/copy";

export type MessageRowView = {
  id: string;
  form: string;
  formName: string;
  formDeleted: boolean;
  from: string;
  preview: string;
  unread: boolean;
  spam: boolean;
  /** 14-35 (P14-P40): a launch-review test message (neutral "Test" badge; never hidden). */
  isTest?: boolean;
  created: string;
};

export type MessageFileView = {
  id: string;
  label: string;
  name: string;
  size: number;
  type: string;
};

/** The authenticated, org-scoped download route for one uploaded file (10-38). */
export function formFileHref(id: string): string {
  return `/hub/api/forms/files/${encodeURIComponent(id)}`;
}

export type MessageDetailView = {
  id: string;
  form: string;
  formName: string;
  formDeleted: boolean;
  page: { id: string; title: string } | null;
  answers: { label: string; value: string }[];
  /** 10-38: Forms Pro uploads (Download through the hub route). */
  files?: MessageFileView[];
  newsletter: boolean;
  email: string | null;
  contact: string | null;
  spam: boolean;
  /** 14-35 (P14-P40): a launch-review test message. */
  isTest?: boolean;
  readAt: string | null;
  created: string;
};

export type InboxFormOption = { id: string; name: string; deleted: boolean };

export const EMPTY_INBOX = Object.freeze({
  heading: "No messages yet",
  body: "When someone sends a form on your site, it lands here and we email you a copy.",
  link: "Go to Forms",
});

export const INBOX_FILTERED_EMPTY =
  "Nothing filtered. Messages that look like spam land here, so you can check them.";

export const INBOX_NO_MATCH = "No messages match.";

export const INBOX_EXPORT_HINT = "Choose a form to export its messages.";

export const INBOX_SEARCH_PLACEHOLDER = "Search messages";

export const INBOX_GONE_COPY =
  "This was removed or moved. Reload the page to see the latest.";

export const DELETE_MESSAGE_COPY = Object.freeze({
  title: (from: string) =>
    from.trim() === ""
      ? "Delete this message?"
      : `Delete this message from ${from}?`,
  body: "It's removed from your Inbox for good. The contact stays in Contacts.",
  confirm: "Delete message",
  keep: "Keep message",
});

export const INBOX_TOASTS = Object.freeze({
  deleted: "Message deleted.",
  notSpam: "Moved to Messages.",
  unread: "Marked as unread.",
});

export const INBOX_COPY = Object.freeze({
  heading: "Inbox",
  formFilter: "Form",
  allForms: "All forms",
  unknownForm: "A removed form",
  search: "Search",
  exportCsv: "Export CSV",
  loadMore: "Load more",
  clearFilters: "Clear filters",
  reply: "Reply by email",
  notSpam: "Not spam",
  markUnread: "Mark as unread",
  deleteMessage: "Delete message",
  viewContact: "View contact",
  newsletterAgreed: "Newsletter: Agreed",
  unread: "Unread",
  // 14-35 (P14-P40): the neutral badge on a message sent from the launch review.
  test: "Test",
  testSr: "Test message from your launch review",
  close: "Close",
  noSender: "Unknown sender",
  answers: "Answers",
  columns: Object.freeze({
    from: "From",
    form: "Form",
    preview: "Preview",
    received: "Received",
  }),
  more: (from: string) =>
    from.trim() === ""
      ? "More actions for this message"
      : `More actions for message from ${from}`,
});

/** "Filtered" / "Filtered · 3". */
export function filteredTabLabel(n: number): string {
  return Number.isInteger(n) && n > 0 ? `Filtered · ${n}` : "Filtered";
}

/** The sender as the list shows it: the name or email, else "Unknown sender". */
export function senderLabel(from: string | null | undefined): string {
  const v = typeof from === "string" ? from.trim() : "";
  return v === "" ? INBOX_COPY.noSender : v;
}

/**
 * The Received cell: "Today, 2:14 pm" for today in the business's time zone, "12 Sep" for
 * another day this year, "12 Sep 2025" for an earlier year; "" for a bad date. Never throws.
 */
export function receivedLabel(
  iso: string,
  timeZone: string,
  now: Date,
): string {
  try {
    const when = formatWhen(iso, timeZone);
    if (when === "") return "";
    const nowIso = Number.isNaN(now.getTime()) ? "" : now.toISOString();
    const day = formatDay(iso, timeZone);
    const today = nowIso === "" ? "" : formatDay(nowIso, timeZone);
    const [date, time] = when.split(", ");
    if (day === today) return `Today, ${time ?? ""}`;
    const year = day.slice(day.lastIndexOf(" ") + 1);
    const thisYear = today.slice(today.lastIndexOf(" ") + 1);
    return year === thisYear ? (date ?? "") : day;
  } catch {
    return "";
  }
}

/** "Contact" or "Contact (deleted)" (CONTEXT resolution f). */
export function formLabel(name: string, deleted: boolean): string {
  const n =
    typeof name === "string" && name.trim() !== "" ? name.trim() : "Form";
  return deleted ? `${n} (deleted)` : n;
}

/** "Message from Maria Lopez". */
export function drawerTitle(from: string | null | undefined): string {
  const v = typeof from === "string" ? from.trim() : "";
  return v === "" ? "Message" : `Message from ${v}`;
}

/** "Contact form · On Home · 12 Sep, 2:14 pm"; the page part is left out when null. */
export function drawerMeta(
  m: {
    formName: string;
    formDeleted: boolean;
    pageTitle: string | null;
    created: string;
  },
  timeZone: string,
): string {
  const name =
    typeof m.formName === "string" && m.formName.trim() !== ""
      ? m.formName.trim()
      : "Form";
  const form = /\bform$/i.test(name) ? name : `${name} form`;
  const parts = [m.formDeleted ? `${form} (deleted)` : form];
  if (m.pageTitle && m.pageTitle.trim() !== "")
    parts.push(`On ${m.pageTitle.trim()}`);
  const when = formatWhen(m.created, timeZone);
  if (when !== "") parts.push(when);
  return parts.join(" · ");
}

// Anything that could add a header, a second recipient or a query to a mailto: link.
const MAILTO_UNSAFE = /[\s,;?&%#<>"'\\]/;

/**
 * `mailto:<email>?subject=Re%3A%20your%20message%20to%20<site>`, or null when the address
 * is not one plain email (CR/LF, commas, "?" and the like are refused; T-07-19-07).
 */
export function mailtoHref(
  email: string | null | undefined,
  siteName: string,
): string | null {
  if (typeof email !== "string" || email === "") return null;
  if (MAILTO_UNSAFE.test(email) || !isEmail(email)) return null;
  const site = typeof siteName === "string" ? siteName.trim() : "";
  const subject =
    site === "" ? "Re: your message" : `Re: your message to ${site}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/** `/hub/marketing?tab=contacts&contact=<id>` (07-16's drawer route). */
export function contactHref(id: string): string {
  return `/hub/marketing?tab=contacts&contact=${encodeURIComponent(id)}`;
}
