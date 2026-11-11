// Credential date helpers (CONTEXT A5-Q2; 05-UI-SPEC "Credentials tab", "Credentials block").
// Pure and shared by the site block, the hub panel and server.ts blockData, so "expired" and
// "expires soon" mean the same thing everywhere. Dates are calendar days: a stored value is
// "YYYY-MM-DD" or PocketBase's "YYYY-MM-DD 00:00:00.000Z"; only the day part is read, and
// "today" is the calendar day of `now` (the request time) at UTC-12, "anywhere on Earth"
// (B-WR-03). Organizations have no time zone yet, so the latest zone is used: a credential is
// valid through its expiry day wherever the tenant is, and never hides before that day ends
// locally (a Texas tenant's "valid through 14 Mar" no longer vanishes at 19:00 CDT). East of
// UTC-12 it can show up to a day longer, the safe side. Swap in the org's zone once it exists.
// A credential is expired from the day after its expiry day. Month names are fixed English so server and
// client render the same text (no locale drift, no hydration mismatch).

const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/;
const MS_PER_DAY = 86_400_000;

export const EXPIRES_SOON_DAYS = 60;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "YYYY-MM-DD" for a real calendar day, else "". */
export function dayOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = DAY.exec(value.trim());
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d
  ) {
    return "";
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function epochDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** Hours behind UTC of the latest time zone (UTC-12, "anywhere on Earth"). */
export const LATEST_ZONE_OFFSET_HOURS = 12;

function today(now: Date): number {
  return Math.floor(
    (now.getTime() - LATEST_ZONE_OFFSET_HOURS * 3_600_000) / MS_PER_DAY,
  );
}

/** Whole days from today (anywhere on Earth) until the day; null when not a date. */
export function daysUntil(value: unknown, now: Date): number | null {
  const day = dayOf(value);
  return day === "" ? null : epochDay(day) - today(now);
}

/** True from the day after expires_on. No (or no valid) expiry never expires. */
export function isExpired(expires_on: unknown, now: Date): boolean {
  const n = daysUntil(expires_on, now);
  return n !== null && n < 0;
}

/** Not yet expired and expiring within `days` days (today counts as 0). */
export function expiresSoon(
  expires_on: unknown,
  now: Date,
  days: number = EXPIRES_SOON_DAYS,
): boolean {
  const n = daysUntil(expires_on, now);
  return n !== null && n >= 0 && n <= days;
}

function parts(value: unknown): [number, number, number] | null {
  const day = dayOf(value);
  if (day === "") return null;
  return day.split("-").map(Number) as [number, number, number];
}

/** "March 2027" (site: "Valid through March 2027"); "" when not a date. */
export function formatMonthYear(value: unknown): string {
  const p = parts(value);
  return p ? `${MONTHS[p[1] - 1]} ${p[0]}` : "";
}

/** "2019" (site: "Since 2019", hub: "Issued 2019"); "" when not a date. */
export function formatYear(value: unknown): string {
  const p = parts(value);
  return p ? String(p[0]) : "";
}

/** "12 Nov" (hub badges and the expiring notice); "" when not a date. */
export function formatDayMonth(value: unknown): string {
  const p = parts(value);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]!.slice(0, 3)}` : "";
}

/** "14 Mar 2027" (hub row meta line); "" when not a date. */
export function formatDayMonthYear(value: unknown): string {
  const p = parts(value);
  return p ? `${formatDayMonth(value)} ${p[0]}` : "";
}
