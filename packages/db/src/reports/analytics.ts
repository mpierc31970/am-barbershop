// P11 reports/analytics (11-32; DASH-10, DASH-11, DASH-13, D59, D196): GA4 and Search Console
// behind the AnalyticsSource port (@cds/core/analytics, 11-06), plus the staff setter for the
// org's ids (`organizations.analytics`, 11-03).
//
// - Stand-in (default): `{ connected: false }` for both calls; the Site Report shows
//   ANALYTICS_COPY.notConnected ("Connects when CDS finishes setup"), never an error.
// - REST adapter: chosen when CDS_ANALYTICS=google AND GOOGLE_SERVICE_ACCOUNT_JSON is set
//   (choice 1). No google-auth-library: the service-account JWT is signed here with node:crypto
//   (RS256) and exchanged at the token endpoint. Endpoints are env-overridable
//   (GOOGLE_TOKEN_URL, GA4_DATA_API_BASE, GSC_API_BASE); an override that is not https is
//   ignored, so the bearer token never leaves over plain http. Endpoint shapes are [ASSUMED]
//   (RESEARCH A2); a recorded-response fixture drives the unit test.
// - Answers are cached in memory per (org, kind, range) for 24 h, so a page view never calls
//   Google. Failures are logged by error name only (never the key or token), read as not
//   connected and are not cached.
// - The setter is staff-only (STAFF_MATRIX.analytics_set: super_admin, support_agent), audited
//   as `org.analytics_set` in the same PB batch as the write (T-11-32-04), and the measurement
//   id is regex-checked at write so nothing odd reaches the gtag URL (T-11-32-03).
// Server-only module (@cds/db): the key is read from env and never leaves it (T-11-32-01).
import { createSign } from "node:crypto";
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  NOT_CONNECTED,
  type AnalyticsSource,
  type DateRange,
  type Ga4Summary,
  type NotConnected,
  type SearchQueries,
} from "@cds/core/analytics";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import type { Invalidator } from "../content/ports";
import { liveTag, siteTag } from "../content/ports";
import { requirePermission } from "../repository";

// ---- ids and validation ------------------------------------------------------------------

