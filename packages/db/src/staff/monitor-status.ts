// packages/db/src/staff/monitor-status.ts: filled by 13-40 (monitorStatus feeders)
//
// GET /api/monitor/status document (STAFF-16, D175, D290, P13-P28; MONITOR-APP-BRIEF.md §4).
// Feeders run under Promise.allSettled: a failed feeder yields null for its section and
// `overall: "degraded"`; the class name is logged, never a body. Monitor-safe by
// construction: ids, business names, hosts, counts, timestamps and states only (T-13-40-01;
// the allowlist + no-"@" test walks the output). The demo org is listed with `demo: true`
// and kept out of `premium[]` and `tenants[].premium` (D293). Every platform_meta value is
// read in one bound query. The 15 s memo lives in the route (apps/web).
// 14-45 (P14, D174, D175): the `domains` section (one feeder, counts and ISO times only, the
// demo org never counted), `jobs.domains` from the domains job heartbeat, and the real
// `indexing.indexnow_failures_24h` + `indexing.sitemap_submit_errors` (brief checks 41-50).
// 15-08 (P15-P8): the `hub` section (check 51) from the static CLAIMS with the injected clock.
import {
  evaluateAll,
  MONITOR_STATUS_PATHS,
  type MonitorDomains,
  type MonitorJobBase,
  type MonitorProvider,
  type MonitorStatusDoc,
} from "@cds/core/health";
import { CLAIMS, oldestVerifiedDays } from "@cds/core/marketing";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { ORG_INDEXING_COLLECTION } from "../content/indexing-record";
import { edgeRoutes } from "../dns/edge";
import { dnsProviderMode } from "../dns/factory";
import { DOMAIN_INCIDENT_PREFIX, domainHealthSummary } from "../dns/health";
import { scannerProviders } from "../content/scan/composite";
import { webRiskMonthLookups, webRiskMonthlyCap } from "../content/scan/budget";
import { emailSendFailures } from "../email/send";
import { formsStatus } from "../forms/status";
import { assemblyStatus } from "../jobs/assembly";
import { billingStatus } from "../jobs/billing";
import { retentionStatus } from "../jobs/retention";
import { mediaStatus } from "../media/ops/status";
import { paymentsMode } from "../payments/factory";
import { failsafeStatus } from "./failsafe";
import { indexingStatus } from "./indexing";
import { reviewGauges } from "./review/queue";

export const MONITOR_STATUS_ALLOWLIST = MONITOR_STATUS_PATHS;

/** Heartbeat keys read for §4 (one query). `backup:db_last_success` has no writer yet. */
export const MONITOR_META_KEYS = {
  dbBackup: "backup:db_last_success",
  tenantExports: "job:exports:last_success",
  restoreRehearsed: "backup:restore_rehearsed_at",
  beaconFlush: "beacon:last_flush",
  beaconDropped: "beacon:dropped",
} as const;

const JOB_NAMES = [
  "quotes",
  "media",
  "alerts",
  "reports",
  "support",
  "review",
  "health",
  "indexing",
  "demo",
  "domains",
] as const;
type MetaJob = (typeof JOB_NAMES)[number];

const HEALTH_INCIDENT_PREFIX = "health:incident:";
const HOUR_MS = 3_600_000;
const SCOPE_ORDER = ["platform", "addon", "organization", "page", "component"];

/** Manifest fields monitorStatus reads; callers pass `ADDON_REGISTRY.list()` (Invariant 4). */
export type MonitorManifest = {
  slug: string;
  premium?: { healthChecks: readonly { id: string }[] } | undefined;
};

type Meta = Map<string, string>;

export type MonitorFeeders = {
  meta: () => Promise<Meta>;
  pocketbase: () => Promise<{ latency_ms: number }>;
  orgs: () => Promise<OrgRows>;
  media: () => ReturnType<typeof mediaStatus>;
  forms: () => ReturnType<typeof formsStatus>;
  assembly: () => ReturnType<typeof assemblyStatus>;
  retention: () => ReturnType<typeof retentionStatus>;
  billing: () => ReturnType<typeof billingStatus>;
  failsafe: () => ReturnType<typeof failsafeStatus>;
  indexing: () => Promise<NonNullable<MonitorStatusDoc["indexing"]>>;
  reviewGauges: () => ReturnType<typeof reviewGauges>;
  scanners: () => Promise<MonitorStatusDoc["review"]>;
  windows: () => Promise<MonitorStatusDoc["service_mode"]>;
  webhooks: () => Promise<number>;
  incidents: () => Promise<number>;
  domains: () => Promise<MonitorDomains>;
};

