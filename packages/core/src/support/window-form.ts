// Service-window form rules (13-36 choice 2; STAFF-10, D99-D102; 13-UI-SPEC "Service windows"
// lines 563-583, WINDOW-RANGE line 1056). Pure and browser-safe: business wall time (moved here
// from the 12-30 `service:window` CLI, which now imports it), the console presets, the console
// range and message caps, datetime-local conversion in business time, and the result line the
// CLI prints. The db function keeps its own wider limits (14 days, 280 characters); the console
// asks for less (7 days, 160 characters) and the action checks it again on the server.
import { BUSINESS_TIME_ZONE } from "../payments";
import { formatNoticeEnd } from "./windows";
import { SITE_PARTS } from "./targets";
import type { WindowScope } from "./types";

/** The console's message cap (UI-SPEC: 160 with a counter). */
export const WINDOW_MESSAGE_MAX = 160;
/** The console's longest window (WINDOW-RANGE: within 7 days). */
export const WINDOW_MAX_SPAN_MS = 7 * 24 * 3_600_000;

export type BusinessWall = {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
};

const wallFormats = new Map<string, Intl.DateTimeFormat>();

function wallFormat(tz: string): Intl.DateTimeFormat {
  let f = wallFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    wallFormats.set(tz, f);
  }
  return f;
}

