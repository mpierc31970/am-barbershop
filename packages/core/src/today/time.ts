// Business time (Pitfall 20, T-11-04-02): every "today", week boundary, greeting and quiet-hours
// check uses business_profile.time_zone through these helpers, falling back to America/Chicago
// (the CDS home zone). Intl only; correct across DST.

export const DEFAULT_TIME_ZONE = "America/Chicago";

/** A valid IANA zone, or America/Chicago. */
export function businessTimeZone(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: raw.trim(),
    }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

type Wall = {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function wall(now: Date, tz: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of fmt(businessTimeZone(tz)).formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    y: parts.year ?? 1970,
    m: parts.month ?? 1,
    d: parts.day ?? 1,
    h: (parts.hour ?? 0) % 24,
    min: parts.minute ?? 0,
    s: parts.second ?? 0,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

/** The business-local calendar day, `YYYY-MM-DD`. */
export function businessDate(now: Date, tz: string): string {
  const w = wall(now, tz);
  return ymd(w.y, w.m, w.d);
}

/** Minutes since business-local midnight (0-1439). */
export function zonedMinutes(now: Date, tz: string): number {
  const w = wall(now, tz);
  return w.h * 60 + w.min;
}

function parseDay(day: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`invalid day: ${day}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The calendar day after `YYYY-MM-DD` (never now + 24 h, which a DST day breaks). */
export function nextBusinessDate(day: string): string {
  return addDays(day, 1);
}

export type WeekBounds = {
  /** Monday..Sunday of the current business week, `YYYY-MM-DD`. */
  current: string[];
  /** Monday..Sunday of the week before. */
  previous: string[];
};

/** Monday-start current and previous week, as business-local day lists. */
export function weekBounds(now: Date, tz: string): WeekBounds {
  const today = businessDate(now, tz);
  const { y, m, d } = parseDay(today);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((dow + 6) % 7));
  const days = (start: string) =>
    Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { current: days(monday), previous: days(addDays(monday, -7)) };
}

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** 05:00-11:59 morning, 12:00-17:59 afternoon, otherwise evening (UI-SPEC § 1, D-UI-P11-13). */
export function greetingFor(now: Date, tz: string): Greeting {
  const h = wall(now, tz).h;
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function offsetMs(t: number, tz: string): number {
  const w = wall(new Date(t), tz);
  return (
    Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000
  );
}

/** The UTC instant of business-local midnight starting `day` (DST-aware). */
export function startOfBusinessDayUtc(day: string, tz: string): Date {
  const { y, m, d } = parseDay(day);
  const zone = businessTimeZone(tz);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, zone);
  const again = guess - offsetMs(t, zone);
  if (again !== t) t = again;
  return new Date(t);
}
