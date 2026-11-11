// P11 reports/daily-stats (11-18; DASH-11, DASH-15, DASH-23; Pattern 11, Pitfall 11): the
// first-party reporting read model over site_daily_stats.
//
// - Write (system only): `upsertDailyStats` is called by the beacon flusher (11-31) with
//   in-memory aggregates. It reads the existing rows for the batch keys in ONE bound query,
//   adds counts, merges vitals histograms, and writes everything in ONE pb.createBatch()
//   (single SQLite writer, Pitfall 11). At most 500 rows per call (T-11-18-01). Rows come
//   from untrusted traffic: every field is validated, a bad row is dropped, rows for an
//   org that does not exist are dropped.
// - Reads (`content:read`, every member role): every query is bound to ctx.orgId
//   (T-11-18-02). Days are business-local `YYYY-MM-DD` (business_profile.time_zone, falling
//   back to America/Chicago).
// - Conversions (choice 4): the beacon counts a conversion when a form submit succeeds and
//   attributes it to the session's landing source (11-31); here they are only summed.
import { InvalidInput } from "@cds/core";
import {
  SOCIAL_SOURCE_KEYS,
  mergeHistograms,
  p75,
  rateVital,
  type DateRange,
  type SourceKind,
  type VitalMetric,
  type VitalRating,
} from "@cds/core/analytics";
import {
  businessTimeZone,
  startOfBusinessDayUtc,
  weekBounds,
} from "@cds/core/today";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { mapped } from "../forms/shared";
import { newRecordId, requirePermission } from "../repository";

const COLLECTION = "site_daily_stats";
const SUBMISSIONS = "form_submissions";

/** Max aggregates per upsertDailyStats call (T-11-18-01). */
export const MAX_DAILY_STATS_BATCH = 500;
/** Longest range a read accepts (Reports offers 7, 30 and 90 days; This week is 14). */
export const MAX_STATS_RANGE_DAYS = 400;
const TOP_N = 10;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const SOURCE_RE = /^[a-z0-9._-]{0,60}$/;
const PATH_MAX = 300;
const DEVICES = ["", "m", "t", "c"] as const;
const METRICS: readonly VitalMetric[] = ["lcp", "inp", "cls"];
const SEARCH_SOURCES: ReadonlySet<string> = new Set([
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
]);
const SOCIAL_SET: ReadonlySet<string> = new Set(SOCIAL_SOURCE_KEYS);

export type StatsDevice = (typeof DEVICES)[number];
export type VitalsHistograms = Partial<Record<VitalMetric, number[]>>;

/** One in-memory aggregate from the beacon flusher. */
export type DailyAggregate = {
  orgId: string;
  /** Business-local day, YYYY-MM-DD. */
  day: string;
  /** "/" style path; "" for an org-level row. */
  path: string;
  /** attributeSource().source ("direct", "google", "instagram", a host, a UTM label). */
  source: string;
  /** m (mobile), t (tablet), c (computer) or "" (all). */
  device: StatsDevice;
  views: number;
  notFound: number;
  /** Form submits attributed to this row's landing source (11-31). */
  conversions?: number;
  /** Fixed-bucket histograms (@cds/core/analytics VITAL_BUCKETS), never raw samples. */
  vitals?: VitalsHistograms;
};

export type UpsertResult = { written: number; dropped: number };

export type VitalSummary = {
  p75: number;
  rating: VitalRating;
  /** Samples behind the p75 (UI shows SPEED-FEW under 20 visits). */
  samples: number;
} | null;

export type VitalsSummary = Record<VitalMetric, VitalSummary>;

export type SourceStat = {
  source: string;
  kind: SourceKind;
  views: number;
  conversions: number;
};

