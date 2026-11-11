// P11 reports/beacon-ingest (11-31; DASH-11, DASH-15, DASH-32; Pattern 11, Pitfall 11): the
// in-memory aggregator behind the cookieless tenant beacon (`POST /api/m` on tenant hosts).
//
// - A hit is never written on its own (single SQLite writer, Pitfall 11). `ingestBeacon` adds
//   it to an in-memory map keyed (org, business day, path, source, device); the flusher writes
//   the map through `upsertDailyStats` in chunks of at most 500 rows every 60 s and on SIGTERM.
// - Org identity comes only from a SiteContext (minted from the middleware's tenant host,
//   T-11-31-04). The route checks bot, size, rate and live before calling in (DASH-32).
// - Visitor privacy (T-11-31-03): an event carries a path, the referrer host, the UTM source
//   and medium and a device class. No IP, id or cookie is ever taken, stored or logged.
// - Source = attributeSource(...).source (the kind is derived on read, 11-18). Vitals go into
//   the fixed-bucket histograms of @cds/core/analytics, never raw samples.
// - A failed flush keeps its rows for one retry on the next tick; a second failure drops them
//   (counted in platform_meta `beacon:dropped`). Each flush writes `beacon:last_flush` (an
//   idle flusher refreshes it every 5 minutes) for the monitor (D174, D175).
// - Per-site budget (review 11 WR-B05): any "/..." path, UTM label or referrer is a new row,
//   so one site may hold at most MAX_ROWS_PER_ORG_DAY distinct (path, source, device) keys and
//   MAX_SOURCES_PER_ORG_DAY sources per business day. Past that, a new source reads "other"
//   and a new key folds into the "/(other)" path, so one noisy site never fills the shared
//   memory cap (blanking every other site's stats) or grows site_daily_stats without bound.
//   The budget is in memory: a restart allows one more budget that day (accepted, A6).
// - Single process assumed (A6): the app runs as one container at the 10-50 tenant target.
//   A second replica would need a shared counter (each process would flush its own share,
//   which still adds up correctly, but the heartbeat and drop count become per process).
// - SIGTERM is best effort: the flush starts at once; when another SIGTERM listener (Next's
//   server) exits the process first, at most one minute of counts is lost.
import {
  addToHistogram,
  attributeSource,
  type VitalMetric,
} from "@cds/core/analytics";
import { businessDate, businessTimeZone } from "@cds/core/today";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { mintSystemContext } from "../context";
import { writePlatformMeta } from "../platform-meta";
import { SlidingWindowLimiter, ipBucket } from "../rate-limit";
import {
  MAX_DAILY_STATS_BATCH,
  upsertDailyStats,
  type DailyAggregate,
  type StatsDevice,
  type UpsertResult,
} from "./daily-stats";

/** Flush period (Pattern 11). */
export const BEACON_FLUSH_MS = 60_000;
/** Idle heartbeat period: an empty flush still refreshes `beacon:last_flush` this often. */
export const BEACON_IDLE_HEARTBEAT_MS = 5 * 60_000;
/** Distinct keys held in memory before new keys are dropped (T-11-31-01). */
export const MAX_BEACON_KEYS = 20_000;
/** Distinct (path, source, device) rows one site may add per business day (WR-B05). */
export const MAX_ROWS_PER_ORG_DAY = 2_000;
/** Distinct sources one site may add per business day; past that a source reads "other". */
export const MAX_SOURCES_PER_ORG_DAY = 50;
/** The path a site's events fold into once its daily row budget is used. */
export const BEACON_OVERFLOW_PATH = "/(other)";
/** The source a site's new sources fold into once its daily source budget is used. */
export const BEACON_OVERFLOW_SOURCE = "other";
/** Longest path kept (matches site_daily_stats.path). */
export const BEACON_PATH_MAX = 300;
export const BEACON_LAST_FLUSH_KEY = "beacon:last_flush";
export const BEACON_DROPPED_KEY = "beacon:dropped";

const TZ_TTL_MS = 10 * 60_000;
const TZ_CACHE_MAX = 1_000;
const DEVICES: ReadonlySet<string> = new Set(["m", "t", "c"]);
const HOST_RE = /^[a-z0-9.-]{1,253}$/;
const LABEL_MAX = 100;

