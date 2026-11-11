// Today copy and small formatters (11-17; 11-UI-SPEC "Today" lines 402-492, Copywriting
// Contract: STATUS-BUILT, STATUS-REVIEW, TRACK-EDIT, REVIEW-SOON, LIVE-BODY, ERR-SECTION
// verbatim; TRACK-DEFAULT lives in @cds/core/today with the tracker). Pure, browser-safe.
import type { StageName } from "@cds/core/today";
import type { BadgeTone } from "../Badge";

export const TODAY_COPY = Object.freeze({
  /** STATUS-BUILT */
  statusBuilt:
    "CDS is building your site. You can edit anything while we work.",
  /** STATUS-REVIEW */
  statusReview:
    "Your site is ready. Look it over and tell us what to change before it goes live.",
  liveLead: "Your site is live at",
  viewPreview: "View preview",
  viewSite: "View site",
  newTab: "(opens in a new tab)",
  yourBuild: "Your build",
  whatNow: "What CDS is doing now:",
  updated: (day: string) => `Updated ${day}`,
  nowWord: "Now",
  /** TRACK-EDIT */
  trackEdit:
    "You can edit any page while we work. If CDS is working on a page, it says so on that page.",
  reviewHeading: "Review your site before it goes live",
  reviewCount: (done: number, total: number) => `${done} of ${total} done`,
  /** REVIEW-SOON */
  reviewSoon: "CDS will email you when your review is ready to start.",
  continueReview: "Continue review",
  liveHeading: (host: string) => `You're live at ${host}`,
  /** LIVE-BODY */
  liveBody:
    "Your site is on its own address now. Here are three things worth doing this week.",
  showToday: "Show my Today",
  needsYou: "Needs you",
  caughtUp: "You're all caught up.",
  urgent: "Urgent",
  optional: "Optional",
  showAll: (n: number) => `Show all ${n}`,
  /** ERR-SECTION */
  errSection: "We couldn't load this part. The rest of the page is fine.",
  tryAgain: "Try again",
});

/** How many Needs-you rows show before "Show all N" (UI-SPEC § 3). */
export const NEEDS_YOU_VISIBLE = 8;

/** Status-line badge tone by stage (UI-SPEC § 1); stages before build have no line. */
export const STAGE_BADGE_TONE: Readonly<Partial<Record<StageName, BadgeTone>>> =
  Object.freeze({
    ready_for_build: "being-built",
    being_built: "being-built",
    ready_for_review: "ready-review",
    live: "live",
  });

/** Where the You're live steps go (D-UI-P11-26). */
export const YOURE_LIVE_HREFS = Object.freeze({
  social: "/hub/marketing?tab=social",
  googleHelp: "/hub/help/google-business-profile",
  reports: "/hub/reports",
});

export type YoureLiveStep = {
  id: "share" | "google" | "outreach" | "report";
  title: string;
  line: string;
  actionLabel: string;
  href: string;
};

/**
 * The three first-week steps. Step 3 is Outreach only when an Outreach add-on is active
 * (its tab href is passed in); otherwise the Site Report.
 */
export function youreLiveSteps(outreachHref?: string | null): YoureLiveStep[] {
  return [
    {
      id: "share",
      title: "Share your site",
      line: "Put your bio links on Instagram, Facebook and the rest.",
      actionLabel: "Add your bio links",
      href: YOURE_LIVE_HREFS.social,
    },
    {
      id: "google",
      title: "Check your Google Business Profile",
      line: "Make sure your hours, phone and website match.",
      actionLabel: "How to check it",
      href: YOURE_LIVE_HREFS.googleHelp,
    },
    outreachHref
      ? {
          id: "outreach",
          title: "See what Outreach will send",
          line: "Look over your first messages before they go out.",
          actionLabel: "Open Outreach",
          href: outreachHref,
        }
      : {
          id: "report",
          title: "See your Site Report",
          line: "Your first numbers appear tomorrow.",
          actionLabel: "Open Reports",
          href: YOURE_LIVE_HREFS.reports,
        },
  ];
}

