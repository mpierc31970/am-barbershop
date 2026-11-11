// Settings › Business info › Your data view (11-41; LIFE-04; D285; 11-UI-SPEC lines 886-911).
// Server-only: maps 11-40's readDataDownloadState to the DataDownloadPanel props, with dates
// in the business time zone ("16 Oct", "9 Oct, 2:14 pm", "2:14 pm tomorrow") and the signed
// link path (built by @cds/db, only for a ready, unexpired zip). Admins, Editors and
// impersonating staff get only who they are: nothing about the download is read for them.
import {
  DEFAULT_TIME_ZONE,
  businessDate,
  nextBusinessDate,
} from "@cds/core/today";
import {
  readDataDownloadState,
  statsTimeZone,
  type DataDownloadState,
  type OrgContext,
} from "@cds/db";
import type { DataDownloadView } from "@cds/ui/hub/people";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** "1.4 GB", "18 MB", "312 KB". */
export function zipSizeLabel(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function part(
  d: Date,
  tz: string,
  opts: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts })
      .formatToParts(d)
      .find((p) => p.type === type)?.value ?? ""
  );
}

/** "16 Oct" (en-US month names, so September is "Sep", never "Sept"). */
export function dayMonth(d: Date, tz: string): string {
  return `${part(d, tz, { day: "numeric" }, "day")} ${part(d, tz, { month: "short" }, "month")}`;
}

/** "2:14 pm". */
export function clockTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(/ |\s/g, " ")
    .replace(/ (AM|PM)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
}

/** "2:14 pm today" / "2:14 pm tomorrow" / "18 Oct, 2:14 pm". */
export function whenLabel(at: Date, now: Date, tz: string): string {
  const day = businessDate(at, tz);
  const today = businessDate(now, tz);
  if (day === today) return `${clockTime(at, tz)} today`;
  // IN-C05: the next calendar day, not now + 24 h (a 23- or 25-hour DST day).
  if (day === nextBusinessDate(today)) {
    return `${clockTime(at, tz)} tomorrow`;
  }
  return `${dayMonth(at, tz)}, ${clockTime(at, tz)}`;
}

function iso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pure mapping (unit-tested): 11-40 state -> panel view. */
export function dataDownloadView(
  state: DataDownloadState,
  timeZone: string,
  now: Date,
): DataDownloadView {
  const empty = {
    status: "idle" as const,
    ready: null,
    requested: null,
    limitUntil: null,
  };
  if (state.who !== "owner") return { viewer: state.who, ...empty };
  const latest = state.latest;
  const next = iso(state.nextAllowedAt);
  const limitUntil = next ? whenLabel(next, now, timeZone) : null;
  const requestedAt = iso(latest?.requestedAt);
  const requested = requestedAt
    ? `${dayMonth(requestedAt, timeZone)}, ${clockTime(requestedAt, timeZone)}`
    : null;
  switch (latest?.status) {
    case "queued":
    case "building":
      return { viewer: "owner", ...empty, status: "building" };
    case "ready": {
      const expires = iso(latest.expiresAt);
      if (latest.href && expires) {
        return {
          viewer: "owner",
          status: "ready",
          ready: {
            href: latest.href,
            until: dayMonth(expires, timeZone),
            size: zipSizeLabel(latest.sizeBytes),
          },
          requested,
          limitUntil,
        };
      }
      return { viewer: "owner", ...empty, limitUntil };
    }
    case "failed":
      return { viewer: "owner", ...empty, status: "failed" };
    default:
      // No row, or the last zip expired: Idle (the limit may still apply).
      return { viewer: "owner", ...empty, limitUntil };
  }
}

/** Reads the state (and, for the Owner, the business time zone) and maps it. */
export async function loadDataDownloadView(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<DataDownloadView> {
  const state = await readDataDownloadState(ctx, now);
  if (state.who !== "owner")
    return dataDownloadView(state, DEFAULT_TIME_ZONE, now);
  const tz = await statsTimeZone(ctx).catch(() => DEFAULT_TIME_ZONE);
  return dataDownloadView(state, tz || DEFAULT_TIME_ZONE, now);
}
