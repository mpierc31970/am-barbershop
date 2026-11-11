// packages/db/src/jobs/health.ts: filled by 13-44 (health:run job)
//
// P13 health job (13-44; STAFF-13, STAFF-14, D154, D155, D174). The every-5-minutes
// `health:run` job, the interim staff alert channel until the monitor app exists. One run does,
// in order, each step in its own try (a failing step is recorded in `failedSteps` and the rest
// still run):
//
//   1. checks          every HEALTH_CHECK against one monitorStatus() document; one
//                      `staff.health_alert` email per incident (open, escalate warn -> critical,
//                      close), state in platform_meta `health:incident:<checkId>` (P13-P19;
//                      `jobEvaluateHealth`, staff/health.ts). A send that throws fails the step.
//   2. failsafe-sync   pull captured requests from the fail-safe service (P13-P14;
//                      `jobSyncFailsafe`); the `notDeployedFailsafe` stand-in pulls nothing
//   3. sessions-prune  staff_sessions rows created more than 30 days ago are deleted
//                      (`pruneStaffSessions`, 13-12; T-13-44-04)
//   4. heartbeat       platform_meta `job:health:last_success` (ISO; only when no step failed)
//                      and `job:health:last_counts` (JSON of HealthJobResult: counts only).
//                      Monitor brief check 34 (D174, D175); change them together.
//
// Concurrency: an in-process chain plus a platform_meta lock `lock:health-job` (a stale lock
// is taken over after 10 min, two missed runs), so the CLI and the scheduled route never
// overlap; a run that finds the lock busy returns `busy: true` and writes nothing. dryRun
// evaluates and counts read-only: no email, no incident row, no pull, no delete, no heartbeat
// (`failsafePulled` stays 0). Logs carry error names only.
import { withSuperuser } from "../client";
import { assertSystemContext, mintSystemContext } from "../context";
import type { EmailTransport } from "../email/transport";
import {
  acquirePlatformLock,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import { jobSyncFailsafe, type FailsafeCapture } from "../staff/failsafe";
import { jobEvaluateHealth } from "../staff/health";
import type { MonitorManifest } from "../staff/monitor-status";
import { pruneStaffSessions, STAFF_SESSION_RETAIN_MS } from "../staff/sessions";

export type HealthJobOptions = {
  now?: Date;
  dryRun?: boolean;
  transport?: EmailTransport;
  /** Defaults to the configured capture port (CDS_FAILSAFE; unset = not deployed). */
  failsafe?: FailsafeCapture;
  /** `ADDON_REGISTRY.list()` from the caller (Invariant 4). */
  manifests?: readonly MonitorManifest[];
};

export type HealthJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Checks evaluated. */
  checks: number;
  /** Incidents opened (dry run: that would be). */
  opened: number;
  /** Open warnings that became critical. */
  escalated: number;
  closed: number;
  emailsSent: number;
  /** No staff alert address, or it is suppressed. */
  emailSkipped: number;
  failsafePulled: number;
  sessionsPruned: number;
  failedSteps: string[];
};

export const HEALTH_JOB_SUCCESS_KEY = "job:health:last_success";
export const HEALTH_JOB_COUNTS_KEY = "job:health:last_counts";
export const HEALTH_LOCK_KEY = "lock:health-job";
const LOCK_STALE_MS = 10 * 60_000;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function emptyResult(dryRun: boolean): HealthJobResult {
  return {
    dryRun,
    busy: false,
    checks: 0,
    opened: 0,
    escalated: 0,
    closed: 0,
    emailsSent: 0,
    emailSkipped: 0,
    failsafePulled: 0,
    sessionsPruned: 0,
    failedSteps: [],
  };
}

/** Rows pruneStaffSessions would delete (dry run). */
async function countPrunableSessions(now: Date): Promise<number> {
  const cut = new Date(now.getTime() - STAFF_SESSION_RETAIN_MS);
  return withSuperuser(async (pb) => {
    const res = await pb.collection("staff_sessions").getList(1, 1, {
      filter: pb.filter("created < {:cut}", { cut }),
      fields: "id",
    });
    return res.totalItems;
  });
}

async function runOnce(opts: HealthJobOptions): Promise<HealthJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "health" });
  assertSystemContext(ctx);
  const result = emptyResult(dryRun);

  let token: string | null = null;
  if (!dryRun) {
    token = await acquirePlatformLock(HEALTH_LOCK_KEY, {
      now,
      staleMs: LOCK_STALE_MS,
    });
    if (token === null) return { ...result, busy: true };
  }

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs/health] ${name} failed: ${errName(err)}`);
      result.failedSteps.push(name);
    }
  };

  try {
    // 1. Health checks and staff alert emails (once per incident).
    await step("checks", async () => {
      const r = await jobEvaluateHealth(now, {
        dryRun,
        ...(opts.transport ? { transport: opts.transport } : {}),
        ...(opts.manifests ? { manifests: opts.manifests } : {}),
      });
      result.checks = r.checks;
      result.opened = r.opened;
      result.escalated = r.escalated;
      result.closed = r.closed;
      result.emailsSent = r.emailsSent;
      result.emailSkipped = r.emailSkipped;
      if (r.emailFailed > 0) throw new Error("AlertSendFailed");
    });

    // 2. Fail-safe pull (P13-P14).
    await step("failsafe-sync", async () => {
      if (dryRun) return;
      const r = await jobSyncFailsafe(
        now,
        opts.failsafe ? { capture: opts.failsafe } : {},
      );
      result.failsafePulled = r.pulled;
      if (r.failed > 0) throw new Error("FailsafeSyncFailed");
    });

    // 3. Staff sessions older than 30 days.
    await step("sessions-prune", async () => {
      result.sessionsPruned = dryRun
        ? await countPrunableSessions(now)
        : await pruneStaffSessions(ctx, { now });
    });

    // 4. Heartbeat (monitor brief check 34).
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(ctx, HEALTH_JOB_SUCCESS_KEY, now.toISOString());
      }
      await writePlatformMeta(
        ctx,
        HEALTH_JOB_COUNTS_KEY,
        JSON.stringify(result),
      );
    }
    return result;
  } finally {
    if (token !== null) await releasePlatformLock(HEALTH_LOCK_KEY, token);
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
 * Run the health job once, serialised with any concurrent run in this process (and across
 * processes through `lock:health-job`).
 */
export async function runHealthJob(
  opts: HealthJobOptions = {},
): Promise<HealthJobResult> {
  return withJobLock(() => runOnce(opts));
}
