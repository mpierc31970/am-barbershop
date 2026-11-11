// First-reply SLA (SUPPORT-02, D299; RESEARCH Pattern 3, A6). Business days are Mon-Fri in
// BUSINESS_TIME_ZONE, no holiday calendar in v1. Intl only, no date library; local-to-UTC uses
// a two-pass offset fix so DST days keep the local wall time.
import { BUSINESS_TIME_ZONE } from "../payments";
import { InvalidInput } from "../errors";
import {
  businessDate,
  nextBusinessDate,
  startOfBusinessDayUtc,
} from "../today/time";
import type { TicketType } from "./types";

/** Question and Problem tickets: first public reply within 2 business days. */
export const SLA_BUSINESS_DAYS = 2;
/** "Due soon" when this much business time or less remains (4 business hours). */
export const SLA_DUE_SOON_MS = 4 * 3_600_000;

export type SlaState = "none" | "on_track" | "due_soon" | "missed" | "met";

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

function wall(t: number, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(t))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return {
    y: p.year ?? 1970,
    m: p.month ?? 1,
    d: p.day ?? 1,
    h: (p.hour ?? 0) % 24,
    min: p.minute ?? 0,
    s: p.second ?? 0,
  };
}

function offsetMs(t: number, tz: string): number {
  const w = wall(t, tz);
  return (
    Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000
  );
}

/** UTC instant of a local wall time in `tz` (two-pass offset fix for DST). */
function localToUtc(
  day: string,
  h: number,
  min: number,
  s: number,
  ms: number,
  tz: string,
): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, h, min, s, ms);
  let t = guess - offsetMs(guess, tz);
  const again = guess - offsetMs(t, tz);
  if (again !== t) t = again;
  return new Date(t);
}

/** 0 = Sunday … 6 = Saturday for a `YYYY-MM-DD` calendar day. */
function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWeekday(day: string): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * `start` + `days` business days at the same local wall time. A start on a weekend counts
 * from the next Monday 00:00 local (A6): Fri 16:00 -> Tue 16:00, Sat 10:00 -> Wed 00:00.
 */
export function businessDeadline(
  start: Date,
  days: number,
  tz: string = BUSINESS_TIME_ZONE,
): Date {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new InvalidInput("days must be a non-negative integer");
  }
  const t = start.getTime();
  if (!Number.isFinite(t)) throw new InvalidInput("invalid start");
  let day = businessDate(start, tz);
  const w = wall(t, tz);
  let time = { h: w.h, min: w.min, s: w.s, ms: ((t % 1000) + 1000) % 1000 };
  if (!isWeekday(day)) {
    while (!isWeekday(day)) day = nextBusinessDate(day);
    time = { h: 0, min: 0, s: 0, ms: 0 };
  }
  for (let left = days; left > 0;) {
    day = nextBusinessDate(day);
    if (isWeekday(day)) left--;
  }
  return localToUtc(day, time.h, time.min, time.s, time.ms, tz);
}

/** Milliseconds between `a` and `b` that fall on Mon-Fri local days (0 when b ≤ a). */
export function businessMsBetween(
  a: Date,
  b: Date,
  tz: string = BUSINESS_TIME_ZONE,
): number {
  const from = a.getTime();
  const to = b.getTime();
  if (!(to > from)) return 0;
  let total = 0;
  let day = businessDate(a, tz);
  const last = businessDate(b, tz);
  for (;;) {
    if (isWeekday(day)) {
      const ds = startOfBusinessDayUtc(day, tz).getTime();
      const de = startOfBusinessDayUtc(nextBusinessDate(day), tz).getTime();
      const s = Math.max(ds, from);
      const e = Math.min(de, to);
      if (e > s) total += e - s;
    }
    if (day >= last) break;
    day = nextBusinessDate(day);
  }
  return total;
}

/** Only Problem and Question tickets carry a first-reply SLA. */
export function slaApplies(type: TicketType): boolean {
  return type === "problem" || type === "question";
}

/**
 * met: first public staff reply at or before due. missed: replied late, or now past due.
 * due_soon: ≤ 4 business hours left. none: no due date (no SLA).
 */
export function slaState(input: {
  dueAt: Date | string | null | undefined;
  repliedAt: Date | string | null | undefined;
  now: Date;
  tz?: string;
}): SlaState {
  const due = toTime(input.dueAt);
  if (due === null) return "none";
  const replied = toTime(input.repliedAt);
  if (replied !== null) return replied <= due ? "met" : "missed";
  const now = input.now.getTime();
  if (now > due) return "missed";
  const left = businessMsBetween(
    input.now,
    new Date(due),
    input.tz ?? BUSINESS_TIME_ZONE,
  );
  return left <= SLA_DUE_SOON_MS ? "due_soon" : "on_track";
}
