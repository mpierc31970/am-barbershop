// packages/db/src/staff/indexing.ts (13-19; STAFF-17, D190, P13-P5).
// Staff reads and actions over per-site search indexing state (`org_indexing`, a platform
// collection keyed by `org_id`). The system writers (recordPing, checkSitemap, resubmitSite)
// live in content/indexing-record.ts (internal, never barrel-exported); every ping (publish,
// live-record save, Resubmit, the weekly `indexing:run` job) goes through recordPing.
// - `indexing` feature, both roles: staffIndexingStatus, staffResubmit (audit
//   `indexing.resubmitted` with organization), staffResubmitAllLive (live, non-demo orgs;
//   one audit row `indexing.resubmitted_all` without org).
// - indexingStatus: the §4 `indexing` object (monitor brief checks 15 / 35).
// Real IndexNow and Search Console stay P14 / GO-LIVE: `pagesIndexed` is null until then.
// 14-26: rows carry the last sitemap submission (`lastSubmitAt`, `lastSubmitResult`); a
// failed submission counts as an error in Resubmit all.
import { authorizeStaff, NotFound } from "@cds/core";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  liveOrgsForIndexing,
  ORG_INDEXING_COLLECTION,
  pingKind,
  resubmitSite,
  sitemapKind,
  type IndexingRecordDeps,
  type ResubmitOutcome,
  type SitemapStatus,
} from "../content/indexing-record";
import type { PingResultKind } from "../content/ports";
import {
  sitemapSubmitKind,
  type SitemapSubmitResultKind,
} from "../content/sitemap-submit";
import { assertPlatformContext, type PlatformContext } from "../context";
import { readPlatformMeta } from "../platform-meta";
import { assertId } from "../repository";

/** Heartbeat of the weekly job (brief row 35); read here for §4 and the console label. */
export const INDEXING_JOB_SUCCESS_KEY = "job:indexing:last_success";
export const INDEXING_JOB_COUNTS_KEY = "job:indexing:last_counts";
const READ_MAX = 500;

export type IndexingSitemapStatus = SitemapStatus;
export type IndexingPingResult = PingResultKind;
export type StaffIndexingDeps = IndexingRecordDeps;
export type StaffResubmitResult = ResubmitOutcome;

export type StaffIndexingRow = {
  orgId: string;
  business: string;
  /** Primary hostname, or null when the site has none yet. */
  host: string | null;
  live: boolean;
  demo: boolean;
  lastPingAt: string | null;
  lastPingResult: PingResultKind | null;
  sitemapStatus: SitemapStatus;
  sitemapCheckedAt: string | null;
  /** Null until Search Console is connected (GO-LIVE). */
  pagesIndexed: number | null;
  lastResubmitAt: string | null;
  /** 14-26: last sitemap submission to Search Console / Bing (stand-in records `logged`). */
  lastSubmitAt: string | null;
  lastSubmitResult: SitemapSubmitResultKind | null;
};

export type StaffResubmitAllResult = { count: number; errors: number };

export type IndexingStatusView = {
  last_weekly_resubmit: string | null;
  indexnow_failures_24h: number;
  sitemap_errors: number;
};

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Indexing rows for the console (Health › Indexing, Site › Indexing): every live org plus
 * any org that already has an indexing row; `orgId` narrows to one site (NotFound when
 * unknown). Sorted by business name.
 */
