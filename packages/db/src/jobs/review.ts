// The hourly `review:run` job (13-29; STAFF-23, STAFF-22; D215, D248, P13-P26). One run does, in
// order, each step in its own try (a failing step is recorded in `failedSteps` and the rest
// still run):
//
//   1. rescan        every `queued` content flag (a scanner outage at save time, D248) is scanned
//                    again. Text records are rebuilt from their target (the published page JSON
//                    when there is one, else the page and its blocks; any other record from its
//                    own fields) and go through the configured content scanner; queued photos
//                    (`source: image`) go to the image moderator with the stored web variant.
//                    clean -> flag resolved; held / unsure -> flag `open` with the new verdict
//                    (held also applies the hold: a page leaves the live site with status `held`,
//                    a photo goes `held`, a record with `enabled` is switched off); no answer
//                    (throws, or the moderator is still skipped) -> `rescan_attempts + 1`, stays
//                    queued; after REVIEW_RESCAN_MAX_ATTEMPTS it goes `open` with verdict
//                    `error` for a person (review WR-A11). Least-tried flags go first, so a
//                    flag that never answers cannot starve newer ones. A target that no longer
//                    exists resolves its flag. Demo flags resolve.
//   2. auto-suspend  notice-mode sites past `fix_by` and not marked fixed go offline
//                    (`jobAutoSuspend`, 13-17; owner notified, super_admin lifts)
//   3. spot-checks   Mondays only (America/Chicago): 5 live sites, one `spot_check` case each,
//                    once per ISO week (`jobOpenSpotChecks`)
//   4. gauges        read-only `reviewGauges` (held pages past the 2-business-day promise)
//   5. heartbeat     platform_meta `job:review:last_success` (ISO; only when no step failed) and
//                    `job:review:last_counts` (JSON of ReviewJobResult: counts only, never an org
//                    id). Monitor brief check 33 (D174, D175); change them together.
//
// Concurrency: an in-process chain plus the platform_meta lock `lock:review-job` (stale after
// 30 min), so the CLI and the scheduled route never overlap; a run that finds the lock busy
// returns `busy: true` and writes nothing. dryRun counts with read-only queries and writes
// nothing (no scan call, no email, no case, no heartbeat). Every filter is bound through
// pb.filter; logs carry error names only.
import { htmlToPlainText } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { readManifest } from "../content/manifest";
import {
  liveTag,
  pageTag,
  siteTag,
  type ContentScanner,
  type ImageModerator,
  type Invalidator,
  type SubResult,
} from "../content/ports";
import { getImageModerator } from "../content/scan/image";
import { getContentScanner } from "../content/scan-standin";
import { refreshSiteIndex } from "../content/site-index/build";
import {
  assertSystemContext,
  mintSystemContext,
  type SystemContext,
} from "../context";
import { orgIsDemo } from "../demo/flag";
import type { EmailTransport } from "../email/transport";
import {
  acquirePlatformLock,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import {
  getObjectStore,
  tenantMediaKey,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../storage";
import { reviewGauges } from "../staff/review/queue";
import { isSpotCheckDay, jobOpenSpotChecks } from "../staff/review/spot-checks";
import { jobAutoSuspend } from "../staff/suspension";

export type ReviewJobOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Defaults to the configured content scanner (getContentScanner). */
  scanner?: ContentScanner;
  /** Defaults to the configured image moderator (stand-in: skipped, so photos stay queued). */
  moderator?: ImageModerator;
  transport?: EmailTransport;
  invalidator?: Invalidator;
  store?: ObjectStore;
  /** Spot-check random seat (tests). */
  rng?: () => number;
};

export type ReviewJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Queued flags that got an answer (resolved or opened). Dry run: flags a run would try. */
  rescanned: number;
  /** Queued flags still waiting for a provider after this run. */
  stillQueued: number;
  /** Sites taken offline at fix_by. Dry run: sites a run would suspend. */
  autoSuspended: number;
  /** Spot-check cases opened (0 on any day but Monday). */
  spotChecksOpened: number;
  /** Gauge: held pages past the 2-business-day promise. */
  heldPastPromise: number;
  failedSteps: string[];
};

