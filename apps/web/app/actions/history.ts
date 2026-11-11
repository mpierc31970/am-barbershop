"use server";
// Site-part history from the Website tabs (07-29; CONT-36, D184, D187; T-07-29-01,
// T-07-29-02, T-07-29-03). Public POST endpoints: every argument is untrusted. The tenant
// comes only from the session cookie via runAction; only an allowlisted part name and a
// stamp-shaped version id ever reach @cds/db, which rebuilds the key for the caller's own
// org and re-checks both.
// 11-25 (DASH-07, D184, D254; T-11-25-01, T-11-25-03): page history from the builder. Only
// a PocketBase-shaped page id and a stamp-shaped version id reach @cds/db, which rebuilds the
// key under the caller's own org + page and requires content:write for a restore. A restore
// publishes through the one publish path (invalidation included) and returns the restored
// draft, so the builder shows it without a reload.
import {
  getPage,
  listPageVersions,
  listSections,
  listSiteSettingsVersions,
  restorePageVersion,
  restoreSiteSettingsVersion,
  type PageSummary,
  type PageVersion,
  type RestoredSitePart,
  type SectionRow,
  type SiteHistoryPart,
  type SiteVersion,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

const PARTS: ReadonlySet<string> = new Set([
  "nav",
  "footer",
  "banner",
  "settings",
]);
const VERSION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const PAGE_ID_RE = /^[a-z0-9]{15}$/;
const RESTORE_FAILED =
  "The restore didn't finish, so nothing changed. Try again in a minute.";

function invalid<T>(): ActionResult<T> {
  return { ok: false, code: "invalid_input", message: RESTORE_FAILED };
}

function isPart(v: unknown): v is SiteHistoryPart {
  return typeof v === "string" && PARTS.has(v);
}

export async function listSiteHistoryAction(
  part: unknown,
): Promise<ActionResult<SiteVersion[]>> {
  if (!isPart(part)) return invalid();
  return runAction((s) => listSiteSettingsVersions(s.ctx, part));
}

export async function restoreSiteHistoryAction(
  part: unknown,
  version: unknown,
): Promise<ActionResult<RestoredSitePart>> {
  if (!isPart(part)) return invalid();
  if (typeof version !== "string" || !VERSION_RE.test(version))
    return invalid();
  return runAction((s) =>
    restoreSiteSettingsVersion(s.ctx, contentDeps(), part, version),
  );
}

/** What a page restore hands back to the builder (11-25 choice 5). */
export type RestoredPage = {
  at: string;
  dropped: number;
  /** The publish scan held the restored version for review (the old live page stays). */
  held: boolean;
  page: PageSummary;
  sections: SectionRow[];
};

function isPageId(v: unknown): v is string {
  return typeof v === "string" && PAGE_ID_RE.test(v);
}

export async function listPageVersionsAction(
  pageId: unknown,
): Promise<ActionResult<PageVersion[]>> {
  if (!isPageId(pageId)) return invalid();
  return runAction((s) => listPageVersions(s.ctx, pageId));
}

export async function restorePageVersionAction(
  pageId: unknown,
  version: unknown,
): Promise<ActionResult<RestoredPage>> {
  if (!isPageId(pageId)) return invalid();
  if (typeof version !== "string" || !VERSION_RE.test(version))
    return invalid();
  const res = await runAction(async (s) => {
    const result = await restorePageVersion(
      s.ctx,
      pageId,
      version,
      contentDeps(),
    );
    const [page, sections] = await Promise.all([
      getPage(s.ctx, pageId),
      listSections(s.ctx, pageId),
    ]);
    return {
      at: atOf(version),
      dropped: 0,
      held: result.status === "held",
      page,
      sections,
    };
  });
  // Review 11 WR-E04: only a generic failure becomes "try again". Typed refusals keep
  // their own copy: agreement_required (the re-accept gate), not_found (version pruned),
  // rate_limited, signed_out, forbidden.
  if (!res.ok && (res.code === "save_failed" || res.code === "invalid_input")) {
    return { ok: false, code: res.code, message: RESTORE_FAILED };
  }
  return res;
}

/** 2026-10-09T14-14-00-000Z -> 2026-10-09T14:14:00.000Z. */
function atOf(id: string): string {
  const [date, time] = id.split("T") as [string, string];
  const [h, m, sec, ms] = time.replace(/Z$/, "").split("-");
  return `${date}T${h}:${m}:${sec}.${ms}Z`;
}
