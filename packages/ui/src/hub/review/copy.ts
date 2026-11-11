// Launch review copy and small formatters (14-34; DOM-10, D172, D26; 14-UI-SPEC "Launch review"
// lines 591-650, Copywriting Contract lines 1056-1065). CONTEXT anchors and shared strings come
// from P14_COPY (@cds/core/dns); the screen-only words live here. Pure, browser-safe.
import type { TimeRange, WeeklyHours } from "@cds/core/intake";
import { P14_COPY } from "@cds/core/dns";

/** The six D172 item ids, in the fixed P11 order (LAUNCH_REVIEW_ITEMS). */
export type ReviewItemId =
  | "pages_reviewed"
  | "changes_sent"
  | "key_facts"
  | "phone_check"
  | "test_form"
  | "no_open_requests";

export type ReviewPageStatus =
  "looks_good" | "needs_change" | "not_looked" | "changed_since";

/** One checklist item as /hub/review renders it (the 14-33 ReviewItem shape). */
export type ReviewItemView = {
  id: string;
  label: string;
  done: boolean;
  /** When the item was ticked (key facts, phone check, test form), else null. */
  at: string | null;
  count: number | null;
  of: number | null;
};

export type ReviewPageView = {
  id: string;
  title: string;
  path: string;
  status: ReviewPageStatus;
};

/** What the checklist needs from launchReviewView (structural; no @cds/db import). */
export type ReviewChecklistView = {
  items: readonly ReviewItemView[];
  done: number;
  total: number;
  pages: readonly ReviewPageView[];
  hasForm: boolean;
};

export const REVIEW_UI_COPY = Object.freeze({
  title: "Review your site",
  helpName: "Review your site before launch",
  count: (done: number, total: number) => `${done} of ${total} done`,
  progressLabel: "Launch review progress",
  ownerOnly: "Only the owner can approve the launch.",
  impersonating:
    "You're viewing as support staff, so this is turned off. Only the owner can approve the launch.",
  notAvailable: "Support will email you when your review is ready to start.",
  newTab: "(opens in a new tab)",
  open: "Open",
  pageStatus: {
    looks_good: "Looks good",
    needs_change: "Needs a change",
    not_looked: "Not looked at",
    changed_since: "Changed since",
  } as Readonly<Record<ReviewPageStatus, string>>,
  // Item sub-lines (UI-SPEC table).
  pagesProgress: (n: number, of: number) =>
    `${n} of ${of} ${of === 1 ? "page" : "pages"} marked Looks good`,
  pagesDone: (of: number) =>
    of === 1 ? "Your page looks good" : `All ${of} pages look good`,
  pagesReset: (title: string) =>
    `${title} changed after you approved it. Look at it again.`,
  noPages: "Your pages appear here once they're published.",
  changesNone: "None asked for",
  changesSent: (n: number) => `${n} sent to Support`,
  changesWaiting: (sent: number, of: number) =>
    `${sent} of ${of} sent to Support`,
  factsLine: "Business name, phone, email, address and hours",
  confirmedOn: (day: string) => (day ? `Confirmed ${day}` : "Confirmed"),
  phoneLine: "Scan a code with your phone and look around",
  checkedOn: (day: string) => (day ? `Checked ${day}` : "Checked"),
  testFormLine: "Send a test message from your Contact page",
  testFormWaiting: "Waiting for your test message…",
  openRequests: (n: number) =>
    `${n} change ${n === 1 ? "request" : "requests"} open. Support is working on it.`,
  noOpenRequests: "No open change requests",
  // Key facts (?step=facts).
  backToReview: "Review your site",
  factsHeading: "Check your key details",
  factLabels: {
    name: "Business name",
    phone: "Phone",
    email: "Email",
    address: "Address",
    hours: "Hours",
  },
  edit: "Edit",
  editAria: (what: string) => `Edit ${what.toLowerCase()}`,
  notSet: "Not added yet",
  emailConfirmed: "Confirmed",
  emailNotConfirmed: "Not confirmed yet",
  resendConfirmation: "Resend confirmation",
  resent: "Confirmation sent.",
  confirm: "Confirm these details",
  confirming: "Confirming…",
  confirmedToast: "Key details confirmed.",
  // Phone check (?step=phone).
  phoneHeading: "Check on your phone",
  phoneBodyBefore:
    "Scan this with your phone's camera. Your site opens in review mode. Look around, then tap ",
  phoneBodyAfter: " at the bottom.",
  qrLabel: "QR code that opens your site in review mode on a phone",
  orOpen: "Or open this link on your phone:",
  linkLife: "The link works for 60 minutes and only for you.",
  onPhone: "You're on your phone already.",
  linkCopied: "Review link copied.",
  copyLinkAria: "Copy the review link",
  phoneCheckedToast: "Phone check done.",
  noLink: "Your preview address isn't ready yet. Support is setting it up.",
  // Submit panel.
  readyToLaunch: "Ready to launch",
  sending: "Sending…",
  finishMore: (n: number) =>
    `Finish ${n} more ${n === 1 ? "item" : "items"} above.`,
  noDomainHeading: "Connect your domain to choose where your site goes live.",
  connectDomain: "Connect your domain",
  domainSettings: "Settings › Domain",
});

