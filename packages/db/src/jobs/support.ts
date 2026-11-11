// P12 support job (12-31; COMM-08, COMM-09, COMM-11, SUPPORT-02). The hourly `support:run`
// job. One run does, in order, each step in its own try (a failing step is recorded in
// `failedSteps` and the rest still run):
//
//   1. auto-close        tickets Resolved for 7 days with no tenant reply are Closed
//                        (`jobAutoCloseTickets`, 12-18)
//   2. sla-warnings      one `support.sla_risk` staff email per unanswered Problem/Question
//                        ticket that is due soon or missed (`jobSlaWarnings`, 12-18)
//   3. windows-start     started service windows raise their `cds.notice` once
//                        (`jobStartServiceWindows`, 12-08; P12-P8)
//   4. windows-clear     ended windows get `cleared_at` (`jobClearEndedWindows`, 12-08)
//   5. rescan            pending tenant attachments are scanned again when a real scanner is
//                        configured (`jobRescanPendingFiles`, 12-07)
//   6. held-drafts       held drafts older than 30 days and discards past the undo window go
//                        (`jobPruneHeldDrafts`, 12-13)
//   7. staged-uploads    staged uploads never sent, older than 24 h, go
//                        (`jobPruneStagedUploads`, 12-07)
//   8. gauges            read-only: `slaMissedOpen` (open tickets past their first-reply due
//                        time with no reply) and `openWindows` (active windows and how long
//                        they have run), for the monitor
//   9. heartbeat         platform_meta `job:support:last_success` (ISO; only when no step
//                        failed) and `job:support:last_counts` (JSON of SupportJobResult).
//                        Monitor brief check 32 (D174, D175); change them together.
//
// Concurrency (T-12-31-03): an in-process chain plus a platform_meta lock `lock:support-job`
// (a stale lock is taken over after 30 min), so the CLI and the scheduled route never
// overlap; a run that finds the lock busy returns `busy: true` and writes nothing. dryRun
// counts what each step would touch with read-only queries and writes nothing (no email, no
// alert, no row or object change, no heartbeat); notice alerts are not counted in a dry run
// (`noticeAlerts` stays 0). Every filter is bound through pb.filter (T-02-13); logs carry
// error names only.
import { slaState } from "@cds/core/support";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import { assertSystemContext, mintSystemContext } from "../context";
import { supportEmail } from "../email/env";
import type { EmailTransport } from "../email/transport";
import { getFileScanner, unavailableScanner } from "../forms/scanner";
import type { FileScanner } from "../forms/scanner-port";
import {
  acquirePlatformLock,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import { getObjectStore, type ObjectStore } from "../storage";
import { tenantSupportPrefix } from "../storage/keys";
import {
  SUPPORT_STAGING_MAX_AGE_MS,
  jobPruneStagedUploads,
  jobRescanPendingFiles,
} from "../support/files";
import {
  HELD_DRAFT_TTL_MS,
  HELD_DRAFT_UNDO_MS,
  jobPruneHeldDrafts,
} from "../support/held-drafts";
import {
  SUPPORT_AUTO_CLOSE_MS,
  jobAutoCloseTickets,
  jobSlaWarnings,
} from "../support/staff-tickets";
import {
  jobClearEndedWindows,
  jobStartServiceWindows,
} from "../support/windows";

export type SupportJobOptions = {
  now?: Date;
  dryRun?: boolean;
  transport?: EmailTransport;
  /** Defaults to the configured scanner (the fail-closed stand-in when none is set). */
  scanner?: FileScanner;
  store?: ObjectStore;
};

export type SupportOpenWindow = { code: string; activeHours: number };

export type SupportJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Tickets closed after 7 days Resolved with no reply. */
  closed: number;
  /** SLA-at-risk staff emails sent. */
  slaWarned: number;
  /** Windows that started since the last run (stamped `alerted_at`). */
  windowsStarted: number;
  /** `cds.notice` alerts raised for those windows (one per reached org). */
  noticeAlerts: number;
  /** Ended windows cleared. */
  windowsCleared: number;
  /** Pending attachments checked by the scanner. */
  rescanned: number;
  heldPruned: number;
  stagedPruned: number;
  /** Gauge: open tickets past their first-reply due time with no reply. */
  slaMissedOpen: number;
  /** Gauge: active (started, not ended, not cleared) windows. */
  openWindows: SupportOpenWindow[];
  failedSteps: string[];
};

