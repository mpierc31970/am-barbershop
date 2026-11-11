// packages/db/src/content/sitemap-submit.ts (P14, CONT-16).
// Owner: 14-26 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Sitemap submission for live custom domains (D190, D253). The Google ping endpoint is
// retired, so submission goes through the two keyed APIs:
// - Search Console: service-account JWT (RS256, scope webmasters) exchanged at the token URL,
//   then `PUT https://www.googleapis.com/webmasters/v3/sites/<site>/sitemaps/<feed>`.
// - Bing Webmaster: `POST https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=<key>`
//   with `{ siteUrl, feedUrl }`.
// Every provider URL is an env var with that default (GSC_TOKEN_URL, GSC_API_BASE,
// BING_WEBMASTER_API_BASE); credentials come from GSC_SERVICE_ACCOUNT_JSON (inline JSON or a
// file path) and BING_WEBMASTER_API_KEY. A missing credential skips that engine.
//
// CDS_SITEMAP_SUBMITTER: unset / `log` → loggingSubmitter (the stand-in, records `logged`),
// `api` → apiSubmitter, anything else throws.
//
// submitAndRecord: the one entry point (launch, move step 10, weekly resubmit). It applies
// the same eligibility guard as IndexNow (custom primary host of a live, non-demo, not
// suspended org; T-14-26-02) and records `org_indexing.last_submit_at / last_submit_result`.
// Never throws. Logs status class / error class only, never hosts, URLs, tokens or keys
// (T-14-26-01).
//
// 14-32 (CONT-16, D312; T-14-32-03): ownerSearchStatus, the owner's read-only view for
// Settings › Integrations: live or not, the GA4 measurement id, whether Search Console is set
// (a boolean, never the site id), and the last sitemap submission and IndexNow ping (time +
// result). Needs `domain:read` (Owner, Admin); scoped to the caller's org (P14-P34).
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { withSuperuser } from "../client";
import { scopedOrgId, type OrgContext } from "../context";
import { orgIsDemo } from "../demo/flag";
import { parseOrgAnalytics } from "../reports/analytics";
import { assertId, requirePermission } from "../repository";
import {
  ORG_INDEXING_COLLECTION,
  eligibleUrls,
  pingKind,
  pingableHost,
  recordSubmit,
} from "./indexing-record";
import type { PingResultKind } from "./ports";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters";
export const GSC_TOKEN_URL_DEFAULT = "https://oauth2.googleapis.com/token";
export const GSC_API_BASE_DEFAULT = "https://www.googleapis.com/webmasters/v3";
export const BING_WEBMASTER_API_BASE_DEFAULT =
  "https://ssl.bing.com/webmaster/api.svc/json";

export type SitemapSubmitResultKind = "logged" | "ok" | "error" | "skipped";
export type SitemapEngineResult = "ok" | "error" | "skipped";

export type SitemapSubmitOutcome = {
  result: SitemapSubmitResultKind;
  engines: { google?: SitemapEngineResult; bing?: SitemapEngineResult };
};

/** Choice 1: the port. `siteUrl` is `https://<host>/`, `sitemapUrl` its `/sitemap.xml`. */
export interface SitemapSubmitter {
  readonly name: "log" | "api";
  /**
   * `opts.gscProperty` (WR-A12): the org's Search Console property id (`sc-domain:<host>` or a
   * URL prefix). null = the org has none: Google is skipped. Omitted: `siteUrl` is used.
   */
  submit(
    siteUrl: string,
    sitemapUrl: string,
    opts?: { gscProperty?: string | null },
  ): Promise<SitemapSubmitOutcome>;
}

/** Per-request timeout for the token, Search Console and Bing calls (WR-A10). */
const SUBMIT_TIMEOUT_MS = 10_000;
const SUBMIT_RESULTS: readonly SitemapSubmitResultKind[] = [
  "logged",
  "ok",
  "error",
  "skipped",
];

export function sitemapSubmitKind(v: unknown): SitemapSubmitResultKind | null {
  return SUBMIT_RESULTS.includes(v as SitemapSubmitResultKind)
    ? (v as SitemapSubmitResultKind)
    : null;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Choice 2: the stand-in. Logs a count only (no host) and answers `logged`. */
export const loggingSubmitter: SitemapSubmitter = {
  name: "log",
  submit() {
    console.info("[sitemap] sitemap submit (stand-in) 1 site");
    return Promise.resolve({ result: "logged", engines: {} });
  },
};

type ServiceAccount = { clientEmail: string; privateKey: string };

/** GSC_SERVICE_ACCOUNT_JSON: inline JSON (starts with `{`) or a path to the key file. */
function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trimStart().startsWith("{")
    ? raw
    : readFileSync(raw.trim(), "utf8");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (
    typeof clientEmail !== "string" ||
    clientEmail === "" ||
    typeof privateKey !== "string" ||
    privateKey === ""
  ) {
    throw new TypeError("service account JSON lacks client_email/private_key");
  }
  return { clientEmail, privateKey };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export type ApiSubmitterOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Defaults to process.env (read once, when the submitter is built). */
  env?: Record<string, string | undefined>;
};

