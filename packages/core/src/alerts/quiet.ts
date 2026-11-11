// Alert timing (DASH-36, D313): quiet hours, burst collapse and the 7am digest. Pure; all
// clock reads are business time through the 11-04 zone helpers (DST-safe).
import {
  businessDate,
  startOfBusinessDayUtc,
  zonedMinutes,
} from "../today/time";
import type { QuietHours } from "./types";

/** D313 default: hold push 9pm-7am business time. */
export const DEFAULT_QUIET_HOURS: Readonly<QuietHours> = Object.freeze({
  on: true,
  from: "21:00",
  until: "07:00",
});

/** Same-type pushes within 10 minutes collapse into one ("3 new messages"). */
export const COLLAPSE_WINDOW_MS = 600_000;

/** The Summary digest goes out from 07:00 business time. */
export const DIGEST_HOUR = 7;

const MINUTE = 60_000;
const DAY_MIN = 24 * 60;

/** `HH:MM` (00:00-23:59) to minutes, or null. */
function parseHm(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function quietWindow(quiet: QuietHours | undefined): {
  on: boolean;
  from: number;
  until: number;
} {
  const q = quiet ?? DEFAULT_QUIET_HOURS;
  return {
    on: q.on === true,
    from: parseHm(q.from) ?? (parseHm(DEFAULT_QUIET_HOURS.from) as number),
    until: parseHm(q.until) ?? (parseHm(DEFAULT_QUIET_HOURS.until) as number),
  };
}

function inWindow(min: number, from: number, until: number): boolean {
  if (from === until) return false;
  // A window with from > until crosses midnight.
  return from < until ? min >= from && min < until : min >= from || min < until;
}

/** True when push is held for this person right now. Bell and email are unaffected. */
export function inQuietHours(
  now: Date,
  tz: string,
  quiet: QuietHours | undefined,
): boolean {
  const w = quietWindow(quiet);
  if (!w.on) return false;
  return inWindow(zonedMinutes(now, tz), w.from, w.until);
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return t.toISOString().slice(0, 10);
}

/** The UTC instant of business-local `minutes` on `day`, corrected for a DST shift that day. */
function zonedInstant(day: string, minutes: number, tz: string): Date {
  let t = startOfBusinessDayUtc(day, tz).getTime() + minutes * MINUTE;
  let diff = minutes - zonedMinutes(new Date(t), tz);
  if (diff > DAY_MIN / 2) diff -= DAY_MIN;
  if (diff < -DAY_MIN / 2) diff += DAY_MIN;
  t += diff * MINUTE;
  return new Date(t);
}

/** When held pushes are released: the next `until` in business time, or `now` if not quiet. */
export function quietEndsAt(
  now: Date,
  tz: string,
  quiet: QuietHours | undefined,
): Date {
  if (!inQuietHours(now, tz, quiet)) return new Date(now.getTime());
  const { until } = quietWindow(quiet);
  const today = businessDate(now, tz);
  const sameDay = zonedInstant(today, until, tz);
  if (sameDay.getTime() > now.getTime()) return sameDay;
  return zonedInstant(nextDay(today), until, tz);
}

/** True when the last push of this type went out less than 10 minutes ago. */
export function collapseWindowOpen(
  lastPushAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (lastPushAt === null || lastPushAt === undefined || lastPushAt === "") {
    return false;
  }
  const last =
    lastPushAt instanceof Date ? lastPushAt.getTime() : Date.parse(lastPushAt);
  if (!Number.isFinite(last)) return false;
  const age = now.getTime() - last;
  return age >= 0 && age < COLLAPSE_WINDOW_MS;
}

/** True from 07:00 business time, once per business day (`lastDigestDay` is `YYYY-MM-DD`). */
export function digestDue(
  now: Date,
  tz: string,
  lastDigestDay: string | null | undefined,
): boolean {
  if (zonedMinutes(now, tz) < DIGEST_HOUR * 60) return false;
  return businessDate(now, tz) !== (lastDigestDay ?? "");
}