const HEARTBEAT_KEY = "job:support:last_success";
const COUNTS_KEY = "job:support:last_counts";
const LOCK_KEY = "lock:support-job";
const LOCK_STALE_MS = 30 * 60_000;
const HOUR_MS = 3_600_000;
/** Rows a dry-run or gauge query reads (10-50 tenants: far above any real backlog). */
const READ_MAX = 500;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toTime(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

function emptyResult(dryRun: boolean): SupportJobResult {
  return {
    dryRun,
    busy: false,
    closed: 0,
    slaWarned: 0,
    windowsStarted: 0,
    noticeAlerts: 0,
    windowsCleared: 0,
    rescanned: 0,
    heldPruned: 0,
    stagedPruned: 0,
    slaMissedOpen: 0,
    openWindows: [],
    failedSteps: [],
  };
}

function scannerOf(opts: SupportJobOptions): FileScanner {
  if (opts.scanner) return opts.scanner;
  try {
    return getFileScanner();
  } catch {
    return unavailableScanner;
  }
}

// ------------------------------------------------------------------ dry-run counts
async function countList(
  collection: string,
  filter: (pb: PocketBase) => string,
): Promise<number> {
  return withSuperuser(async (pb) => {
    const res = await pb.collection(collection).getList(1, 1, {
      filter: filter(pb),
      fields: "id",
    });
    return res.totalItems;
  });
}

async function dryAutoClose(now: Date): Promise<number> {
  const cut = new Date(now.getTime() - SUPPORT_AUTO_CLOSE_MS);
  return countList("support_threads", (pb) =>
    pb.filter(
      "kind = 'ticket' && status = 'resolved' && resolved_at != '' && resolved_at <= {:cut}",
      { cut },
    ),
  );
}

async function dryNeedsWarning(now: Date): Promise<number> {
  if (!supportEmail()) return 0;
  const rows = await withSuperuser((pb) =>
    pb.collection("support_threads").getList(1, READ_MAX, {
      filter:
        "kind = 'ticket' && status != 'closed' && status != 'resolved' && " +
        "first_reply_due_at != '' && first_replied_at = '' && sla_warned_at = ''",
      fields: "id,first_reply_due_at,first_replied_at",
      skipTotal: true,
    }),
  );
  return rows.items.filter((r) => {
    const s = slaState({
      dueAt: str(r.first_reply_due_at) || null,
      repliedAt: str(r.first_replied_at) || null,
      now,
    });
    return s === "due_soon" || s === "missed";
  }).length;
}

async function dryStartWindows(now: Date): Promise<number> {
  return countList("service_windows", (pb) =>
    pb.filter(
      "alerted_at = '' && cleared_at = '' && starts_at <= {:now} && ends_at > {:now}",
      { now },
    ),
  );
}

async function dryClearWindows(now: Date): Promise<number> {
  return countList("service_windows", (pb) =>
    pb.filter("cleared_at = '' && ends_at <= {:now}", { now }),
  );
}

async function dryRescan(scanner: FileScanner): Promise<number> {
  if (scanner.name === "unavailable") return 0;
  const n = await countList("support_files", () => "scan = 'pending'");
  return Math.min(n, 200);
}

async function dryHeldDrafts(now: Date): Promise<number> {
  const old = new Date(now.getTime() - HELD_DRAFT_TTL_MS);
  const gone = new Date(now.getTime() - HELD_DRAFT_UNDO_MS);
  return countList("held_drafts", (pb) =>
    pb.filter(
      "created < {:old} || (discarded_at != '' && discarded_at < {:gone})",
      { old, gone },
    ),
  );
}

async function dryStagedUploads(
  now: Date,
  store: ObjectStore,
): Promise<number> {
  const cutoff = now.getTime() - SUPPORT_STAGING_MAX_AGE_MS;
  const orgs = await withSuperuser((pb) =>
    pb.collection("organizations").getFullList({ fields: "id" }),
  );
  let n = 0;
  for (const o of orgs) {
    const objects = await store
      .list(`${tenantSupportPrefix(o.id)}staging/`)
      .catch(() => []);
    n += objects.filter((obj) => obj.lastModified.getTime() < cutoff).length;
  }
  return n;
}

// ------------------------------------------------------------------ gauges
async function gaugeSlaMissedOpen(now: Date): Promise<number> {
  return countList("support_threads", (pb) =>
    pb.filter(
      "kind = 'ticket' && status != 'closed' && status != 'resolved' && " +
        "first_reply_due_at != '' && first_replied_at = '' && first_reply_due_at < {:now}",
      { now },
    ),
  );
}

async function gaugeOpenWindows(now: Date): Promise<SupportOpenWindow[]> {
  const rows = await withSuperuser((pb) =>
    pb.collection("service_windows").getList(1, READ_MAX, {
      filter: pb.filter(
        "cleared_at = '' && starts_at <= {:now} && ends_at > {:now}",
        { now },
      ),
      sort: "starts_at,seq",
      fields: "id,seq,starts_at",
      skipTotal: true,
    }),
  );
  return rows.items.map((r) => {
    const start = toTime(r.starts_at) ?? now.getTime();
    const hours = Math.max(0, (now.getTime() - start) / HOUR_MS);
    return {
      code: `W-${typeof r.seq === "number" ? r.seq : 0}`,
      activeHours: Math.round(hours * 10) / 10,
    };
  });
}

// ------------------------------------------------------------------ run
async function runOnce(opts: SupportJobOptions): Promise<SupportJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "support" });
  assertSystemContext(ctx);
  const result = emptyResult(dryRun);
  const scanner = scannerOf(opts);
  const transport = opts.transport;

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
      console.error(`[jobs/support] ${name} failed: ${errName(err)}`);
      result.failedSteps.push(name);
    }
  };

  try {
    // 1. Auto-close after 7 days Resolved.
    await step("auto-close", async () => {
      if (dryRun) {
        result.closed = await dryAutoClose(now);
        return;
      }
      const r = await jobAutoCloseTickets(now, transport ? { transport } : {});
      result.closed = r.closed;
      if (r.failed > 0) throw new Error("AutoCloseFailed");
    });

    // 2. SLA-at-risk staff emails (once per ticket).
    await step("sla-warnings", async () => {
      if (dryRun) {
        result.slaWarned = await dryNeedsWarning(now);
        return;
      }
      const r = await jobSlaWarnings(now, transport ? { transport } : {});
      result.slaWarned = r.warned;
      if (r.failed > 0) throw new Error("SlaWarningFailed");
    });

    // 3. Windows that have started: one cds.notice per reached org.
    await step("windows-start", async () => {
      if (dryRun) {
        result.windowsStarted = await dryStartWindows(now);
        return;
      }
      const r = await jobStartServiceWindows(
        now,
        transport ? { transport } : {},
      );
      result.windowsStarted = r.windows;
      result.noticeAlerts = r.alerted;
    });

    // 4. Ended windows.
    await step("windows-clear", async () => {
      result.windowsCleared = dryRun
        ? await dryClearWindows(now)
        : (await jobClearEndedWindows(now)).cleared;
    });

    // 5. Pending attachments, when a real scanner answers.
    await step("rescan", async () => {
      if (dryRun) {
        result.rescanned = await dryRescan(scanner);
        return;
      }
      const r = await jobRescanPendingFiles({
        scanner,
        ...(opts.store ? { store: opts.store } : {}),
      });
      result.rescanned = r.checked;
    });

    // 6. Held drafts.
    await step("held-drafts", async () => {
      result.heldPruned = dryRun
        ? await dryHeldDrafts(now)
        : (await jobPruneHeldDrafts(now)).pruned;
    });

    // 7. Staged uploads never sent.
    await step("staged-uploads", async () => {
      const store = opts.store ?? getObjectStore();
      result.stagedPruned = dryRun
        ? await dryStagedUploads(now, store)
        : (await jobPruneStagedUploads(now, { store })).deleted;
    });

    // 8. Read-only gauges for the monitor.
    await step("gauges", async () => {
      result.slaMissedOpen = await gaugeSlaMissedOpen(now);
      result.openWindows = await gaugeOpenWindows(now);
    });

    // 9. Heartbeat (monitor brief check 32).
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(ctx, HEARTBEAT_KEY, now.toISOString());
      }
      await writePlatformMeta(ctx, COUNTS_KEY, JSON.stringify(result));
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

/** Run the support job once, serialised with any concurrent run (in process and across). */
export async function runSupportJobs(
  opts: SupportJobOptions = {},
): Promise<SupportJobResult> {
  return withJobLock(() => runOnce(opts));
}