export const REVIEW_JOB_SUCCESS_KEY = "job:review:last_success";
export const REVIEW_JOB_COUNTS_KEY = "job:review:last_counts";
const LOCK_KEY = "lock:review-job";
const LOCK_STALE_MS = 30 * 60_000;
/** Queued flags tried per run (10-50 tenants: far above any real backlog). */
export const REVIEW_RESCAN_MAX = 200;
/** Runs a queued flag is retried before it goes to the review queue (hourly: one day). */
export const REVIEW_RESCAN_MAX_ATTEMPTS = 24;
export const REVIEW_RESCAN_GAVE_UP_REASON =
  "No scanner answer after repeated tries: needs a person";
const JSON_TYPE = "application/json";
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const MAX_STRINGS = 2000;
const MAX_DEPTH = 8;
/** Fields that are never content (ids, state, timestamps). */
const SKIP_KEYS = new Set([
  "id",
  "organization",
  "collectionId",
  "collectionName",
  "created",
  "updated",
  "status",
  "slug",
  "kind",
  "page",
  "section_type",
  "sort_order",
  "version_refs",
  "expand",
]);

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function emptyResult(dryRun: boolean): ReviewJobResult {
  return {
    dryRun,
    busy: false,
    rescanned: 0,
    stillQueued: 0,
    autoSuspended: 0,
    spotChecksOpened: 0,
    heldPastPromise: 0,
    failedSteps: [],
  };
}

// ------------------------------------------------------------------ scan input builder
type ScanTexts = { texts: string[]; urls: string[] };

function collect(v: unknown, key: string, out: ScanTexts, depth: number): void {
  if (out.texts.length + out.urls.length >= MAX_STRINGS || depth > MAX_DEPTH) {
    return;
  }
  if (SKIP_KEYS.has(key) || /_(at|id|key)$/.test(key)) return;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || ID_RE.test(s)) return;
    if (/^https?:\/\//i.test(s)) out.urls.push(s);
    else out.texts.push(s.includes("<") ? htmlToPlainText(s) : s);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collect(item, "", out, depth + 1);
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      collect(item, k, out, depth + 1);
    }
  }
}

function inputOf(...parts: unknown[]): ScanTexts {
  const out: ScanTexts = { texts: [], urls: [] };
  for (const p of parts) collect(p, "", out, 0);
  return out;
}

class TargetGone extends Error {
  override name = "TargetGone";
}

async function targetRow(
  pb: PocketBase,
  orgId: string,
  collection: string,
  id: string,
): Promise<RecordModel> {
  if (!COLLECTION_RE.test(collection) || !ID_RE.test(id))
    throw new TargetGone();
  try {
    return await pb
      .collection(collection)
      .getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", { id, org: orgId }),
      );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new TargetGone();
    }
    throw err;
  }
}

/** Page: the published JSON when there is one (what the live site serves), else the draft. */
async function pageInput(
  pb: PocketBase,
  store: ObjectStore,
  orgId: string,
  page: RecordModel,
): Promise<ScanTexts> {
  const raw = await store.get(tenantPublishedPageKey(orgId, page.id));
  if (raw) {
    try {
      const pub = JSON.parse(Buffer.from(raw).toString("utf8")) as {
        page?: unknown;
        sections?: { content?: unknown }[];
      };
      return inputOf(
        pub.page,
        (Array.isArray(pub.sections) ? pub.sections : []).map(
          (s) => s?.content,
        ),
      );
    } catch {
      // A broken JSON falls back to the draft below.
    }
  }
  const rows = await pb.collection("page_sections").getFullList({
    filter: pb.filter("organization = {:org} && page = {:page}", {
      org: orgId,
      page: page.id,
    }),
    sort: "sort_order,created,id",
    fields: "content",
  });
  return inputOf(
    { title: page.title, seo: page.seo },
    rows.map((r) => r.content),
  );
}

