// The billing reconcile job (10-21; PAY-01, PAY-02, PAY-03, D244; CONTEXT A1; RESEARCH
// Pitfalls 1, 2 and 12). Nothing is lost while the platform was down or a webhook was missed:
// the job re-reads the provider and runs what it finds through the SAME ledgered processor
// as the webhooks (processNormalisedEvent), so a replay is a duplicate and every handler is
// state-idempotent.
//
//   1. cds-objects: billing.reconcile({ since }) returns the CDS-side events since the window
//      start: on Stripe its own event log with the real event ids (CR-E04: changes, not
//      creations; the ledger dedups them against the webhook), on the fake one id per object
//      version (`reconcile:<object>:<status>:<updated>`). Each goes through
//      processNormalisedEvent.
//   2. connect: gateway.reconcile over every gateway_accounts.account_id. The stored row is
//      compared with the provider first: an unchanged account is a no-op (counted as a
//      duplicate, no ledger row); a changed one is dispatched under a per-run id, so a
//      connected -> restricted -> connected -> restricted cycle is caught every time
//      (choice 5). The account handler re-fetches the account and alerts once per change.
//   3. failed-events: retryFailedEvents, at most 100 ledger rows whose outcome is failed
//      (Pitfall 1: a crashed handler is retried, never skipped).
//   4. metrics: backlog = ledger rows unprocessed for more than 15 minutes; restricted =
//      gateway rows not connected after having been connected (alerted_status set).
//
// Window (choice 1): the last success minus 10 minutes of overlap, or 24 hours when the job
// never succeeded; `since` overrides it. Step isolation as in jobs/retention.ts: a throw is
// logged (message only), its name lands in failedSteps and later steps still run.
// Heartbeat: BILLING_HEARTBEAT_KEY (ISO, only when no step failed) and BILLING_COUNTS_KEY
// (counts JSON, never an org id, name or object id) on every non-dry run. A dry run lists
// what it would process and writes nothing: no ledger row, no heartbeat, no mail.
// The monitor brief (.planning/design/MONITOR-APP-BRIEF.md check 27, D174, D175) documents
// both keys and billingStatus(); change them together. Production runs the job hourly
// through POST /api/jobs/billing (Pitfall 12: the standalone image has no scripts).
import type {
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { withSuperuser } from "../client";
import {
  assertSystemContext,
  mintSystemContext,
  type SystemContext,
} from "../context";
import {
  getCdsBilling,
  getPaymentGateway,
  paymentsMode,
} from "../payments/factory";
import { eventBacklog, failedEvents, objectRefOf } from "../payments/ledger";
import {
  processNormalisedEvent,
  retryFailedEvents,
  type ProcessDeps,
  type ProcessOutcome,
} from "../payments/process";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";

export const BILLING_HEARTBEAT_KEY = "job:billing:last_success";
export const BILLING_COUNTS_KEY = "job:billing:last_counts";

const HOUR_MS = 60 * 60 * 1000;
/** Choice 1: the window overlaps the last success by 10 minutes. */
const OVERLAP_MS = 10 * 60 * 1000;
/** Choice 1: with no success yet, look back 24 hours. */
const DEFAULT_WINDOW_MS = 24 * HOUR_MS;
/** Choice 2: at most 100 failed ledger rows per run. */
const RETRY_LIMIT = 100;
/** Choice 2: an event unprocessed this long counts as backlog. */
const BACKLOG_MINUTES = 15;
const PAGE = 200;

export type BillingJobResult = {
  dryRun: boolean;
  /** ISO start of the window the provider was read from. */
  since: string;
  eventsSeen: number;
  applied: number;
  duplicates: number;
  ignored: number;
  failed: number;
  /** Failed ledger rows run again (a dry run: rows that would be). */
  retried: number;
  accountsChecked: number;
  /** Gateway rows not connected after having been connected. */
  restricted: number;
  /** Ledger rows unprocessed for more than 15 minutes. */
  backlog: number;
  failedSteps: string[];
  /**
   * Dry run only: what would be processed (event type and provider object ref; a Connect
   * account shows its last 4 characters). Never written to the counts key.
   */
  planned: { type: string; ref: string }[];
  /**
   * Provider events by kind (10-24, for the CLI's UI-SPEC lines): read = seen in the window,
   * applied = changed something (a dry run: would be processed), duplicates = already
   * handled. Retried ledger rows are not split. Never written to the counts key.
   */
  kinds: Record<BillingEventKind, BillingKindCount>;
};

export type BillingEventKind =
  "subscription" | "invoice" | "checkout" | "account" | "other";

export type BillingKindCount = {
  read: number;
  applied: number;
  duplicates: number;
};

/** The kind an event type counts under in the CLI report. */
export function billingEventKind(type: string): BillingEventKind {
  const prefix = type.split(".")[0];
  return prefix === "subscription" ||
    prefix === "invoice" ||
    prefix === "checkout" ||
    prefix === "account"
    ? prefix
    : "other";
}

function emptyKinds(): Record<BillingEventKind, BillingKindCount> {
  const zero = (): BillingKindCount => ({ read: 0, applied: 0, duplicates: 0 });
  return {
    subscription: zero(),
    invoice: zero(),
    checkout: zero(),
    account: zero(),
    other: zero(),
  };
}

export type BillingJobDeps = ProcessDeps & {
  writeMeta?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
};

export type BillingJobOptions = {
  dryRun?: boolean;
  /** Overrides the window start (the CLI's `--since 24h|<ISO>`). */
  since?: Date;
  now?: Date;
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

// ------------------------------------------------------------------ helpers
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parses the CLI's `--since`: `<N>h` / `<N>d` back from `now`, or an ISO date. Null when
 * the value is neither (the caller prints usage).
 */
export function parseBillingSince(value: string, now: Date): Date | null {
  const v = value.trim();
  const rel = /^(\d{1,4})([hd])$/.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2] === "h" ? n * HOUR_MS : n * 24 * HOUR_MS;
    return new Date(now.getTime() - ms);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function windowStart(now: Date, override?: Date): Promise<Date> {
  if (override instanceof Date && !Number.isNaN(override.getTime())) {
    return override;
  }
  const last = Date.parse(
    (await readPlatformMeta(BILLING_HEARTBEAT_KEY)) ?? "",
  );
  if (Number.isFinite(last)) return new Date(last - OVERLAP_MS);
  return new Date(now.getTime() - DEFAULT_WINDOW_MS);
}

type StoredAccount = {
  accountId: string;
  status: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
};

async function storedAccounts(): Promise<StoredAccount[]> {
  return withSuperuser(async (pb) => {
    const out: StoredAccount[] = [];
    for (let page = 1; ; page += 1) {
      const res = await pb.collection("gateway_accounts").getList(page, PAGE, {
        filter: "account_id != ''",
        sort: "created,id",
        fields: "account_id,status,charges_enabled,details_submitted",
        skipTotal: true,
      });
      for (const r of res.items) {
        out.push({
          accountId: str(r.account_id),
          status: str(r.status),
          chargesEnabled: r.charges_enabled === true,
          detailsSubmitted: r.details_submitted === true,
        });
      }
      if (res.items.length < PAGE) return out;
    }
  });
}

async function countRows(collection: string, filter: string): Promise<number> {
  return withSuperuser(async (pb) => {
    const res = await pb
      .collection(collection)
      .getList(1, 1, { filter, fields: "id" });
    return res.totalItems;
  });
}

/** Gateway rows that stopped after having been connected once (10-14's alerted_status). */
const RESTRICTED_FILTER = "status != 'connected' && alerted_status != ''";
const FAILED_FILTER = "processed_at = '' && outcome = 'failed'";

function refOf(e: NormalisedEvent): string {
  const ref = objectRefOf(e);
  return e.type.startsWith("account.") ? `…${ref.slice(-4)}` : ref;
}

// ------------------------------------------------------------------ the run
async function runOnce(
  opts: BillingJobOptions,
  deps: BillingJobDeps,
): Promise<BillingJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "billing" });
  assertSystemContext(ctx);
  const billing = (): CdsBilling => deps.billing ?? getCdsBilling();
  const gateway = (): PaymentGateway => deps.gateway ?? getPaymentGateway();
  const processDeps: ProcessDeps = {
    ...(deps.billing ? { billing: deps.billing } : {}),
    ...(deps.gateway ? { gateway: deps.gateway } : {}),
    ...(deps.handlers ? { handlers: deps.handlers } : {}),
    ...(deps.transport ? { transport: deps.transport } : {}),
    ...(deps.addons ? { addons: deps.addons } : {}),
    now,
  };

  const result: BillingJobResult = {
    dryRun,
    since: "",
    eventsSeen: 0,
    applied: 0,
    duplicates: 0,
    ignored: 0,
    failed: 0,
    retried: 0,
    accountsChecked: 0,
    restricted: 0,
    backlog: 0,
    failedSteps: [],
    planned: [],
    kinds: emptyKinds(),
  };

  async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs/billing] ${name} failed: ${message(err)}`);
      result.failedSteps.push(name);
    }
  }

  function tally(outcome: ProcessOutcome, e: NormalisedEvent): void {
    const kind = result.kinds[billingEventKind(e.type)];
    if (outcome === "applied") {
      result.applied += 1;
      kind.applied += 1;
    } else if (outcome === "duplicate") {
      result.duplicates += 1;
      kind.duplicates += 1;
    } else if (outcome === "in_progress") {
      // WR-E07: another process holds the event's claim and is applying it.
      result.duplicates += 1;
      kind.duplicates += 1;
    } else if (outcome === "ignored") result.ignored += 1;
    else result.failed += 1;
  }

  function seen(e: NormalisedEvent): void {
    result.kinds[billingEventKind(e.type)].read += 1;
  }

  async function run(e: NormalisedEvent): Promise<void> {
    if (dryRun) {
      result.planned.push({ type: e.type, ref: refOf(e) });
      result.kinds[billingEventKind(e.type)].applied += 1;
      return;
    }
    tally((await processNormalisedEvent(e, processDeps)).outcome, e);
  }

  const since = await windowStart(now, opts.since);
  result.since = since.toISOString();

  // 1. CDS objects changed in the window (PAY-02, D244).
  await step("cds-objects", async () => {
    const events = await billing().reconcile({ since });
    result.eventsSeen += events.length;
    for (const e of events) {
      seen(e);
      await run(e);
    }
  });

  // 2. Every Connect account, event or not (PAY-03).
  await step("connect", async () => {
    const stored = await storedAccounts();
    result.accountsChecked = stored.length;
    if (stored.length === 0) return;
    const byId = new Map(stored.map((s) => [s.accountId, s]));
    const gw = gateway();
    const events = await gw.reconcile({
      since,
      accountIds: stored.map((s) => s.accountId),
    });
    result.eventsSeen += events.length;
    for (const e of events) {
      seen(e);
      if (e.type !== "account.updated" && e.type !== "account.deauthorized") {
        await run(e);
        continue;
      }
      const row = byId.get(e.accountId);
      if (row) {
        const unchanged =
          e.type === "account.deauthorized"
            ? row.status === "disconnected"
            : await gw
                .accountStatus(e.accountId)
                .then(
                  (a) =>
                    a.status === row.status &&
                    a.chargesEnabled === row.chargesEnabled &&
                    a.detailsSubmitted === row.detailsSubmitted,
                );
        if (unchanged) {
          // Choice 5: nothing to apply, so no ledger row either.
          result.duplicates += 1;
          result.kinds.account.duplicates += 1;
          continue;
        }
      }
      // A change: one ledger row per run that sees it, so a repeated stop is caught.
      await run({ ...e, id: `${e.id}:${now.toISOString()}` });
    }
  });

  // 3. Failed ledger rows (Pitfall 1).
  await step("failed-events", async () => {
    if (dryRun) {
      const rows = await failedEvents(RETRY_LIMIT);
      result.retried = rows.length;
      for (const r of rows) {
        result.planned.push({ type: `retry ${r.type}`, ref: r.eventId });
      }
      return;
    }
    const r = await retryFailedEvents(processDeps, RETRY_LIMIT);
    result.retried = r.retried;
    result.applied += r.applied;
    result.failed += r.failed;
  });

  // 4. Backlog and restricted accounts (monitor check 27).
  await step("metrics", async () => {
    result.backlog = await eventBacklog(BACKLOG_MINUTES);
    result.restricted = await countRows("gateway_accounts", RESTRICTED_FILTER);
  });

  if (!dryRun) {
    const write = deps.writeMeta ?? writePlatformMeta;
    if (result.failedSteps.length === 0) {
      await write(ctx, BILLING_HEARTBEAT_KEY, now.toISOString());
    }
    // Counts only (T-10-21-03): `planned` carries object refs and is left out.
    await write(ctx, BILLING_COUNTS_KEY, JSON.stringify(billingCounts(result)));
  }
  return result;
}

/** The result without `planned` or `kinds`: what the counts key and the job route carry. */
export function billingCounts(
  result: BillingJobResult,
): Omit<BillingJobResult, "planned" | "kinds"> {
  const counts: Partial<BillingJobResult> = { ...result };
  delete counts.planned;
  delete counts.kinds;
  return counts as Omit<BillingJobResult, "planned" | "kinds">;
}

/** Run the billing reconcile once, serialised with any concurrent run in this process. */
export async function runBillingJob(
  opts: BillingJobOptions = {},
  deps: BillingJobDeps = {},
): Promise<BillingJobResult> {
  return withJobLock(() => runOnce(opts, deps));
}

// ------------------------------------------------------------------ monitor status
export type BillingStatusReport = {
  /** ISO time of the last run with no failed step, or null when it never ran clean. */
  last_success: string | null;
  /** Ledger rows unprocessed for more than 15 minutes. */
  backlog: number;
  /** Ledger rows whose last attempt failed and that are still unprocessed. */
  failed_events: number;
  /** Connect accounts not connected after having been connected. */
  restricted_accounts: number;
  payments_mode: "fake" | "stripe";
};

/**
 * The billing job's monitor view (monitor brief check 27, `jobs.billing`; D174, D175).
 * Counts only: never an org id, name or account id (T-10-21-03).
 */
export async function billingStatus(): Promise<BillingStatusReport> {
  const last = await readPlatformMeta(BILLING_HEARTBEAT_KEY);
  return {
    last_success: last || null,
    backlog: await eventBacklog(BACKLOG_MINUTES),
    failed_events: await countRows("payment_events", FAILED_FILTER),
    restricted_accounts: await countRows("gateway_accounts", RESTRICTED_FILTER),
    payments_mode: paymentsMode(),
  };
}