/** GA4 web stream measurement id ("G-XXXXXXX"). Universal Analytics ("UA-") is refused. */
export const GA4_MEASUREMENT_RE = /^G-[A-Z0-9]{4,12}$/;
/** GA4 numeric property id (the Data API's `properties/{id}`). */
export const GA4_PROPERTY_RE = /^\d{5,12}$/;
const GSC_DOMAIN_RE =
  /^sc-domain:(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GSC_MAX = 200;
const ORG_RE = /^[a-z0-9]{15}$/;

export const ANALYTICS_COPY = Object.freeze({
  notConnected: "Connects when CDS finishes setup",
});

/** The stored shape of `organizations.analytics` (snake_case, 11-03). */
export type OrgAnalyticsIds = {
  ga4_measurement_id?: string;
  ga4_property_id?: string;
  gsc_site_url?: string;
  owner?: "cds" | "tenant";
};

/** What staff may set. `null` removes one field; `clear` removes them all first. */
export type SetOrgAnalyticsInput = {
  ga4MeasurementId?: string | null;
  ga4PropertyId?: string | null;
  gscSiteUrl?: string | null;
  owner?: "cds" | "tenant" | null;
  clear?: boolean;
};

/** A Search Console property: an https URL-prefix property, or `sc-domain:<host>`. */
export function normalizeGscSite(raw: string): string | null {
  const v = raw.trim();
  if (v === "" || v.length > GSC_MAX) return null;
  if (v.startsWith("sc-domain:")) {
    const lower = v.toLowerCase();
    return GSC_DOMAIN_RE.test(lower) ? lower : null;
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.search || u.hash) return null;
  return u.href;
}

/** Checks and normalizes the named fields (no PB access). Throws InvalidInput. */
export function validateAnalyticsInput(
  input: Omit<SetOrgAnalyticsInput, "clear">,
): OrgAnalyticsIds {
  const out: OrgAnalyticsIds = {};
  const m = input.ga4MeasurementId;
  if (typeof m === "string") {
    const id = m.trim().toUpperCase();
    if (!GA4_MEASUREMENT_RE.test(id)) {
      throw new InvalidInput(
        "GA4 measurement id must look like G-XXXXXXX (Universal Analytics UA- ids are not supported)",
      );
    }
    out.ga4_measurement_id = id;
  }
  const p = input.ga4PropertyId;
  if (typeof p === "string") {
    const id = p.trim();
    if (!GA4_PROPERTY_RE.test(id)) {
      throw new InvalidInput("GA4 property id must be 5-12 digits");
    }
    out.ga4_property_id = id;
  }
  const g = input.gscSiteUrl;
  if (typeof g === "string") {
    const site = normalizeGscSite(g);
    if (!site) {
      throw new InvalidInput(
        "Search Console site must be an https URL or sc-domain:<host>",
      );
    }
    out.gsc_site_url = site;
  }
  const o = input.owner;
  if (o !== undefined && o !== null && o !== "cds" && o !== "tenant") {
    throw new InvalidInput("owner must be cds or tenant");
  }
  if (o === "cds" || o === "tenant") out.owner = o;
  return out;
}

/** The stored json, re-validated on read: anything malformed is dropped. */
export function parseOrgAnalytics(v: unknown): OrgAnalyticsIds {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: OrgAnalyticsIds = {};
  const str = (k: string) =>
    Object.prototype.hasOwnProperty.call(src, k) && typeof src[k] === "string"
      ? (src[k] as string)
      : undefined;
  const m = str("ga4_measurement_id");
  if (m && GA4_MEASUREMENT_RE.test(m)) out.ga4_measurement_id = m;
  const p = str("ga4_property_id");
  if (p && GA4_PROPERTY_RE.test(p)) out.ga4_property_id = p;
  const g = str("gsc_site_url");
  const site = g ? normalizeGscSite(g) : null;
  if (site) out.gsc_site_url = site;
  if (src.owner === "cds" || src.owner === "tenant") out.owner = src.owner;
  return out;
}

const FIELD_ORDER = [
  "ga4_measurement_id",
  "ga4_property_id",
  "gsc_site_url",
  "owner",
] as const;

function ordered(ids: OrgAnalyticsIds): OrgAnalyticsIds {
  const out: Record<string, string> = {};
  for (const k of FIELD_ORDER) if (ids[k] !== undefined) out[k] = ids[k]!;
  return out as OrgAnalyticsIds;
}

function sameIds(a: OrgAnalyticsIds, b: OrgAnalyticsIds): boolean {
  return FIELD_ORDER.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

// ---- service-account token (choice 1) ------------------------------------------------------

export type ServiceAccount = {
  client_email: string;
  private_key: string;
};

export const ANALYTICS_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
]);

export type AnalyticsEndpoints = {
  tokenUrl?: string;
  ga4Base?: string;
  gscBase?: string;
};

const DEFAULT_ENDPOINTS = Object.freeze({
  tokenUrl: "https://oauth2.googleapis.com/token",
  ga4Base: "https://analyticsdata.googleapis.com/v1beta",
  gscBase: "https://searchconsole.googleapis.com/webmasters/v3",
});

const FETCH_TIMEOUT_MS = 15_000;

/** An https override, trailing slash trimmed; anything else falls back to the default. */
function httpsOr(v: string | undefined, fallback: string): string {
  if (typeof v !== "string" || v.trim() === "") return fallback;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:") return fallback;
    return u.href.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function resolveEndpoints(e: AnalyticsEndpoints = {}) {
  return {
    tokenUrl: httpsOr(e.tokenUrl, DEFAULT_ENDPOINTS.tokenUrl),
    ga4Base: httpsOr(e.ga4Base, DEFAULT_ENDPOINTS.ga4Base),
    gscBase: httpsOr(e.gscBase, DEFAULT_ENDPOINTS.gscBase),
  };
}

/** Parse GOOGLE_SERVICE_ACCOUNT_JSON; null when unusable (never throws, never logs it). */
export function parseServiceAccount(
  json: string | undefined,
): ServiceAccount | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof v.client_email === "string" &&
      v.client_email.includes("@") &&
      typeof v.private_key === "string" &&
      v.private_key.includes("PRIVATE KEY")
    ) {
      return { client_email: v.client_email, private_key: v.private_key };
    }
  } catch {
    // fall through
  }
  return null;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