export type SiteStats = {
  views: number;
  byDay: { day: string; views: number }[];
  topPages: { path: string; views: number }[];
  sources: SourceStat[];
  notFound: { path: string; hits: number; lastSeen: string }[];
  vitals: VitalsSummary;
  /** Same vitals per device (phone/computer/tablet columns); "" rows are not included. */
  vitalsByDevice: Record<"m" | "t" | "c", VitalsSummary>;
  formSubmissions: number;
};

export type WeekNumbers = {
  days: { now: string[]; prev: string[] };
  visitors: { now: number; prev: number };
  inquiries: { now: number; prev: number };
};

export type SocialSourceStat = {
  source: string;
  visits: number;
  conversions: number;
};

// ---------------------------------------------------------------------------------------
// Helpers.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validDay(day: unknown): day is string {
  if (typeof day !== "string" || !DAY_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day;
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function pbDate(at: Date): string {
  return at.toISOString().replace("T", " ");
}

function keyOf(r: {
  orgId: string;
  day: string;
  path: string;
  source: string;
  device: string;
}): string {
  return JSON.stringify([r.orgId, r.day, r.path, r.source, r.device]);
}

/** The kind of a stored source label (attributeSource's vocabulary). */
export function sourceKindOf(source: string): SourceKind {
  if (source === "direct" || source === "") return "direct";
  if (SOCIAL_SET.has(source)) return "social";
  if (SEARCH_SOURCES.has(source)) return "search";
  // A referrer is stored as its bare host; a UTM label with no dot is a campaign.
  if (source.includes(".") || source === "other") return "referral";
  return "campaign";
}

function histogramsOf(raw: unknown): VitalsHistograms {
  const out: VitalsHistograms = {};
  if (!isRecord(raw)) return out;
  for (const m of METRICS) {
    const h = raw[m];
    if (Array.isArray(h)) out[m] = mergeHistograms(m, h as number[]);
  }
  return out;
}

function mergeVitals(
  a: VitalsHistograms,
  b: VitalsHistograms,
): VitalsHistograms {
  const out: VitalsHistograms = {};
  for (const m of METRICS) {
    const ha = a[m];
    const hb = b[m];
    if (ha || hb) out[m] = mergeHistograms(m, ha ?? [], hb ?? []);
  }
  return out;
}

function summarise(h: VitalsHistograms): VitalsSummary {
  const out = { lcp: null, inp: null, cls: null } as VitalsSummary;
  for (const m of METRICS) {
    const hist = h[m];
    if (!hist) continue;
    const value = p75(m, hist);
    if (value === null) continue;
    out[m] = {
      p75: value,
      rating: rateVital(m, value),
      samples: hist.reduce((s, n) => s + n, 0),
    };
  }
  return out;
}

/** A clean aggregate, or null (dropped). Untrusted: from visitor traffic. */
function cleanAggregate(raw: unknown): DailyAggregate | null {
  if (!isRecord(raw)) return null;
  const { orgId, day, path, source, device } = raw;
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) return null;
  if (!validDay(day)) return null;
  if (typeof path !== "string" || path.length > PATH_MAX) return null;
  if (path !== "" && !path.startsWith("/")) return null;
  if (typeof source !== "string" || !SOURCE_RE.test(source)) return null;
  if (!DEVICES.includes(device as StatsDevice)) return null;
  const vitals = histogramsOf(raw.vitals);
  return {
    orgId,
    day,
    path,
    source,
    device: device as StatsDevice,
    views: count(raw.views),
    notFound: count(raw.notFound),
    conversions: count(raw.conversions),
    vitals,
  };
}

