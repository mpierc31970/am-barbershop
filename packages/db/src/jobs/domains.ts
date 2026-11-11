// packages/db/src/jobs/domains.ts (P14, 14-41; DOM-08, DOM-01, ONB-10, LIFE-01; P14-P18).
// Owner: 14-41 (14-EXECUTOR-BRIEF "Module seams"). Nobody else edits it.
//
// The every-5-minutes `domains:run` job (Coolify `*/5 * * * *`, POST /api/jobs/domains). One run
// does, in order, each step in its own try (a failing step is named in `failedSteps`, the rest
// still run; a step whose function counts per-item errors is failed when that count is > 0):
//
//   1. backfill     preview hosts for active orgs that have none (P14-P3, 14-15)
//   2. moves        advance due domain moves (14-22/14-23; the owner's nameserver change is the
//                   only thing they wait for)
//   3. sending      SES tenant sending identities once a CDS zone is active (14-24, P14-P19)
//   4. handbacks    offboarding DNS handback checks (14-40); before `offboarding`, so a
//                   handback finished in this run lets the notice end close the same run
//   5. offboarding  notice-end actions (14-39)
//   6. health       daily domain health (14-27), once per UTC day after 06:00, claim
//                   `domains:health:<YYYY-MM-DD>` (never stale; released again if the step
//                   throws, so a later run retries). A dry run never claims.
//   7. heartbeat    platform_meta `job:domains:last_success` (ISO; only when no step failed)
//                   and `job:domains:last_counts` (JSON of DomainsJobResult: counts only, never
//                   an org id, host or record value). Monitor brief check 42 (D174, D175).
//
// Concurrency: an in-process chain plus the platform_meta lock `lock:domains-job` (stale after
// 10 min), so the CLI and the scheduled route never overlap; a run that finds the lock held
// returns `busy: true` and writes nothing. A dry run takes no lock and writes nothing: every
// step runs in its dry-run mode (backfill only counts hostless orgs). Logs carry error class
// names only. `@cds/db` never imports the add-on registry (P13-P7): the route and CLI load it.
import { assertSystemContext, mintSystemContext } from "../context";
import { backfillPreviewHosts } from "../assembly/preview-host";
import { runDomainHealth, type DomainHealthDeps } from "../dns/health";
import { advanceMoves, type MoveDeps } from "../dns/moves";
import {
  advanceSendingDomains,
  type SendingDeps,
} from "../email/sending-domains/ensure";
import { advanceHandbacks, type HandbackDeps } from "../offboarding/handback";
import {
  advanceOffboardings,
  type OffboardingDeps,
} from "../offboarding/offboardings";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";

export const DOMAINS_JOB_SUCCESS_KEY = "job:domains:last_success";
export const DOMAINS_JOB_COUNTS_KEY = "job:domains:last_counts";
export const DOMAINS_JOB_LOCK_KEY = "lock:domains-job";
/** Health runs once per UTC day, from this UTC hour on. */
export const DOMAINS_HEALTH_HOUR_UTC = 6;
export const DOMAINS_JOB_STEPS = [
  "backfill",
  "moves",
  "sending",
  "handbacks",
  "offboarding",
  "health",
] as const;
export type DomainsJobStep = (typeof DOMAINS_JOB_STEPS)[number];

const LOCK_STALE_MS = 10 * 60_000;
/** A day's health claim never goes stale: the day is spent once claimed. */
const NEVER_STALE = Number.MAX_SAFE_INTEGER;
const BACKFILL_LIMIT = 50;

export type DomainsJobOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Preview hosts created per run (default 50). */
  backfillLimit?: number;
  /** Injected adapters per step (tests); production uses the configured ones. */
  deps?: {
    moves?: MoveDeps;
    sending?: SendingDeps;
    handbacks?: HandbackDeps;
    offboarding?: OffboardingDeps;
    health?: DomainHealthDeps;
  };
};

/** Monitor brief check 42 keys (plus `ms`). Counts only. */
export type DomainsJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Preview hosts created (dry run: hostless orgs found). */
  backfilled: number;
  movesAdvanced: number;
  movesWaitingOwner: number;
  movesFailed: number;
  /** Launch moves cancelled after MOVE_ABANDON_DAYS at step 4 (WR-A04). */
  movesExpired: number;
  /** Orgs whose sending identity changed (records written, verified or failed). */
  sendingUpdated: number;
  handbacksChecked: number;
  offboardingsClosed: number;
  /** The daily health step ran this run. */
  healthRan: boolean;
  failedSteps: string[];
  /** Wall time of the run. */
  ms: number;
};

/** `domains:health:2026-10-17`: the UTC calendar day of `now`. */
export function domainsHealthClaimKey(now: Date): string {
  return `domains:health:${now.toISOString().slice(0, 10)}`;
}

