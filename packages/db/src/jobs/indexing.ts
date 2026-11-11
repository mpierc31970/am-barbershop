// P13 indexing job (13-19; STAFF-17, D190). The weekly `indexing:run` job (Coolify schedules
// it Sundays 06:00 UTC, `0 6 * * 0`; the job itself never checks the weekday). One run does,
// in order, each step in its own try (a failing step is recorded in `failedSteps` and the rest
// still run):
//
//   1. resubmit    each live, non-demo site is pinged through the SearchPinger port (stand-in
//                  `loggingPinger` until IndexNow / Search Console, P14 / GO-LIVE) and its
//                  `org_indexing` row gets the ping result and `last_resubmit_at`; demo sites
//                  are counted in `skippedDemo`, never pinged
//   2. sitemaps    each of those sites' sitemap is built in-process from its index.json and
//                  checked (`ok` with at least one URL); failures counted in `sitemapErrors`,
//                  the per-site result in `org_indexing`
//   3. heartbeat   platform_meta `job:indexing:last_success` (ISO; only when no step failed)
//                  and `job:indexing:last_counts` (JSON of IndexingJobResult: counts only,
//                  never an org id). Monitor brief check 35 (D174, D175); change them together.
//
// Concurrency: an in-process chain plus a platform_meta lock `lock:indexing-job` (a stale
// lock is taken over after 30 min), so the CLI and the scheduled route never overlap; a run
// that finds the lock busy returns `busy: true` and writes nothing. dryRun counts the sites
// and checks sitemaps read-only: no ping, no row, no heartbeat. Logs carry error names only.
import { assertSystemContext, mintSystemContext } from "../context";
import {
  checkSitemap,
  liveOrgsForIndexing,
  resubmitSite,
} from "../content/indexing-record";
import type { SearchPinger } from "../content/ports";
import {
  acquirePlatformLock,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import type { ObjectStore } from "../storage";
import {
  INDEXING_JOB_COUNTS_KEY,
  INDEXING_JOB_SUCCESS_KEY,
} from "../staff/indexing";

export type IndexingJobOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Defaults to the configured pinger (the logging stand-in). */
  pinger?: SearchPinger;
  /** Defaults to the configured object store (index.json reads). */
  store?: ObjectStore;
};

export type IndexingJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Live, non-demo sites resubmitted (dry run: that would be). */
  resubmitted: number;
  /** Live demo sites left out. */
  skippedDemo: number;
  /** Sites whose sitemap check failed. */
  sitemapErrors: number;
  failedSteps: string[];
};

const LOCK_KEY = "lock:indexing-job";
const LOCK_STALE_MS = 30 * 60_000;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function emptyResult(dryRun: boolean): IndexingJobResult {
  return {
    dryRun,
    busy: false,
    resubmitted: 0,
    skippedDemo: 0,
    sitemapErrors: 0,
    failedSteps: [],
  };
}

async function runOnce(opts: IndexingJobOptions): Promise<IndexingJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "indexing" });
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
      console.error(`[jobs/indexing] ${name} failed: ${errName(err)}`);
      result.failedSteps.push(name);
    }
  };

  try {
    let targets: string[] = [];

    // 1. Resubmit every live, non-demo site.
    await step("resubmit", async () => {
      const live = await liveOrgsForIndexing();
      targets = live.filter((o) => !o.demo).map((o) => o.id);
      result.skippedDemo = live.length - targets.length;
      if (dryRun) {
        result.resubmitted = targets.length;
        return;
      }
      let failed = 0;
      for (const orgId of targets) {
        try {
          await resubmitSite(orgId, {
            ...(opts.pinger ? { pinger: opts.pinger } : {}),
            now,
            sitemap: false,
          });
          result.resubmitted += 1;
        } catch (err) {
          console.error(
            `[jobs/indexing] resubmit site failed: ${errName(err)}`,
          );
          failed += 1;
        }
      }
      if (failed > 0) throw new Error("ResubmitFailed");
    });

    // 2. Check each resubmitted site's sitemap (read-only in a dry run).
    await step("sitemaps", async () => {
      for (const orgId of targets) {
        const status = await checkSitemap(orgId, {
          ...(opts.store ? { store: opts.store } : {}),
          now,
          record: !dryRun,
        });
        if (status === "error") result.sitemapErrors += 1;
      }
    });

    // 3. Heartbeat (monitor brief check 35).
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(
          ctx,
          INDEXING_JOB_SUCCESS_KEY,
          now.toISOString(),
        );
      }
      await writePlatformMeta(
        ctx,
        INDEXING_JOB_COUNTS_KEY,
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

/**
 * Run the indexing job once, serialised with any concurrent run in this process (and across
 * processes through `lock:indexing-job`).
 */
export async function runIndexingJob(
  opts: IndexingJobOptions = {},
): Promise<IndexingJobResult> {
  return withJobLock(() => runOnce(opts));
}
