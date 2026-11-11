// Per-site indexing writes (13-19; STAFF-17, D190, P13-P5). Internal: never exported from a
// barrel (system writers, invariant 1). The staff reads/actions (staff/indexing.ts), the
// weekly job (jobs/indexing.ts) and the content ping sites (publish.ts, screen.ts) import it
// by path.
// - recordPing: system upsert of the last ping (time + result) in `org_indexing` (one row per
//   org, keyed by `org_id`).
// - pingAndRecord: ping through the SearchPinger port, then recordPing. Never throws. The demo
//   org (13-24, D293) is never pinged and nothing is recorded: answers `skipped`.
//   14-21 (CONT-16, D170; T-14-21-01): the ONE eligibility guard. Only URLs on the org's
//   custom primary host (`org_hosts` kind = custom && primary = true) of a live (stage
//   `live`, not closed), not suspended org reach the pinger (`eligibleUrls`); a preview
//   host URL never does. Nothing eligible → recorded and answered `skipped`. Every ping
//   site (publish, afterLiveSave, add-on install/import, resubmit, the weekly job) goes
//   through here, so the guard is central.
// - checkSitemap renders the org's own sitemap in-process from its index.json through the
//   site-index builder (`sitemapXml`, the same code /sitemap.xml serves; no HTTP): `ok` when
//   it builds with at least one URL, `error` otherwise. It never rebuilds index.json (a
//   rebuild here would lack the caller's add-on sections).
// - resubmitSite: ping + sitemap submission (14-26, submitAndRecord) + sitemap check +
//   `last_resubmit_*`, no audit (callers add theirs).
// - recordSubmit: system upsert of `last_submit_at` / `last_submit_result` (14-26).
// Errors are logged by class name only; no org id, URL or host is logged.
import { parseSiteIndex, sitemapXml } from "@cds/core/seo";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { orgIsDemo } from "../demo/flag";
import { assertId } from "../repository";
import {
  getObjectStore,
  tenantSiteIndexKey,
  type ObjectStore,
} from "../storage";
import { readJson } from "./manifest";
import type { PingResultKind, SearchPinger } from "./ports";
import { getSearchPinger } from "./scan-standin";
import { siteUrls } from "./shared";
// 14-26: a function-only import cycle (sitemap-submit uses pingableHost / recordSubmit from
// here); nothing runs at module load, so it is safe.
import {
  submitAndRecord,
  type SitemapSubmitResultKind,
  type SitemapSubmitter,
} from "./sitemap-submit";

export const ORG_INDEXING_COLLECTION = "org_indexing";
const PING_RESULTS: readonly PingResultKind[] = [
  "logged",
  "ok",
  "error",
  "skipped",
];
const READ_MAX = 500;

export type SitemapStatus = "ok" | "error" | "unchecked";

export type IndexingRecordDeps = {
  /** Defaults to getSearchPinger() (the logging stand-in). */
  pinger?: SearchPinger;
  /** Defaults to getObjectStore(). */
  store?: ObjectStore;
  /** Defaults to getSitemapSubmitter() (the logging stand-in; 14-26). */
  submitter?: SitemapSubmitter;
};

export type ResubmitOutcome = {
  orgId: string;
  ping: PingResultKind;
  sitemap: SitemapStatus;
  /** 14-26: the sitemap submission to Search Console / Bing (stand-in: `logged`). */
  submit: SitemapSubmitResultKind;
  at: string;
};

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export function pingKind(v: unknown): PingResultKind | null {
  return PING_RESULTS.includes(v as PingResultKind)
    ? (v as PingResultKind)
    : null;
}

export function sitemapKind(v: unknown): SitemapStatus {
  return v === "ok" || v === "error" ? v : "unchecked";
}

async function rowFor(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(ORG_INDEXING_COLLECTION).getList(1, 1, {
    filter: pb.filter("org_id = {:org}", { org: orgId }),
    skipTotal: true,
  });
  return res.items[0] ?? null;
}