/** A parsed beacon payload (v = view, w = vitals, n = not found, c = conversion). */
export type BeaconEvent = {
  t: "v" | "w" | "n" | "c";
  /** "/..." path, query and hash removed, ≤ 300 chars. */
  p: string;
  /** Referrer host (no scheme, no path), "" when none. */
  r: string;
  us: string;
  um: string;
  d: "m" | "t" | "c" | "";
  lcp?: number;
  inp?: number;
  cls?: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cleanPath(raw: unknown): string | null {
  let p = str(raw).trim();
  if (p === "" || !p.startsWith("/") || p.startsWith("//")) return null;
  p = p.replace(/[?#].*$/, "");
  if (p.length > BEACON_PATH_MAX) return null;
  // Control characters and whitespace never belong in a path.
  if (/[\s\u0000-\u001f\u007f]/.test(p)) return null;
  return p;
}

function cleanHost(raw: unknown): string {
  const h = str(raw).trim().toLowerCase();
  return HOST_RE.test(h) ? h : "";
}

function cleanLabel(raw: unknown): string {
  const v = str(raw).trim();
  return v.length > LABEL_MAX ? v.slice(0, LABEL_MAX) : v;
}

function vital(raw: unknown, max: number): number | undefined {
  return typeof raw === "number" &&
    Number.isFinite(raw) &&
    raw >= 0 &&
    raw <= max
    ? raw
    : undefined;
}

/**
 * The beacon payload, validated and clamped, or null when it is malformed. Unknown keys are
 * ignored. Vitals outside a sane range (LCP/INP ≤ 120 s, CLS ≤ 100) are dropped.
 */
export function parseBeacon(raw: unknown): BeaconEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const o = raw as Record<string, unknown>;
  const t = o.t;
  if (t !== "v" && t !== "w" && t !== "n" && t !== "c") return null;
  const p = cleanPath(o.p);
  if (p === null) return null;
  const d = DEVICES.has(str(o.d)) ? (str(o.d) as "m" | "t" | "c") : "";
  const ev: BeaconEvent = {
    t,
    p,
    r: cleanHost(o.r),
    us: cleanLabel(o.us),
    um: cleanLabel(o.um),
    d,
  };
  if (t === "w") {
    const lcp = vital(o.lcp, 120_000);
    const inp = vital(o.inp, 120_000);
    const cls = vital(o.cls, 100);
    if (lcp === undefined && inp === undefined && cls === undefined)
      return null;
    if (lcp !== undefined) ev.lcp = lcp;
    if (inp !== undefined) ev.inp = inp;
    if (cls !== undefined) ev.cls = cls;
  }
  return ev;
}

type Entry = DailyAggregate & { tries: number };

export type BeaconAggregatorDeps = {
  now?: () => Date;
  write?: (rows: readonly DailyAggregate[]) => Promise<UpsertResult>;
  /** The org's business time zone (default: business_profile.time_zone, cached 10 min). */
  timeZoneOf?: (orgId: string) => Promise<string>;
  /** Heartbeat writer (default: platform_meta through a SystemContext). */
  writeMeta?: (key: string, value: string) => Promise<void>;
  maxKeys?: number;
  /** Per-site daily row budget (default MAX_ROWS_PER_ORG_DAY). */
  maxRowsPerOrgDay?: number;
  /** Per-site daily source budget (default MAX_SOURCES_PER_ORG_DAY). */
  maxSourcesPerOrgDay?: number;
};

/** One site's budget for its current business day (WR-B05). */
type OrgDay = { day: string; keys: Set<string>; sources: Set<string> };

export type FlushResult = {
  written: number;
  /** Rows dropped by this flush (second failure, or refused by upsertDailyStats). */
  dropped: number;
  /** Rows kept for a retry on the next tick. */
  retrying: number;
};

function keyOf(a: DailyAggregate): string {
  return [a.orgId, a.day, a.path, a.source, a.device].join("\u0001");
}

function toAggregate(e: Entry): DailyAggregate {
  const a: DailyAggregate = {
    orgId: e.orgId,
    day: e.day,
    path: e.path,
    source: e.source,
    device: e.device,
    views: e.views,
    notFound: e.notFound,
    conversions: e.conversions ?? 0,
  };
  if (e.vitals) a.vitals = e.vitals;
  return a;
}

const tzCache = new Map<string, { at: number; tz: Promise<string> }>();

async function defaultTimeZoneOf(orgId: string): Promise<string> {
  const now = Date.now();
  const hit = tzCache.get(orgId);
  if (hit && now - hit.at < TZ_TTL_MS) return hit.tz;
  const tz = withSuperuser((pb) =>
    pb.collection("business_profile").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "time_zone",
    }),
  ).then(
    (res) => businessTimeZone(str(res.items[0]?.time_zone)),
    () => businessTimeZone(""),
  );
  tzCache.set(orgId, { at: now, tz });
  if (tzCache.size > TZ_CACHE_MAX) {
    for (const [k, v] of tzCache) {
      if (now - v.at >= TZ_TTL_MS) tzCache.delete(k);
    }
  }
  return tz;
}