/** When today's (UTC) health step was claimed, or null when it has not run today. */
export async function domainsHealthRanAt(now: Date): Promise<Date | null> {
  const v = await readPlatformMeta(domainsHealthClaimKey(now));
  if (v === null) return null;
  const at = new Date(v.split(" ")[1] ?? "");
  return Number.isFinite(at.getTime()) ? at : null;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** Thrown by a step whose function counted per-item errors (logged there by class name). */
class StepItemsFailed extends Error {
  override name = "StepItemsFailed";
}

function emptyResult(dryRun: boolean): DomainsJobResult {
  return {
    dryRun,
    busy: false,
    backfilled: 0,
    movesAdvanced: 0,
    movesWaitingOwner: 0,
    movesFailed: 0,
    movesExpired: 0,
    sendingUpdated: 0,
    handbacksChecked: 0,
    offboardingsClosed: 0,
    healthRan: false,
    failedSteps: [],
    ms: 0,
  };
}

async function runOnce(opts: DomainsJobOptions): Promise<DomainsJobResult> {
  const started = performance.now();
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const deps = opts.deps ?? {};
  const ctx = mintSystemContext({ job: "domains" });
  assertSystemContext(ctx);
  const result = emptyResult(dryRun);

  let token: string | null = null;
  if (!dryRun) {
    token = await acquirePlatformLock(DOMAINS_JOB_LOCK_KEY, {
      now,
      staleMs: LOCK_STALE_MS,
    });
    if (token === null) {
      return { ...result, busy: true, ms: elapsed(started) };
    }
  }

  const step = async (name: DomainsJobStep, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs/domains] ${name} failed: ${errName(err)}`);
      result.failedSteps.push(name);
    }
  };

  try {
    // 1. Preview hosts for hostless orgs (P14-P3). A dry run only counts them.
    await step("backfill", async () => {
      const r = await backfillPreviewHosts({
        limit: dryRun ? 0 : (opts.backfillLimit ?? BACKFILL_LIMIT),
        now: () => now,
      });
      result.backfilled = dryRun ? r.skipped : r.created;
      if (r.failed > 0) throw new StepItemsFailed();
    });

    // 2. Domain moves.
    await step("moves", async () => {
      const r = await advanceMoves({
        now,
        dryRun,
        ...(deps.moves ? { deps: deps.moves } : {}),
      });
      result.movesAdvanced = r.advanced;
      result.movesWaitingOwner = r.waitingOwner;
      result.movesFailed = r.failed;
      result.movesExpired = r.expired;
    });

    // 3. Sending identities.
    await step("sending", async () => {
      const r = await advanceSendingDomains({
        now,
        dryRun,
        ...(deps.sending ? { deps: deps.sending } : {}),
      });
      result.sendingUpdated = r.updated + r.verified + r.failed;
    });

    // 4. DNS handbacks (before the notice end, so a same-run handback lets it close).
    await step("handbacks", async () => {
      const r = await advanceHandbacks({
        now,
        dryRun,
        ...(deps.handbacks ? { deps: deps.handbacks } : {}),
      });
      result.handbacksChecked = r.checked;
      if (r.errors > 0) throw new StepItemsFailed();
    });

    // 5. Offboarding notice ends.
    await step("offboarding", async () => {
      const r = await advanceOffboardings({
        now,
        dryRun,
        ...(deps.offboarding ? { deps: deps.offboarding } : {}),
      });
      result.offboardingsClosed = r.closed;
      if (r.errors > 0) throw new StepItemsFailed();
    });

    // 6. Daily domain health: after 06:00 UTC, once per UTC day.
    await step("health", async () => {
      if (now.getUTCHours() < DOMAINS_HEALTH_HOUR_UTC) return;
      const claimKey = domainsHealthClaimKey(now);
      if ((await readPlatformMeta(claimKey)) !== null) return;
      if (dryRun) {
        await runDomainHealth({
          now,
          dryRun: true,
          ...(deps.health ? { deps: deps.health } : {}),
        });
        result.healthRan = true;
        return;
      }
      const claim = await acquirePlatformLock(claimKey, {
        now,
        staleMs: NEVER_STALE,
      });
      if (claim === null) return;
      let r: Awaited<ReturnType<typeof runDomainHealth>>;
      try {
        r = await runDomainHealth({
          now,
          ...(deps.health ? { deps: deps.health } : {}),
        });
      } catch (err) {
        // Give the day back so a later run retries (the demo job's WR-A10 rule).
        await releasePlatformLock(claimKey, claim).catch((e: unknown) => {
          console.error(
            `[jobs/domains] health claim release failed: ${errName(e)}`,
          );
        });
        throw err;
      }
      result.healthRan = true;
      if (r.errors > 0) throw new StepItemsFailed();
    });

    // 7. Heartbeat (monitor brief check 42).
    result.ms = elapsed(started);
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(
          ctx,
          DOMAINS_JOB_SUCCESS_KEY,
          now.toISOString(),
        );
      }
      await writePlatformMeta(
        ctx,
        DOMAINS_JOB_COUNTS_KEY,
        JSON.stringify(result),
      );
    }
    return result;
  } finally {
    if (token !== null) await releasePlatformLock(DOMAINS_JOB_LOCK_KEY, token);
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
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
 * Run the domains job once, serialised with any concurrent run in this process (and across
 * processes through `lock:domains-job`).
 */
export async function runDomainsJob(
  opts: DomainsJobOptions = {},
): Promise<DomainsJobResult> {
  return withJobLock(() => runOnce(opts));
}
