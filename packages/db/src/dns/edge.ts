// packages/db/src/dns/edge.ts (P14, DOM-06, DOM-02).
// Owner: 14-14 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The control plane's host truth (D13): the edge (Traefik HTTP provider or Caddy on-demand ask)
// asks, this module decides. Nothing gets a router or a certificate unless an `org_hosts` row
// says so (T-14-14-01):
//   - the hostname matches a row EXACTLY (`hostname = {:h}`; never a suffix or LIKE match),
//   - the row's organization is `active` (held / disabled / closed orgs are denied; a
//     suspended org stays allowed and answers 503 over HTTPS, P13-P3),
//   - and the row is a platform-assigned `preview` host, or a `custom` / `redirect` host with
//     `verified_at` set (no custom row exists before delegation is verified, P14-P4).
// The one suffix check below is a guard on PREVIEW rows only: a preview row must sit under the
// platform preview suffix it was assigned under, so a hand-made preview row for a foreign
// domain is still refused. It never widens the allow decision.
//
// `edgeRoutes()` is the Traefik dynamic config (P14-P7): one https router plus one http
// router per allowed host, named `cds-h-<sha256(host) first 8 hex>[-r<n>]`, where n is the
// retry count 14-23 stores in platform_meta `edge:retry:<host>` (a bumped name makes Traefik
// retry the certificate). A database error throws (the route answers 5xx), never an empty list
// that would unroute every tenant. Hostnames are re-validated against `^[a-z0-9.-]+$` before
// they are placed inside a backtick Host() rule (T-14-14-03).
//
// `cdsHostProof` is the `cds-host` MAC: HMAC-SHA256(linkSecret, `cds-host.<host>.<org>`),
// base64url. The `cds-host.` purpose prefix keeps it apart from every other link MAC.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { classifyHost, normalizeHost, parsePlatformHosts } from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { previewHostSuffix } from "../assembly/preview-host";
import { withSuperuser } from "../client";
import { linkSecret } from "../email/env";
import { forgetHost as forgetResolvedHost } from "../resolve";

// ------------------------------------------------------------------------------- types

export type TraefikRouter = {
  rule: string;
  entryPoints: string[];
  service: string;
  middlewares?: string[];
  tls?: { certResolver: string };
};

export type TraefikDynamicConfig = {
  http: { routers: Record<string, TraefikRouter> };
};

export type EdgeRoutesOptions = {
  /** The Traefik https service (default env CDS_EDGE_SERVICE; required). */
  service?: string;
  /** The http router middleware (default env CDS_EDGE_HTTP_MIDDLEWARE, else redirect-to-https@docker). */
  httpMiddleware?: string;
};

export const EDGE_DEFAULT_HTTP_MIDDLEWARE = "redirect-to-https@docker";
export const EDGE_CERT_RESOLVER = "letsencrypt";
/** platform_meta key prefix for the HTTPS retry counter (written by 14-23). */
export const EDGE_RETRY_KEY_PREFIX = "edge:retry:";

const HOST_RE = /^[a-z0-9.-]+$/;
const MAX_HOST = 253;

// ------------------------------------------------------------------------------- the rule

type OrgShape = { id?: string; status?: string };

let platformHosts: Set<string> | undefined;
function platform(): Set<string> {
  platformHosts ??= parsePlatformHosts(process.env.PLATFORM_HOSTS);
  return platformHosts;
}

/** A normalised tenant hostname that is safe to look up and to put in a rule, else null. */
function tenantHost(raw: string | null | undefined): string | null {
  const h = normalizeHost(raw);
  if (!h || h.length > MAX_HOST || !HOST_RE.test(h)) return null;
  const c = classifyHost(h, platform());
  return c.kind === "tenant" ? c.host : null;
}