/** Upsert the org's row with `patch` (the unique org_id index settles a create race). */
async function upsert(
  orgId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  assertId(orgId);
  await withSuperuser(async (pb) => {
    const existing = await rowFor(pb, orgId);
    if (existing) {
      await pb.collection(ORG_INDEXING_COLLECTION).update(existing.id, patch);
      return;
    }
    try {
      await pb
        .collection(ORG_INDEXING_COLLECTION)
        .create({ org_id: orgId, ...patch });
    } catch (err) {
      const again = await rowFor(pb, orgId);
      if (!again) throw err;
      await pb.collection(ORG_INDEXING_COLLECTION).update(again.id, patch);
    }
  });
}

/** Record one ping's result for the org (system write; choice 1). */
export async function recordPing(
  orgId: string,
  result: PingResultKind,
  now: Date = new Date(),
): Promise<void> {
  await upsert(orgId, {
    last_ping_at: now.toISOString(),
    last_ping_result: pingKind(result) ?? "error",
  });
}

/**
 * Record one sitemap submission's result for the org (system write; 14-26 choice 4).
 * Unknown kinds are recorded as `error`.
 */
export async function recordSubmit(
  orgId: string,
  result: PingResultKind,
  now: Date = new Date(),
): Promise<void> {
  await upsert(orgId, {
    last_submit_at: now.toISOString(),
    last_submit_result: pingKind(result) ?? "error",
  });
}

/**
 * 14-21 (choice 3): keep only `https://<host>/…` URLs (host compared case-insensitively).
 * `host` null → nothing is eligible.
 */
export function eligibleUrls(
  urls: readonly string[],
  host: string | null,
): string[] {
  if (!host) return [];
  const want = host.toLowerCase();
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") continue;
      if (parsed.username !== "" || parsed.password !== "") continue;
      if (parsed.port !== "") continue;
      if (parsed.hostname.toLowerCase() !== want) continue;
      out.push(u);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The org's custom primary host when the org may be announced to search engines (stage
 * `live`, status `active`, not suspended), else null. Two reads, fields limited. Held and
 * disabled orgs (billing lapse, fit hold, closure: `disabled` + closed_reason) are never
 * pinged; the edge refuses to serve them (WR-A07).
 */
export async function pingableHost(orgId: string): Promise<string | null> {
  return withSuperuser(async (pb) => {
    const org = await pb.collection("organizations").getOne(orgId, {
      fields: "stage,status,suspended_at",
    });
    if (org.stage !== "live" || org.status !== "active") return null;
    if (typeof org.suspended_at === "string" && org.suspended_at !== "") {
      return null;
    }
    const res = await pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && kind = 'custom' && primary = true",
        { org: orgId },
      ),
      fields: "hostname",
      skipTotal: true,
    });
    const h = res.items[0]?.hostname;
    return typeof h === "string" && h !== "" ? h : null;
  });
}

/**
 * Ping `urls` for the org and record the result. Best effort: never throws (a failed record
 * is logged by class name). Only URLs passing the eligibility guard are sent (14-21); none
 * left → `skipped`, the pinger is not called. A pinger that returns nothing counts as `ok`;
 * a throw as `error`.
 */
export async function pingAndRecord(
  orgId: string,
  urls: string[],
  opts: { pinger?: SearchPinger; now?: Date } = {},
): Promise<PingResultKind> {
  const now = opts.now ?? new Date();
  // 13-24 (STAFF-18, D293): search engines never hear about the demo org.
  if (await orgIsDemo(orgId)) return "skipped";
  let result: PingResultKind = "skipped";
  let eligible: string[] = [];
  if (urls.length > 0) {
    try {
      eligible = eligibleUrls(urls, await pingableHost(orgId));
    } catch (err) {
      console.error(`[indexing] eligibility read failed: ${errName(err)}`);
      eligible = [];
    }
  }
  if (eligible.length > 0) {
    try {
      const pinger = opts.pinger ?? getSearchPinger();
      const res = await pinger.ping(eligible, { orgId });
      result = res ? (pingKind(res.result) ?? "ok") : "ok";
    } catch {
      result = "error";
    }
  }
  try {
    await recordPing(orgId, result, now);
  } catch (err) {
    console.error(`[indexing] record ping failed: ${errName(err)}`);
  }
  return result;
}

