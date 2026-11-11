// Save-time screening, invalidation and ping for live records (banner, pop-ups; CONT-31,
// D248, D253, D270; CONTEXT A3-Q4). Internal.
//   - the scanner never blocks a save (D248): a thrown scan saves and flags "error" with
//     status "queued", source "scan" (13-11: review:run rescans it when providers answer)
//   - "held" keeps the record off (enabled=false) and flags it; "unsure" saves as asked
//     and flags it
//   - every successful save invalidates the org's live tag and pings once (13-19: the ping
//     result is recorded per org through recordPing, content/indexing-record.ts)
import type { OrgContext } from "../context";
import { withSuperuser } from "../client";
import { orgIsDemo } from "../demo/flag";
import { recordContentFlag } from "./flags";
import { pingAndRecord } from "./indexing-record";
import { refreshSiteIndex } from "./site-index/build";
import { liveTag, type ContentDeps, type ScanResult } from "./ports";
import type { SiteIndexDeps } from "./site-index/build";
import { getContentScanner } from "./scan-standin";
import { siteUrls } from "./shared";

export type ScanOutcome = ScanResult | { verdict: "error"; reasons: string[] };

export async function screen(
  ctx: OrgContext,
  deps: Pick<ContentDeps, "scanner">,
  texts: string[],
  urls: string[],
): Promise<ScanOutcome> {
  // 13-24 (STAFF-18, D293): the demo org is never scanned and never flagged.
  if (await orgIsDemo(ctx.orgId)) return { verdict: "clean", reasons: [] };
  const scanner = deps.scanner ?? getContentScanner();
  try {
    const res = await scanner.scan({ orgId: ctx.orgId, texts, urls });
    if (res.verdict === "held" || res.verdict === "unsure") return res;
    return { verdict: "clean", reasons: [] };
  } catch {
    return { verdict: "error", reasons: ["scanner unavailable"] };
  }
}

/**
 * What afterLiveSave needs. 13-52: the section registry is optional (the site index rebuilds
 * without it, as saveService always did), so core list writers can call it with only an
 * invalidator. ContentDeps satisfies it.
 */
export type LiveSaveDeps = Pick<ContentDeps, "invalidator" | "pinger"> &
  Pick<SiteIndexDeps, "sections" | "addons">;

/** Write the flag (if any), invalidate the live tag and ping the site. */
export async function afterLiveSave(
  ctx: OrgContext,
  deps: LiveSaveDeps,
  outcome: ScanOutcome,
  target: { collection: string; id: string },
): Promise<void> {
  if (outcome.verdict !== "clean") {
    await recordContentFlag(ctx, {
      targetCollection: target.collection,
      targetId: target.id,
      verdict: outcome.verdict,
      reasons: outcome.reasons,
      // 13-11 (D248): an outage queues for the hourly rescan; held / unsure open for staff.
      status: outcome.verdict === "error" ? "queued" : "open",
      ...(outcome.verdict === "error" ? { source: "scan" as const } : {}),
    });
  }
  // 07-31: rebuild index.json. 14-21 (choice 4): a live-data save is site-wide, so it bumps
  // every page's sitemap lastmod.
  await refreshSiteIndex(ctx.orgId, {
    ...deps,
    liveChangedAt: new Date().toISOString(),
  });
  deps.invalidator.invalidate([liveTag(ctx.orgId)]);
  try {
    const urls = await withSuperuser((pb) => siteUrls(pb, ctx.orgId));
    // 13-19 (STAFF-17): the per-org result goes to org_indexing (recordPing); a site with no
    // primary host yet records nothing.
    if (urls.length > 0) {
      await pingAndRecord(ctx.orgId, urls, {
        ...(deps.pinger ? { pinger: deps.pinger } : {}),
      });
    }
  } catch {
    // A ping is best effort; the save already happened.
  }
}