/** The allow decision for one org_hosts row (expanded organization). */
function rowAllowed(row: RecordModel, host: string): boolean {
  const org = row.expand?.organization as OrgShape | undefined;
  if (!org?.id || org.status !== "active") return false;
  if (row.hostname !== host) return false; // exact, never a suffix
  if (row.kind === "preview") {
    // Guard on preview rows only (see header): the platform preview suffix it was assigned
    // under. Never used to allow a host that has no row.
    return host.endsWith(`.${previewHostSuffix()}`);
  }
  if (row.kind === "custom" || row.kind === "redirect") {
    return typeof row.verified_at === "string" && row.verified_at !== "";
  }
  return false;
}

// ------------------------------------------------------------------------------- cache
// Same shape as resolve.ts (T-14-14-02): 30 s positive, 5 s negative, bounded at 1000 entries.

const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;
export const EDGE_CACHE_MAX = 1000;

const cache = new Map<string, { value: boolean; expires: number }>();

function remember(host: string, value: boolean): void {
  cache.delete(host);
  while (cache.size >= EDGE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(host, {
    value,
    expires: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
}

/** Drop every cached edge decision (tests). */
export function clearEdgeCache(): void {
  cache.clear();
  platformHosts = undefined;
  askSnapshot = null;
}

// WR-A11: the Caddy ask answers from a snapshot of every allowed host, refreshed at most once
// per 30 s (one query, single flight) and dropped by forgetHost. A flood of random SNI names
// can neither evict known hosts (the per-host cache is bounded) nor drive database reads.
const ASK_SNAPSHOT_MS = 30_000;
let askSnapshot: { hosts: Set<string>; at: number } | null = null;
let askLoading: Promise<void> | null = null;

/**
 * Drop one host from the resolver cache and the edge cache, so cutover and redirect changes
 * apply at once. (The @cds/db barrel exports this one; `resolve.ts` keeps its own
 * resolver-only `forgetHost`.)
 */
export function forgetHost(host: string): void {
  forgetResolvedHost(host);
  const h = normalizeHost(host);
  if (h) cache.delete(h);
  askSnapshot = null;
}

/**
 * The Caddy on_demand_tls ask (WR-A11): true only when `host` is in the allowed-host
 * snapshot (same rule as edgeAllowedHosts). Throws only when no snapshot was ever loaded and
 * the database read fails; a failed refresh keeps answering from the last snapshot.
 */
export async function edgeAskAllowed(
  host: string | null | undefined,
): Promise<boolean> {
  const h = tenantHost(host);
  if (!h) return false;
  if (!askSnapshot || Date.now() - askSnapshot.at > ASK_SNAPSHOT_MS) {
    askLoading ??= edgeAllowedHosts()
      .then((list) => {
        askSnapshot = { hosts: new Set(list), at: Date.now() };
      })
      .finally(() => {
        askLoading = null;
      });
    try {
      await askLoading;
    } catch (err) {
      if (!askSnapshot) throw err;
    }
  }
  return askSnapshot?.hosts.has(h) ?? false;
}

// ------------------------------------------------------------------------------- edgeAllowed

/** True only when the edge may serve and certify `host` (see header). A PB error throws. */
export async function edgeAllowed(
  host: string | null | undefined,
): Promise<boolean> {
  const h = tenantHost(host);
  if (!h) return false;
  const hit = cache.get(h);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = false;
  try {
    const row = await withSuperuser((pb) =>
      pb
        .collection("org_hosts")
        .getFirstListItem(pb.filter("hostname = {:h}", { h }), {
          expand: "organization",
        }),
    );
    value = rowAllowed(row, h);
  } catch (err) {
    if (!(err instanceof ClientResponseError && err.status === 404)) throw err;
  }
  remember(h, value);
  return value;
}

// ------------------------------------------------------------------------------- routes

/** `cds-h-<first 8 hex of sha256(host)>`, plus `-r<n>` when retried n > 0 times. */
export function edgeRouterName(host: string, retry = 0): string {
  const base = `cds-h-${createHash("sha256").update(host).digest("hex").slice(0, 8)}`;
  return retry > 0 ? `${base}-r${retry}` : base;
}

function edgeService(opts: EdgeRoutesOptions): string {
  const s = (opts.service ?? process.env.CDS_EDGE_SERVICE ?? "").trim();
  if (s === "") throw new Error("CDS_EDGE_SERVICE must be set");
  return s;
}

async function retryCounts(): Promise<Map<string, number>> {
  // One list over the key range [edge:retry:, edge:retry;) (`;` follows `:`): a prefix read
  // without a LIKE match.
  const rows = await withSuperuser((pb) =>
    pb.collection("platform_meta").getFullList({
      filter: pb.filter("key >= {:lo} && key < {:hi}", {
        lo: EDGE_RETRY_KEY_PREFIX,
        hi: "edge:retry;",
      }),
      fields: "key,value",
    }),
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.key ?? "");
    if (!key.startsWith(EDGE_RETRY_KEY_PREFIX)) continue;
    const n = Number.parseInt(String(r.value ?? ""), 10);
    if (Number.isSafeInteger(n) && n > 0) {
      out.set(key.slice(EDGE_RETRY_KEY_PREFIX.length), n);
    }
  }
  return out;
}

/** Every host the edge may serve, sorted (one superuser list). A PB error throws. */
export async function edgeAllowedHosts(): Promise<string[]> {
  const rows = await withSuperuser((pb) =>
    pb.collection("org_hosts").getFullList({
      filter:
        "(kind = 'preview' || verified_at != '') && organization.status = 'active'",
      expand: "organization",
    }),
  );
  const hosts = new Set<string>();
  for (const row of rows) {
    const h = tenantHost(String(row.hostname ?? ""));
    if (!h || h !== row.hostname) continue; // re-validated before any rule (T-14-14-03)
    if (rowAllowed(row, h)) hosts.add(h);
  }
  return [...hosts].sort();
}

/** The Traefik HTTP-provider dynamic config for every allowed host (P14-P7). */
export async function edgeRoutes(
  opts: EdgeRoutesOptions = {},
): Promise<TraefikDynamicConfig> {
  const service = edgeService(opts);
  const httpService = service.startsWith("https-")
    ? `http-${service.slice("https-".length)}`
    : service;
  const middleware =
    (
      opts.httpMiddleware ??
      process.env.CDS_EDGE_HTTP_MIDDLEWARE ??
      ""
    ).trim() || EDGE_DEFAULT_HTTP_MIDDLEWARE;

  const [hosts, retries] = await Promise.all([
    edgeAllowedHosts(),
    retryCounts(),
  ]);
  const routers: Record<string, TraefikRouter> = {};
  for (const h of hosts) {
    const name = edgeRouterName(h, retries.get(h) ?? 0);
    const rule = `Host(\`${h}\`)`;
    routers[name] = {
      rule,
      entryPoints: ["https"],
      service,
      tls: { certResolver: EDGE_CERT_RESOLVER },
    };
    routers[`${name}-http`] = {
      rule,
      entryPoints: ["http"],
      middlewares: [middleware],
      service: httpService,
    };
  }
  return { http: { routers } };
}

// ------------------------------------------------------------------------------- cds-host proof

const PROOF_RE = /^[A-Za-z0-9_-]{43}$/;

function proofMac(host: string, orgId: string): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`cds-host.${host}.${orgId}`)
    .digest();
}

/** base64url HMAC-SHA256(linkSecret, `cds-host.<host>.<orgId>`); the host is normalised. */
export function cdsHostProof(host: string, orgId: string): string {
  const h = normalizeHost(host) ?? "";
  return proofMac(h, orgId).toString("base64url");
}

/** Timing-safe check of a `cds-host` proof. Never throws. */
export function verifyCdsHostProof(
  host: unknown,
  orgId: unknown,
  proof: unknown,
): boolean {
  try {
    if (typeof host !== "string" || typeof orgId !== "string") return false;
    if (typeof proof !== "string" || !PROOF_RE.test(proof)) return false;
    const h = normalizeHost(host);
    if (!h || orgId === "") return false;
    const want = proofMac(h, orgId);
    const got = Buffer.from(proof, "base64url");
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}