/** Choice 3: Search Console + Bing Webmaster, each skipped when its credential is absent. */
export function apiSubmitter(opts: ApiSubmitterOptions = {}): SitemapSubmitter {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());
  const tokenUrl = env.GSC_TOKEN_URL || GSC_TOKEN_URL_DEFAULT;
  const gscBase = trimSlash(env.GSC_API_BASE || GSC_API_BASE_DEFAULT);
  const bingBase = trimSlash(
    env.BING_WEBMASTER_API_BASE || BING_WEBMASTER_API_BASE_DEFAULT,
  );
  const saRaw = env.GSC_SERVICE_ACCOUNT_JSON ?? "";
  const bingKey = env.BING_WEBMASTER_API_KEY ?? "";
  let cached: { token: string; expiresAt: number } | null = null;

  // WR-A10: a timeout on every call (the launch's step 10 runs inside the org lock).
  const doFetch = (url: string, init: RequestInit) =>
    (opts.fetch ?? fetch)(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

  async function accessToken(sa: ServiceAccount): Promise<string> {
    const t = now().getTime();
    if (cached && t < cached.expiresAt) return cached.token;
    const iat = Math.floor(t / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: sa.clientEmail,
        scope: GSC_SCOPE,
        aud: tokenUrl,
        iat,
        exp: iat + 3600,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${signer.sign(sa.privateKey).toString("base64url")}`;
    const res = await doFetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`token exchange refused: ${statusClass(res.status)}`);
    }
    const body = (await res.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof body.access_token !== "string" || body.access_token === "") {
      throw new TypeError("token exchange answered no access_token");
    }
    const ttl =
      typeof body.expires_in === "number" && body.expires_in > 0
        ? body.expires_in
        : 3600;
    // Refresh a minute early so a token never expires mid-request.
    cached = {
      token: body.access_token,
      expiresAt: t + Math.max(0, ttl - 60) * 1000,
    };
    return body.access_token;
  }

  async function google(
    siteUrl: string,
    sitemapUrl: string,
  ): Promise<SitemapEngineResult> {
    if (saRaw.trim() === "") return "skipped";
    try {
      const sa = parseServiceAccount(saRaw);
      const token = await accessToken(sa);
      const url = `${gscBase}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
      const res = await doFetch(url, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error(
          `[sitemap] search console refused: ${statusClass(res.status)}`,
        );
        return "error";
      }
      return "ok";
    } catch (err) {
      console.error(`[sitemap] search console failed: ${errName(err)}`);
      return "error";
    }
  }

  async function bing(
    siteUrl: string,
    sitemapUrl: string,
  ): Promise<SitemapEngineResult> {
    if (bingKey.trim() === "") return "skipped";
    try {
      const url = `${bingBase}/SubmitFeed?apikey=${encodeURIComponent(bingKey.trim())}`;
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ siteUrl, feedUrl: sitemapUrl }),
      });
      if (!res.ok) {
        console.error(`[sitemap] bing refused: ${statusClass(res.status)}`);
        return "error";
      }
      return "ok";
    } catch (err) {
      console.error(`[sitemap] bing failed: ${errName(err)}`);
      return "error";
    }
  }

  return {
    name: "api",
    async submit(siteUrl, sitemapUrl, opts) {
      // Sequential: one site, two calls; keeps logs and retries easy to follow.
      const property =
        opts?.gscProperty === undefined ? siteUrl : opts.gscProperty;
      const g = property ? await google(property, sitemapUrl) : "skipped";
      const b = await bing(siteUrl, sitemapUrl);
      const configured = [g, b].filter((r) => r !== "skipped");
      const result: SitemapSubmitResultKind =
        configured.length === 0
          ? "skipped"
          : configured.includes("error")
            ? "error"
            : "ok";
      return { result, engines: { google: g, bing: b } };
    },
  };
}

let memo: { env: string; submitter: SitemapSubmitter } | null = null;