function isUniqueRace(err: unknown): boolean {
  if (!(err instanceof ClientResponseError) || err.status !== 400) return false;
  try {
    return JSON.stringify(err.response ?? {}).includes("validation_not_unique");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Write (system).

/**
 * Adds a batch of beacon aggregates to site_daily_stats: one row per
 * (org, day, path, source, device). System write: only the beacon flusher (11-31) calls it,
 * with a SystemContext minted inside @cds/db (review 11 WR-B07, invariant 1): app code cannot
 * write stats for an org it names.
 */
export async function upsertDailyStats(
  ctx: SystemContext,
  rows: readonly DailyAggregate[],
): Promise<UpsertResult> {
  assertSystemContext(ctx);
  if (!Array.isArray(rows)) throw new InvalidInput("rows must be a list");
  if (rows.length > MAX_DAILY_STATS_BATCH) {
    throw new InvalidInput(
      `at most ${MAX_DAILY_STATS_BATCH} aggregates per call`,
    );
  }
  // Collapse duplicate keys in the input first, so one key is one write.
  const merged = new Map<string, DailyAggregate>();
  let dropped = 0;
  for (const raw of rows) {
    const a = cleanAggregate(raw);
    if (!a) {
      dropped++;
      continue;
    }
    const k = keyOf(a);
    const prev = merged.get(k);
    merged.set(
      k,
      prev
        ? {
            ...prev,
            views: prev.views + a.views,
            notFound: prev.notFound + a.notFound,
            conversions: (prev.conversions ?? 0) + (a.conversions ?? 0),
            vitals: mergeVitals(prev.vitals ?? {}, a.vitals ?? {}),
          }
        : a,
    );
  }
  if (merged.size === 0) return { written: 0, dropped };

  return mapped(
    withSuperuser(async (pb) => {
      // Rows for an org that does not exist would fail the whole batch: drop them.
      const orgIds = [...new Set([...merged.values()].map((a) => a.orgId))];
      const known = new Set(
        (
          await pb.collection("organizations").getFullList({
            filter: pb.filter(
              orgIds.map((_, i) => `id = {:o${i}}`).join(" || "),
              Object.fromEntries(orgIds.map((id, i) => [`o${i}`, id])),
            ),
            fields: "id",
          })
        ).map((r) => r.id),
      );
      const list = [...merged.values()].filter((a) => {
        if (known.has(a.orgId)) return true;
        dropped++;
        return false;
      });
      if (list.length === 0) return { written: 0, dropped };

      for (let attempt = 0; ; attempt++) {
        try {
          await writeBatch(pb, list);
          return { written: list.length, dropped };
        } catch (err) {
          // Another writer created one of our keys between the read and the batch.
          if (attempt >= 2 || !isUniqueRace(err)) throw err;
        }
      }
    }),
  );
}

async function writeBatch(
  pb: PocketBase,
  list: readonly DailyAggregate[],
): Promise<void> {
  // One bound read for every (org, day) pair in the batch.
  const pairs = [...new Set(list.map((a) => `${a.orgId}|${a.day}`))].map(
    (p) => p.split("|") as [string, string],
  );
  const params: Record<string, string> = {};
  const clauses = pairs.map(([org, day], i) => {
    params[`o${i}`] = org;
    params[`d${i}`] = day;
    return `(organization = {:o${i}} && day = {:d${i}})`;
  });
  const existing = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter(clauses.join(" || "), params),
    batch: 500,
  });
  const byKey = new Map<string, RecordModel>();
  for (const r of existing) {
    byKey.set(
      keyOf({
        orgId: str(r.organization),
        day: str(r.day),
        path: str(r.path),
        source: str(r.source),
        device: str(r.device),
      }),
      r,
    );
  }

  const batch = pb.createBatch();
  for (const a of list) {
    const row = byKey.get(keyOf(a));
    if (row) {
      batch.collection(COLLECTION).update(row.id, {
        views: count(row.views) + a.views,
        not_found: count(row.not_found) + a.notFound,
        conversions: count(row.conversions) + (a.conversions ?? 0),
        vitals: mergeVitals(histogramsOf(row.vitals), a.vitals ?? {}),
      });
    } else {
      batch.collection(COLLECTION).create({
        id: newRecordId(),
        organization: a.orgId,
        day: a.day,
        path: a.path,
        source: a.source,
        device: a.device,
        views: a.views,
        not_found: a.notFound,
        conversions: a.conversions ?? 0,
        vitals: a.vitals ?? {},
      });
    }
  }
  await batch.send();
}

