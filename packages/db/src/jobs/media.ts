// The hourly media job (07-27; CONT-19, CONT-20, D278, D221; CONTEXT Area 1 rows 3 and 5).
// Idempotent, safe to run every hour, cheap when nothing is wrong. One run does, in order:
//
//   1. CDN probe: HEAD on the newest published thumb through the CDN (skipped with the app
//      stand-in). See media/ops/probe.ts.
//   2. Fallback state: set `media:cdn_down_since` (earliest kept) on a failure, clear it on a
//      pass; staff `media.alert` at the outage start and once at the 72 h cap (D278).
//   3. Stuck videos: 07-13's sweepStuckVideos re-queues or fails them (mints its own context).
//   4. Temp sweep: upload and video work dirs older than 24 h (active video ids skipped).
//   5. Over-allowance: one staff alert per org crossing its 2 GB allowance (D221).
//   6. Soft-delete GC (07-28, D275): hard-deletes soft-deleted pop-ups, forms and media that
//      nothing references any more (content/soft-delete-gc.ts); needs deps.gc.sections.
//
// Step isolation (choice 6): each step runs inside step(name, fn); a throw is logged (message
// only, never keys, paths or addresses), its name lands in `failedSteps`, and later steps
// still run. Heartbeat: platform_meta HEARTBEAT_KEY (ISO, only when no step failed) and
// COUNTS_KEY (JSON of MediaJobResult, every run). The monitor brief
// (.planning/design/MONITOR-APP-BRIEF.md, D174, D175) documents both; change them together.
// Concurrency: an in-process mutex (a separate chain from the quote job).
import { mintSystemContext, type SystemContext } from "../context";
import type { EmailTransport } from "../email/transport";
import {
  alertOverAllowance,
  sendMediaAlert,
  type AllowanceAlertDeps,
  type AllowanceAlertResult,
} from "../media/ops/alerts";
import {
  applyProbe,
  type FallbackDeps,
  type FallbackResult,
} from "../media/ops/fallback";
import {
  probeCdn,
  type ProbeDeps,
  type ProbeOutcome,
  type ProbeResult,
} from "../media/ops/probe";
import {
  sweepTempDirs,
  type TempRoot,
  type TempSweepResult,
} from "../media/ops/temp-sweep";
import { sweepStuckVideos, type VideoSweepResult } from "../media/video/sweep";
import { writePlatformMeta } from "../platform-meta";
import {
  gcSoftDeleted,
  GC_NEEDS_REGISTRY,
  type GcDeps,
  type GcResult,
} from "../content/soft-delete-gc";

export const MEDIA_HEARTBEAT_KEY = "job:media:last_success";
export const MEDIA_COUNTS_KEY = "job:media:last_counts";

export type MediaJobResult = {
  /** "error" when the probe step itself threw. */
  probe: ProbeResult | "error";
  fallbackActive: boolean;
  fallbackStarted: boolean;
  fallbackCapped: boolean;
  recovered: boolean;
  videosRequeued: number;
  videosFailed: number;
  tempRemoved: number;
  overAllowanceAlerted: number;
  alertsSkipped: number;
  alertFailures: number;
  /** Step 6 (07-28): soft-delete GC counts. gcPages: pages purged after 30 days (11-29). */
  gcPages: number;
  gcPopups: number;
  gcForms: number;
  gcMedia: number;
  gcKept: number;
  gcErrors: number;
  failedSteps: string[];
};

export type MediaJobDeps = {
  probe?: ProbeDeps;
  fallback?: FallbackDeps;
  allowance?: AllowanceAlertDeps;
  tempRoots?: TempRoot[];
  /** Whole-step fakes (unit tests). */
  probeCdn?: (deps?: ProbeDeps) => Promise<ProbeOutcome>;
  applyProbe?: (
    ctx: SystemContext,
    probe: ProbeOutcome,
    now: Date,
    deps?: FallbackDeps,
  ) => Promise<FallbackResult>;
  sweepStuckVideos?: (opts: { now: Date }) => Promise<VideoSweepResult>;
  sweepTempDirs?: (opts: {
    now: Date;
    roots?: TempRoot[];
  }) => Promise<TempSweepResult>;
  alertOverAllowance?: (
    ctx: SystemContext,
    now: Date,
    deps?: AllowanceAlertDeps,
  ) => Promise<AllowanceAlertResult>;
  writeMeta?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
  /** Step 6 (07-28): the composed section registry and invalidator; required for the GC. */
  gc?: GcDeps;
  /** Whole-step fake for the GC (unit tests). */
  runGc?: (ctx: SystemContext, deps: GcDeps) => Promise<GcResult>;
};