/** The sub-line under one checklist row, by item and state (UI-SPEC table). */
export function itemSubLine(
  item: ReviewItemView,
  pages: readonly ReviewPageView[],
  hasForm: boolean,
  day: string,
): string {
  const c = item.count ?? 0;
  const of = item.of ?? 0;
  switch (item.id) {
    case "pages_reviewed": {
      const reset = pages.find((p) => p.status === "changed_since");
      if (reset) return REVIEW_UI_COPY.pagesReset(reset.title);
      if (of === 0) return REVIEW_UI_COPY.noPages;
      return item.done
        ? REVIEW_UI_COPY.pagesDone(of)
        : REVIEW_UI_COPY.pagesProgress(c, of);
    }
    case "changes_sent":
      if (of === 0) return REVIEW_UI_COPY.changesNone;
      return item.done
        ? REVIEW_UI_COPY.changesSent(c)
        : REVIEW_UI_COPY.changesWaiting(c, of);
    case "key_facts":
      return item.done
        ? REVIEW_UI_COPY.confirmedOn(day)
        : REVIEW_UI_COPY.factsLine;
    case "phone_check":
      return item.done
        ? REVIEW_UI_COPY.checkedOn(day)
        : REVIEW_UI_COPY.phoneLine;
    case "test_form":
      if (!hasForm) return P14_COPY.TESTFORM_NA;
      return item.done ? P14_COPY.TESTFORM_DONE : REVIEW_UI_COPY.testFormLine;
    case "no_open_requests":
      return c > 0
        ? REVIEW_UI_COPY.openRequests(c)
        : REVIEW_UI_COPY.noOpenRequests;
    default:
      return "";
  }
}

const SHORT_DAY: Readonly<Record<string, string>> = Object.freeze({
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
});
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** "09:00" -> { text: "9", half: "am" }, "17:30" -> { "5:30", "pm" }, "00:00" -> { "12", "am" }. */
function clock(hhmm: string): { text: string; half: "am" | "pm" } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hour = Number(m[1]);
  const h = hour % 12 || 12;
  return {
    text: m[2] === "00" ? String(h) : `${h}:${m[2]}`,
    half: hour % 24 < 12 ? "am" : "pm",
  };
}

/**
 * WR-E06: one opening range with am/pm, so the owner can tell 8am–8pm from 8pm–8am.
 * The end always carries its marker; the start carries one only when it is in the other
 * half of the day: "9am–5pm", "9–11am", "12am–6am" → "12–6am".
 */
export function hoursRange(start: string, end: string): string {
  const a = clock(start);
  const b = clock(end);
  if (!a || !b) return `${start}–${end}`;
  return a.half === b.half
    ? `${a.text}–${b.text}${b.half}`
    : `${a.text}${a.half}–${b.text}${b.half}`;
}

function rangesText(ranges: readonly TimeRange[]): string {
  return ranges.map((r) => hoursRange(r.start, r.end)).join(", ");
}

/**
 * Compact weekly hours: "Mon–Fri 9am–5pm, Sat 10am–2pm" (runs of days with the same ranges joined).
 * "" when there are no hours or every day is closed.
 */
export function compactWeeklyHours(hours: WeeklyHours | null): string {
  if (!hours) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const day = hours[DAY_ORDER[i]!];
    const text =
      day && day.open && day.ranges.length > 0 ? rangesText(day.ranges) : "";
    let j = i;
    while (j + 1 < DAY_ORDER.length) {
      const next = hours[DAY_ORDER[j + 1]!];
      const nextText =
        next && next.open && next.ranges.length > 0
          ? rangesText(next.ranges)
          : "";
      if (nextText !== text) break;
      j += 1;
    }
    if (text) {
      const from = SHORT_DAY[DAY_ORDER[i]!]!;
      const to = SHORT_DAY[DAY_ORDER[j]!]!;
      parts.push(`${i === j ? from : `${from}–${to}`} ${text}`);
    }
    i = j + 1;
  }
  return parts.join(", ");
}
