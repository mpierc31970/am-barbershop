// packages/db/src/dns/cloudflare/client.ts (P14, DOM-03; 14-11 choice 1).
// Owner: 14-11. Only ./provider.ts and ./index.ts import it; only factory.ts imports the folder.
//
// A tiny Cloudflare API v4 client over `fetch` (no SDK): bearer token, JSON envelope
// `{ success, errors, result, result_info }`. Logs nothing, ever (T-14-11-01): a failure is a
// CloudflareError carrying the first v4 error code, the HTTP status and whether a later run may
// retry it. Its message names neither the token, a host nor a record value.

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/** Per-request timeout (WR-A10): the move runner calls Cloudflare inside the org lock. */
const CLOUDFLARE_TIMEOUT_MS = 15_000;

/** v4 error code for "a zone with this name already exists" (in this or another account). */
export const CF_ZONE_EXISTS = 1061;

export type CfFetch = typeof globalThis.fetch;

export type CfClientOptions = {
  token: string;
  fetch?: CfFetch | undefined;
};

export type CfResultInfo = {
  page?: number;
  per_page?: number;
  count?: number;
  total_count?: number;
  total_pages?: number;
};

export type CfEnvelope<T> = {
  success: boolean;
  errors: { code: number; message?: string }[];
  messages?: unknown[];
  result: T;
  result_info?: CfResultInfo;
};

/**
 * A Cloudflare failure. `code` is `zone_exists` (1061), the first v4 error code as text, or
 * `http_<status>` / `bad_response` / `network` / `too_large` / `import_busy`. `retryable` is
 * true for 429, 5xx, network failures and the import spacing claim.
 */
export class CloudflareError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: string, status: number | null, retryable: boolean) {
    super(
      `Cloudflare API error ${code}${status === null ? "" : ` (HTTP ${status})`}`,
    );
    this.name = "CloudflareError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function errorFrom(status: number, body: unknown): CloudflareError {
  const errors =
    body &&
    typeof body === "object" &&
    Array.isArray((body as CfEnvelope<unknown>).errors)
      ? (body as CfEnvelope<unknown>).errors
      : [];
  const first = errors.find((e) => typeof e?.code === "number");
  const code =
    first?.code === CF_ZONE_EXISTS
      ? "zone_exists"
      : first
        ? String(first.code)
        : `http_${status}`;
  return new CloudflareError(code, status, retryableStatus(status));
}

async function send(
  path: string,
  init: RequestInit,
  opts: CfClientOptions,
): Promise<Response> {
  if (!opts.token) throw new CloudflareError("no_token", null, false);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${opts.token}`);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const doFetch = opts.fetch ?? globalThis.fetch;
  try {
    // WR-A10: callers hold the org lock; a hung connection must not hold it forever.
    return await doFetch(`${CLOUDFLARE_API_BASE}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
    });
  } catch {
    // Never echo the underlying error: it can carry the URL (zone ids) or headers.
    throw new CloudflareError("network", null, true);
  }
}

/** One v4 call returning the parsed envelope; non-success throws CloudflareError. */
export async function cfFetch<T>(
  path: string,
  init: RequestInit,
  opts: CfClientOptions,
): Promise<CfEnvelope<T>> {
  const res = await send(path, init, opts);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (!res.ok)
      throw new CloudflareError(
        `http_${res.status}`,
        res.status,
        retryableStatus(res.status),
      );
    throw new CloudflareError("bad_response", res.status, false);
  }
  const env = body as CfEnvelope<T>;
  if (!res.ok || !env || env.success !== true)
    throw errorFrom(res.status, body);
  return env;
}

/** A v4 call whose success body is plain text (the BIND export). Errors are v4 envelopes. */
export async function cfFetchText(
  path: string,
  init: RequestInit,
  opts: CfClientOptions,
): Promise<string> {
  const res = await send(path, init, opts);
  const text = await res.text();
  if (res.ok) return text;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // keep null: the status alone names the failure
  }
  throw errorFrom(res.status, body);
}
