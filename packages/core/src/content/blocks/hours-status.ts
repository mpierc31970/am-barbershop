// Business hours status helpers (07-24; CONT-27, D257; UI-SPEC rows 366, 645, a11y 683).
//
// The hours block renders the 7-day table on the server ("today" computed in the business
// time zone from the request's `now`) and a client island computes the "Open now" pill in
// the visitor's browser from the same helpers. Never throws: an invalid zone or malformed
// hours yield null / "" so a page always renders (T-07-24-06).
// Pure and Edge-safe: Intl only, no Node built-ins, no html cleaner, no next/* imports.
// Every name is block-specific (exports-b shares a flat barrel with exports-a).
import { DAYS, DAY_LABELS, type Day } from "../../intake/stages";
import type { WeeklyHours } from "../../intake/snapshot";

export type HoursRow = {
  day: Day;
  label: string;
  /** "9:00 am to 5:00 pm" ranges joined by ", ", or "Closed". */
  text: string;
  closed: boolean;
  today: boolean;
};

export type HoursOpenStatus = { open: boolean; label: string };

const HHMM = /^(\d{2}):(\d{2})$/;

function minutesOf(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** "09:00" -> "9:00 am"; "12:00" -> "12:00 pm"; "00:15" -> "12:15 am". "" when invalid. */
export function formatClock(hhmm: string): string {
  const total = minutesOf(hhmm);
  if (total === null) return "";
  const h = Math.floor(total / 60) % 24;
  const min = String(total % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${h < 12 ? "am" : "pm"}`;
}

type DayRanges = { start: number; end: number }[];

/** Usable ranges for a day: valid, end after start, sorted. Closed or malformed -> []. */
function rangesFor(hours: WeeklyHours | null, day: Day): DayRanges {
  if (!hours || typeof hours !== "object") return [];
  const d = Object.prototype.hasOwnProperty.call(hours, day)
    ? (hours as Record<string, unknown>)[day]
    : undefined;
  if (typeof d !== "object" || d === null) return [];
  const { open, ranges } = d as { open?: unknown; ranges?: unknown };
  if (open !== true || !Array.isArray(ranges)) return [];
  const out: DayRanges = [];
  for (const r of ranges as unknown[]) {
    if (typeof r !== "object" || r === null) continue;
    const start = minutesOf((r as { start?: unknown }).start);
    const end = minutesOf((r as { end?: unknown }).end);
    if (start === null || end === null || end <= start) continue;
    out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

function clockOf(total: number): string {
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return formatClock(`${h}:${m}`);
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Readonly<Record<string, number>> = Object.freeze({
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
});

/** Weekday index (Monday 0) and minutes past midnight of `now` in `timeZone`; null if invalid. */
function zoneNow(
  timeZone: string,
  now: Date,
): { dayIndex: number; minutes: number } | null {
  if (typeof timeZone !== "string" || timeZone === "") return null;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  try {
    let fmt = zoneFormatters.get(timeZone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      zoneFormatters.set(timeZone, fmt);
    }
    let weekday = "";
    let hour = NaN;
    let minute = NaN;
    for (const p of fmt.formatToParts(now)) {
      if (p.type === "weekday") weekday = p.value;
      else if (p.type === "hour") hour = Number(p.value);
      else if (p.type === "minute") minute = Number(p.value);
    }
    const dayIndex = Object.prototype.hasOwnProperty.call(
      WEEKDAY_INDEX,
      weekday,
    )
      ? WEEKDAY_INDEX[weekday]!
      : -1;
    if (dayIndex < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return { dayIndex, minutes: (hour % 24) * 60 + minute };
  } catch {
    return null;
  }
}

/** Seven rows, Monday first; `today` is the weekday of `now` in the business zone. */
export function hoursRows(
  hours: WeeklyHours | null,
  timeZone: string,
  now: Date,
): HoursRow[] {
  const z = zoneNow(timeZone, now);
  return DAYS.map((day, i) => {
    const ranges = rangesFor(hours, day);
    const closed = ranges.length === 0;
    return {
      day,
      label: DAY_LABELS[day],
      text: closed
        ? "Closed"
        : ranges
            .map((r) => `${clockOf(r.start)} to ${clockOf(r.end)}`)
            .join(", "),
      closed,
      today: z !== null && z.dayIndex === i,
    };
  });
}

/** The "Open now" pill text, or null when there are no hours or the zone is unusable. */
export function openStatus(
  hours: WeeklyHours | null,
  timeZone: string,
  now: Date,
): HoursOpenStatus | null {
  if (!hours) return null;
  const z = zoneNow(timeZone, now);
  if (!z) return null;
  const today = rangesFor(hours, DAYS[z.dayIndex]!);
  for (const r of today) {
    if (z.minutes >= r.start && z.minutes < r.end) {
      return { open: true, label: `Open now · Closes at ${clockOf(r.end)}` };
    }
  }
  const later = today.find((r) => r.start > z.minutes);
  if (later) {
    return {
      open: false,
      label: `Closed now · Opens at ${clockOf(later.start)}`,
    };
  }
  for (let step = 1; step <= 7; step++) {
    const day = DAYS[(z.dayIndex + step) % 7]!;
    const first = rangesFor(hours, day)[0];
    if (first) {
      return {
        open: false,
        label: `Closed now · Opens ${DAY_LABELS[day]} at ${clockOf(first.start)}`,
      };
    }
  }
  return null;
}

/** "America/Chicago" -> "Central Time"; "" for an invalid or blank zone. */
export function timeZoneLabel(timeZone: string): string {
  if (typeof timeZone !== "string" || timeZone === "") return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date(0));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