/** A host of the org (primary first), for the sitemap origin. */
async function hostOf(pb: PocketBase, orgId: string): Promise<string | null> {
  for (const filter of [
    "organization = {:org} && primary = true",
    "organization = {:org}",
  ]) {
    const res = await pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter(filter, { org: orgId }),
      fields: "hostname",
      skipTotal: true,
    });
    const h = res.items[0]?.hostname;
    if (typeof h === "string" && h !== "") return h;
  }
  return null;
}

/**
 * Render the org's sitemap in-process from its index.json (the /sitemap.xml builder):
 * `ok` with at least one URL, `error` otherwise (no index, no host, no page). Records
 * `sitemap_status` + `sitemap_checked_at` unless `record: false`.
 */
export async function checkSitemap(
  orgId: string,
  opts: { store?: ObjectStore; now?: Date; record?: boolean } = {},
): Promise<SitemapStatus> {
  assertId(orgId);
  const now = opts.now ?? new Date();
  let status: SitemapStatus = "error";
  try {
    const store = opts.store ?? getObjectStore();
    const index = parseSiteIndex(
      await readJson(store, tenantSiteIndexKey(orgId)),
    );
    const host = await withSuperuser((pb) => hostOf(pb, orgId));
    if (index && host && index.pages.length > 0) {
      const xml = sitemapXml({ origin: `https://${host}`, pages: index.pages });
      if (xml.includes("<loc>")) status = "ok";
    }
  } catch (err) {
    console.error(`[indexing] sitemap check failed: ${errName(err)}`);
    status = "error";
  }
  if (opts.record !== false) {
    await upsert(orgId, {
      sitemap_status: status,
      sitemap_checked_at: now.toISOString(),
    });
  }
  return status;
}

/**
 * One resubmit: ping the site's primary URL(s), check the sitemap, stamp
 * `last_resubmit_at` / `last_resubmit_by` (`by` "" for the job). No audit row.
 * `sitemap: false` skips the check (the weekly job runs it as its own `sitemaps` step) and
 * answers `unchecked` without touching the stored sitemap fields.
 */
export async function resubmitSite(
  orgId: string,
  opts: IndexingRecordDeps & {
    now?: Date;
    by?: string;
    sitemap?: boolean;
  } = {},
): Promise<ResubmitOutcome> {
  assertId(orgId);
  const now = opts.now ?? new Date();
  const urls = await withSuperuser((pb) => siteUrls(pb, orgId));
  const ping = await pingAndRecord(orgId, urls, {
    ...(opts.pinger ? { pinger: opts.pinger } : {}),
    now,
  });
  // 14-26 (CONT-16): submit the sitemap after the ping (same eligibility guard; never throws).
  const submit = await submitAndRecord(orgId, null, {
    ...(opts.submitter ? { submitter: opts.submitter } : {}),
    now,
  });
  const stamp = {
    last_resubmit_at: now.toISOString(),
    last_resubmit_by: (opts.by ?? "").slice(0, 15),
  };
  if (opts.sitemap === false) {
    await upsert(orgId, stamp);
    return {
      orgId,
      ping,
      sitemap: "unchecked",
      submit,
      at: now.toISOString(),
    };
  }
  const sitemap = await checkSitemap(orgId, {
    ...(opts.store ? { store: opts.store } : {}),
    now,
    record: false,
  });
  await upsert(orgId, {
    sitemap_status: sitemap,
    sitemap_checked_at: now.toISOString(),
    ...stamp,
  });
  return { orgId, ping, sitemap, submit, at: now.toISOString() };
}

/**
 * Live orgs (stage `live`, status `active`, not suspended; WR-A07) with their demo flag,
 * oldest first. A suspended site answers 503 and is never pinged to search engines (WR-A14).
 */
export async function liveOrgsForIndexing(): Promise<
  { id: string; demo: boolean }[]
> {
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("organizations").getFullList({
      filter: "stage = 'live' && status = 'active' && suspended_at = ''",
      fields: "id,demo",
      sort: "created",
      batch: READ_MAX,
    });
    return rows.map((r) => ({ id: r.id, demo: r.demo === true }));
  });
}
