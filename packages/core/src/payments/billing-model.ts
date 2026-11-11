// The pure billing model (BILL-17, CONTEXT A2-A4; D181, D214, D225, D299, D310). One source for
// the money rules later P10 plans reuse. Integer cents only. Time-zone math uses Intl parts
// only (no date library). Business days are Monday-Friday in BUSINESS_TIME_ZONE; public
// holidays are out of scope (10-01 choice 3).
import { InvalidInput } from "../errors";
import type { ProviderSubscriptionStatus } from "./types";

/** Staff are in Texas (packages/db/src/email/render/templates.ts uses the same zone). */
export const BUSINESS_TIME_ZONE = "America/Chicago";
/** Care Plan: one hour of edits a month, no rollover (D299). */
export const CARE_PLAN_MINUTES = 60;
/** Base media storage per site (D225). */
export const BASE_MEDIA_BYTES = 2 * 1024 ** 3;
export const PACK_5GB_BYTES = 5 * 1024 ** 3;
export const PACK_25GB_BYTES = 25 * 1024 ** 3;
/** CDS may decline a paid site up to 5 business days after payment (D214). */
export const DECLINE_WINDOW_BUSINESS_DAYS = 5;
/** The build fee installment plan is 6 monthly payments (D181). */
export const BUILD_INSTALLMENTS = 6;

function nonNegativeInt(v: number, name: string): void {
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new InvalidInput(`${name} must be a non-negative integer`);
  }
}

// ---------------------------------------------------------------------------------------
// Build fee installments (D181, Pitfall 6)

/**
 * Same formula as priceQuote (pricing/price-quote.ts): every payment is floor(total / n) and
 * the remainder cents go on the last. Studio: 5 x 58,333 + 58,335.
 */
export function installmentSplit(
  buildCents: number,
  installments: number = BUILD_INSTALLMENTS,
): { eachCents: number; lastCents: number } {
  nonNegativeInt(buildCents, "buildCents");
  if (!Number.isSafeInteger(installments) || installments < 1) {
    throw new InvalidInput("installments must be a positive integer");
  }
  const eachCents = Math.floor(buildCents / installments);
  const lastCents = buildCents - eachCents * (installments - 1);
  return { eachCents, lastCents };
}

// ---------------------------------------------------------------------------------------
// Lapse (CONTEXT A3, D27, D310): past_due keeps everything on; lapse only when retries end.

export type BillingStatus = "none" | "active" | "past_due" | "lapsed";

export function lapseStateFor(
  status: ProviderSubscriptionStatus,
): BillingStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
      return "lapsed";
    case "incomplete":
      return "none";
  }
}

// ---------------------------------------------------------------------------------------
// Business time zone helpers

type Civil = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

function civilOf(d: Date): Civil {
  const out: Record<string, number> = {};
  for (const p of PARTS.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Offset of the business zone from UTC at an instant, in ms (negative in Chicago). */
function zoneOffsetMs(t: number): number {
  const c = civilOf(new Date(t));
  const asUtc = Date.UTC(
    c.year,
    c.month - 1,
    c.day,
    c.hour,
    c.minute,
    c.second,
  );
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The instant a business-zone wall-clock time happens (Date.UTC normalises overflow). */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let t = wall - zoneOffsetMs(wall);
  t = wall - zoneOffsetMs(t);
  return new Date(t);
}

/** 0 = Sunday ... 6 = Saturday, for a civil date. */
function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekend(year: number, month: number, day: number): boolean {
  const w = weekday(year, month, day);
  return w === 0 || w === 6;
}

/** Next civil date (Date.UTC handles month and year rollover). */
function nextDay(c: { year: number; month: number; day: number }): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + 1));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * `n` business days after `from`, in the business time zone. Business day 1 is always the
 * first business day after the payment date (WR-B02, D214): a weekday start keeps its
 * wall-clock time and counts from the next business day; a weekend start makes the
 * following Monday business day 1, at 00:00 (n = 0 and n = 1 both return that Monday).
 */
export function addBusinessDays(from: Date, n: number): Date {
  nonNegativeInt(n, "business days");
  const c = civilOf(from);
  let date = { year: c.year, month: c.month, day: c.day };
  let time: [number, number, number] = [c.hour, c.minute, c.second];
  let start = 0;
  if (isWeekend(date.year, date.month, date.day)) {
    while (isWeekend(date.year, date.month, date.day)) date = nextDay(date);
    time = [0, 0, 0];
    // Monday is the 1st business day after a weekend payment, not day 0.
    start = 1;
  }
  for (let i = start; i < n;) {
    date = nextDay(date);
    if (!isWeekend(date.year, date.month, date.day)) i++;
  }
  return zonedInstant(date.year, date.month, date.day, ...time);
}

/**
 * True while CDS may still decline a paid site (D214): through the end of the 5th business
 * day after payment, in the business time zone. A Saturday or Sunday payment closes on the
 * Friday after (Mon-Fri = 5), never the Monday after that (WR-B02).
 */
export function withinDeclineWindow(paidAt: Date, now: Date): boolean {
  const last = civilOf(addBusinessDays(paidAt, DECLINE_WINDOW_BUSINESS_DAYS));
  const next = nextDay(last);
  const endExclusive = zonedInstant(next.year, next.month, next.day);
  return now.getTime() < endExclusive.getTime();
}

// ---------------------------------------------------------------------------------------
// Care Plan (D298, D299, CONTEXT A4)

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

export type CareMonth = {
  year: number;
  /** 1-12 */
  month: number;
  label: string;
  /** First instant of the month in the business time zone. */
  start: Date;
  /** First instant of the next month (exclusive end). */
  end: Date;
};

/** The Care Plan month `now` falls in, in the business time zone. */
export function careMonth(now: Date): CareMonth {
  const c = civilOf(now);
  return {
    year: c.year,
    month: c.month,
    label: MONTHS[c.month - 1]!,
    start: zonedInstant(c.year, c.month, 1),
    end: zonedInstant(c.year, c.month + 1, 1),
  };
}

/** May `addMinutes` more be logged this month? Past 60 is refused (quote polish instead). */
export function careLogCheck(
  usedMinutes: number,
  addMinutes: number,
): { ok: boolean; total: number } {
  nonNegativeInt(usedMinutes, "used minutes");
  nonNegativeInt(addMinutes, "minutes");
  if (addMinutes < 1) throw new InvalidInput("minutes must be at least 1");
  const total = usedMinutes + addMinutes;
  return { ok: total <= CARE_PLAN_MINUTES, total };
}

// ---------------------------------------------------------------------------------------
// Media storage (D225)

/** 2 GB base + 5 GB per small pack + 25 GB per large pack. */
export function mediaAllowanceBytes(packs5: number, packs25: number): number {
  nonNegativeInt(packs5, "5 GB pack quantity");
  nonNegativeInt(packs25, "25 GB pack quantity");
  return BASE_MEDIA_BYTES + packs5 * PACK_5GB_BYTES + packs25 * PACK_25GB_BYTES;
}
