// Reports data (11-33; DASH-10, DASH-11, DASH-15, DASH-32; 11-UI-SPEC "Reports"; T-11-33-01,
// T-11-33-02). Server-only. Every read takes the session OrgContext (the org never comes
// from the URL) and every cache key starts with the org id. Sections load in parallel and
// fail soft: a failed read becomes `{ ok: false }` and only that section shows ERR-SECTION.
// - Built-in stats (readSiteStats, socialSourceStats) and SEO health are cached 10 minutes
//   with unstable_cache under `org:<id>:reports` (SEO health also under the live tag, so a
//   publish refreshes it). GA4 / Search Console go through the cached analytics readers
//   (11-32) and never block the page on Google.
// - Periods are business days (business_profile.time_zone): last N days ending today, and
//   the N days before for "vs the previous N days".
import {
  businessDate,
  businessTimeZone,
  DEFAULT_TIME_ZONE,
  isLive,
} from "@cds/core/today";
import type {
  DateRange,
  Ga4Summary,
  NotConnected,
  SearchQueries,
} from "@cds/core/analytics";
import {
  getOrgStage,
  listPages,
  liveTag,
  readGa4Summary,
  readSearchTopQueries,
  readSiteStats,
  seoHealthFor,
  socialSourceStats,
  statsTimeZone,
  type OrgContext,
  type SeoHealthReport,
  type SiteStats,
  type SocialSourceStat,
} from "@cds/db";
import type { ReportPeriod } from "@cds/ui/hub/reports";
import { unstable_cache } from "next/cache";

/** Built-in report reads are cached this long (choice 3). */
export const REPORTS_REVALIDATE_S = 600;

/** Cache tag for one org's report reads. */
export function reportsTag(orgId: string): string {
  return `org:${orgId}:reports`;
}

export type Section<T> = { ok: true; data: T } | { ok: false };

export type ReportPage = { id: string; slug: string; title: string };

export type SiteReportData = {
  period: ReportPeriod;
  range: DateRange;
  live: boolean;
  timeZone: string;
  current: Section<SiteStats>;
  previous: Section<SiteStats>;
  seo: Section<SeoHealthReport>;
  ga4: Section<Ga4Summary | NotConnected>;
  searches: Section<SearchQueries | NotConnected>;
  pages: ReportPage[];
};

export type SocialReportData = {
  period: ReportPeriod;
  live: boolean;
  social: Section<SocialSourceStat[]>;
};

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The last `days` business days ending today, and the same length just before. */
export function periodRanges(
  now: Date,
  timeZone: string,
  days: ReportPeriod,
): { current: DateRange; previous: DateRange } {
  const to = businessDate(now, timeZone);
  const from = addDays(to, -(days - 1));
  return {
    current: { from, to },
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
  };
}

async function settle<T>(label: string, p: Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    console.error(
      `[hub] reports ${label} failed`,
      err instanceof Error ? err.name : typeof err,
    );
    return { ok: false };
  }
}

function cachedStats(ctx: OrgContext, range: DateRange): Promise<SiteStats> {
  return unstable_cache(
    () => readSiteStats(ctx, range),
    ["reports-stats", ctx.orgId, range.from, range.to],
    { tags: [reportsTag(ctx.orgId)], revalidate: REPORTS_REVALIDATE_S },
  )();
}

function cachedSocial(
  ctx: OrgContext,
  range: DateRange,
): Promise<SocialSourceStat[]> {
  return unstable_cache(
    () => socialSourceStats(ctx, range),
    ["reports-social", ctx.orgId, range.from, range.to],
    { tags: [reportsTag(ctx.orgId)], revalidate: REPORTS_REVALIDATE_S },
  )();
}

function cachedSeo(ctx: OrgContext): Promise<SeoHealthReport> {
  return unstable_cache(() => seoHealthFor(ctx), ["reports-seo", ctx.orgId], {
    tags: [reportsTag(ctx.orgId), liveTag(ctx.orgId)],
    revalidate: REPORTS_REVALIDATE_S,
  })();
}

/** Stage + time zone. A failed stage read counts as live (numbers stay visible). */
async function basics(
  ctx: OrgContext,
): Promise<{ live: boolean; timeZone: string }> {
  const [stage, tz] = await Promise.all([
    settle("stage", getOrgStage(ctx)),
    settle("time zone", statsTimeZone(ctx)),
  ]);
  return {
    live: stage.ok ? isLive(stage.data.stage) : true,
    timeZone: tz.ok ? businessTimeZone(tz.data) : DEFAULT_TIME_ZONE,
  };
}

export async function loadSiteReport(
  ctx: OrgContext,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<SiteReportData> {
  const { live, timeZone } = await basics(ctx);
  const { current, previous } = periodRanges(now, timeZone, period);
  // Before launch only SEO health and the Google status load (DASH-32, D-UI-P11-15).
  const skipped = Promise.resolve({ ok: false } as const);
  const [cur, prev, seo, ga4, searches, pages] = await Promise.all([
    live ? settle("stats", cachedStats(ctx, current)) : skipped,
    live ? settle("previous stats", cachedStats(ctx, previous)) : skipped,
    settle("seo health", cachedSeo(ctx)),
    settle("ga4", readGa4Summary(ctx, current)),
    settle("search console", readSearchTopQueries(ctx, current)),
    settle("pages", listPages(ctx)),
  ]);
  return {
    period,
    range: current,
    live,
    timeZone,
    current: cur,
    previous: prev,
    seo,
    ga4,
    searches,
    pages: pages.ok
      ? pages.data.map((p) => ({ id: p.id, slug: p.slug, title: p.title }))
      : [],
  };
}

export async function loadSocialReport(
  ctx: OrgContext,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<SocialReportData> {
  const { live, timeZone } = await basics(ctx);
  if (!live) return { period, live, social: { ok: false } };
  const { current } = periodRanges(now, timeZone, period);
  return {
    period,
    live,
    social: await settle("social", cachedSocial(ctx, current)),
  };
}