/** The wall-clock parts of instant `t` (ms) in business time. */
export function businessWall(
  t: number,
  tz: string = BUSINESS_TIME_ZONE,
): BusinessWall {
  const p: Record<string, number> = {};
  for (const x of wallFormat(tz).formatToParts(new Date(t))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return {
    y: p.year!,
    m: p.month!,
    d: p.day!,
    h: p.hour! % 24,
    min: p.minute!,
  };
}

/** The UTC instant of a wall-clock time in business time (two passes settle DST). */
export function businessWallToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  tz: string = BUSINESS_TIME_ZONE,
): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const w = businessWall(t, tz);
    t += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  }
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A Date to a `datetime-local` value in business time ("2026-10-16T22:00"). */
export function toBusinessLocalInput(
  at: Date,
  tz: string = BUSINESS_TIME_ZONE,
): string {
  if (Number.isNaN(at.getTime())) return "";
  const w = businessWall(at.getTime(), tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.min)}`;
}

/** A `datetime-local` value read as business time, or null when it is not a real time. */
export function fromBusinessLocalInput(
  value: string,
  tz: string = BUSINESS_TIME_ZONE,
): Date | null {
  const m = typeof value === "string" ? LOCAL_RE.exec(value.trim()) : null;
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    probe.getUTCMonth() + 1 !== mo ||
    probe.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return null;
  }
  return businessWallToUtc(y, mo, d, h, mi, tz);
}

export const WINDOW_PRESETS = ["now", "1h", "4h", "tonight"] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];
export const WINDOW_PRESET_LABELS: Readonly<Record<WindowPreset, string>> = {
  now: "Now",
  "1h": "+1 hour",
  "4h": "+4 hours",
  tonight: "Tonight 10 pm–2 am",
};

const HOUR = 3_600_000;

/**
 * A preset applied to the current range (13-36 choice 2): **Now** starts the window now (the
 * end moves to an hour later when it would fall before the start); **+1 hour** / **+4 hours**
 * end it that long after its start (now when the start is unset or past); **Tonight** sets
 * 10 pm today to 2 am tomorrow, business time (tomorrow night once 10 pm has passed).
 */
export function applyWindowPreset(
  preset: WindowPreset,
  current: { start: Date | null; end: Date | null },
  now: Date,
  tz: string = BUSINESS_TIME_ZONE,
): { start: Date; end: Date } {
  const t = now.getTime();
  const start =
    current.start && current.start.getTime() > t ? current.start : now;
  switch (preset) {
    case "now": {
      const end =
        current.end && current.end.getTime() > t
          ? current.end
          : new Date(t + HOUR);
      return { start: now, end };
    }
    case "1h":
      return { start, end: new Date(start.getTime() + HOUR) };
    case "4h":
      return { start, end: new Date(start.getTime() + 4 * HOUR) };
    case "tonight": {
      const w = businessWall(t, tz);
      let from = businessWallToUtc(w.y, w.m, w.d, 22, 0, tz);
      if (from.getTime() + 4 * HOUR <= t) {
        const next = new Date(Date.UTC(w.y, w.m - 1, w.d + 1));
        from = businessWallToUtc(
          next.getUTCFullYear(),
          next.getUTCMonth() + 1,
          next.getUTCDate(),
          22,
          0,
          tz,
        );
      }
      const day = businessWall(from.getTime() + 6 * HOUR, tz);
      const to = businessWallToUtc(day.y, day.m, day.d, 2, 0, tz);
      return { start: from.getTime() < t ? now : from, end: to };
    }
  }
}

/** WINDOW-RANGE: the end after the start (and after now), within 7 days of the start. */
export function windowRangeOk(
  start: Date | null,
  end: Date | null,
  now: Date,
): boolean {
  if (!start || !end) return false;
  const s = start.getTime();
  const e = end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return e > s && e > now.getTime() && e - s <= WINDOW_MAX_SPAN_MS;
}

/** Labels for the result line: business names, page titles and add-on names. */
export type WindowLineLabels = {
  orgs: Readonly<Record<string, string>>;
  pages: Readonly<Record<string, string>>;
  addons: readonly { slug: string; name: string }[];
};

export type WindowLineTarget = {
  scope: WindowScope;
  orgId: string;
  addon: string;
  page: string;
  component: string;
};

function addonName(slug: string, labels: WindowLineLabels): string {
  return labels.addons.find((a) => a.slug === slug)?.name ?? slug;
}

/** "Rivera Bakery · page "About us"", "all sites", … (the CLI's target words). */
export function windowTargetText(
  w: WindowLineTarget,
  labels: WindowLineLabels,
): string {
  const business = labels.orgs[w.orgId] || w.orgId || "?";
  switch (w.scope) {
    case "platform":
      return "all sites";
    case "addon":
      return `add-on "${addonName(w.addon, labels)}" on every site that has it`;
    case "organization":
      return business;
    case "page":
      return `${business} · page "${labels.pages[w.page] || w.page}"`;
    case "component": {
      const part = SITE_PARTS.find((p) => p.key === w.component);
      const name = part
        ? part.label.toLowerCase()
        : `add-on "${addonName(w.component, labels)}"`;
      return `${business} · ${name}`;
    }
    default:
      return business;
  }
}

/** "now → 4:00 pm Central" or "Thu 16 Oct at 10:00 pm → tomorrow at 2:00 am Central". */
export function windowSpanText(
  start: Date,
  end: Date,
  now: Date,
  tz: string = BUSINESS_TIME_ZONE,
): string {
  const from =
    start.getTime() <= now.getTime() ? "now" : formatNoticeEnd(start, now, tz);
  return `${from} → ${formatNoticeEnd(end, now, tz)} Central`;
}

/**
 * The console result line (UI-SPEC line 582, the CLI's "Window W-12 · …" line with
 * "Central" for the zone): "Window W-12 · Rivera Bakery · page "About us" · now → 4:00 pm
 * Central · editing paused for the owner."
 */
export function windowCreatedLine(
  code: string,
  w: WindowLineTarget,
  labels: WindowLineLabels,
  span: { start: Date; end: Date; now: Date },
  tz: string = BUSINESS_TIME_ZONE,
): string {
  const started = span.start.getTime() <= span.now.getTime();
  const verb = started ? "editing paused" : "editing pauses then";
  const who =
    w.scope === "platform" || w.scope === "addon" ? "the owners" : "the owner";
  return `Window ${code} · ${windowTargetText(w, labels)} · ${windowSpanText(span.start, span.end, span.now, tz)} · ${verb} for ${who}.`;
}

/** Platform and add-on windows need super_admin (D100). */
export function isWideWindowScope(scope: WindowScope): boolean {
  return scope === "platform" || scope === "addon";
}