// ---------------------------------------------------------------------------------------
// Reads.

function assertRange(range: DateRange): void {
  if (!isRecord(range) || !validDay(range.from) || !validDay(range.to)) {
    throw new InvalidInput("range needs from and to as YYYY-MM-DD");
  }
  if (range.from > range.to) {
    throw new InvalidInput("range.from must not be after range.to");
  }
  if (daysBetween(range.from, range.to).length > MAX_STATS_RANGE_DAYS) {
    throw new InvalidInput(`range is longer than ${MAX_STATS_RANGE_DAYS} days`);
  }
}

function runRead<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  return mapped(withSuperuser(fn));
}

/** The org's business time zone (business_profile.time_zone, else America/Chicago). */
async function orgTimeZone(pb: PocketBase, orgId: string): Promise<string> {
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "time_zone",
  });
  return businessTimeZone(str(res.items[0]?.time_zone));
}

async function statRows(
  pb: PocketBase,
  orgId: string,
  from: string,
  to: string,
): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter(
      "organization = {:org} && day >= {:from} && day <= {:to}",
      { org: orgId, from, to },
    ),
    fields: "day,path,source,device,views,not_found,conversions,vitals",
    batch: 1000,
  });
}

/** Non-spam form submissions created in [from 00:00, to+1 00:00) business time. */
async function countSubmissionsIn(
  pb: PocketBase,
  orgId: string,
  from: string,
  to: string,
  tz: string,
): Promise<number> {
  const start = startOfBusinessDayUtc(from, tz);
  const end = startOfBusinessDayUtc(addDays(to, 1), tz);
  const res = await pb.collection(SUBMISSIONS).getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && spam = false && created >= {:start} && created < {:end}",
      { org: orgId, start: pbDate(start), end: pbDate(end) },
    ),
    fields: "id",
  });
  return res.totalItems;
}

/**
 * The org's business time zone for report ranges (11-33: the Site Report's period is in
 * business days). content:read, bound to ctx.orgId.
 */
export async function statsTimeZone(ctx: OrgContext): Promise<string> {
  return runRead(ctx, (pb) => orgTimeZone(pb, ctx.orgId));
}

function sumViews(rows: readonly RecordModel[]): number {
  return rows.reduce((s, r) => s + count(r.views), 0);
}

