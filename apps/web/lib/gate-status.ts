// The no-JS password gate status URL contract (CONT-28, D235 #12; 07-32 choice 6;
// T-07-32-05). The one place POST /api/gate/<pageId> builds its 303 target and the one place
// the tenant page parses it back:
//   <path>?gate=wrong
//   <path>?gate=rate&wait=<1-15 minutes>
// Only a status word and a clamped number travel (display only); never the password. The
// path comes from this org's manifest by page id (gatePathFor), never from the request.
// Pure: no next/*, never throws.
import { GATE_WAIT_MAX_MIN, type SiteManifest } from "@cds/core/content";

export type GateStatus =
  | { kind: "idle"; waitMinutes: 0 }
  | { kind: "wrong"; waitMinutes: 0 }
  | { kind: "rate"; waitMinutes: number };

type Params = Readonly<Record<string, string | string[] | undefined>>;

const PAGE_ID_RE = /^[a-z0-9]{15}$/;

function first(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : null;
}

/** Minutes clamped to 1..15 (anything unreadable is 15). */
export function clampWait(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return GATE_WAIT_MAX_MIN;
  return Math.min(GATE_WAIT_MAX_MIN, Math.max(1, Math.ceil(n)));
}

/** The 303 target after a refused password. `path` must already be a same-site path. */
export function gateStatusUrl(
  path: string,
  status: { kind: "wrong" } | { kind: "rate"; waitMinutes: number },
): string {
  const base = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  if (status.kind === "wrong") return `${base}?gate=wrong`;
  return `${base}?gate=rate&wait=${clampWait(status.waitMinutes)}`;
}

/** searchParams -> the gate status to show. Never throws. */
export function parseGateStatus(params: Params | null | undefined): GateStatus {
  try {
    if (!params || typeof params !== "object") {
      return { kind: "idle", waitMinutes: 0 };
    }
    const gate = Object.hasOwn(params, "gate") ? first(params.gate) : null;
    if (gate === "wrong") return { kind: "wrong", waitMinutes: 0 };
    if (gate === "rate") {
      const wait = Object.hasOwn(params, "wait") ? first(params.wait) : null;
      return { kind: "rate", waitMinutes: clampWait(wait) };
    }
  } catch {
    // fall through
  }
  return { kind: "idle", waitMinutes: 0 };
}

/**
 * A page's own path from the org's manifest by id, protected or not ("/" for home), or
 * null when the page is not published. The only redirect target of the gate route.
 */
export function gatePathFor(
  manifest: SiteManifest | null | undefined,
  pageId: unknown,
): string | null {
  if (!manifest || typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) {
    return null;
  }
  const pages = manifest.pages;
  if (typeof pages !== "object" || pages === null) return null;
  for (const slug of Object.keys(pages)) {
    const entry = pages[slug];
    if (!entry || entry.id !== pageId) continue;
    if (slug === "system-404") return null;
    return slug === "home" ? "/" : `/${encodeURIComponent(slug)}`;
  }
  return null;
}
