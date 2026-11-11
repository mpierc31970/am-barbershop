// Soft-delete GC (07-28; D275; CONTEXT Area 5 row 2: "the hourly job hard-deletes soft-deleted
// items no longer referenced anywhere"; choice 7). Step 6 of the hourly media job
// (jobs/media.ts). Takedown (07-27, D249) is a separate hard delete and never goes through here.
//
// One run:
//   1. discovery: a paged superuser scan per collection (`deleted_at != ''`, fields id +
//      organization, at most GC_SCAN_MAX rows per collection per run), grouped by org.
//      Per org, the scan pages past still-referenced rows and stops at GC_BATCH_MAX deletes
//      (WR-A04: rows kept for months never starve newer ones)
//   2. per org, under withOrgLock(orgId) (the same lock as publish, restore and delete, so it
//      never races them): phases pop-ups -> forms -> media, with the org's references
//      (soft-delete.ts orgReferencedIds, OrgScope { orgId }) recomputed before each phase, so
//      one run cascades (a deleted pop-up frees the form and photo inside it). Each phase is
//      one PB batch: the row deletes plus one `<collection>.gc_delete` audit row each (system
//      actor, organization = the org)
//   3. after the lock: removeMediaObjects for every media row (public + private objects, CDN
//      purge), then one invalidate([siteTag, liveTag]) per org that changed
// 11-29 (DASH-06, D187, D275): pages run first, before pop-ups: a page in Recently deleted
// for more than PAGE_BIN_DAYS is purged, one PB batch per page (its page_sections rows, the
// row and one `pages.gc_delete` audit row), at most GC_BATCH_MAX pages per org per run. After
// the lock its version JSON (tenants/<org>/versions/pages/<id>/) and published JSON go. The
// manifest redirect from its old address stays. Its refs leave with it, so the later phases
// of the same run can free what only it used.
// A failure in one org is counted in gcErrors and logged without ids or keys; the other orgs
// still run. Counts only leave this file (T-07-28-08).
import type { SectionRegistry } from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertSystemContext, type SystemContext } from "../context";
import type { MediaDelivery } from "../media/ports";
import { removeMediaObjects } from "../media/library/delete";
import { assertId } from "../repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantVersionPrefix,
  type ObjectStore,
} from "../storage";
import { withOrgLock } from "./lock";
import { PAGE_BIN_DAYS } from "./page-delete";
import { liveTag, siteTag, type Invalidator } from "./ports";
import {
  orgReferencedIds,
  SOFT_COLLECTION,
  type SoftKind,
} from "./soft-delete";

export type GcDeps = {
  sections: SectionRegistry;
  invalidator: Invalidator;
  delivery?: MediaDelivery;
  store?: ObjectStore;
  publicStore?: ObjectStore;
  /** The run's clock (tests); pages deleted before now - PAGE_BIN_DAYS are purged. */
  now?: () => Date;
};

export type GcResult = {
  /** 11-29: pages purged after PAGE_BIN_DAYS in Recently deleted. */
  gcPages: number;
  gcPopups: number;
  gcForms: number;
  gcMedia: number;
  gcKept: number;
  gcErrors: number;
};

/** Most rows hard-deleted per collection per org per run (one PB batch: rows + audits). */
export const GC_BATCH_MAX = 200;
/** Page size of the GC scans. */
const GC_PAGE = 200;
/**
 * Most soft-deleted rows scanned per collection per run (WR-A04). Scans page past rows that
 * are still referenced, so kept rows at the head of the queue never starve newer ones; this
 * only bounds one run.
 */
export const GC_SCAN_MAX = 20_000;
const PHASES: readonly SoftKind[] = ["popups", "forms", "media"];
const RESULT_KEY: Record<SoftKind, "gcPopups" | "gcForms" | "gcMedia"> = {
  popups: "gcPopups",
  forms: "gcForms",
  media: "gcMedia",
};

export const GC_NEEDS_REGISTRY = "gc needs the composed section registry";