let systemCtx: ReturnType<typeof mintSystemContext> | null = null;
function beaconSystemContext(): ReturnType<typeof mintSystemContext> {
  systemCtx ??= mintSystemContext({ job: "beacon" });
  return systemCtx;
}
async function defaultWriteMeta(key: string, value: string): Promise<void> {
  await writePlatformMeta(beaconSystemContext(), key, value);
}

/** Hits held in memory until the next flush. One per process (see the module header). */
export class BeaconAggregator {
  private pending = new Map<string, Entry>();
  private retry: Entry[] = [];
  private droppedTotal = 0;
  private lastHeartbeat = 0;
  private flushing: Promise<FlushResult> | null = null;
  private readonly now: () => Date;
  private readonly write: (
    rows: readonly DailyAggregate[],
  ) => Promise<UpsertResult>;
  private readonly timeZoneOf: (orgId: string) => Promise<string>;
  private readonly writeMeta: (key: string, value: string) => Promise<void>;
  private readonly maxKeys: number;
  private readonly maxRowsPerOrgDay: number;
  private readonly maxSourcesPerOrgDay: number;
  private budgets = new Map<string, OrgDay>();

  constructor(deps: BeaconAggregatorDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.write =
      deps.write ?? ((rows) => upsertDailyStats(beaconSystemContext(), rows));
    this.timeZoneOf = deps.timeZoneOf ?? defaultTimeZoneOf;
    this.writeMeta = deps.writeMeta ?? defaultWriteMeta;
    this.maxKeys = deps.maxKeys ?? MAX_BEACON_KEYS;
    this.maxRowsPerOrgDay = deps.maxRowsPerOrgDay ?? MAX_ROWS_PER_ORG_DAY;
    this.maxSourcesPerOrgDay =
      deps.maxSourcesPerOrgDay ?? MAX_SOURCES_PER_ORG_DAY;
  }

  /**
   * WR-B05: fold `row` into the site's daily budget. A new source past the source budget
   * reads "other"; a new key past the row budget goes to the "/(other)" path. The overflow
   * keys are always allowed (at most a few rows per site per day).
   */
  private budget(row: DailyAggregate): void {
    let b = this.budgets.get(row.orgId);
    if (!b || b.day !== row.day) {
      b = { day: row.day, keys: new Set(), sources: new Set() };
      this.budgets.set(row.orgId, b);
    }
    if (!b.sources.has(row.source)) {
      if (b.sources.size >= this.maxSourcesPerOrgDay) {
        row.source = BEACON_OVERFLOW_SOURCE;
      } else {
        b.sources.add(row.source);
      }
    }
    const k = [row.path, row.source, row.device].join("\u0001");
    if (b.keys.has(k)) return;
    if (b.keys.size >= this.maxRowsPerOrgDay) {
      row.path = BEACON_OVERFLOW_PATH;
      row.source = BEACON_OVERFLOW_SOURCE;
      return;
    }
    b.keys.add(k);
  }

  /** Distinct keys waiting (pending plus retry). */
  get size(): number {
    return this.pending.size + this.retry.length;
  }

  /** Rows dropped since this process started. */
  get dropped(): number {
    return this.droppedTotal;
  }

  /** Add one parsed event for `orgId`; `ownHost` makes self-referrals read as direct. */
  async add(orgId: string, ownHost: string, ev: BeaconEvent): Promise<boolean> {
    const tz = await this.timeZoneOf(orgId);
    const day = businessDate(this.now(), tz);
    const source = attributeSource({
      utmSource: ev.us,
      utmMedium: ev.um,
      referrer: ev.r ? `https://${ev.r}/` : null,
      ownHost,
    }).source;
    const row: DailyAggregate = {
      orgId,
      day,
      path: ev.p,
      source,
      device: ev.d as StatsDevice,
      views: 0,
      notFound: 0,
      conversions: 0,
    };
    this.budget(row);
    const k = keyOf(row);
    let e = this.pending.get(k);
    if (!e) {
      if (this.pending.size >= this.maxKeys) {
        this.droppedTotal++;
        return false;
      }
      e = { ...row, tries: 0 };
      this.pending.set(k, e);
    }
    if (ev.t === "v") e.views++;
    else if (ev.t === "n") e.notFound++;
    else if (ev.t === "c") e.conversions = (e.conversions ?? 0) + 1;
    else {
      const vitals = (e.vitals ??= {});
      for (const m of ["lcp", "inp", "cls"] as const satisfies VitalMetric[]) {
        const v = ev[m];
        if (v !== undefined) vitals[m] = addToHistogram(m, vitals[m] ?? [], v);
      }
    }
    return true;
  }