export type MonitorStatusOptions = {
  now?: Date;
  manifests?: readonly MonitorManifest[];
  /** Tests replace one feeder (e.g. one that throws). */
  feeders?: Partial<MonitorFeeders>;
};

type OrgRows = {
  orgs: RecordModel[];
  hosts: RecordModel[];
  addons: RecordModel[];
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const isoOrNull = (v: string | undefined): string | null =>
  v !== undefined && v !== "" ? v : null;

function counts(meta: Meta, jobName: MetaJob): Record<string, unknown> {
  const raw = meta.get(`job:${jobName}:last_counts`);
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function lastSuccess(meta: Meta, jobName: MetaJob): MonitorJobBase {
  return { last_success: isoOrNull(meta.get(`job:${jobName}:last_success`)) };
}

// ------------------------------------------------------------------ default feeders
async function readMeta(): Promise<Meta> {
  const keys = [
    ...Object.values(MONITOR_META_KEYS),
    ...JOB_NAMES.flatMap((j) => [
      `job:${j}:last_success`,
      `job:${j}:last_counts`,
    ]),
  ];
  return withSuperuser(async (pb) => {
    const params: Record<string, string> = {};
    const parts = keys.map((k, i) => {
      params[`k${i}`] = k;
      return `key = {:k${i}}`;
    });
    const rows = await pb.collection("platform_meta").getFullList({
      filter: pb.filter(parts.join(" || "), params),
      fields: "key,value",
    });
    return new Map(rows.map((r) => [str(r.key), str(r.value)]));
  });
}

async function timedPocketbase(): Promise<{ latency_ms: number }> {
  const t0 = performance.now();
  await withSuperuser((pb) => pb.health.check());
  return { latency_ms: Math.round(performance.now() - t0) };
}

async function readOrgs(): Promise<OrgRows> {
  return withSuperuser(async (pb) => {
    const [orgs, hosts, addons] = await Promise.all([
      pb.collection("organizations").getFullList({
        fields: "id,name,stage,status,closed_reason,suspended_at,demo",
        sort: "name,id",
      }),
      pb.collection("org_hosts").getFullList({
        fields: "organization,hostname,kind,primary",
        sort: "-primary,hostname",
      }),
      pb.collection("org_addons").getFullList({
        filter: "status = 'active'",
        fields: "organization,addon",
      }),
    ]);
    return { orgs, hosts, addons };
  });
}

function providerOf(name: string, capped = false): MonitorProvider {
  if (name === "skipped" || name === "" || name === "none") {
    return { provider: "none", status: "skipped" };
  }
  return { provider: name, status: capped ? "capped" : "ok" };
}

function safeProvider(read: () => string, capped = false): MonitorProvider {
  try {
    return providerOf(read(), capped);
  } catch {
    // A misconfigured adapter env throws at construction: report it, never the message.
    return { provider: "none", status: "error" };
  }
}

function scannersFeeder(
  now: Date,
  gauges: () => ReturnType<typeof reviewGauges>,
): () => Promise<MonitorStatusDoc["review"]> {
  return async () => {
    const [g, lookups] = await Promise.all([
      gauges(),
      webRiskMonthLookups(now),
    ]);
    const cap = webRiskMonthlyCap();
    return {
      text_checker: safeProvider(() => scannerProviders().text),
      image_moderator: safeProvider(() => scannerProviders().image),
      link_checker: safeProvider(() => scannerProviders().link, lookups >= cap),
      held_pages: g.held_pages,
      held_oldest_business_days: g.held_oldest_business_days,
      queued_scans: g.queued_scans,
      webrisk_month_lookups: lookups,
      webrisk_cap: cap,
    };
  };
}

function windowsFeeder(
  now: Date,
): () => Promise<MonitorStatusDoc["service_mode"]> {
  return async () => {
    const rows = await withSuperuser((pb) =>
      pb.collection("service_windows").getFullList({
        filter: pb.filter(
          "cleared_at = '' && starts_at <= {:now} && ends_at > {:now}",
          { now },
        ),
        fields: "scope",
      }),
    );
    const scopes = rows.map((r) => str(r.scope));
    const widest =
      SCOPE_ORDER.find((s) => scopes.includes(s)) ??
      (scopes.length > 0 ? "organization" : null);
    return { active: rows.length > 0, scope: widest, windows: rows.length };
  };
}

function webhooksFeeder(now: Date): () => Promise<number> {
  return async () => {
    const res = await withSuperuser((pb) =>
      pb.collection("payment_events").getList(1, 1, {
        filter: pb.filter("outcome = 'failed' && updated >= {:since}", {
          since: new Date(now.getTime() - HOUR_MS),
        }),
        fields: "id",
      }),
    );
    return res.totalItems;
  };
}

async function openIncidents(): Promise<number> {
  const rows = await withSuperuser((pb) =>
    pb.collection("platform_meta").getFullList({
      filter: pb.filter("key ~ {:p} && value != ''", {
        p: `${HEALTH_INCIDENT_PREFIX}%`,
      }),
      fields: "key",
    }),
  );
  return rows.filter((r) => str(r.key).startsWith(HEALTH_INCIDENT_PREFIX))
    .length;
}

// ------------------------------------------------------------------ P14 feeders (14-45)
const DAY_MS = 24 * HOUR_MS;
/** Brief row 47: an owner who has not changed nameservers in 48 h. */
export const MONITOR_NS_SLOW_MS = 48 * HOUR_MS;
/** Not finished moves (as `openMoveFor`): `failed` stays open until retried or cancelled. */
const OPEN_MOVE_STATUSES = [
  "running",
  "waiting_owner",
  "prepared",
  "cutover_running",
  "failed",
] as const;
/** 14-22 records a provider exception as step detail `provider_error:<code>`. */
const PROVIDER_ERROR_PREFIX = "provider_error:";

type StepLite = {
  key: string;
  status: string;
  detail: string;
  startedAt: string;
  finishedAt: string;
};

function stepsOf(v: unknown): StepLite[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> => x !== null && typeof x === "object",
    )
    .map((x) => ({
      key: str(x.key),
      status: str(x.status),
      detail: str(x.detail),
      startedAt: str(x.startedAt),
      finishedAt: str(x.finishedAt),
    }));
}

function msSince(iso: string, now: Date): number | null {
  const t = Date.parse(iso.replace(" ", "T"));
  return Number.isFinite(t) ? now.getTime() - t : null;
}

async function demoOrgIds(): Promise<Set<string>> {
  const rows = await withSuperuser((pb) =>
    pb.collection("organizations").getFullList({
      filter: pb.filter("demo = {:d}", { d: true }),
      fields: "id",
    }),
  );
  return new Set(rows.map((r) => r.id));
}

function safeProviderMode(): string {
  try {
    return dnsProviderMode();
  } catch {
    // A misconfigured CDS_DNS_PROVIDER refuses every DNS write: the adapter is off.
    return "closed";
  }
}

/** §4 `indexing`: the weekly job view plus the P14 per-site failure counts (check 45). */
function indexingFeeder(
  now: Date,
): () => Promise<NonNullable<MonitorStatusDoc["indexing"]>> {
  return async () => {
    const [base, demo, pings, submits] = await Promise.all([
      indexingStatus(),
      demoOrgIds(),
      withSuperuser((pb) =>
        pb.collection(ORG_INDEXING_COLLECTION).getFullList({
          filter: pb.filter(
            "last_ping_result = {:err} && last_ping_at >= {:since}",
            { err: "error", since: new Date(now.getTime() - DAY_MS) },
          ),
          fields: "org_id",
        }),
      ),
      withSuperuser((pb) =>
        pb.collection(ORG_INDEXING_COLLECTION).getFullList({
          filter: pb.filter("last_submit_result = {:err}", { err: "error" }),
          fields: "org_id",
        }),
      ),
    ]);
    const count = (rows: RecordModel[]) =>
      rows.filter((r) => !demo.has(str(r.org_id))).length;
    return {
      last_weekly_resubmit: base.last_weekly_resubmit,
      indexnow_failures_24h: count(pings),
      sitemap_errors: base.sitemap_errors,
      sitemap_submit_errors: count(submits),
    };
  };
}

/**
 * §4 `domains` (checks 41, 43, 44, 46, 47, 48, 50). Counts only: hosts, domains and org ids
 * are read to count and never leave this function (T-14-45-01). The demo org is never
 * counted (D293). `edge_routes` is the router count `/api/edge/routes` emits, as Traefik
 * sees it.
 */
function domainsFeeder(now: Date): () => Promise<MonitorDomains> {
  return async () => (await readDomainWork(now)).counts;
}

/**
 * Which orgs stand behind the staff-facing counts (staff Today deep links, 14-45 choice 4).
 * Never part of the status document: `domainsFeeder` keeps `counts` only.
 */
export type DomainWorkOrgs = {
  movesFailed: string[];
  postSwitch: string[];
  gatePending: string[];
  waitingNs: string[];
  expiring7d: string[];
  leaving: string[];
};

export type DomainWork = { counts: MonitorDomains; orgs: DomainWorkOrgs };

/** One read of the P14 domain state (demo org excluded): §4 counts + the orgs behind them. */
export async function readDomainWork(now: Date): Promise<DomainWork> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const [
    demo,
    zones,
    hosts,
    openMoves,
    recentMoves,
    offboardings,
    profiles,
    incidents,
  ] = await Promise.all([
    demoOrgIds(),
    withSuperuser((pb) =>
      pb.collection("dns_zones").getFullList({
        filter: pb.filter("status = {:a} || status = {:m}", {
          a: "active",
          m: "moved",
        }),
        fields: "org_id,status",
      }),
    ),
    withSuperuser((pb) =>
      pb.collection("org_hosts").getFullList({
        filter: pb.filter("kind = {:k} && verified_at != {:none}", {
          k: "custom",
          none: "",
        }),
        fields: "organization",
      }),
    ),
    withSuperuser((pb) => {
      const params: Record<string, string> = {};
      const parts = OPEN_MOVE_STATUSES.map((st, i) => {
        params[`s${i}`] = st;
        return `status = {:s${i}}`;
      });
      return pb.collection("domain_moves").getFullList({
        filter: pb.filter(parts.join(" || "), params),
        fields: "org_id,status,failed_step,steps",
      });
    }),
    withSuperuser((pb) =>
      pb.collection("domain_moves").getFullList({
        filter: pb.filter("updated >= {:since} && steps ~ {:p}", {
          since: since24h,
          p: PROVIDER_ERROR_PREFIX,
        }),
        fields: "org_id,steps,updated",
      }),
    ),
    withSuperuser((pb) =>
      pb.collection("offboardings").getFullList({
        filter: pb.filter("status = {:s}", { s: "notice" }),
        fields: "org_id",
      }),
    ),
    withSuperuser((pb) =>
      pb.collection("business_profile").getFullList({
        filter: pb.filter("sending_status = {:p} || sending_status = {:f}", {
          p: "pending",
          f: "failed",
        }),
        fields: "organization,sending_status",
      }),
    ),
    withSuperuser((pb) =>
      pb.collection("platform_meta").getFullList({
        filter: pb.filter("key ~ {:p} && value != {:none}", {
          p: `${DOMAIN_INCIDENT_PREFIX}%`,
          none: "",
        }),
        fields: "key",
      }),
    ),
  ]);
  const real = (rows: RecordModel[], field = "org_id"): RecordModel[] =>
    rows.filter((r) => !demo.has(str(r[field])));

  const [routes, health] = await Promise.all([
    edgeRoutes({ service: process.env.CDS_EDGE_SERVICE?.trim() || "count" }),
    domainHealthSummary(),
  ]);

  const leaving = new Set(real(offboardings).map((o) => str(o.org_id)));
  const liveZones = real(zones);
  const moves = real(openMoves);

  const orgs: DomainWorkOrgs = {
    movesFailed: [],
    postSwitch: [],
    gatePending: [],
    waitingNs: [],
    expiring7d: [],
    leaving: [...leaving].sort(),
  };
  let waitingNs = 0;
  let gatePending = 0;
  let postSwitch = 0;
  for (const m of moves) {
    const status = str(m.status);
    const org = str(m.org_id);
    if (status === "failed") orgs.movesFailed.push(org);
    const steps = stepsOf(m.steps);
    const ns = steps.find((x) => x.key === "nameservers");
    const nsAge = ns ? msSince(ns.startedAt, now) : null;
    if (
      status === "waiting_owner" &&
      ns?.status === "waiting_owner" &&
      nsAge !== null &&
      nsAge > MONITOR_NS_SLOW_MS
    ) {
      waitingNs++;
      orgs.waitingNs.push(org);
    }
    const gate = steps.find((x) => x.key === "gate");
    if (
      status !== "failed" &&
      gate?.status === "waiting" &&
      gate.detail === "cds_review"
    ) {
      gatePending++;
      orgs.gatePending.push(org);
    }
    const delegation = steps.find((x) => x.key === "delegation");
    if (
      status === "failed" &&
      str(m.failed_step) === "delegation" &&
      delegation?.detail === "post_switch_mismatch"
    ) {
      postSwitch++;
      orgs.postSwitch.push(org);
    }
  }

  let providerErrors = 0;
  for (const m of real(recentMoves)) {
    for (const st of stepsOf(m.steps)) {
      if (!st.detail.startsWith(PROVIDER_ERROR_PREFIX)) continue;
      // A failed step carries finishedAt; a waiting retry does not, so the move's last
      // update stands in for it.
      const age = msSince(st.finishedAt || str(m.updated), now);
      if (age !== null && age <= DAY_MS) providerErrors++;
    }
  }

  const expirySuffix = ":expiry_7d";
  for (const r of incidents) {
    const key = str(r.key);
    if (!key.startsWith(DOMAIN_INCIDENT_PREFIX) || !key.endsWith(expirySuffix))
      continue;
    const org = key.slice(
      DOMAIN_INCIDENT_PREFIX.length,
      key.length - expirySuffix.length,
    );
    if (org !== "" && !demo.has(org)) orgs.expiring7d.push(org);
  }
  for (const k of Object.keys(orgs) as (keyof DomainWorkOrgs)[]) {
    orgs[k] = [...new Set(orgs[k])].sort();
  }

  const sending = real(profiles, "organization");
  const counts: MonitorDomains = {
    provider: safeProviderMode(),
    provider_errors_24h: providerErrors,
    zones_active: liveZones.filter((z) => str(z.status) === "active").length,
    custom_hosts: real(hosts, "organization").length,
    edge_routes: Object.keys(routes.http.routers).length,
    moves_open: moves.length,
    moves_failed: moves.filter((m) => str(m.status) === "failed").length,
    moves_prepared: moves.filter((m) => str(m.status) === "prepared").length,
    waiting_ns_over_48h: waitingNs,
    gate_overrides_pending: gatePending,
    post_switch_mismatches: postSwitch,
    https_failing: health?.https_failing ?? 0,
    cert_min_days: health?.cert_min_days ?? null,
    delegation_lost: health?.delegation_lost ?? 0,
    email_drift: health?.email_drift ?? 0,
    expiring_30d: health?.expiring_30d ?? 0,
    expiring_7d: health?.expiring_7d ?? 0,
    offboardings_in_notice: leaving.size,
    handbacks_open: liveZones.filter((z) => leaving.has(str(z.org_id))).length,
    sending_pending: sending.filter((p) => str(p.sending_status) === "pending")
      .length,
    sending_failed: sending.filter((p) => str(p.sending_status) === "failed")
      .length,
    last_health_at: health && health.at !== "" ? health.at : null,
  };
  return { counts, orgs };
}

