// Bell copy and pure helpers (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell", BELL-EMPTY, ERR-LOAD).
// Browser-safe: no @cds/db. Owner words only; the bell never says "CDS" except the section
// label of a CDS Support alert.
import { businessDate } from "@cds/core/today";

/** One bell row as the hub receives it (the shape of @cds/db BellAlert). */
export type BellRow = {
  id: string;
  type: string;
  level: "urgent" | "normal" | "summary";
  /** Full title: the hub always shows it (D305). */
  title: string;
  href: string;
  section: string;
  /** ISO time the alert was raised. */
  createdAt: string;
  read: boolean;
  /** Its Needs-you item is done: renders read and is not counted. */
  cleared: boolean;
};

export const ALERTS_COPY = {
  title: "Alerts",
  markAll: "Mark all as read",
  close: "Close",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
  /** BELL-EMPTY-H / BELL-EMPTY-B */
  emptyHeading: "No alerts yet",
  emptyBody: "When something needs you, it shows here.",
  /** ERR-LOAD (P3) */
  errLoad: "We couldn't load this. Check your connection and try again.",
  tryAgain: "Try again",
  showMore: "Show more",
  settings: "Alert settings",
  settingsHref: "/hub/profile#alerts",
  unread: "Unread",
  urgent: "Urgent",
  done: "Done",
  loading: "Loading alerts",
} as const;

/** Badge text: the number, "9+" above nine. */
export function bellChipText(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/** "Alerts" / "Alerts, 3 unread" / "Alerts, 3 unread, 1 urgent" (UI-SPEC accessible name). */
export function bellLabel(count: number, urgent: number): string {
  if (!(count > 0)) return ALERTS_COPY.title;
  const base = `${ALERTS_COPY.title}, ${count} unread`;
  return urgent > 0 ? `${base}, ${urgent} urgent` : base;
}

/** Polite announcement when the count goes up: "1 new alert" / "3 new alerts"; "" otherwise. */
export function newAlertsText(previous: number, next: number): string {
  const d = next - previous;
  if (!(d > 0)) return "";
  return d === 1 ? "1 new alert" : `${d} new alerts`;
}

const SECTION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  today: "Today",
  inbox: "Inbox",
  website: "Website",
  marketing: "Marketing",
  reports: "Reports",
  settings: "Settings",
  addons: "Add-ons",
  help: "Help",
  support: "CDS Support",
});

/** The row's section label in owner words ("Inbox"; `addon:studio-booking` -> "Studio booking"). */
export function alertSectionLabel(section: string): string {
  if (SECTION_WORDS[section]) return SECTION_WORDS[section];
  if (section.startsWith("addon:")) {
    const slug = section.slice("addon:".length).replace(/-/g, " ");
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }
  return "Your site";
}

function parseTime(raw: string): number {
  if (typeof raw !== "string" || raw === "") return Number.NaN;
  return Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
}

