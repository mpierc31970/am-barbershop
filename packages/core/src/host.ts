// Hostname classification (PLAT-02, D4). Pure and Edge-safe: no Node APIs, because
// apps/web/middleware.ts runs on the Edge runtime. Seed of P2's hostname -> organization
// resolution, which must reject rather than default, so invalid hosts are rejected here.
//
// Security (T-01-04): exact-match allowlist only, never suffix matching. Callers pass the
// `host` header only; proxy-forwarded host headers are never trusted here. IP literals in
// any form (dotted quad, bracketed IPv6, and the IN-08 numeric/0x-hex last-label forms)
// are never tenants (T-02-10).

export const DEFAULT_PLATFORM_HOSTS = "localhost,cds.needtobeedgy.com";

/**
 * Request header that carries the validated tenant host from the middleware to the
 * tenant route. The middleware strips any incoming copy and sets it only from the
 * classified `host` header, so tenant identity never comes from the URL path (WR-02).
 */
export const TENANT_HOST_HEADER = "x-cds-tenant-host";

// One DNS label: 1-63 chars of [a-z0-9-], not starting or ending with a hyphen.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const NUMERIC_LABEL = /^\d+$/;
const HEX_LABEL = /^0x[0-9a-f]*$/;

export type HostClass =
  { kind: "platform" } | { kind: "tenant"; host: string } | { kind: "invalid" };

/** Trim, lowercase, strip one trailing `:<port>` and one trailing dot. Empty -> null. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return h || null;
}

/**
 * Parse a comma-separated PLATFORM_HOSTS value into a normalized set.
 *
 * Outside production a missing or blank value falls back to DEFAULT_PLATFORM_HOSTS
 * (local dev and tests). In production it must be set: the dev default would make the
 * real platform domain a tenant, so a missing or empty value throws instead of failing open.
 */
export function parsePlatformHosts(
  env?: string,
  prod = process.env.NODE_ENV === "production",
): Set<string> {
  const source = env?.trim() ? env : prod ? "" : DEFAULT_PLATFORM_HOSTS;
  const hosts = new Set<string>();
  for (const part of source.split(",")) {
    const h = normalizeHost(part);
    if (h) hosts.add(h);
  }
  if (hosts.size === 0) {
    throw new Error("PLATFORM_HOSTS must list at least one platform host");
  }
  return hosts;
}

/** A tenant host: a DNS name, never an IP literal (IPs are never tenants, WR-03). */
function isValidTenantHost(h: string): boolean {
  if (h.length < 1 || h.length > 253) return false;
  if (IPV4_HOST.test(h) || h.startsWith("[")) return false;
  const labels = h.split(".");
  // IN-08: short/decimal/hex IPv4 forms (127.1, 1387037872, 0x7f.1) end in a numeric or
  // 0x-hex label; no real TLD does, so such hosts are never tenants.
  const last = labels[labels.length - 1] ?? "";
  if (NUMERIC_LABEL.test(last) || HEX_LABEL.test(last)) return false;
  return labels.every((label) => DNS_LABEL.test(label));
}

/**
 * Domains CDS owns: no tenant may map one of these, or any name under them, as its own
 * host. Preview hosts under `sites.connectionsdesignstudios.com` (D57) are assigned by the
 * platform only (review WR-04).
 */
export const RESERVED_HOST_SUFFIXES = ["connectionsdesignstudios.com"] as const;

/**
 * True when a normalized host is a platform host, a CDS-reserved domain, or a subdomain
 * of either. Suffix matching is right here (unlike classifyHost): it is a deny-list for
 * what a tenant may claim, never an allowlist for routing.
 */
export function isReservedHost(host: string, platform: Set<string>): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  for (const s of [...platform, ...RESERVED_HOST_SUFFIXES]) {
    if (h === s || h.endsWith(`.${s}`)) return true;
  }
  return false;
}

/**
 * Classify a raw Host header value against the platform allowlist. Platform hosts are
 * matched first (exact), so an IP literal such as `[::1]` works only when it is listed
 * in PLATFORM_HOSTS; every other host must be a valid DNS name to be a tenant.
 */
export function classifyHost(
  raw: string | null | undefined,
  platform: Set<string>,
): HostClass {
  const h = normalizeHost(raw);
  if (!h) return { kind: "invalid" };
  if (platform.has(h)) return { kind: "platform" };
  if (!isValidTenantHost(h)) return { kind: "invalid" };
  return { kind: "tenant", host: h };
}