async function postWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * An OAuth access token for the service account: an RS256 JWT bearer grant signed with
 * node:crypto (no google-auth-library). Throws on a malformed account or a refused grant.
 */
export async function serviceAccountToken(
  sa: ServiceAccount,
  scopes: readonly string[],
  fetchImpl: typeof fetch = fetch,
  opts: { now?: () => Date; tokenUrl?: string } = {},
): Promise<string> {
  return (await requestToken(sa, scopes, fetchImpl, opts)).token;
}

async function requestToken(
  sa: ServiceAccount,
  scopes: readonly string[],
  fetchImpl: typeof fetch,
  opts: { now?: () => Date; tokenUrl?: string },
): Promise<{ token: string; expiresAt: number }> {
  if (
    !sa ||
    typeof sa.client_email !== "string" ||
    !sa.client_email.includes("@") ||
    typeof sa.private_key !== "string" ||
    !sa.private_key.includes("PRIVATE KEY")
  ) {
    throw new InvalidInput("service account is not usable");
  }
  const tokenUrl = httpsOr(opts.tokenUrl, DEFAULT_ENDPOINTS.tokenUrl);
  const nowMs = (opts.now ?? (() => new Date()))().getTime();
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(" "),
      aud: tokenUrl,
      iat,
      exp: iat + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const res = await postWithTimeout(fetchImpl, tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token grant refused (${res.status})`);
  const body = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new Error("token grant returned no access token");
  }
  const ttl =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : 3600;
  return { token: body.access_token, expiresAt: nowMs + ttl * 1000 };
}

// ---- cache (24 h per org, kind, range) -----------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
type Cached = { at: number; value: Ga4Summary | SearchQueries | NotConnected };
const cache = new Map<string, Cached>();

function cacheKey(orgId: string, kind: string, range: DateRange): string {
  return `${orgId}|${kind}|${range.from}|${range.to}`;
}

/** Drop one org's cached answers (the setter calls it after a change). */
export function clearAnalyticsCache(orgId: string): void {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${orgId}|`)) cache.delete(k);
  }
}

export function resetAnalyticsCacheForTests(): void {
  cache.clear();
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validRange(range: DateRange): boolean {
  return (
    !!range &&
    DAY_RE.test(range.from) &&
    DAY_RE.test(range.to) &&
    range.from <= range.to
  );
}

// ---- sources -------------------------------------------------------------------------------

export const standInAnalytics: AnalyticsSource = Object.freeze({
  async ga4Summary(): Promise<NotConnected> {
    return NOT_CONNECTED;
  },
  async searchTopQueries(): Promise<NotConnected> {
    return NOT_CONNECTED;
  },
});

/** The org's stored ids (server-only read; organizations.analytics is serverOnly). */
async function lookupOrgIds(orgId: string): Promise<OrgAnalyticsIds> {
  if (!ORG_RE.test(orgId)) return {};
  return withSuperuser(async (pb) => {
    try {
      const row = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "analytics" });
      return parseOrgAnalytics(row.analytics);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) return {};
      throw err;
    }
  });
}

