// P8 (08-17): hourly assembly sweep, CONTEXT A2-Q1/A2-Q4; heartbeat for the monitor app,
// D174/D175; message-only logs. (TMPL-02, TMPL-04; RESEARCH Pattern 5, Open question 5;
// T-08-17-02, T-08-17-04, T-08-17-05.)
//
// Send to CDS enqueues assembly at once (assembly/queue.ts). This sweep is the safety net and
// the only trigger for orgs that reach `ready_for_build` another way (fit approval, quotes
// reconcile). One run:
//
//   1. List `organizations` with `stage = 'ready_for_build'` (bound filter, oldest first, at
//      most 50 per run).
//   2. Per org, read the ledger (`org_intake.assembly`): skip an org with no intake row
//      (counted by assemblyStatus() as given up, WR-A08); skip `done`; skip `failed` with
//      attempts >= 3 (staff were emailed once, CONTEXT A2-Q4); skip `running` unless it
//      started over 30 minutes ago (then recover it, counted in `stuckRecovered`); everything
//      else runs on the shared assemblyQueue, each org in its own try/catch.
//
// Counts (no org ids): { assembled, failed, skipped, stuckRecovered, failureEmails,
// failedSteps }. Heartbeat: platform_meta ASSEMBLY_HEARTBEAT_KEY (ISO, only when no step
// failed; it means the sweep ran, not that every org assembled: org failures show in
// `failed` and in assemblyStatus().failed_orgs, IN-A06) and ASSEMBLY_COUNTS_KEY (every run). The monitor brief
// (.planning/design/MONITOR-APP-BRIEF.md check 25) documents both; change them together.
// Concurrency: an in-process mutex, a separate chain from the media and quote jobs.
import type { AssemblyLedger } from "@cds/core/templates";
import { withSuperuser } from "../client";
import { mintSystemContext, type SystemContext } from "../context";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";
import type { AssemblyResult } from "../assembly/assemble";
import { parseLedger } from "../assembly/ledger";
import { assemblyErrorLabel, assemblyQueue } from "../assembly/queue";
import {
  ASSEMBLY_MAX_ATTEMPTS,
  runAssemblyForOrg,
  type AssemblyRunDeps,
} from "../assembly/run";

export const ASSEMBLY_HEARTBEAT_KEY = "job:assembly:last_success";
export const ASSEMBLY_COUNTS_KEY = "job:assembly:last_counts";

/** At most this many orgs per run (T-08-17-02). */
export const ASSEMBLY_SWEEP_LIMIT = 50;
/** A `running` ledger older than this is stuck and gets recovered. */
export const ASSEMBLY_STUCK_MS = 30 * 60 * 1000;
/** Ledger rows scanned by assemblyStatus() when counting in code. */
const STATUS_SCAN_MAX = 500;

export type AssemblyJobResult = {
  assembled: number;
  failed: number;
  skipped: number;
  stuckRecovered: number;
  failureEmails: number;
  failedSteps: string[];
};

export type AssemblyCandidate = {
  orgId: string;
  ledger: AssemblyLedger;
  /** The org has no org_intake row: it can never assemble (WR-A08). */
  noIntake?: boolean;
};

export type AssemblyJobOptions = {
  now?: Date;
  /** The run deps (templates, sections, copy, registry, ...); the app's assemblyDeps(). */
  deps: AssemblyRunDeps;
  writeMeta?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
  /** Test seams (unit tests). */
  listCandidates?: (limit: number) => Promise<AssemblyCandidate[]>;
  runOrg?: (
    orgId: string,
    deps: AssemblyRunDeps,
    opts: { now: Date },
  ) => Promise<AssemblyResult>;
};