// ------------------------------------------------------------------ holds
async function holdPage(
  sys: SystemContext,
  orgId: string,
  pageId: string,
  opts: { store: ObjectStore; now: Date; invalidator?: Invalidator },
): Promise<void> {
  await withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      const manifestKey = tenantSiteManifestKey(orgId);
      const manifest = await readManifest(opts.store, orgId, opts.now);
      const live = Object.entries(manifest.pages)
        .filter(([, e]) => e.id === pageId)
        .map(([s]) => s);
      const prev = live.length > 0 ? await opts.store.get(manifestKey) : null;
      if (live.length > 0) {
        for (const s of live) {
          delete manifest.pages[s];
          delete manifest.redirects[s];
        }
        manifest.updated_at = opts.now.toISOString();
        await opts.store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);
      }
      try {
        const batch = pb.createBatch();
        batch.collection("pages").update(pageId, { status: "held" });
        batch.collection("audit_log").create(
          auditBody(sys, {
            action: "page.publish_held",
            organization: orgId,
            targetCollection: "pages",
            targetId: pageId,
            meta: { rescan: true, live: live.length > 0 },
          }),
        );
        await batch.send();
      } catch (err) {
        if (live.length > 0) {
          if (prev) await opts.store.put(manifestKey, prev, JSON_TYPE);
          else await opts.store.delete(manifestKey).catch(() => undefined);
        }
        throw err;
      }
    }),
  );
  await refreshSiteIndex(orgId, { store: opts.store, now: () => opts.now });
  try {
    opts.invalidator?.invalidate([
      pageTag(orgId, pageId),
      siteTag(orgId),
      liveTag(orgId),
    ]);
  } catch (err) {
    console.error(`[jobs/review] invalidate failed: ${errName(err)}`);
  }
}

/**
 * Photo -> `held`; a record with `enabled` -> off; a shown team member or service -> hidden
 * (13-52, as their save-time hold); anything else: the open flag only.
 */
async function holdRecord(
  pb: PocketBase,
  sys: SystemContext,
  orgId: string,
  collection: string,
  row: RecordModel,
  opts: { invalidator?: Invalidator },
): Promise<void> {
  let body: Record<string, unknown> | null = null;
  if (collection === "media_assets") {
    if (str(row.status) !== "held") body = { status: "held" };
  } else if (row.enabled === true) {
    body = { enabled: false };
  } else if (
    (collection === "team_members" || collection === "services") &&
    row.is_published === true
  ) {
    body = { is_published: false };
  }
  if (body === null) return;
  const batch = pb.createBatch();
  batch.collection(collection).update(row.id, body);
  batch.collection("audit_log").create(
    auditBody(sys, {
      action: "review.rescan_held",
      organization: orgId,
      targetCollection: collection,
      targetId: row.id,
    }),
  );
  await batch.send();
  try {
    opts.invalidator?.invalidate([liveTag(orgId), siteTag(orgId)]);
  } catch (err) {
    console.error(`[jobs/review] invalidate failed: ${errName(err)}`);
  }
}

// ------------------------------------------------------------------ rescan step
type RescanDeps = {
  now: Date;
  scanner: ContentScanner;
  moderator: ImageModerator;
  store: ObjectStore;
  invalidator?: Invalidator;
};

type Answer =
  | { kind: "clean" }
  | { kind: "flag"; verdict: "held" | "unsure"; reasons: string[] }
  | { kind: "none" };

function reasonsOf(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((r): r is string => typeof r === "string")
    .slice(0, 10)
    .map((r) => r.slice(0, 200));
}

async function askImage(
  orgId: string,
  assetId: string,
  deps: RescanDeps,
): Promise<Answer> {
  const url = tenantMediaKey(orgId, assetId, "web.webp");
  const bytes = await deps.store.get(url);
  if (!bytes) throw new TargetGone();
  let res: SubResult;
  try {
    res = await deps.moderator.check({
      orgId,
      texts: [],
      urls: [],
      images: [{ url, bytes }],
    });
  } catch {
    return { kind: "none" };
  }
  if (res?.verdict === "held" || res?.verdict === "unsure") {
    return {
      kind: "flag",
      verdict: res.verdict,
      reasons: reasonsOf(res.reasons),
    };
  }
  if (res?.verdict === "clean") return { kind: "clean" };
  return { kind: "none" }; // skipped / unchecked: still no provider answer
}