/** Choice 4: CDS_SITEMAP_SUBMITTER selects the implementation; unknown values throw. */
export function getSitemapSubmitter(): SitemapSubmitter {
  const v = process.env.CDS_SITEMAP_SUBMITTER;
  if (v === undefined || v === "" || v === "log") return loggingSubmitter;
  if (v === "api") {
    if (memo && memo.env === v) return memo.submitter;
    const submitter = apiSubmitter();
    memo = { env: v, submitter };
    return submitter;
  }
  throw new Error(
    `CDS_SITEMAP_SUBMITTER="${v}" is not supported (use "api", or unset it / "log" for the logging stand-in)`,
  );
}

/** Tests only: forget the memoised API submitter (and its token cache). */
export function resetSitemapSubmitterForTests(): void {
  memo = null;
}

export type SubmitAndRecordOptions = {
  /** Defaults to getSitemapSubmitter(). */
  submitter?: SitemapSubmitter;
  now?: Date;
};

/**
 * Submit the org's sitemap and record the outcome (choice 4). `host` names the host to
 * submit; null means "the org's custom primary". Only the custom primary host of a live,
 * non-demo, not suspended org is ever submitted; anything else answers `skipped` without
 * calling the submitter (recorded, except for the demo org, which is never recorded, like
 * pings). Never throws.
 */
export async function submitAndRecord(
  orgId: string,
  host: string | null,
  opts: SubmitAndRecordOptions = {},
): Promise<SitemapSubmitResultKind> {
  const now = opts.now ?? new Date();
  try {
    assertId(orgId);
  } catch {
    return "skipped";
  }
  if (await orgIsDemo(orgId)) return "skipped";
  let result: SitemapSubmitResultKind = "skipped";
  let target: string | null = null;
  let gscProperty: string | null = null;
  try {
    const allowed = await pingableHost(orgId);
    const want = host ?? allowed;
    if (want && eligibleUrls([`https://${want}/`], allowed).length === 1) {
      target = want.toLowerCase();
    }
    // WR-A12: Search Console needs the exact property id the org recorded (analytics:set),
    // which may be a Domain property (`sc-domain:<host>`); none recorded skips Google.
    const org = await withSuperuser((pb) =>
      pb.collection("organizations").getOne(orgId, { fields: "analytics" }),
    );
    gscProperty = parseOrgAnalytics(org.analytics).gsc_site_url ?? null;
  } catch (err) {
    console.error(`[sitemap] eligibility read failed: ${errName(err)}`);
    target = null;
  }
  if (target) {
    try {
      const submitter = opts.submitter ?? getSitemapSubmitter();
      const out = await submitter.submit(
        `https://${target}/`,
        `https://${target}/sitemap.xml`,
        { gscProperty },
      );
      result = sitemapSubmitKind(out?.result) ?? "error";
    } catch (err) {
      console.error(`[sitemap] submit failed: ${errName(err)}`);
      result = "error";
    }
  }
  try {
    await recordSubmit(orgId, result, now);
  } catch (err) {
    console.error(`[sitemap] record submit failed: ${errName(err)}`);
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// 14-32: owner read for Settings › Integrations
// ---------------------------------------------------------------------------------------

export type OwnerSearchStatus = {
  /** True once the site is live (stage `live`). */
  live: boolean;
  /** GA4 measurement id ("G-…"), or null. The only analytics id an owner sees. */
  ga4MeasurementId: string | null;
  /** Search Console is set up for the site (the site id itself stays staff-only). */
  searchConsole: boolean;
  lastSubmitAt: string | null;
  lastSubmitResult: SitemapSubmitResultKind | null;
  lastPingAt: string | null;
  lastPingResult: PingResultKind | null;
};

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Settings › Integrations (14-32 choice 4). Read-only; `domain:read`. */
export async function ownerSearchStatus(
  ctx: OrgContext,
): Promise<OwnerSearchStatus> {
  const orgId = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "read");
  return withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "stage,analytics" });
    const ids = parseOrgAnalytics(org.analytics);
    const res = await pb.collection(ORG_INDEXING_COLLECTION).getList(1, 1, {
      filter: pb.filter("org_id = {:org}", { org: orgId }),
      fields: "last_submit_at,last_submit_result,last_ping_at,last_ping_result",
      skipTotal: true,
    });
    const row = res.items[0];
    return {
      live: org.stage === "live",
      ga4MeasurementId: ids.ga4_measurement_id ?? null,
      searchConsole: Boolean(ids.gsc_site_url),
      lastSubmitAt: row ? isoOrNull(row.last_submit_at) : null,
      lastSubmitResult: row ? sitemapSubmitKind(row.last_submit_result) : null,
      lastPingAt: row ? isoOrNull(row.last_ping_at) : null,
      lastPingResult: row ? pingKind(row.last_ping_result) : null,
    };
  });
}