function requireGcDeps(gc: GcDeps | undefined): GcDeps {
  if (!gc?.sections || typeof gc.sections.get !== "function") {
    throw new Error(GC_NEEDS_REGISTRY);
  }
  return gc;
}

export type MediaJobOptions = {
  now?: Date;
  transport?: EmailTransport;
  deps?: MediaJobDeps;
};

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

async function runOnce(opts: MediaJobOptions): Promise<MediaJobResult> {
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? {};
  const ctx = mintSystemContext({ job: "media" });
  const result: MediaJobResult = {
    probe: "error",
    fallbackActive: false,
    fallbackStarted: false,
    fallbackCapped: false,
    recovered: false,
    videosRequeued: 0,
    videosFailed: 0,
    tempRemoved: 0,
    overAllowanceAlerted: 0,
    alertsSkipped: 0,
    alertFailures: 0,
    gcPages: 0,
    gcPopups: 0,
    gcForms: 0,
    gcMedia: 0,
    gcKept: 0,
    gcErrors: 0,
    failedSteps: [],
  };

  async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[jobs/media] ${name} failed: ${msg}`);
      result.failedSteps.push(name);
    }
  }

  const alert = (c: SystemContext, d: Parameters<typeof sendMediaAlert>[1]) =>
    sendMediaAlert(c, d, { transport: opts.transport });

  // 1. CDN probe.
  const probed: { outcome: ProbeOutcome | null } = { outcome: null };
  await step("probe", async () => {
    probed.outcome = await (deps.probeCdn ?? probeCdn)(deps.probe);
    result.probe = probed.outcome.result;
  });

  // 2. Fallback state + alerts (only with a probe outcome to act on).
  const outcome = probed.outcome;
  if (outcome) {
    await step("fallback", async () => {
      const f = await (deps.applyProbe ?? applyProbe)(ctx, outcome, now, {
        alert,
        ...deps.fallback,
      });
      result.fallbackActive = f.downSince !== null;
      result.fallbackStarted = f.started;
      result.fallbackCapped = f.capped;
      result.recovered = f.recovered;
      result.alertsSkipped += f.alertsSkipped;
      result.alertFailures += f.alertFailures;
    });
  }

  // 3. Stuck videos (07-13).
  await step("videos", async () => {
    const v = await (deps.sweepStuckVideos ?? sweepStuckVideos)({ now });
    result.videosRequeued = v.requeued;
    result.videosFailed = v.failed;
  });

  // 4. Upload / video temp dirs older than 24 h.
  await step("temp", async () => {
    const t = await (deps.sweepTempDirs ?? sweepTempDirs)({
      now,
      roots: deps.tempRoots,
    });
    result.tempRemoved = t.removed;
  });

  // 5. Over-allowance alerts.
  await step("allowance", async () => {
    const a = await (deps.alertOverAllowance ?? alertOverAllowance)(ctx, now, {
      transport: opts.transport,
      ...deps.allowance,
    });
    result.overAllowanceAlerted = a.alerted;
    result.alertsSkipped += a.skipped;
    result.alertFailures += a.failed;
  });

  // 6. Soft-delete GC (07-28, D275).
  await step("gc", async () => {
    const gcDeps = requireGcDeps(deps.gc);
    const g = deps.runGc
      ? await deps.runGc(ctx, gcDeps)
      : await gcSoftDeleted(ctx, gcDeps);
    result.gcPages = g.gcPages;
    result.gcPopups = g.gcPopups;
    result.gcForms = g.gcForms;
    result.gcMedia = g.gcMedia;
    result.gcKept = g.gcKept;
    result.gcErrors = g.gcErrors;
  });

  // Heartbeat (monitor brief section 3).
  const write = deps.writeMeta ?? writePlatformMeta;
  if (result.failedSteps.length === 0) {
    await write(ctx, MEDIA_HEARTBEAT_KEY, now.toISOString());
  }
  await write(ctx, MEDIA_COUNTS_KEY, JSON.stringify(result));
  return result;
}

/** Run the media job once, serialised with any concurrent run in this process. */
export async function runMediaJobs(
  opts: MediaJobOptions = {},
): Promise<MediaJobResult> {
  return withJobLock(() => runOnce(opts));
}