  /** Write everything held (≤ 500 rows per call). Concurrent calls share one flush. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<FlushResult> {
    const rows = [...this.retry, ...this.pending.values()];
    this.retry = [];
    this.pending = new Map();
    const out: FlushResult = { written: 0, dropped: 0, retrying: 0 };
    for (let i = 0; i < rows.length; i += MAX_DAILY_STATS_BATCH) {
      const chunk = rows.slice(i, i + MAX_DAILY_STATS_BATCH);
      try {
        const r = await this.write(chunk.map(toAggregate));
        out.written += r.written;
        out.dropped += r.dropped;
      } catch (err) {
        console.error(
          "[beacon] flush failed",
          err instanceof Error ? err.name : "unknown",
        );
        for (const e of chunk) {
          if (e.tries >= 1) out.dropped++;
          else {
            this.retry.push({ ...e, tries: e.tries + 1 });
            out.retrying++;
          }
        }
      }
    }
    this.droppedTotal += out.dropped;
    await this.heartbeat(rows.length > 0, out.dropped > 0);
    return out;
  }

  private async heartbeat(wrote: boolean, dropped: boolean): Promise<void> {
    const now = this.now();
    try {
      if (
        wrote ||
        now.getTime() - this.lastHeartbeat >= BEACON_IDLE_HEARTBEAT_MS
      ) {
        await this.writeMeta(BEACON_LAST_FLUSH_KEY, now.toISOString());
        this.lastHeartbeat = now.getTime();
      }
      if (dropped) {
        await this.writeMeta(
          BEACON_DROPPED_KEY,
          `${this.droppedTotal} ${now.toISOString()}`,
        );
      }
    } catch (err) {
      console.error(
        "[beacon] heartbeat failed",
        err instanceof Error ? err.name : "unknown",
      );
    }
  }
}

// ------------------------------------------------------------------------ per-IP limit

/** Beacon events per client IP (IPv6 /64) per minute; over that, events are dropped. */
export const BEACON_PER_IP_PER_MIN = 60;
/** Largest beacon body (2 KB; 11-31 choice 2). */
export const MAX_BEACON_BYTES = 2048;

// In-process sliding window (single app process, A6). The key is ipBucket(ip): held only for
// the window, never stored in the database and never logged (T-11-31-03).
const beaconLimiter = new SlidingWindowLimiter(BEACON_PER_IP_PER_MIN, 60_000);

/** Record one beacon from `ip`; false when that address is over its per-minute budget. */
export function takeBeaconSlot(ip: string): boolean {
  return beaconLimiter.hit(`beacon:${ipBucket(ip)}`);
}

/** Test seam: clear the beacon rate limit. */
export function resetBeaconLimitForTests(): void {
  beaconLimiter.clear();
}

// --------------------------------------------------------------------- process singleton

let shared: BeaconAggregator | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let onSigterm: (() => void) | null = null;

function aggregator(): BeaconAggregator {
  shared ??= new BeaconAggregator();
  return shared;
}

/**
 * Count one beacon event for the site (route: after the bot, size, rate and live checks).
 * Org identity comes only from the SiteContext (T-11-31-04).
 */
export async function ingestBeacon(
  site: SiteContext,
  event: BeaconEvent,
): Promise<boolean> {
  assertSiteContext(site);
  return aggregator().add(site.orgId, site.primaryHost ?? site.host, event);
}

/** Flush the process aggregator now (the timer and SIGTERM call this). */
export function flushBeacon(): Promise<FlushResult> {
  return aggregator().flush();
}

/**
 * Start the 60 s flusher and the SIGTERM flush once per process. The timer is unref'd, so it
 * never keeps the process alive. Safe to call on every request.
 */
export function startBeaconFlusher(): void {
  if (timer) return;
  timer = setInterval(() => {
    void flushBeacon().catch(() => undefined);
  }, BEACON_FLUSH_MS);
  timer.unref?.();
  onSigterm = () => {
    // Another listener (Next's server) owns the exit: flush best effort. Alone, we re-raise
    // the signal after the flush (our `once` listener is gone, so the default exit runs).
    const alone = process.listenerCount("SIGTERM") === 0;
    const done = flushBeacon().catch(() => undefined);
    if (alone) {
      const bail = setTimeout(
        () => process.kill(process.pid, "SIGTERM"),
        5_000,
      );
      bail.unref?.();
      void done.then(() => process.kill(process.pid, "SIGTERM"));
    }
  };
  process.once("SIGTERM", onSigterm);
}

/** Test seam: stop the flusher and forget the process aggregator. */
export function __resetBeaconForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onSigterm) process.removeListener("SIGTERM", onSigterm);
  onSigterm = null;
  shared = null;
  tzCache.clear();
}
