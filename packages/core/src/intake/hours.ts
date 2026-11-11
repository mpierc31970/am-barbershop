// Weekly opening hours and time zones (ONB-13, D257, D-UI-P6-22/23, RESEARCH Pitfall 14).
// Pure. Times are "HH:MM" on a 15-minute grid, 00:00..23:45; overnight ranges are not
// supported in v1.0 (close at 23:45 and tell CDS). Messages are the UI-SPEC copy.
import { InvalidInput } from "../errors";
import type { TimeRange, WeeklyHours } from "./snapshot";
import { DAYS, DAY_LABELS } from "./stages";

export const MAX_RANGES_PER_DAY = 4;

/** A new org starts with every day closed ("Contact us for hours"). */
export function emptyWeeklyHours(): WeeklyHours {
  const out = {} as WeeklyHours;
  for (const d of DAYS) out[d] = { open: false, ranges: [] };
  return out;
}

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

function minutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Throws InvalidInput with owner-facing copy; returns closed days as [] and ranges sorted. */
export function validateHours(raw: unknown): WeeklyHours {
  if (!isRecord(raw)) {
    throw new InvalidInput(
      "We couldn't read those hours. Refresh and try again.",
    );
  }
  const out = emptyWeeklyHours();
  for (const d of DAYS) {
    const day = raw[d];
    const label = DAY_LABELS[d];
    if (day === undefined || day === null) continue;
    if (!isRecord(day) || typeof day.open !== "boolean") {
      throw new InvalidInput(
        `We couldn't read ${label}'s hours. Refresh and try again.`,
      );
    }
    if (!day.open) continue;
    const list = day.ranges;
    if (!Array.isArray(list) || list.length === 0) {
      throw new InvalidInput(
        `Add opening and closing times for ${label}, or set it to closed.`,
      );
    }
    if (list.length > MAX_RANGES_PER_DAY) {
      throw new InvalidInput(
        `${label} can have up to ${MAX_RANGES_PER_DAY} time ranges.`,
      );
    }
    const ranges: TimeRange[] = list.map((r: unknown) => {
      const start = isRecord(r) ? r.start : undefined;
      const end = isRecord(r) ? r.end : undefined;
      if (
        typeof start !== "string" ||
        typeof end !== "string" ||
        !TIME.test(start) ||
        !TIME.test(end)
      ) {
        throw new InvalidInput(
          `${label}'s times must be on the quarter hour, like 9:00 or 9:15.`,
        );
      }
      if (minutes(end) <= minutes(start)) {
        throw new InvalidInput(
          `${label}'s closing time is before its opening time. Pick a later closing time.`,
        );
      }
      return { start, end };
    });
    ranges.sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let i = 1; i < ranges.length; i++) {
      if (minutes(ranges[i]!.start) < minutes(ranges[i - 1]!.end)) {
        throw new InvalidInput(`${label}'s times overlap. Adjust one range.`);
      }
    }
    out[d] = { open: true, ranges };
  }
  return out;
}

/** IANA time zone (aliases like Asia/Calcutta included) via Intl; throws InvalidInput. */
export function validateTimeZone(raw: unknown): string {
  const tz = typeof raw === "string" ? raw.trim() : "";
  if (tz === "" || tz.length > 64) {
    throw new InvalidInput("Pick a time zone from the list.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new InvalidInput("Pick a time zone from the list.");
  }
  return tz;
}