export type AssemblyStatusReport = {
  last_success: string | null;
  failed_orgs: number;
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

/** The oldest `ready_for_build` orgs and their ledgers (bound filters only). */
async function listReadyOrgs(limit: number): Promise<AssemblyCandidate[]> {
  return withSuperuser(async (pb) => {
    const orgs = await pb.collection("organizations").getList(1, limit, {
      filter: pb.filter("stage = {:stage}", { stage: "ready_for_build" }),
      sort: "created,id",
      fields: "id",
      skipTotal: true,
    });
    const out: AssemblyCandidate[] = [];
    for (const org of orgs.items) {
      const intake = await pb.collection("org_intake").getList(1, 1, {
        filter: pb.filter("organization = {:org}", { org: org.id }),
        fields: "id,assembly",
        skipTotal: true,
      });
      const row = intake.items[0];
      out.push(
        row
          ? { orgId: org.id, ledger: parseLedger(row.assembly) }
          : { orgId: org.id, ledger: parseLedger(undefined), noIntake: true },
      );
    }
    return out;
  });
}

type Decision = "run" | "recover" | "skip";

function decide(ledger: AssemblyLedger, now: Date): Decision {
  if (ledger.status === "done") return "skip";
  if (ledger.status === "failed" && ledger.attempts >= ASSEMBLY_MAX_ATTEMPTS) {
    return "skip";
  }
  if (ledger.status === "running") {
    const started = ledger.started_at ? Date.parse(ledger.started_at) : NaN;
    if (
      Number.isFinite(started) &&
      now.getTime() - started <= ASSEMBLY_STUCK_MS
    ) {
      return "skip";
    }
    return "recover";
  }
  return "run";
}

async function runOnce(opts: AssemblyJobOptions): Promise<AssemblyJobResult> {
  const now = opts.now ?? new Date();
  const ctx = mintSystemContext({ job: "assembly" });
  const result: AssemblyJobResult = {
    assembled: 0,
    failed: 0,
    skipped: 0,
    stuckRecovered: 0,
    failureEmails: 0,
    failedSteps: [],
  };

  let candidates: AssemblyCandidate[] = [];
  try {
    candidates = await (opts.listCandidates ?? listReadyOrgs)(
      ASSEMBLY_SWEEP_LIMIT,
    );
  } catch (err) {
    console.error(`[jobs/assembly] list failed: ${assemblyErrorLabel(err)}`);
    result.failedSteps.push("list");
  }

  const runOrg = opts.runOrg ?? runAssemblyForOrg;
  for (const { orgId, ledger, noIntake } of candidates) {
    // No intake row: never run (it would fail every hour without counting an attempt).
    // assemblyStatus() counts it in failed_orgs so the monitor raises it (WR-A08).
    const decision = noIntake === true ? "skip" : decide(ledger, now);
    if (decision === "skip") {
      result.skipped += 1;
      continue;
    }
    if (decision === "recover") result.stuckRecovered += 1;
    try {
      const r = await assemblyQueue.run(() =>
        runOrg(orgId, opts.deps, { now }),
      );
      if (r.status === "done") {
        result.assembled += 1;
      } else if (r.status === "failed") {
        result.failed += 1;
        if (
          r.ledger.failure_emailed === true &&
          ledger.failure_emailed !== true
        ) {
          result.failureEmails += 1;
        }
      } else {
        // no_template, already, busy, not_ready.
        result.skipped += 1;
      }
    } catch (err) {
      console.error(`[jobs/assembly] org failed: ${assemblyErrorLabel(err)}`);
      result.failed += 1;
    }
  }

  // Heartbeat (monitor brief check 25).
  const write = opts.writeMeta ?? writePlatformMeta;
  if (result.failedSteps.length === 0) {
    await write(ctx, ASSEMBLY_HEARTBEAT_KEY, now.toISOString());
  }
  await write(ctx, ASSEMBLY_COUNTS_KEY, JSON.stringify(result));
  return result;
}

/** Run the sweep once, serialised with any concurrent run in this process. */
export async function runAssemblyJobs(
  opts: AssemblyJobOptions,
): Promise<AssemblyJobResult> {
  return withJobLock(() => runOnce(opts));
}

/**
 * Monitor status (D174, D175): the last clean sweep and how many orgs have given up: three
 * failed attempts, or `ready_for_build` with no org_intake row at all (WR-A08). Counts only,
 * never an org id. PocketBase 0.39.11 filters JSON fields by path (`assembly.status`), so
 * each count is one bound query.
 */
export async function assemblyStatus(): Promise<AssemblyStatusReport> {
  const failed = await withSuperuser(async (pb) => {
    const res = await pb.collection("org_intake").getList(1, STATUS_SCAN_MAX, {
      filter: pb.filter(
        "assembly.status = {:status} && assembly.attempts >= {:max}",
        { status: "failed", max: ASSEMBLY_MAX_ATTEMPTS },
      ),
      fields: "assembly",
      skipTotal: true,
    });
    // Re-check in code through the deny-by-default parser.
    const gaveUp = res.items.filter((row) => {
      const l = parseLedger(row.assembly);
      return l.status === "failed" && l.attempts >= ASSEMBLY_MAX_ATTEMPTS;
    }).length;
    // A ready_for_build org with no org_intake row can never assemble and has no ledger
    // to count attempts on: it is given up too (WR-A08).
    const ready = await pb
      .collection("organizations")
      .getList(1, STATUS_SCAN_MAX, {
        filter: pb.filter("stage = {:stage}", { stage: "ready_for_build" }),
        fields: "id",
        skipTotal: true,
      });
    const withIntake = await pb
      .collection("org_intake")
      .getList(1, STATUS_SCAN_MAX, {
        filter: pb.filter("organization.stage = {:stage}", {
          stage: "ready_for_build",
        }),
        fields: "organization",
        skipTotal: true,
      });
    const has = new Set(withIntake.items.map((r) => String(r.organization)));
    return gaveUp + ready.items.filter((o) => !has.has(o.id)).length;
  });
  const last = await readPlatformMeta(ASSEMBLY_HEARTBEAT_KEY);
  return { last_success: last || null, failed_orgs: failed };
}