function defaultFeeders(now: Date): MonitorFeeders {
  const gauges = () => reviewGauges(now);
  return {
    meta: readMeta,
    pocketbase: timedPocketbase,
    orgs: readOrgs,
    media: () => mediaStatus({ now }),
    forms: () => formsStatus(),
    assembly: () => assemblyStatus(),
    retention: () => retentionStatus(now),
    billing: () => billingStatus(),
    failsafe: () => failsafeStatus(),
    indexing: indexingFeeder(now),
    reviewGauges: gauges,
    scanners: scannersFeeder(now, gauges),
    windows: windowsFeeder(now),
    webhooks: webhooksFeeder(now),
    incidents: openIncidents,
    domains: domainsFeeder(now),
  };
}

// ------------------------------------------------------------------ assembly
function settledValue<T>(
  r: PromiseSettledResult<T>,
  name: string,
  failed: string[],
): T | null {
  if (r.status === "fulfilled") return r.value;
  failed.push(name);
  const err: unknown = r.reason;
  console.error(
    `[monitor/status] feeder ${name} failed: ${err instanceof Error ? err.name : typeof err}`,
  );
  return null;
}

function tenantsFrom(
  rows: OrgRows,
  premiumSlugs: ReadonlySet<string>,
): NonNullable<MonitorStatusDoc["tenants"]> {
  const hostsBy = new Map<string, RecordModel[]>();
  for (const h of rows.hosts) {
    const id = str(h.organization);
    hostsBy.set(id, [...(hostsBy.get(id) ?? []), h]);
  }
  const addonsBy = new Map<string, string[]>();
  for (const a of rows.addons) {
    const id = str(a.organization);
    addonsBy.set(id, [...(addonsBy.get(id) ?? []), str(a.addon)]);
  }
  return rows.orgs
    .filter((o) => str(o.closed_reason) === "")
    .map((o) => {
      const hosts = hostsBy.get(o.id) ?? [];
      const pick = (list: RecordModel[]) =>
        (list.find((h) => h.primary === true) ?? list[0])?.hostname;
      const custom = hosts.filter((h) => h.kind === "custom");
      const preview = hosts.filter((h) => h.kind !== "custom");
      const demo = o.demo === true;
      return {
        org_id: o.id,
        name: str(o.name),
        live_domain: str(pick(custom)) || null,
        preview_host: str(pick(preview)) || null,
        live: str(o.stage) === "live" && str(o.status) !== "disabled",
        suspended: str(o.suspended_at) !== "",
        premium: demo
          ? []
          : [...new Set(addonsBy.get(o.id) ?? [])]
              .filter((s) => premiumSlugs.has(s))
              .sort(),
        demo,
      };
    });
}