export type GoogleSourceOptions = {
  serviceAccount: ServiceAccount;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Defaults to reading organizations.analytics. */
  lookup?: (orgId: string) => Promise<OrgAnalyticsIds>;
  endpoints?: AnalyticsEndpoints;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The GA4 Data API + Search Console REST adapter (choice 2). */
export function googleAnalyticsSource(
  opts: GoogleSourceOptions,
): AnalyticsSource {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const lookup = opts.lookup ?? lookupOrgIds;
  const ep = resolveEndpoints(opts.endpoints);
  let token: { token: string; expiresAt: number } | null = null;

  async function bearer(): Promise<string> {
    const t = now().getTime();
    if (token && token.expiresAt - 60_000 > t) return token.token;
    token = await requestToken(
      opts.serviceAccount,
      ANALYTICS_SCOPES,
      fetchImpl,
      {
        now,
        tokenUrl: ep.tokenUrl,
      },
    );
    return token.token;
  }

  async function postJson(url: string, body: unknown): Promise<unknown> {
    const res = await postWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await bearer()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`google api refused (${res.status})`);
    return res.json();
  }

  async function cached<T extends Ga4Summary | SearchQueries>(
    orgId: string,
    kind: "ga4" | "gsc",
    range: DateRange,
    load: (ids: OrgAnalyticsIds) => Promise<T | NotConnected>,
  ): Promise<T | NotConnected> {
    if (!ORG_RE.test(orgId) || !validRange(range)) return NOT_CONNECTED;
    const key = cacheKey(orgId, kind, range);
    const t = now().getTime();
    const hit = cache.get(key);
    if (hit && t - hit.at < CACHE_TTL_MS) return hit.value as T | NotConnected;
    try {
      const value = await load(await lookup(orgId));
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { at: t, value });
      return value;
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      console.error(`[analytics] ${kind} read failed (${name})`);
      return NOT_CONNECTED;
    }
  }

  const dateRanges = (r: DateRange) => [{ startDate: r.from, endDate: r.to }];

  return {
    ga4Summary(orgId, range) {
      return cached<Ga4Summary>(orgId, "ga4", range, async (ids) => {
        const property = ids.ga4_property_id;
        if (!property) return NOT_CONNECTED;
        const url = `${ep.ga4Base}/properties/${encodeURIComponent(property)}:runReport`;
        const totals = (await postJson(url, {
          dateRanges: dateRanges(range),
          metrics: [{ name: "activeUsers" }, { name: "sessions" }],
        })) as { rows?: { metricValues?: { value?: unknown }[] }[] };
        const pages = (await postJson(url, {
          dateRanges: dateRanges(range),
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 10,
        })) as {
          rows?: {
            dimensionValues?: { value?: unknown }[];
            metricValues?: { value?: unknown }[];
          }[];
        };
        const t0 = totals.rows?.[0]?.metricValues ?? [];
        return {
          connected: true,
          users: num(t0[0]?.value),
          sessions: num(t0[1]?.value),
          topPages: (pages.rows ?? []).slice(0, 10).map((r) => ({
            path: String(r.dimensionValues?.[0]?.value ?? "").slice(0, 500),
            views: num(r.metricValues?.[0]?.value),
          })),
        };
      });
    },
    searchTopQueries(orgId, range) {
      return cached<SearchQueries>(orgId, "gsc", range, async (ids) => {
        const site = ids.gsc_site_url;
        if (!site) return NOT_CONNECTED;
        const url = `${ep.gscBase}/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
        const body = (await postJson(url, {
          startDate: range.from,
          endDate: range.to,
          dimensions: ["query"],
          rowLimit: 10,
        })) as {
          rows?: {
            keys?: unknown[];
            clicks?: unknown;
            impressions?: unknown;
          }[];
        };
        return {
          connected: true,
          rows: (body.rows ?? []).slice(0, 10).map((r) => ({
            query: String(r.keys?.[0] ?? "").slice(0, 300),
            clicks: num(r.clicks),
            impressions: num(r.impressions),
          })),
        };
      });
    },
  };
}

let googleSingleton: { json: string; source: AnalyticsSource } | null = null;

/**
 * The configured source: the REST adapter when CDS_ANALYTICS=google and a usable
 * GOOGLE_SERVICE_ACCOUNT_JSON are set, else the stand-in.
 */
export function getAnalyticsSource(
  env: Record<string, string | undefined> = process.env,
): AnalyticsSource {
  if (env.CDS_ANALYTICS !== "google") return standInAnalytics;
  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sa = parseServiceAccount(json);
  if (!sa || !json) return standInAnalytics;
  if (googleSingleton && googleSingleton.json === json) {
    return googleSingleton.source;
  }
  const source = googleAnalyticsSource({
    serviceAccount: sa,
    endpoints: {
      tokenUrl: env.GOOGLE_TOKEN_URL,
      ga4Base: env.GA4_DATA_API_BASE,
      gscBase: env.GSC_API_BASE,
    },
  });
  googleSingleton = { json, source };
  return source;
}

// ---- owner reads (11-33 Site Report) -------------------------------------------------------

/** GA4 summary for the signed-in org (content:read), or not connected. */
export async function readGa4Summary(
  ctx: OrgContext,
  range: DateRange,
  source: AnalyticsSource = getAnalyticsSource(),
): Promise<Ga4Summary | NotConnected> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  return source.ga4Summary(ctx.orgId, range);
}

/** Search Console top queries for the signed-in org (content:read), or not connected. */
export async function readSearchTopQueries(
  ctx: OrgContext,
  range: DateRange,
  source: AnalyticsSource = getAnalyticsSource(),
): Promise<SearchQueries | NotConnected> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  return source.searchTopQueries(ctx.orgId, range);
}

// ---- staff setter (choice 3) ---------------------------------------------------------------

function assertOrgId(orgId: string): void {
  if (typeof orgId !== "string" || !ORG_RE.test(orgId)) {
    throw new InvalidInput("organization id is not valid");
  }
}

/** Staff: an org's name and stored analytics ids (analytics:set prints old -> new). */
export async function staffOrgAnalytics(
  pctx: PlatformContext,
  orgId: string,
): Promise<{ orgName: string; analytics: OrgAnalyticsIds }> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "analytics_set");
  assertOrgId(orgId);
  return withSuperuser(async (pb) => {
    try {
      const row = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name,analytics" });
      return {
        orgName: typeof row.name === "string" ? row.name : "",
        analytics: parseOrgAnalytics(row.analytics),
      };
    } catch (err) {
      if ((err as { status?: number })?.status === 404) throw new NotFound();
      throw err;
    }
  });
}

export type SetOrgAnalyticsResult = {
  orgName: string;
  before: OrgAnalyticsIds;
  after: OrgAnalyticsIds;
  changed: boolean;
};

/**
 * Staff (super_admin, support_agent): record an org's GA4 measurement / property id, Search
 * Console site and owner (DASH-13, D196). Fields not named are kept; `null` removes one;
 * `clear` starts from empty. The write and its `org.analytics_set` audit row commit in one
 * batch; the site and live cache tags are invalidated (the consent banner and the GA4 loader
 * follow; out-of-process callers rely on the 60 s / 300 s windows).
 */
export async function setOrgAnalytics(
  pctx: PlatformContext,
  orgId: string,
  input: SetOrgAnalyticsInput,
  deps: { invalidator?: Invalidator } = {},
): Promise<SetOrgAnalyticsResult> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "analytics_set");
  assertOrgId(orgId);
  const named = validateAnalyticsInput(input);
  const removed = FIELD_ORDER.filter((k) => {
    const map = {
      ga4_measurement_id: input.ga4MeasurementId,
      ga4_property_id: input.ga4PropertyId,
      gsc_site_url: input.gscSiteUrl,
      owner: input.owner,
    } as const;
    return map[k] === null;
  });

  const result = await withSuperuser(async (pb) => {
    let row: { name?: unknown; analytics?: unknown };
    try {
      row = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name,analytics" });
    } catch (err) {
      if ((err as { status?: number })?.status === 404) throw new NotFound();
      throw err;
    }
    const before = parseOrgAnalytics(row.analytics);
    const next: OrgAnalyticsIds = input.clear ? {} : { ...before };
    for (const k of removed) delete next[k];
    Object.assign(next, named);
    const after = ordered(next);
    const orgName = typeof row.name === "string" ? row.name : "";
    if (sameIds(before, after)) {
      return { orgName, before, after, changed: false };
    }
    const batch = pb.createBatch();
    batch.collection("organizations").update(orgId, { analytics: after });
    batch.collection("audit_log").create(
      auditBody(pctx, {
        action: "org.analytics_set",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: {
          fields: FIELD_ORDER.filter(
            (k) => (before[k] ?? null) !== (after[k] ?? null),
          ),
          owner: after.owner ?? null,
        },
      }),
    );
    await batch.send();
    return { orgName, before, after, changed: true };
  });

  if (result.changed) {
    clearAnalyticsCache(orgId);
    deps.invalidator?.invalidate([siteTag(orgId), liveTag(orgId)]);
  }
  return result;
}
