// packages/db/src/content/indexnow.ts (P14, CONT-16).
// Owner: 14-21 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The real IndexNow pinger behind the SearchPinger port (D190, D253). No account: one
// platform key (`CDS_INDEXNOW_KEY`), served at `https://<host>/<key>.txt` by the middleware
// (14-18). One batch POST per host (the protocol takes one host per call), at most
// INDEXNOW_MAX_URLS URLs each (extra dropped). 200/202 → `ok`; anything else or a throw →
// `error`. Logs the status class only, never URLs, hosts or the key (T-14-21-03).
//
// Which URLs may reach it is decided centrally in indexing-record.ts `pingAndRecord`
// (custom primary host of a live, non-demo, non-suspended org only; T-14-21-01).
import type { PingResult, PingResultKind, SearchPinger } from "./ports";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_URLS = 10_000;
const KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;
/** Per-request timeout (WR-A10). */
const INDEXNOW_TIMEOUT_MS = 10_000;

export type IndexNowOptions = {
  fetch?: typeof fetch;
  endpoint?: string;
};

/** True when `key` is a valid IndexNow key (8-128 of a-z, A-Z, 0-9, `-`). */
export function isIndexNowKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

/** `CDS_INDEXNOW_KEY`, validated; throws naming the variable when missing or malformed. */
export function requireIndexNowKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.CDS_INDEXNOW_KEY;
  if (!isIndexNowKey(key)) {
    throw new Error(
      "CDS_INDEXNOW_KEY must be set to 8-128 letters, digits or '-' when CDS_SEARCH_PINGER=indexnow",
    );
  }
  return key;
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** Group https URLs by host, keeping order; non-URLs are dropped. */
function byHost(urls: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const u of urls) {
    if (typeof u !== "string") continue;
    let host: string;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      host = parsed.hostname.toLowerCase();
    } catch {
      continue;
    }
    if (host === "") continue;
    const list = out.get(host) ?? [];
    list.push(u);
    out.set(host, list);
  }
  return out;
}

/** A SearchPinger that submits to IndexNow (choice 1). */
export function indexNowPinger(
  key: string,
  opts: IndexNowOptions = {},
): SearchPinger {
  if (!isIndexNowKey(key)) {
    throw new Error("indexNowPinger: invalid IndexNow key (CDS_INDEXNOW_KEY)");
  }
  const endpoint = opts.endpoint ?? INDEXNOW_ENDPOINT;
  return {
    async ping(
      urls: string[],
      pingOpts?: { orgId?: string },
    ): Promise<PingResult> {
      const orgId = pingOpts?.orgId ?? "";
      const groups = byHost(Array.isArray(urls) ? urls : []);
      if (groups.size === 0) return { orgId, result: "skipped" };
      const doFetch = opts.fetch ?? fetch;
      let result: PingResultKind = "ok";
      for (const [host, list] of groups) {
        const body = JSON.stringify({
          host,
          key,
          keyLocation: `https://${host}/${key}.txt`,
          urlList: list.slice(0, INDEXNOW_MAX_URLS),
        });
        try {
          const res = await doFetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body,
            redirect: "error",
            // WR-A10: step 10 runs inside the org lock; never wait on a hung host.
            signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
          });
          if (res.status !== 200 && res.status !== 202) {
            console.error(
              `[indexnow] ping refused: ${statusClass(res.status)}`,
            );
            result = "error";
          }
        } catch (err) {
          console.error(
            `[indexnow] ping failed: ${err instanceof Error ? err.name : typeof err}`,
          );
          result = "error";
        }
      }
      return { orgId, result };
    },
  };
}