function validId(v: unknown): v is string {
  try {
    assertId(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Page through one collection's soft-deleted rows, oldest first, until `visit` returns false,
 * the rows run out or GC_SCAN_MAX rows were read (WR-A04: never just the first page, which
 * still-referenced rows can fill for good).
 */
async function scanSoftDeleted(
  pb: PocketBase,
  collection: string,
  opts: { filter: string; fields?: string },
  visit: (rows: RecordModel[]) => boolean | Promise<boolean>,
): Promise<void> {
  for (let page = 1; (page - 1) * GC_PAGE < GC_SCAN_MAX; page++) {
    const res = await pb.collection(collection).getList(page, GC_PAGE, {
      filter: opts.filter,
      sort: "deleted_at,id",
      skipTotal: true,
      ...(opts.fields ? { fields: opts.fields } : {}),
    });
    if (res.items.length === 0) return;
    if (!(await visit(res.items))) return;
    if (res.items.length < GC_PAGE) return;
  }
}

const DAY_MS = 86_400_000;

/** PB date stamp of the purge cutoff: pages deleted before it are purged. */
function pageCutoff(now: Date): string {
  return new Date(now.getTime() - PAGE_BIN_DAYS * DAY_MS)
    .toISOString()
    .replace("T", " ");
}

/** Orgs with a soft-deleted row in the three collections or a page past the bin window. */
async function discoverOrgs(pb: PocketBase, cutoff: string): Promise<string[]> {
  const orgs = new Set<string>();
  await scanSoftDeleted(
    pb,
    "pages",
    {
      filter: pb.filter("deleted_at != '' && deleted_at < {:cutoff}", {
        cutoff,
      }),
      fields: "id,organization",
    },
    (rows) => {
      for (const r of rows) {
        if (validId(r.id) && validId(r.organization)) orgs.add(r.organization);
      }
      return true;
    },
  );
  for (const kind of PHASES) {
    await scanSoftDeleted(
      pb,
      SOFT_COLLECTION[kind],
      { filter: "deleted_at != ''", fields: "id,organization" },
      (rows) => {
        for (const r of rows) {
          if (validId(r.id) && validId(r.organization)) {
            orgs.add(r.organization);
          }
        }
        return true;
      },
    );
  }
  return [...orgs];
}

type OrgOutcome = {
  pages: string[];
  counts: Record<SoftKind, number>;
  kept: number;
  media: RecordModel[];
};

/** Purge the org's pages past the bin window: sections + row + audit, one batch per page. */
async function purgePages(
  pb: PocketBase,
  sysCtx: SystemContext,
  orgId: string,
  cutoff: string,
): Promise<string[]> {
  const doomed: RecordModel[] = [];
  await scanSoftDeleted(
    pb,
    "pages",
    {
      filter: pb.filter(
        "organization = {:org} && deleted_at != '' && deleted_at < {:cutoff}",
        { org: orgId, cutoff },
      ),
      fields: "id,slug",
    },
    (rows) => {
      for (const r of rows) {
        if (!validId(r.id)) continue;
        doomed.push(r);
        if (doomed.length >= GC_BATCH_MAX) return false;
      }
      return true;
    },
  );
  const purged: string[] = [];
  for (const r of doomed) {
    const sections = await pb.collection("page_sections").getFullList({
      filter: pb.filter("organization = {:org} && page = {:page}", {
        org: orgId,
        page: r.id,
      }),
      fields: "id",
    });
    const batch = pb.createBatch();
    for (const sec of sections)
      batch.collection("page_sections").delete(sec.id);
    batch.collection("pages").delete(r.id);
    batch.collection("audit_log").create(
      auditBody(sysCtx, {
        action: "pages.gc_delete",
        organization: orgId,
        targetCollection: "pages",
        targetId: r.id,
        meta: {
          slug: typeof r.slug === "string" ? r.slug : "",
          sections: sections.length,
        },
      }),
    );
    await batch.send();
    purged.push(r.id);
  }
  return purged;
}

/** The purged pages' version JSON and published JSON (best effort; D187). */
async function removePageObjects(
  orgId: string,
  pageIds: readonly string[],
  store: ObjectStore,
): Promise<void> {
  for (const id of pageIds) {
    try {
      for (const o of await store.list(tenantVersionPrefix(orgId, id))) {
        await store.delete(o.key);
      }
      await store.delete(tenantPublishedPageKey(orgId, id));
    } catch {
      console.error("[jobs/media] gc page objects failed");
    }
  }
}

async function gcOrg(
  pb: PocketBase,
  sysCtx: SystemContext,
  orgId: string,
  deps: GcDeps,
  cutoff: string,
): Promise<OrgOutcome> {
  const out: OrgOutcome = {
    pages: await purgePages(pb, sysCtx, orgId, cutoff),
    counts: { popups: 0, forms: 0, media: 0 },
    kept: 0,
    media: [],
  };
  const scope = { orgId };
  for (const kind of PHASES) {
    const collection = SOFT_COLLECTION[kind];
    // WR-A04: the cap is on deletes, not on rows scanned. Still-referenced rows are skipped
    // and the scan pages on, so they never block newer unreferenced rows behind them.
    let used: Set<string> | null = null;
    const doomed: RecordModel[] = [];
    await scanSoftDeleted(
      pb,
      collection,
      {
        filter: pb.filter("organization = {:org} && deleted_at != ''", {
          org: orgId,
        }),
      },
      async (rows) => {
        // References are read once per phase, and only when there is something to check.
        if (!used) {
          const refs = await orgReferencedIds(pb, scope, deps.sections, {
            ...(deps.store ? { store: deps.store } : {}),
          });
          used = new Set(refs[kind]);
        }
        for (const r of rows) {
          if (!validId(r.id) || used.has(r.id)) {
            out.kept += 1;
            continue;
          }
          doomed.push(r);
          if (doomed.length >= GC_BATCH_MAX) return false;
        }
        return true;
      },
    );
    if (doomed.length === 0) continue;
    const batch = pb.createBatch();
    for (const r of doomed) {
      batch.collection(collection).delete(r.id);
      batch.collection("audit_log").create(
        auditBody(sysCtx, {
          action: `${collection}.gc_delete`,
          organization: orgId,
          targetCollection: collection,
          targetId: r.id,
          meta:
            kind === "media"
              ? {
                  kind: typeof r.kind === "string" ? r.kind : "",
                  bytes: typeof r.bytes === "number" ? r.bytes : 0,
                }
              : { name: typeof r.name === "string" ? r.name : "" },
        }),
      );
    }
    await batch.send();
    out.counts[kind] = doomed.length;
    if (kind === "media") out.media = doomed;
  }
  return out;
}

/**
 * Purge pages past the bin window, then hard-delete soft-deleted pop-ups, forms and media
 * nothing references any more (D275).
 */
export async function gcSoftDeleted(
  sysCtx: SystemContext,
  deps: GcDeps,
): Promise<GcResult> {
  assertSystemContext(sysCtx);
  if (!deps?.sections || typeof deps.sections.get !== "function") {
    throw new Error(GC_NEEDS_REGISTRY);
  }
  const result: GcResult = {
    gcPages: 0,
    gcPopups: 0,
    gcForms: 0,
    gcMedia: 0,
    gcKept: 0,
    gcErrors: 0,
  };
  const cutoff = pageCutoff((deps.now ?? (() => new Date()))());
  const orgs = await withSuperuser((pb) => discoverOrgs(pb, cutoff));
  for (const orgId of orgs) {
    try {
      const done = await withOrgLock(orgId, () =>
        withSuperuser((pb) => gcOrg(pb, sysCtx, orgId, deps, cutoff)),
      );
      result.gcPages += done.pages.length;
      if (done.pages.length > 0) {
        await removePageObjects(
          orgId,
          done.pages,
          deps.store ?? getObjectStore(),
        );
      }
      for (const kind of PHASES) result[RESULT_KEY[kind]] += done.counts[kind];
      result.gcKept += done.kept;
      for (const row of done.media) {
        await removeMediaObjects(orgId, row, deps);
      }
      if (done.pages.length > 0 || PHASES.some((k) => done.counts[k] > 0)) {
        try {
          deps.invalidator.invalidate([siteTag(orgId), liveTag(orgId)]);
        } catch {
          // Cached renders expire on their own.
        }
      }
    } catch (err) {
      result.gcErrors += 1;
      console.error(
        `[jobs/media] gc org failed: ${err instanceof Error ? err.name : "error"}`,
      );
    }
  }
  return result;
}
