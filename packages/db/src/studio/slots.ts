// Open booking times (Studio Booking step 2). Pure. Ported from palm-science's
// fetchAvailableSlots (weekly schedule -> date override -> busy ranges -> step through the
// day), adapted to many barbers: each seat has its own weekly hours (the intake WeeklyHours
// shape, several ranges per day) and whole-day time off; busy ranges are that barber's
// confirmed bookings. Times are the shop's local wall clock (business time zone); every
// instant is UTC milliseconds.
import type { Day, WeeklyHours } from "@cds/core/intake";

/** Default gap between bookable start times; a barber can pick their own (SLOT_CHOICES). */
export const SLOT_STEP_MIN = 60;
export const SLOT_CHOICES = [15, 30, 45, 60, 90, 120] as const;

/** A seat's slot_minutes, or the default when unset / not a choice. */
export function slotMinutesOf(v: unknown): number {
  return (SLOT_CHOICES as readonly number[]).includes(Number(v))
    ? Number(v)
    : SLOT_STEP_MIN;
}
/** No booking closer than this to now. */
export const LEAD_MIN = 60;
/** How far ahead a visitor can book. */
export const BOOK_AHEAD_DAYS = 30;

const DAY_KEYS: readonly Day[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Days start..end; with from/to only that part of each day is blocked (else all day). */
export type TimeOff = {
  start: string;
  end: string;
  from?: string;
  to?: string;
};
export type Busy = { start: number; end: number };
export type Slot = { time: string; startsAt: number; endsAt: number };

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** The zone's offset from UTC (ms) at `utcMs`. */
function offsetAt(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Local wall-clock date + time in `tz` -> UTC ms (DST-safe for real wall times). */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

/** UTC ms -> { date, time } on the shop's wall clock. */
export function utcToZoned(
  utcMs: number,
  tz: string,
): { date: string; time: string } {
  const local = new Date(utcMs + offsetAt(utcMs, tz));
  return {
    date: local.toISOString().slice(0, 10),
    time: local.toISOString().slice(11, 16),
  };
}

/** "YYYY-MM-DD" plus n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOf(date: string): Day {
  return DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

const onDate = (date: string, o: TimeOff) => date >= o.start && date <= o.end;
const partial = (o: TimeOff) => isTime(o.from) && isTime(o.to);

/** The whole day is off. */
export function isOff(date: string, off: readonly TimeOff[]): boolean {
  return off.some((o) => onDate(date, o) && !partial(o));
}

/**
 * Open start times for one barber on one local date: inside a working range of that weekday,
 * not on time off, the whole service fits before the range ends, not overlapping a busy
 * range, at least LEAD_MIN from now and within BOOK_AHEAD_DAYS.
 */
export function openSlots(input: {
  date: string;
  hours: WeeklyHours | null;
  timeOff: readonly TimeOff[];
  busy: readonly Busy[];
  durationMin: number;
  tz: string;
  now: number;
  stepMin?: number;
}): Slot[] {
  const { date, hours, timeOff, busy, durationMin, tz, now } = input;
  const step = input.stepMin ?? SLOT_STEP_MIN;
  if (!isDate(date) || !hours || durationMin <= 0) return [];
  const today = utcToZoned(now, tz).date;
  if (date < today || date > addDays(today, BOOK_AHEAD_DAYS)) return [];
  if (isOff(date, timeOff)) return [];
  const day = hours[dayOf(date)];
  if (!day?.open) return [];
  const blocked: Busy[] = timeOff
    .filter((o) => onDate(date, o) && partial(o))
    .map((o) => ({
      start: zonedToUtc(date, o.from!, tz),
      end: zonedToUtc(date, o.to!, tz),
    }));
  const taken = [...busy, ...blocked];
  const earliest = now + LEAD_MIN * 60_000;
  const out: Slot[] = [];
  for (const r of day.ranges) {
    if (!isTime(r.start) || !isTime(r.end)) continue;
    for (let m = toMin(r.start); m + durationMin <= toMin(r.end); m += step) {
      const time = toTime(m);
      const startsAt = zonedToUtc(date, time, tz);
      const endsAt = startsAt + durationMin * 60_000;
      if (startsAt < earliest) continue;
      if (taken.some((b) => startsAt < b.end && endsAt > b.start)) continue;
      out.push({ time, startsAt, endsAt });
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}
