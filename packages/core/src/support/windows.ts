// Service windows (COMM-11; D99-D102, P12-P8): which windows reach an org, which content writes
// they lock, and the notice strip text in owner words (UI-SPEC lines 571-578). Pure: the caller
// passes `now`. Field names follow the 12-02 `service_windows` migration.
import { BUSINESS_TIME_ZONE } from "../payments";
import { noticeActiveText, noticePlannedText } from "./copy";
import { SITE_PARTS } from "./targets";
import type { WindowScope } from "./types";

/** Upcoming windows show a planned notice from 24 h before they start. */
export const WINDOW_UPCOMING_MS = 24 * 3_600_000;

/** The fields of a `service_windows` row these rules read. Times are ISO strings. */
export type ServiceWindowRule = {
  scope: WindowScope;
  /** organization, page and component scopes (P12-P12: never `organization`). */
  org_id?: string | null;
  /** add-on scope: the add-on slug. */
  addon?: string | null;
  /** page scope: the page id. */
  page?: string | null;
  /** component scope: a site part key (header, footer, menus) or an add-on slug. */
  component?: string | null;
  message?: string | null;
  starts_at: string;
  ends_at: string;
  cleared_at?: string | null;
};

export type WindowPhase = "upcoming" | "active" | "ended";

/** A content write a lock may block (P12-P4). A section write passes its page. */
export type WriteTarget =
  | { kind: "content" }
  | { kind: "page"; id: string }
  | { kind: "part"; key: string }
  | { kind: "addon"; slug: string };

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** active, upcoming (starts within 24 h), ended (past end or cleared), or null (later). */
export function windowPhase(
  w: ServiceWindowRule,
  now: Date,
): WindowPhase | null {
  const t = now.getTime();
  const start = ms(w.starts_at);
  const end = ms(w.ends_at);
  const cleared = ms(w.cleared_at);
  if (start === null || end === null) return null;
  if ((cleared !== null && cleared <= t) || t >= end) return "ended";
  if (t >= start) return "active";
  if (start - t <= WINDOW_UPCOMING_MS) return "upcoming";
  return null;
}

/** Does this window reach the org? Add-on windows reach only orgs with it active (D100). */
export function windowReaches(
  w: ServiceWindowRule,
  who: { orgId: string; activeAddons: readonly string[] },
): boolean {
  switch (w.scope) {
    case "platform":
      return true;
    case "addon":
      return !!w.addon && who.activeAddons.includes(w.addon);
    case "organization":
    case "page":
    case "component":
      return !!w.org_id && w.org_id === who.orgId;
    default:
      return false;
  }
}

/**
 * Does this (reaching, active) window lock the write? Platform and organization lock all
 * content; add-on locks its slug; page locks that page and its sections; component locks
 * that site part or add-on slug.
 */
export function lockCovers(w: ServiceWindowRule, target: WriteTarget): boolean {
  switch (w.scope) {
    case "platform":
    case "organization":
      return true;
    case "addon":
      return target.kind === "addon" && !!w.addon && target.slug === w.addon;
    case "page":
      return target.kind === "page" && !!w.page && target.id === w.page;
    case "component":
      if (!w.component) return false;
      return (
        (target.kind === "part" && target.key === w.component) ||
        (target.kind === "addon" && target.slug === w.component)
      );
    default:
      return false;
  }
}

export type NoticeLabels = {
  addonName?: string;
  pageTitle?: string;
  componentLabel?: string;
};

/**
 * `{target}` in owner words (UI-SPEC line 576). Never the raw add-on slug or component key:
 * a missing label falls back to the site part's own label or generic words (review IN-B06).
 */
export function noticeTarget(
  w: ServiceWindowRule,
  labels: NoticeLabels,
): string {
  switch (w.scope) {
    case "platform":
      return "the CDS platform";
    case "addon":
      return labels.addonName || "an add-on";
    case "page":
      return labels.pageTitle ? `your ${labels.pageTitle} page` : "a page";
    case "component":
      return `your ${
        labels.componentLabel ||
        SITE_PARTS.find((p) => p.key === w.component)?.label ||
        "site"
      }`;
    default:
      return "your site";
  }
}

type Parts = {
  day: string;
  weekday: string;
  d: string;
  month: string;
  time: string;
  period: string;
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function parts(t: number, tz: string): Parts {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    partsCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
  }).format(new Date(t));
  const mm = (p.month ?? "01").padStart(2, "0");
  const dd = (p.day ?? "1").padStart(2, "0");
  return {
    day: `${p.year}-${mm}-${dd}`,
    weekday: p.weekday ?? "",
    d: String(Number(p.day ?? "1")),
    month: monthName,
    time: `${p.hour}:${p.minute}`,
    period: (p.dayPeriod ?? "").toLowerCase(),
  };
}

function addDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** "4:00 pm", "tomorrow at 9:00 am" or "Thu 15 Oct at 9:00 am", in business time. */
export function formatNoticeEnd(
  end: Date,
  now: Date,
  tz: string = BUSINESS_TIME_ZONE,
): string {
  const e = parts(end.getTime(), tz);
  const n = parts(now.getTime(), tz);
  const clock = `${e.time} ${e.period}`;
  if (e.day === n.day) return clock;
  if (e.day === addDay(n.day)) return `tomorrow at ${clock}`;
  return `${e.weekday} ${e.d} ${e.month} at ${clock}`;
}

/** "Thu 16 Oct, 9:00–11:00 pm" (or across periods / days), in business time. */
export function formatNoticeWhen(
  start: Date,
  end: Date,
  tz: string = BUSINESS_TIME_ZONE,
): string {
  const s = parts(start.getTime(), tz);
  const e = parts(end.getTime(), tz);
  const date = (p: Parts) => `${p.weekday} ${p.d} ${p.month}`;
  if (s.day !== e.day) {
    return `${date(s)}, ${s.time} ${s.period} – ${date(e)}, ${e.time} ${e.period}`;
  }
  if (s.period === e.period) {
    return `${date(s)}, ${s.time}–${e.time} ${e.period}`;
  }
  return `${date(s)}, ${s.time} ${s.period}–${e.time} ${e.period}`;
}

/** NOTICE-ACTIVE or NOTICE-PLANNED for this window, or null when it shows nothing. */
export function noticeText(
  w: ServiceWindowRule,
  labels: NoticeLabels,
  now: Date,
  tz: string = BUSINESS_TIME_ZONE,
): string | null {
  const phase = windowPhase(w, now);
  if (phase !== "active" && phase !== "upcoming") return null;
  const target = noticeTarget(w, labels);
  const message = w.message ?? "";
  const end = new Date(w.ends_at);
  if (phase === "active") {
    return noticeActiveText(target, formatNoticeEnd(end, now, tz), message);
  }
  return noticePlannedText(
    target,
    formatNoticeWhen(new Date(w.starts_at), end, tz),
    message,
  );
}