async function askText(
  orgId: string,
  input: ScanTexts,
  deps: RescanDeps,
): Promise<Answer> {
  try {
    const res = await deps.scanner.scan({ orgId, ...input });
    if (res?.verdict === "held" || res?.verdict === "unsure") {
      return {
        kind: "flag",
        verdict: res.verdict,
        reasons: reasonsOf(res.reasons),
      };
    }
    return { kind: "clean" };
  } catch {
    return { kind: "none" };
  }
}

async function rescanOne(
  sys: SystemContext,
  flag: RecordModel,
  deps: RescanDeps,
): Promise<"answered" | "queued"> {
  const orgId = str(flag.organization);
  const collection = str(flag.target_collection);
  const targetId = str(flag.target_id);
  const resolve = () =>
    withSuperuser((pb) =>
      pb.collection("content_flags").update(flag.id, { status: "resolved" }),
    );

  // D293: the demo org is never scanned and never flagged.
  if (await orgIsDemo(orgId)) {
    await resolve();
    return "answered";
  }

  let answer: Answer;
  let row: RecordModel;
  try {
    row = await withSuperuser((pb) =>
      targetRow(pb, orgId, collection, targetId),
    );
    if (str(flag.source) === "image" || collection === "media_assets") {
      answer = await askImage(orgId, row.id, deps);
    } else {
      const input =
        collection === "pages"
          ? await withSuperuser((pb) => pageInput(pb, deps.store, orgId, row))
          : inputOf(row);
      answer = await askText(orgId, input, deps);
    }
  } catch (err) {
    if (err instanceof TargetGone) {
      await resolve();
      return "answered";
    }
    throw err;
  }

  if (answer.kind === "none") return countAttempt(flag);
  if (answer.kind === "clean") {
    await resolve();
    return "answered";
  }
  if (answer.verdict === "held") {
    if (collection === "pages") {
      if (str(row.status) !== "held") {
        await holdPage(sys, orgId, row.id, {
          store: deps.store,
          now: deps.now,
          ...(deps.invalidator ? { invalidator: deps.invalidator } : {}),
        });
      }
    } else {
      await withSuperuser((pb) =>
        holdRecord(pb, sys, orgId, collection, row, {
          ...(deps.invalidator ? { invalidator: deps.invalidator } : {}),
        }),
      );
    }
  }
  await withSuperuser((pb) =>
    pb.collection("content_flags").update(flag.id, {
      status: "open",
      verdict: answer.verdict,
      reasons: answer.reasons,
    }),
  );
  return "answered";
}

/**
 * One more try with no answer: `rescan_attempts + 1`; at REVIEW_RESCAN_MAX_ATTEMPTS the flag
 * leaves the rescan queue for the human review queue (`open`, verdict `error`; WR-A11).
 */
async function countAttempt(flag: RecordModel): Promise<"answered" | "queued"> {
  const attempts =
    (typeof flag.rescan_attempts === "number" ? flag.rescan_attempts : 0) + 1;
  if (attempts < REVIEW_RESCAN_MAX_ATTEMPTS) {
    await withSuperuser((pb) =>
      pb
        .collection("content_flags")
        .update(flag.id, { rescan_attempts: attempts }),
    );
    return "queued";
  }
  const prior = Array.isArray(flag.reasons)
    ? (flag.reasons as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];
  await withSuperuser((pb) =>
    pb.collection("content_flags").update(flag.id, {
      rescan_attempts: attempts,
      status: "open",
      verdict: "error",
      reasons: [...prior, REVIEW_RESCAN_GAVE_UP_REASON].slice(-10),
    }),
  );
  return "answered";
}

async function queuedFlags(): Promise<RecordModel[]> {
  return withSuperuser(async (pb) => {
    const res = await pb
      .collection("content_flags")
      .getList(1, REVIEW_RESCAN_MAX, {
        filter: "status = 'queued'",
        // WR-A11: least-tried first, so a flag that never answers cannot starve newer ones.
        sort: "rescan_attempts,created,id",
        skipTotal: true,
      });
    return res.items;
  });
}

async function countQueued(): Promise<number> {
  return withSuperuser(async (pb) => {
    const res = await pb.collection("content_flags").getList(1, 1, {
      filter: "status = 'queued'",
      fields: "id",
    });
    return res.totalItems;
  });
}