/** PocketBase dates are "YYYY-MM-DD HH:MM:SS.sssZ"; ISO works too. NaN when unreadable. */
function parseTime(raw: string): number {
  return Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
}

/**
 * "9 Oct" in the business time zone; "" when the date can't be read.
 * Built from numeric parts: en-GB prints September as "Sept".
 */
export function formatDayMonth(raw: string, timeZone: string): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "numeric",
      timeZone,
    }).formatToParts(new Date(t));
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    const month = Number(parts.find((p) => p.type === "month")?.value ?? "0");
    const name = MONTHS[month - 1];
    return day && name ? `${day} ${name}` : "";
  } catch {
    return "";
  }
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago"; "" when unreadable. */
export function relativeAge(raw: string, now: number): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// ---------------------------------------------------------------------------------------
// 11-19: Today cards, Customize, This week, From CDS, work in progress (11-UI-SPEC "Today"
// §§ 4-6, 8 and "Live, normal"; WEEK-PRELAUNCH verbatim; D-UI-P11-9, D-UI-P11-30).

export const TODAY_CARDS_COPY = Object.freeze({
  yourDay: "Your day",
  customize: "Customize",
  allHidden: "You've hidden all your cards.",
  cardError: "We couldn't load this card.",
  inquiriesTitle: "Inquiries",
  inquiriesEmpty: "No messages this week.",
  openInbox: "Open Inbox",
  messagesThisWeek: (n: number) =>
    n === 1 ? "1 message this week" : `${n} messages this week`,
  someone: "Someone",
  sheetTitle: "Customize Today",
  sheetIntro: "Choose which cards show and in what order. Only you see this.",
  show: (name: string) => `Show ${name}`,
  reorder: (name: string) => `Reorder ${name}`,
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
  resetOrder: "Reset to default order",
  done: "Done",
  close: "Close",
  impersonating:
    "You're viewing as CDS staff, so changes to Today are turned off. Only the person can change their own Today.",
  thisWeek: "This week",
  visitors: "Visitors",
  messages: "Messages",
  seeReport: "See your Site Report",
  /** WEEK-PRELAUNCH (CONTEXT, verbatim). */
  weekPrelaunch: "Your first numbers appear a day after launch.",
  fromCds: "From CDS",
  fromCdsByline: "From CDS",
  dismiss: "Dismiss this card",
  showMeHow: "Show me how",
  seeAddon: (name: string) => `See ${name}`,
  workHeading: "Work in progress",
  workSteps: ["Ordered", "CDS is setting it up", "Ready"] as const,
  started: (day: string) => `Started ${day}`,
  viewQuote: "View quote",
});

export const TODAY_REPORTS_HREF = "/hub/reports";

export type WeekDelta = { dir: "up" | "down" | "same"; words: string };

/** "12 more than last week" / "3 fewer than last week" / "Same as last week". */
export function weekDelta(now: number, prev: number): WeekDelta {
  const d = Math.round(now) - Math.round(prev);
  if (d > 0) return { dir: "up", words: `${d} more than last week` };
  if (d < 0) return { dir: "down", words: `${-d} fewer than last week` };
  return { dir: "same", words: "Same as last week" };
}

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

function dayParts(day: string): { d: number; month: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  if (!Number.isFinite(date.getTime())) return null;
  return { d: date.getUTCDate(), month: MONTHS[date.getUTCMonth()] ?? "" };
}

/** "Mon 6 – Sun 12 Oct" (or "Mon 29 Sep – Sun 5 Oct") from a Monday-start week of YYYY-MM-DD. */
export function weekRangeLabel(days: readonly string[]): string {
  const a = dayParts(days[0] ?? "");
  const b = dayParts(days[days.length - 1] ?? "");
  if (!a || !b) return "";
  return a.month === b.month
    ? `Mon ${a.d} – Sun ${b.d} ${b.month}`
    : `Mon ${a.d} ${a.month} – Sun ${b.d} ${b.month}`;
}

/** "Tue" in the business time zone; "" when the date can't be read. */
export function formatWeekday(raw: string, timeZone: string): string {
  const t = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      timeZone,
    }).format(new Date(t));
  } catch {
    return "";
  }
}