/** The calendar day before `ymd` (`YYYY-MM-DD`). */
function dayBefore(ymd: string): string {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

export type BellGroup = {
  key: "today" | "yesterday" | "earlier";
  label: string;
  rows: BellRow[];
};

/**
 * Rows grouped by business-time day: Today, Yesterday, Earlier (empty groups dropped; order
 * within a group kept, newest first as the API sends them). An unreadable time is Earlier.
 */
export function groupBellRows(
  rows: readonly BellRow[],
  timeZone: string,
  now: number,
): BellGroup[] {
  const today = businessDate(new Date(now), timeZone);
  const yesterday = dayBefore(today);
  const groups: BellGroup[] = [
    { key: "today", label: ALERTS_COPY.today, rows: [] },
    { key: "yesterday", label: ALERTS_COPY.yesterday, rows: [] },
    { key: "earlier", label: ALERTS_COPY.earlier, rows: [] },
  ];
  for (const r of rows) {
    const t = parseTime(r.createdAt);
    const day = Number.isNaN(t) ? "" : businessDate(new Date(t), timeZone);
    const g = day === today ? 0 : day === yesterday ? 1 : 2;
    groups[g]!.rows.push(r);
  }
  return groups.filter((g) => g.rows.length > 0);
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago"; "" when unreadable. */
export function alertAge(raw: string, now: number): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// ---------------------------------------------------------------------------------------
// Your profile and alerts (11-24; DASH-36, DASH-37; 11-UI-SPEC "Profile" lines 368-401;
// copy ALERTS-INTRO, SENSITIVE-ON, QUIET-HELP, DEVICES-EMPTY, PROFILE-SIGNIN-HELP).

export const PROFILE_COPY = {
  title: "Your profile and alerts",
  you: "You",
  name: "Name",
  email: "Email",
  /** PROFILE-SIGNIN-HELP */
  signinHelp: "To change your sign-in email, ask CDS Support.",
  alerts: "Alerts",
  /** ALERTS-INTRO */
  alertsIntro:
    "Choose how each alert reaches you. The bell always shows everything.",
  colAlert: "Alert",
  colBell: "Bell",
  colEmail: "Email",
  colPhone: "Phone",
  bellAlwaysOn: "Bell alerts are always on",
  notAvailable: "Not available",
  levels: {
    urgent: { label: "Urgent", help: "Sent straight away" },
    normal: {
      label: "Normal",
      help: "Sent straight away; phone alerts wait for quiet hours",
    },
    summary: { label: "Summary", help: "Collected into one email at 7am" },
  },
  noAlerts: "No alerts cover your role on this site yet.",
  reset: "Reset to defaults",
  resetDone: "Alerts reset to the defaults.",
  undo: "Undo",
  quiet: "Quiet hours",
  quietSwitch: "Hold phone alerts at night",
  from: "From",
  until: "Until",
  devices: "Phones and computers",
  thisDevice: "This device",
  turnOff: "Turn off",
  turnedOff: "Alerts turned off for that device.",
  /** DEVICES-EMPTY */
  devicesEmpty:
    "No phones or computers get alerts yet. Turn them on from Today on your phone.",
  turnOnHere: "Turn on alerts on this device",
  turnedOn: "Alerts are on for this device.",
  pushDenied:
    "Alerts are blocked for this site in your browser settings. Allow notifications there, then try again.",
  pushError: "We couldn't turn on alerts just now. Try again in a minute.",
  tours: "Tours",
  toursBody: "Tours show the first time you open a screen.",
  toursAgain: "Show the tours again",
  toursDone: "Tours will show again the next time you open each screen.",
  /** Impersonation (UI-SPEC IMPERSONATING pattern). */
  impersonating:
    "You're viewing as CDS staff, so alert settings are turned off. Only the person can change their own alerts.",
} as const;

/** SENSITIVE-ON with the business name. */
export function sensitiveOnCopy(business: string): string {
  return `Sensitive-practice mode is on for ${business}, so phone and email alerts never show a client's name or service.`;
}

/** QUIET-HELP naming the business time zone ("Central Time"); the zone id when unnamed. */
export function quietHelpCopy(zoneLabel: string): string {
  return `Phone alerts that arrive at night wait until morning and come as one summary. Times are in ${zoneLabel}, your business's time zone.`;
}

/** "Your role at Rivera Bakery · Owner". */
export function roleLine(business: string, role: string): string {
  const r = role.charAt(0).toUpperCase() + role.slice(1);
  return `Your role at ${business} · ${r}`;
}

/** "21:00" -> "9:00 pm", "00:30" -> "12:30 am"; the input when unreadable. */
export function clockLabel(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Every half hour of the day: 00:00, 00:30 … 23:30 (member_prefs accepts :00 and :30 only). */
export function halfHourOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 48; i++) {
    const v = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
    out.push({ value: v, label: clockLabel(v) });
  }
  return out;
}

const FAMILY_NAMES: Readonly<Record<string, string>> = {
  iphone: "iPhone",
  android: "Android phone",
  desktop: "Computer",
};

/** Device family as owner words; unknown families read "Phone or computer". */
export function deviceName(uaFamily: string): string {
  return FAMILY_NAMES[uaFamily.trim().toLowerCase()] ?? "Phone or computer";
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
];

/** "9 Oct" in the business time zone; "" when unreadable. */
export function dayMonth(raw: string, timeZone: string): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  const day = businessDate(new Date(t), timeZone);
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ""}`.trim();
}

/** "iPhone · turned on 9 Oct". */
export function deviceLine(
  d: { uaFamily: string; createdAt: string },
  timeZone: string,
): string {
  const when = dayMonth(d.createdAt, timeZone);
  const name = deviceName(d.uaFamily);
  return when ? `${name} · turned on ${when}` : name;
}

/** Accessible name of a device's Turn off: "Turn off alerts on iPhone, turned on 9 Oct". */
export function turnOffLabel(
  d: { uaFamily: string; createdAt: string },
  timeZone: string,
): string {
  const when = dayMonth(d.createdAt, timeZone);
  const name = deviceName(d.uaFamily);
  return when
    ? `Turn off alerts on ${name}, turned on ${when}`
    : `Turn off alerts on ${name}`;
}