// ------------------------------------------------------------------ dry-run counts
async function dryAutoSuspend(now: Date): Promise<number> {
  const rows = await withSuperuser((pb) =>
    pb.collection("organizations").getFullList({
      filter: "suspended_at = ''",
      fields: "id,suspension",
    }),
  );
  let n = 0;
  for (const r of rows) {
    const s = r.suspension as Record<string, unknown> | null;
    if (!s || typeof s !== "object") continue;
    if (s.mode !== "notice" || str(s.fixed_at) || str(s.lifted_at)) continue;
    const fixBy = Date.parse(str(s.fix_by));
    if (Number.isFinite(fixBy) && fixBy <= now.getTime()) n += 1;
  }
  return n;
}

// ------------------------------------------------------------------ run
function scannerOf(opts: ReviewJobOptions): ContentScanner {
  return opts.scanner ?? getContentScanner();
}

function moderatorOf(opts: ReviewJobOptions): ImageModerator {
  return opts.moderator ?? getImageModerator();
}

async function runOnce(opts: ReviewJobOptions): Promise<ReviewJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "review" });
  assertSystemContext(ctx);
  const result = emptyResult(dryRun);

  let token: string | null = null;
  if (!dryRun) {
    token = await acquirePlatformLock(LOCK_KEY, {
      now,
      staleMs: LOCK_STALE_MS,
    });
    if (token === null) return { ...result, busy: true };
  }

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs/review] ${name} failed: ${errName(err)}`);
      result.failedSteps.push(name);
    }
  };

  try {
    // 1. Rescan queued flags.
    await step("rescan", async () => {
      if (dryRun) {
        result.rescanned = Math.min(await countQueued(), REVIEW_RESCAN_MAX);
        return;
      }
      const deps: RescanDeps = {
        now,
        scanner: scannerOf(opts),
        moderator: moderatorOf(opts),
        store: opts.store ?? getObjectStore(),
        ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
      };
      let failed = 0;
      for (const flag of await queuedFlags()) {
        try {
          const r = await rescanOne(ctx, flag, deps);
          if (r === "answered") result.rescanned += 1;
        } catch (err) {
          failed += 1;
          console.error(`[jobs/review] rescan item failed: ${errName(err)}`);
          // A target that keeps throwing counts its attempts too (WR-A11).
          await countAttempt(flag).catch(() => undefined);
        }
      }
      result.stillQueued = await countQueued();
      if (failed > 0) throw new Error("RescanFailed");
    });

    // 2. Notices past fix_by go offline.
    await step("auto-suspend", async () => {
      if (dryRun) {
        result.autoSuspended = await dryAutoSuspend(now);
        return;
      }
      const r = await jobAutoSuspend(now, {
        ...(opts.transport ? { transport: opts.transport } : {}),
        ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
      });
      result.autoSuspended = r.suspended;
      if (r.failed > 0) throw new Error("AutoSuspendFailed");
    });

    // 3. Monday spot checks (America/Chicago), once per ISO week.
    await step("spot-checks", async () => {
      if (!isSpotCheckDay(now)) return;
      const r = await jobOpenSpotChecks(now, {
        dryRun,
        ...(opts.rng ? { rng: opts.rng } : {}),
      });
      result.spotChecksOpened = r.opened;
    });

    // 4. Read-only gauges for the monitor.
    await step("gauges", async () => {
      const g = await reviewGauges(now);
      result.heldPastPromise = g.held_past_promise;
      if (dryRun) result.stillQueued = g.queued_scans;
    });

    // 5. Heartbeat (monitor brief check 33).
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(ctx, REVIEW_JOB_SUCCESS_KEY, now.toISOString());
      }
      await writePlatformMeta(
        ctx,
        REVIEW_JOB_COUNTS_KEY,
        JSON.stringify(result),
      );
    }
    return result;
  } finally {
    if (token !== null) await releasePlatformLock(LOCK_KEY, token);
  }
}

// ------------------------------------------------------------------ single-key mutex
let chain: Promise<unknown> = Promise.resolve();

function withJobLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Run the review job once, serialised with any concurrent run (in process and across). */
export async function runReviewJob(
  opts: ReviewJobOptions = {},
): Promise<ReviewJobResult> {
  return withJobLock(() => runOnce(opts));
}
