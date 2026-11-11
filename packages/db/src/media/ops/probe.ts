// Hourly CDN probe (07-27; CONTEXT Area 1 row 3, D278, CONT-20; choice 1).
//
// The canary is the newest published, ready, not-deleted image row; its `thumb` variant is
// fetched with HEAD through the CDN (`delivery.urlFor`, so the host comes only from the Bunny
// adapter's env, never from data: no SSRF, T-07-27-03). 2xx or 304 passes; one retry after
// 2 s. On a second failure the public store decides: object present -> "down" (a CDN
// problem); object missing or stat throws -> "no-canary" (an origin problem, counted with
// noteMediaOriginError; the CDN state is left alone). With the app stand-in the probe is
// "skipped": the app is the origin, so there is nothing to fall back from.
// Logs carry the result only, never the URL or the key.
import { withSuperuser } from "../../client";
import {
  getPublicMediaStore,
  tenantPublicMediaKey,
  type ObjectStat,
} from "../../storage";
import { getMediaDelivery } from "../library/delivery";
import { IMAGE_ROW_KINDS } from "../library/list";
import type { DeliveryAssetRef, MediaDelivery } from "../ports";
import { noteMediaOriginError } from "./counters";

export type ProbeResult = "skipped" | "ok" | "down" | "no-canary";

export type ProbeOutcome = { result: ProbeResult; canary: boolean };

export type Canary = DeliveryAssetRef & { key: string };

export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_RETRY_MS = 2_000;

type FetchLike = (
  url: string,
  init: { method: string; redirect: RequestRedirect; signal: AbortSignal },
) => Promise<{ status: number }>;

export type ProbeDeps = {
  delivery?: MediaDelivery;
  fetch?: FetchLike;
  findCanary?: () => Promise<Canary | null>;
  store?: { stat(key: string): Promise<ObjectStat | null> };
  sleep?: (ms: number) => Promise<void>;
};

/** The newest published image (one bound query; row kinds as params). */
export async function findCanary(): Promise<Canary | null> {
  return withSuperuser(async (pb) => {
    const params: Record<string, string> = {};
    const kinds = IMAGE_ROW_KINDS.map((k, i) => {
      params[`k${i}`] = k;
      return `kind = {:k${i}}`;
    }).join(" || ");
    const expr =
      "public_at != '' && status = 'ready' && deleted_at = '' && (" +
      kinds +
      ")";
    const list = await pb.collection("media_assets").getList(1, 1, {
      filter: pb.filter(expr, params),
      sort: "-public_at",
      fields: "id,organization,kind",
    });
    const row = list.items[0];
    if (!row) return null;
    const id = String(row.id);
    const orgId = String(row.organization ?? "");
    if (!orgId) return null;
    return {
      id,
      orgId,
      kind: "image",
      key: tenantPublicMediaKey(orgId, "image", id, "thumb"),
    };
  });
}

function passed(status: number): boolean {
  return (status >= 200 && status < 300) || status === 304;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function probeCdn(deps: ProbeDeps = {}): Promise<ProbeOutcome> {
  const delivery = deps.delivery ?? getMediaDelivery();
  if (delivery.name !== "bunny") {
    console.info("[jobs/media] probe skipped");
    return { result: "skipped", canary: false };
  }
  const canary = await (deps.findCanary ?? findCanary)();
  if (!canary) {
    console.info("[jobs/media] probe no-canary");
    return { result: "no-canary", canary: false };
  }
  const doFetch: FetchLike = deps.fetch ?? (globalThis.fetch as FetchLike);
  const sleep = deps.sleep ?? realSleep;
  const target = delivery.urlFor(
    { id: canary.id, orgId: canary.orgId, kind: canary.kind },
    "thumb",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(PROBE_RETRY_MS);
    try {
      const res = await doFetch(target, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (passed(res.status)) {
        console.info("[jobs/media] probe ok");
        return { result: "ok", canary: true };
      }
    } catch {
      // A timeout or network error counts as a failed attempt.
    }
  }
  const store = deps.store ?? getPublicMediaStore();
  let present = false;
  try {
    present = (await store.stat(canary.key)) !== null;
  } catch {
    present = false;
  }
  if (present) {
    console.warn("[jobs/media] probe down");
    return { result: "down", canary: true };
  }
  noteMediaOriginError();
  console.warn("[jobs/media] probe no-canary (origin object unreadable)");
  return { result: "no-canary", canary: true };
}