/**
 * Build the §4 status document. `manifests` = `ADDON_REGISTRY.list()` from the caller
 * (never imported here). Never throws for a feeder failure.
 */
export async function monitorStatus(
  opts: MonitorStatusOptions = {},
): Promise<MonitorStatusDoc> {
  const now = opts.now ?? new Date();
  const f: MonitorFeeders = { ...defaultFeeders(now), ...opts.feeders };
  const manifests = opts.manifests ?? [];
  const premiumChecks = new Map<string, string[]>();
  for (const m of manifests) {
    if (m.premium) {
      premiumChecks.set(
        m.slug,
        m.premium.healthChecks.map((c) => c.id),
      );
    }
  }

  const [
    metaR,
    pbR,
    orgsR,
    mediaR,
    formsR,
    assemblyR,
    retentionR,
    billingR,
    failsafeR,
    indexingR,
    gaugesR,
    scannersR,
    windowsR,
    webhooksR,
    incidentsR,
    domainsR,
  ] = await Promise.allSettled([
    f.meta(),
    f.pocketbase(),
    f.orgs(),
    f.media(),
    f.forms(),
    f.assembly(),
    f.retention(),
    f.billing(),
    f.failsafe(),
    f.indexing(),
    f.reviewGauges(),
    f.scanners(),
    f.windows(),
    f.webhooks(),
    f.incidents(),
    f.domains(),
  ]);
  const failed: string[] = [];
  const meta = settledValue(metaR, "meta", failed);
  const pbUp = settledValue(pbR, "pocketbase", failed);
  const orgs = settledValue(orgsR, "orgs", failed);
  const media = settledValue(mediaR, "media", failed);
  const forms = settledValue(formsR, "forms", failed);
  const assembly = settledValue(assemblyR, "assembly", failed);
  const retention = settledValue(retentionR, "retention", failed);
  const billing = settledValue(billingR, "billing", failed);
  const failsafe = settledValue(failsafeR, "failsafe", failed);
  const indexing = settledValue(indexingR, "indexing", failed);
  const gauges = settledValue(gaugesR, "review-gauges", failed);
  const review = settledValue(scannersR, "scanners", failed);
  const serviceMode = settledValue(windowsR, "windows", failed);
  const webhooks = settledValue(webhooksR, "webhooks", failed);
  const incidents = settledValue(incidentsR, "incidents", failed);
  const domains = settledValue(domainsR, "domains", failed);

  const tenants = orgs
    ? tenantsFrom(orgs, new Set(premiumChecks.keys()))
    : null;
  const premium = tenants
    ? tenants.flatMap((t) =>
        t.premium.map((addon) => ({
          org_id: t.org_id,
          addon,
          // v1.0 ships no premium add-on and no check runners: "unknown" until one does.
          status: "unknown" as const,
          checks: premiumChecks.get(addon) ?? [],
          error_rate_1h: null,
          db_write_p95_ms: null,
          failed_emails_1h: null,
        })),
      )
    : null;

  let payMode = "unknown";
  let payStatus: "ok" | "down" | "stand_in" = "down";
  try {
    payMode = paymentsMode();
    payStatus = payMode === "fake" ? "stand_in" : "ok";
  } catch {
    payStatus = "down";
  }
  const emailMode = process.env.CDS_EMAIL_TRANSPORT?.trim() || "log";
  const components: MonitorStatusDoc["components"] = [
    pbUp
      ? { id: "pocketbase", status: "ok", latency_ms: pbUp.latency_ms }
      : { id: "pocketbase", status: "down" },
    {
      id: "email",
      status: emailMode === "log" ? "stand_in" : "ok",
      mode: emailMode,
    },
    { id: "payments", status: payStatus, mode: payMode },
    review
      ? {
          id: "content_scanners",
          status: [
            review.text_checker,
            review.image_moderator,
            review.link_checker,
          ].some((p) => p.status === "error")
            ? "down"
            : "ok",
        }
      : { id: "content_scanners", status: "down" },
    forms
      ? {
          id: "file_scanner",
          status:
            forms.scanner_status === "off"
              ? "off"
              : forms.scanner_status === "ok"
                ? "ok"
                : "down",
          mode: forms.scanner,
        }
      : { id: "file_scanner", status: "down" },
    media
      ? {
          id: "cdn",
          status: media.cdn_status === "ok" ? "ok" : "down",
          mode: media.cdn,
        }
      : { id: "cdn", status: "down" },
  ];

  const jobs: MonitorStatusDoc["jobs"] = meta
    ? (() => {
        const q = counts(meta, "quotes");
        const al = counts(meta, "alerts");
        const rp = counts(meta, "reports");
        const sp = counts(meta, "support");
        const rv = counts(meta, "review");
        const hl = counts(meta, "health");
        const ix = counts(meta, "indexing");
        const dm = counts(meta, "domains");
        return {
          quotes: {
            ...lastSuccess(meta, "quotes"),
            send_failures_24h: num(q.sendFailures),
          },
          media: media
            ? {
                last_success: media.job_last_success,
                failed_steps: strList(counts(meta, "media").failedSteps),
                gc_errors: num(counts(meta, "media").gcErrors),
              }
            : null,
          assembly: assembly
            ? {
                last_success: assembly.last_success,
                failed_orgs: assembly.failed_orgs,
              }
            : null,
          retention: retention
            ? {
                last_success: retention.last_success,
                cap_hit: retention.cap_hit,
                overdue_closed_orgs: retention.overdue_closed_orgs,
              }
            : null,
          billing: billing
            ? {
                last_success: billing.last_success,
                backlog: billing.backlog,
                failed_events: billing.failed_events,
                restricted_accounts: billing.restricted_accounts,
                payments_mode: billing.payments_mode,
              }
            : null,
          alerts: {
            ...lastSuccess(meta, "alerts"),
            push_failed: num(al.pushFailed),
            digest_failures: num(al.digestFailures),
            held_quiet: num(al.heldQuiet),
          },
          reports: {
            ...lastSuccess(meta, "reports"),
            month:
              typeof rp.month === "string" && rp.month !== "" ? rp.month : null,
            emails_sent: num(rp.emailsSent),
            send_failures: num(rp.sendFailures),
            failed_orgs: Array.isArray(rp.failedOrgs)
              ? rp.failedOrgs.length
              : num(rp.failedOrgs),
          },
          support: {
            ...lastSuccess(meta, "support"),
            failed_steps: strList(sp.failedSteps),
            sla_missed_open: num(sp.slaMissedOpen),
            open_windows: (Array.isArray(sp.openWindows) ? sp.openWindows : [])
              .filter(
                (w): w is { code: unknown; activeHours: unknown } =>
                  w !== null && typeof w === "object",
              )
              .map((w) => ({
                code: /^W-\d{1,9}$/.test(str(w.code)) ? str(w.code) : "W-0",
                active_hours: num(w.activeHours),
              })),
          },
          review: {
            ...lastSuccess(meta, "review"),
            failed_steps: strList(rv.failedSteps),
            queued_scans: gauges ? gauges.queued_scans : num(rv.stillQueued),
            held_oldest_business_days: gauges
              ? gauges.held_oldest_business_days
              : 0,
          },
          health: {
            ...lastSuccess(meta, "health"),
            failed_steps: strList(hl.failedSteps),
            open_incidents: incidents ?? 0,
          },
          indexing: {
            ...lastSuccess(meta, "indexing"),
            failed_steps: strList(ix.failedSteps),
          },
          demo: lastSuccess(meta, "demo"),
          domains: {
            ...lastSuccess(meta, "domains"),
            failed_steps: strList(dm.failedSteps),
          },
        };
      })()
    : {
        quotes: null,
        media: null,
        assembly: null,
        retention: null,
        billing: null,
        alerts: null,
        reports: null,
        support: null,
        review: null,
        health: null,
        indexing: null,
        demo: null,
        domains: null,
      };

  const dropped = meta
    ? parseDropped(meta.get(MONITOR_META_KEYS.beaconDropped))
    : null;

  const doc: MonitorStatusDoc = {
    generated_at: now.toISOString(),
    // Same source as /api/health: Coolify's SOURCE_COMMIT, then APP_VERSION.
    version:
      process.env.SOURCE_COMMIT?.trim() ||
      process.env.APP_VERSION?.trim() ||
      "dev",
    overall: "ok",
    components,
    tenants,
    premium,
    failsafe,
    backups: meta
      ? {
          db_last_success: isoOrNull(meta.get(MONITOR_META_KEYS.dbBackup)),
          tenant_exports_last_success: isoOrNull(
            meta.get(MONITOR_META_KEYS.tenantExports),
          ),
          restore_rehearsed_at: isoOrNull(
            meta.get(MONITOR_META_KEYS.restoreRehearsed),
          ),
        }
      : null,
    email: {
      // SES rates arrive with the SES transport (GO-LIVE); null until then.
      bounce_rate_7d: null,
      complaint_rate_7d: null,
      sending_enabled: true,
      transport_failures_24h: emailSendFailures(),
    },
    jobs,
    payments: webhooks === null ? null : { failed_webhooks_1h: webhooks },
    service_mode: serviceMode,
    growth: [],
    indexing,
    domains,
    review,
    chatbot: null,
    media: media
      ? {
          cdn: media.cdn,
          cdn_status: media.cdn_status,
          fallback_active: media.fallback_active,
          origin_errors_1h: media.origin_errors_1h,
          compress_failures_24h: media.compress_failures_24h,
          fallback_since: media.fallback_since,
          video_paused: media.video_paused,
          stuck_videos: media.stuck_videos,
          over_allowance: media.over_allowance,
          wasabi_egress_month_gb: null,
          wasabi_stored_gb: null,
          over_delivery: [],
        }
      : null,
    forms,
    beacon: meta
      ? {
          last_flush: isoOrNull(meta.get(MONITOR_META_KEYS.beaconFlush)),
          dropped: dropped?.count ?? 0,
          dropped_at: dropped?.at ?? null,
        }
      : null,
    // P15 (15-08, check 51): static claims data, so it never fails or degrades with a feeder.
    hub: {
      claims_verified: CLAIMS.filter((c) => c.status === "verified").length,
      claims_draft: CLAIMS.filter((c) => c.status === "draft").length,
      oldest_verified_days: oldestVerifiedDays(CLAIMS, now),
    },
  };

  const levels = evaluateAll(doc, now).map((e) => e.level);
  doc.overall = components.some(
    (c) => c.id === "pocketbase" && c.status === "down",
  )
    ? "down"
    : failed.length > 0 || levels.some((l) => l === "warn" || l === "critical")
      ? "degraded"
      : "ok";
  return doc;
}

/** `beacon:dropped` = "<rows dropped since process start> <ISO of last drop>". */
function parseDropped(
  raw: string | undefined,
): { count: number; at: string | null } | null {
  if (!raw) return null;
  const m = /^(\d{1,12})(?:\s+(\S+))?$/.exec(raw.trim());
  if (!m) return null;
  const at = m[2] && Number.isFinite(Date.parse(m[2])) ? m[2] : null;
  return { count: Number(m[1]), at };
}
