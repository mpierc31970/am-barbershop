// Thread copy and time helpers (12-09 choice 5; 12-UI-SPEC lines 116-130, 301-333).
// Words the thread needs that are not Copywriting Contract IDs (those live in
// SUPPORT_UI_COPY): the checking badge and reason, the unread divider, day labels and the
// new-tab suffix. Times are business time: clock times inside a thread ("2:14 pm") under
// day separators ("Today", "Yesterday", "Thu 9 Oct"). Browser-safe; no @cds/db.
import { businessDate } from "@cds/core/today";

export const THREAD_COPY = Object.freeze({
  checking: "Checking file",
  checkingReason: "This file is still being checked. Try again later.",
  unread: "New since your last visit",
  today: "Today",
  yesterday: "Yesterday",
  you: "You",
  newTab: "(opens in a new tab)",
  dropOverlay: "Drop files to attach",
  uploading: (pct: number) => `Uploading ${pct}%`,
  uploadingValue: (name: string, pct: number) => `Uploading ${name}, ${pct}%`,
  waitForUploads: "Wait for your files to finish uploading.",
  /** 12-REVIEW WR-D04: a failed file blocks Send, so it is never silently dropped. */
  failedUploads: "Remove or retry the file that didn't upload.",
  /** 12-REVIEW IN-D01: a download whose link request threw (network drop, a 500). */
  downloadFailed:
    "That download didn't start. Check your connection and try again.",
  counter: (n: number, max: number) =>
    `${n.toLocaleString("en-US")} of ${max.toLocaleString("en-US")}`,
  threadLabel: "Messages",
});

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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** PocketBase dates are "YYYY-MM-DD HH:MM:SS.sssZ"; ISO works too. NaN when unreadable. */
export function parseTime(raw: string): number {
  if (typeof raw !== "string" || !raw) return NaN;
  return Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
}

function wallClock(t: number, timeZone: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(t));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { h, m };
}

function clockOf(t: number, timeZone: string): string {
  const { h, m } = wallClock(t, timeZone);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "2:14 pm" in business time; "" when unreadable. */
export function clockTime(raw: string, timeZone: string): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  try {
    return clockOf(t, timeZone);
  } catch {
    return "";
  }
}

function dayParts(day: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** The business day key `YYYY-MM-DD` of a stored time; "" when unreadable. */
export function dayKey(raw: string, timeZone: string): string {
  const t = parseTime(raw);
  if (!Number.isFinite(t)) return "";
  try {
    return businessDate(new Date(t), timeZone);
  } catch {
    return "";
  }
}

/** "Today", "Yesterday", "Thu 9 Oct" ("Thu 9 Oct 2025" in another year); "" if unreadable. */
export function dayLabel(raw: string, timeZone: string, now: number): string {
  const day = dayKey(raw, timeZone);
  const p = dayParts(day);
  if (!p) return "";
  const today = businessDate(new Date(now), timeZone);
  if (day === today) return THREAD_COPY.today;
  const t = dayParts(today);
  if (t) {
    const y = new Date(Date.UTC(t.y, t.m - 1, t.d - 1));
    if (
      y.getUTCFullYear() === p.y &&
      y.getUTCMonth() + 1 === p.m &&
      y.getUTCDate() === p.d
    ) {
      return THREAD_COPY.yesterday;
    }
  }
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  const label = `${weekday} ${p.d} ${MONTHS[p.m - 1] ?? ""}`;
  return t && t.y !== p.y ? `${label} ${p.y}` : label;
}

/** "Screenshot 12 Oct, 2:14 pm.png" (UI-SPEC line 342), in business time. */
export function screenshotName(
  now: Date,
  timeZone: string,
  ext = "png",
): string {
  const t = now.getTime();
  const p = dayParts(businessDate(now, timeZone));
  const day = p ? `${p.d} ${MONTHS[p.m - 1] ?? ""}` : "";
  return `Screenshot ${day}, ${clockOf(t, timeZone)}.${ext}`;
}