/** Site Report numbers for a business-day range (DASH-11). */
export async function readSiteStats(
  ctx: OrgContext,
  range: DateRange,
): Promise<SiteStats> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  assertRange(range);
  return runRead(ctx, async (pb) => {
    const tz = await orgTimeZone(pb, ctx.orgId);
    const rows = await statRows(pb, ctx.orgId, range.from, range.to);

    const perDay = new Map<string, number>();
    const perPage = new Map<string, number>();
    const perSource = new Map<string, { views: number; conversions: number }>();
    const missing = new Map<string, { hits: number; lastSeen: string }>();
    let vitals: VitalsHistograms = {};
    const byDevice: Record<"m" | "t" | "c", VitalsHistograms> = {
      m: {},
      t: {},
      c: {},
    };

    for (const r of rows) {
      const views = count(r.views);
      const day = str(r.day);
      const path = str(r.path);
      const source = str(r.source) || "direct";
      perDay.set(day, (perDay.get(day) ?? 0) + views);
      if (path !== "" && views > 0) {
        perPage.set(path, (perPage.get(path) ?? 0) + views);
      }
      const s = perSource.get(source) ?? { views: 0, conversions: 0 };
      s.views += views;
      s.conversions += count(r.conversions);
      perSource.set(source, s);
      const nf = count(r.not_found);
      if (nf > 0 && path !== "") {
        const m = missing.get(path) ?? { hits: 0, lastSeen: "" };
        m.hits += nf;
        if (day > m.lastSeen) m.lastSeen = day;
        missing.set(path, m);
      }
      const h = histogramsOf(r.vitals);
      vitals = mergeVitals(vitals, h);
      const device = str(r.device);
      if (device === "m" || device === "t" || device === "c") {
        byDevice[device] = mergeVitals(byDevice[device], h);
      }
    }

    const byViews = (
      a: { views: number; k: string },
      b: { views: number; k: string },
    ) => b.views - a.views || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);

    return {
      views: sumViews(rows),
      byDay: daysBetween(range.from, range.to).map((day) => ({
        day,
        views: perDay.get(day) ?? 0,
      })),
      topPages: [...perPage]
        .map(([k, views]) => ({ k, views }))
        .sort(byViews)
        .slice(0, TOP_N)
        .map(({ k, views }) => ({ path: k, views })),
      sources: [...perSource]
        .map(([k, v]) => ({ k, ...v }))
        .filter((s) => s.views > 0 || s.conversions > 0)
        .sort(byViews)
        .map(({ k, views, conversions }) => ({
          source: k,
          kind: sourceKindOf(k),
          views,
          conversions,
        })),
      notFound: [...missing]
        .map(([path, m]) => ({ path, ...m }))
        .sort(
          (a, b) =>
            b.hits - a.hits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )
        .slice(0, TOP_N),
      vitals: summarise(vitals),
      vitalsByDevice: {
        m: summarise(byDevice.m),
        t: summarise(byDevice.t),
        c: summarise(byDevice.c),
      },
      formSubmissions: await countSubmissionsIn(
        pb,
        ctx.orgId,
        range.from,
        range.to,
        tz,
      ),
    };
  });
}

/**
 * This week vs last week (DASH-23): Monday-start business weeks, 7 business days each
 * (weekBounds, DST-aware). Add-on numbers (bookings, sales) join through the Today contract.
 */
export async function weekNumbers(
  ctx: OrgContext,
  now: Date,
): Promise<WeekNumbers> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return runRead(ctx, async (pb) => {
    const tz = await orgTimeZone(pb, ctx.orgId);
    const { current, previous } = weekBounds(now, tz);
    const pFrom = previous[0];
    const pTo = previous[6];
    const cFrom = current[0];
    const cTo = current[6];
    const rows = await statRows(pb, ctx.orgId, pFrom, cTo);
    const inWeek = (days: readonly string[]) => {
      const set = new Set(days);
      return sumViews(rows.filter((r) => set.has(str(r.day))));
    };
    return {
      days: { now: [...current], prev: [...previous] },
      visitors: { now: inWeek(current), prev: inWeek(previous) },
      inquiries: {
        now: await countSubmissionsIn(pb, ctx.orgId, cFrom, cTo, tz),
        prev: await countSubmissionsIn(pb, ctx.orgId, pFrom, pTo, tz),
      },
    };
  });
}

/** Visits and conversions per social platform (DASH-15), busiest first; empty ones left out. */
export async function socialSourceStats(
  ctx: OrgContext,
  range: DateRange,
): Promise<SocialSourceStat[]> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  assertRange(range);
  return runRead(ctx, async (pb) => {
    const rows = await statRows(pb, ctx.orgId, range.from, range.to);
    const per = new Map<string, SocialSourceStat>();
    for (const r of rows) {
      const source = str(r.source);
      if (sourceKindOf(source) !== "social") continue;
      const s = per.get(source) ?? { source, visits: 0, conversions: 0 };
      s.visits += count(r.views);
      s.conversions += count(r.conversions);
      per.set(source, s);
    }
    const order = new Map<string, number>(
      SOCIAL_SOURCE_KEYS.map((k, i) => [k, i]),
    );
    return [...per.values()]
      .filter((s) => s.visits > 0 || s.conversions > 0)
      .sort(
        (a, b) =>
          b.visits - a.visits ||
          b.conversions - a.conversions ||
          (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99),
      );
  });
}
