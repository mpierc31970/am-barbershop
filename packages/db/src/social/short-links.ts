// Bio short links (11-35; DASH-15, D199; RESEARCH Pattern 13, Pitfall 19; T-11-35-02, -03).
//
// A site serves `/<presetCode>` (`/ig`) and `/go/<code>` for its social accounts. The tenant
// route calls resolveShortCode with the SiteContext minted from the request host, so a code
// only ever resolves for that host's org (T-11-35-03). The page always wins: a preset code a
// non-deleted page of the org owns never resolves at the root, and that account's link is
// /go/<code> (the slug rule stops new pages taking a code; old ones keep it, WR-A06).
// The per-org projection is cached 60 s in-process; every social write clears it (and
// invalidates org:<id>:social when given an invalidator).
import { PRESET_CODES, findPreset } from "@cds/core/social";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { mapError } from "../repository";
import {
  cachedShortCodes,
  pageOwnedCodes,
  readSocialRows,
  storeShortCodes,
  str,
  type ShortCodeMap,
} from "./rows";

const CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function loadShortCodes(orgId: string): Promise<ShortCodeMap> {
  const hit = cachedShortCodes(orgId);
  if (hit) return hit;
  const map = await withSuperuser(async (pb) => {
    const [rows, pageCodes] = await Promise.all([
      readSocialRows(pb, orgId),
      pageOwnedCodes(pb, orgId),
    ]);
    const root = new Map<string, string>();
    const go = new Map<string, string>();
    for (const r of rows) {
      const platform = str(r.platform);
      const code = str(r.short_code);
      if (!code) continue;
      go.set(code, platform);
      const preset = findPreset(platform);
      if (preset && preset.code === code && !pageCodes.has(code)) {
        root.set(code, platform);
      }
    }
    return { root, go } satisfies ShortCodeMap;
  }).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
  storeShortCodes(orgId, map);
  return map;
}

/**
 * The platform a short-link path points at on this site, or null. `segments` is the request
 * path split on "/": `["ig"]` (a preset code) or `["go", code]`. Anything else is null.
 */
export async function resolveShortCode(
  site: SiteContext,
  segments: readonly string[],
): Promise<{ platform: string } | null> {
  assertSiteContext(site);
  if (!Array.isArray(segments)) return null;
  const parts = segments.map((s) =>
    typeof s === "string" ? s.toLowerCase() : "",
  );
  let code: string;
  let atRoot: boolean;
  if (parts.length === 1 && PRESET_CODES.includes(parts[0]!)) {
    code = parts[0]!;
    atRoot = true;
  } else if (parts.length === 2 && parts[0] === "go") {
    code = parts[1]!;
    atRoot = false;
  } else {
    return null;
  }
  if (!CODE_RE.test(code) || code.length > 24) return null;
  const map = await loadShortCodes(site.orgId);
  const platform = (atRoot ? map.root : map.go).get(code);
  return platform ? { platform } : null;
}

/** The full bio link for an account: origin (e.g. `https://riverabakery.com`) + its path. */
export function bioLinkFor(
  account: { bioPath: string },
  origin: string,
): string {
  const base = typeof origin === "string" ? origin.replace(/\/+$/, "") : "";
  return `${base}${account.bioPath}`;
}
