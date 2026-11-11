// The nightly `demo:reset` job (13-31; STAFF-18, D293, P13-P13, RESEARCH Pattern 9). Triggered
// hourly (`30 * * * *`, UTC cron); it acts only when the America/Chicago hour is 3 and the day's
// claim `demo:reset:<YYYY-MM-DD>` (Chicago calendar day) is unclaimed, so it runs once a night at
// about 03:30 local whatever the DST offset. `force` (CLI `--now`) bypasses the hour and the
// claim, never the lock. A failed wipe or seed releases the claim (review WR-A10), so a later
// run in the same 3 am hour tries again.
//
//   gate     not 3 am Chicago, or already claimed today -> `skippedHour: 1`, nothing written
//   wipe     ensure the demo org, delete its tenant rows (demo/reset.ts; `rowsDeleted`)
//   seed     seed the demo content again (`rowsSeeded` = the demo org's rows afterwards)
//   heartbeat platform_meta `job:demo:last_success` (ISO; only when a reset ran and no step
//            failed) and `job:demo:last_counts` (JSON of DemoJobResult: counts only, never an
//            org id or name), written only when a reset ran (a skipped hour writes nothing, so
//            the counts always describe the last reset). Monitor brief check 36 (D174, D175);
//            change them together.
//
// Concurrency: an in-process chain plus the platform_meta lock `lock:demo-job` (stale after
// 30 min), shared with staff "Reset now" (staffResetDemo); a run that finds it held returns
// `busy: true` and writes nothing. dryRun reads only: the gate, then what the wipe would delete
// (`reset: 1`, `rowsDeleted`), no claim, no heartbeat.
import { businessDate, zonedMinutes } from "@cds/core/today";
import { mintSystemContext } from "../context";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import {
  DEMO_LOCK_KEY,
  DEMO_LOCK_STALE_MS,
  DemoResetStepError,
  demoResetPreview,
  resetDemoOrg,
} from "../demo/reset";
import type { DemoSeedDeps } from "../demo/seed";

export const DEMO_JOB_SUCCESS_KEY = "job:demo:last_success";
export const DEMO_JOB_COUNTS_KEY = "job:demo:last_counts";
/** The reset hour, America/Chicago (P13-P13). */
export const DEMO_RESET_HOUR = 3;
export const DEMO_RESET_TIME_ZONE = "America/Chicago";
/** A day's claim never goes stale: the night is spent once claimed. */
const NEVER_STALE = Number.MAX_SAFE_INTEGER;

export type DemoJobOptions = DemoSeedDeps & {
  now?: Date;
  dryRun?: boolean;
  /** Run whatever the hour (CLI `--now`); the lock still applies. */
  force?: boolean;
};

export type DemoJobResult = {
  dryRun: boolean;
  busy: boolean;
  reset: number;
  skippedHour: number;
  rowsDeleted: number;
  rowsSeeded: number;
  failedSteps: string[];
};

/** `demo:reset:2026-10-15`: the America/Chicago calendar day of `now`. */
export function demoResetClaimKey(now: Date): string {
  return `demo:reset:${businessDate(now, DEMO_RESET_TIME_ZONE)}`;
}

/** True when the America/Chicago hour of `now` is the reset hour. */
export function isDemoResetHour(now: Date): boolean {
  return (
    Math.floor(zonedMinutes(now, DEMO_RESET_TIME_ZONE) / 60) === DEMO_RESET_HOUR
  );
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function emptyResult(dryRun: boolean): DemoJobResult {
  return {
    dryRun,
    busy: false,
    reset: 0,
    skippedHour: 0,
    rowsDeleted: 0,
    rowsSeeded: 0,
    failedSteps: [],
  };
}

async function runOnce(opts: DemoJobOptions): Promise<DemoJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const result = emptyResult(dryRun);
  const claimKey = demoResetClaimKey(now);

  // Gate: 3 am Chicago, once a day (unless forced).
  if (!force) {
    if (!isDemoResetHour(now) || (await readPlatformMeta(claimKey)) !== null) {
      result.skippedHour = 1;
      return result;
    }
  }

  if (dryRun) {
    const preview = await demoResetPreview();
    result.reset = 1;
    result.rowsDeleted = preview.rowsToDelete;
    return result;
  }

  const token = await acquirePlatformLock(DEMO_LOCK_KEY, {
    now,
    staleMs: DEMO_LOCK_STALE_MS,
  });
  if (token === null) return { ...result, busy: true };
  try {
    let claim: string | null = null;
    if (!force) {
      claim = await acquirePlatformLock(claimKey, {
        now,
        staleMs: NEVER_STALE,
      });
      if (claim === null) {
        result.skippedHour = 1;
        return result;
      }
    }
    const sys = mintSystemContext({ job: "demo" });
    try {
      const r = await resetDemoOrg(sys, { ...opts, now });
      result.reset = 1;
      result.rowsDeleted = r.rowsDeleted;
      result.rowsSeeded = r.rowsSeeded;
    } catch (err) {
      const step = err instanceof DemoResetStepError ? err.step : "wipe";
      if (err instanceof DemoResetStepError) {
        result.rowsDeleted = err.rowsDeleted;
      }
      const cause =
        err instanceof DemoResetStepError ? (err.cause ?? err) : err;
      console.error(`[jobs/demo] ${step} failed: ${errName(cause)}`);
      result.failedSteps.push(step);
      // WR-A10: a failed reset gives the day back, so the next hourly run in the 3 am hour
      // tries again instead of leaving the public demo empty until tomorrow.
      if (claim !== null) {
        await releasePlatformLock(claimKey, claim).catch((e: unknown) => {
          console.error(`[jobs/demo] claim release failed: ${errName(e)}`);
        });
      }
    }

    // Heartbeat (monitor brief check 36).
    if (result.failedSteps.length === 0) {
      await writePlatformMeta(sys, DEMO_JOB_SUCCESS_KEY, now.toISOString());
    }
    await writePlatformMeta(sys, DEMO_JOB_COUNTS_KEY, JSON.stringify(result));
    return result;
  } finally {
    await releasePlatformLock(DEMO_LOCK_KEY, token);
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

/** Run the demo reset job once, serialised with any concurrent run (in process and across). */
export async function runDemoResetJob(
  opts: DemoJobOptions,
): Promise<DemoJobResult> {
  return withJobLock(() => runOnce(opts));
}

/** Alias named in the 13-31 plan; the monitor brief names runDemoResetJob. */
export const runDemoJob = runDemoResetJob;