export async function staffIndexingStatus(
  ctx: PlatformContext,
  opts: { orgId?: string } = {},
): Promise<StaffIndexingRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "indexing");
  if (opts.orgId !== undefined) assertId(opts.orgId);
  return withSuperuser(async (pb) => {
    const indexRows = await pb.collection(ORG_INDEXING_COLLECTION).getFullList({
      ...(opts.orgId
        ? { filter: pb.filter("org_id = {:org}", { org: opts.orgId }) }
        : {}),
      batch: READ_MAX,
    });
    const byOrg = new Map(indexRows.map((r) => [str(r.org_id), r]));
    const orgFields = "id,name,stage,status,demo";
    const orgs = await pb.collection("organizations").getFullList({
      filter: opts.orgId
        ? pb.filter("id = {:org}", { org: opts.orgId })
        : "stage = 'live' && status != 'closed'",
      fields: orgFields,
      batch: READ_MAX,
    });
    if (opts.orgId && orgs.length === 0) throw new NotFound("site not found");
    const seen = new Set(orgs.map((o) => o.id));
    // Orgs with a row that are no longer live still show (their last state is useful).
    const extra = [...byOrg.keys()].filter((id) => id !== "" && !seen.has(id));
    for (let i = 0; i < extra.length; i += 50) {
      const ids = extra.slice(i, i + 50);
      const more = await pb.collection("organizations").getFullList({
        filter: ids.map((id) => pb.filter("id = {:id}", { id })).join(" || "),
        fields: orgFields,
      });
      orgs.push(...more);
    }
    const hosts = await pb.collection("org_hosts").getFullList({
      filter: "primary = true",
      fields: "organization,hostname",
      batch: READ_MAX,
    });
    const hostByOrg = new Map(
      hosts.map((h) => [str(h.organization), str(h.hostname)]),
    );
    const out: StaffIndexingRow[] = orgs.map((o) => {
      const r = byOrg.get(o.id);
      const pages = r ? Number(r.pages_indexed) : 0;
      return {
        orgId: o.id,
        business: str(o.name),
        host: hostByOrg.get(o.id) || null,
        live: o.stage === "live" && o.status !== "closed",
        demo: o.demo === true,
        lastPingAt: r ? iso(r.last_ping_at) : null,
        lastPingResult: r ? pingKind(r.last_ping_result) : null,
        sitemapStatus: r ? sitemapKind(r.sitemap_status) : "unchecked",
        sitemapCheckedAt: r ? iso(r.sitemap_checked_at) : null,
        // PocketBase reads an unset number as 0: unknown until Search Console reports.
        pagesIndexed: Number.isFinite(pages) && pages > 0 ? pages : null,
        lastResubmitAt: r ? iso(r.last_resubmit_at) : null,
        lastSubmitAt: r ? iso(r.last_submit_at) : null,
        lastSubmitResult: r ? sitemapSubmitKind(r.last_submit_result) : null,
      };
    });
    return out.sort((a, b) => a.business.localeCompare(b.business));
  });
}

/** Resubmit one site (ping + sitemap submission + sitemap check); audit `indexing.resubmitted` (organization). */
export async function staffResubmit(
  ctx: PlatformContext,
  orgId: string,
  opts: StaffIndexingDeps & { now?: Date } = {},
): Promise<StaffResubmitResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "indexing");
  assertId(orgId);
  await withSuperuser(async (pb) => {
    try {
      await pb.collection("organizations").getOne(orgId, { fields: "id" });
    } catch {
      throw new NotFound("site not found");
    }
  });
  const outcome = await resubmitSite(orgId, { ...opts, by: ctx.actor });
  await withSuperuser(async (pb) => {
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: "indexing.resubmitted",
        organization: orgId,
        targetCollection: ORG_INDEXING_COLLECTION,
        targetId: orgId,
        meta: {
          ping: outcome.ping,
          sitemap: outcome.sitemap,
          submit: outcome.submit,
        },
      }),
    );
  });
  return outcome;
}

/**
 * Resubmit every live, non-demo site (confirm-gated in the console, 13-39). `count` = sites
 * resubmitted; `errors` = those whose ping or sitemap check failed. One audit row, no org.
 */
export async function staffResubmitAllLive(
  ctx: PlatformContext,
  opts: StaffIndexingDeps & { now?: Date } = {},
): Promise<StaffResubmitAllResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "indexing");
  const now = opts.now ?? new Date();
  const orgs = (await liveOrgsForIndexing()).filter((o) => !o.demo);
  let count = 0;
  let errors = 0;
  for (const o of orgs) {
    try {
      const r = await resubmitSite(o.id, { ...opts, now, by: ctx.actor });
      count += 1;
      if (r.ping === "error" || r.sitemap === "error" || r.submit === "error") {
        errors += 1;
      }
    } catch (err) {
      console.error(`[indexing] resubmit failed: ${errName(err)}`);
      errors += 1;
    }
  }
  await withSuperuser(async (pb) => {
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: "indexing.resubmitted_all",
        targetCollection: ORG_INDEXING_COLLECTION,
        meta: { count, errors },
      }),
    );
  });
  return { count, errors };
}

/**
 * The §4 `indexing` object: last weekly resubmit (job heartbeat), IndexNow failures in the
 * last 24 h (always 0 until live IndexNow ships in P14) and sites whose sitemap check failed.
 */
export async function indexingStatus(): Promise<IndexingStatusView> {
  const last = await readPlatformMeta(INDEXING_JOB_SUCCESS_KEY);
  const sitemapErrors = await withSuperuser(async (pb) => {
    const res = await pb.collection(ORG_INDEXING_COLLECTION).getList(1, 1, {
      filter: "sitemap_status = 'error'",
      fields: "id",
    });
    return res.totalItems;
  });
  return {
    last_weekly_resubmit: last !== null && last !== "" ? last : null,
    indexnow_failures_24h: 0,
    sitemap_errors: sitemapErrors,
  };
}
