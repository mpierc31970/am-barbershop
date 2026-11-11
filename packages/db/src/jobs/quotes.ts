// The hourly quote job (ONB-08, D213, D290; CONTEXT A1-Q2; RESEARCH Pattern 8). Idempotent,
// safe to run every hour, and cheap when nothing is due. One run does, in order:
//
//   1. Reminders (the first marketing email, EMAIL-01). Reminder 1 at >= saved_at + 24 h,
//      reminder 2 ("This is the last reminder.") at >= saved_at + 72 h, only for live saved
//      quotes. Both candidate lists are read BEFORE any claim, so one run never sends both.
//      Each reminder is CLAIMED first (reminders_sent / last_reminder_at), then sent: at most
//      once. A failed send is counted into the heartbeat and never retried (marketing).
//      Suppression (unsubscribe) is checked inside sendEmail (canSend, D138).
//      PD-9: a quote changed within the last 12 h is skipped; a later hourly run picks it up.
//   2. Purge drafts untouched for 30 days (they never had an email; nothing to keep).
//   3. Flip saved/draft quotes past expires_at to expired.
//   4. Purge expired/blocked quotes 90 days after expiry. Submitted quotes are never purged.
//   5. Delete unverified, non-staff users older than 24 h with no membership (Submit step A
//      orphans; 06-08 sets verified=true after a good code, so a real member is never hit).
//   6. Move on any org at intake whose intake was already sent (R2-WR-01: an approve that
//      raced a Send in another process), to ready_for_build.
//
// Concurrency: an in-process mutex (members.ts precedent; one app instance at this scale), so
// two triggers never interleave. Heartbeat: platform_meta HEARTBEAT_KEY (ISO) and
// `job:quotes:last_counts` (JSON of QuoteJobResult). The monitor brief
// (.planning/design/MONITOR-APP-BRIEF.md, D174, D175) documents both; change them together.
// Every filter is bound through pb.filter, never interpolated.
import { PATHS } from "@cds/core/onboarding";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertSystemContext,
  mintSystemContext,
  type SystemContext,
} from "../context";
import { sendEmail } from "../email/send";
import { reconcileSentOrgs } from "../fit";
import type { EmailTransport } from "../email/transport";
import { writePlatformMeta } from "../platform-meta";
import {
  quoteSignedReopenLink,
  quoteUnsubscribeLink,
  quoteUnsubscribePostUrl,
} from "../quotes";

export type QuoteJobResult = {
  reminded1: number;
  reminded2: number;
  skippedActive: number;
  suppressed: number;
  sendFailures: number;
  expired: number;
  purgedDrafts: number;
  purgedLeads: number;
  purgedUsers: number;
  /** R2-WR-01: orgs moved on from intake whose intake was already sent. */
  reconciled: number;
};

export type QuoteJobOptions = { now?: Date; transport?: EmailTransport };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** PD-9: a quote changed this recently belongs to an active visitor; remind later. */
export const QUOTE_ACTIVE_MS = 12 * HOUR;
const REMINDER_1_MS = 1 * DAY;
const REMINDER_2_MS = 3 * DAY;
const DRAFT_TTL_MS = 30 * DAY;
const LEAD_RETENTION_MS = 90 * DAY;
const ORPHAN_USER_MS = 1 * DAY;

const HEARTBEAT_KEY = "job:quotes:last_success";
const COUNTS_KEY = "job:quotes:last_counts";

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
function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function pathLabel(path: unknown): string {
  return PATHS.find((p) => p.id === path)?.label ?? String(path ?? "");
}

async function listQuotes(
  filter: string,
  params: Record<string, unknown>,
): Promise<RecordModel[]> {
  return withSuperuser((pb) =>
    pb.collection("quotes").getFullList({
      filter: pb.filter(filter, params),
      sort: "saved_at",
    }),
  );
}

function logFailure(what: string, id: string, err: unknown): void {
  // Ids only: never an email address.
  console.error(
    `[quote-job] ${what} failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

async function remind(
  ctx: SystemContext,
  row: RecordModel,
  day: 1 | 3,
  now: Date,
  transport: EmailTransport | undefined,
  result: QuoteJobResult,
): Promise<void> {
  const updated = toDate(row.updated);
  if (updated && now.getTime() - updated.getTime() < QUOTE_ACTIVE_MS) {
    result.skippedActive += 1;
    return;
  }
  const expiresAt = toDate(row.expires_at);
  if (!expiresAt) return;
  // Claim first: at most once, whatever the send does.
  await withSuperuser((pb) =>
    pb.collection("quotes").update(row.id, {
      reminders_sent: day === 1 ? 1 : 2,
      last_reminder_at: now.toISOString(),
    }),
  );
  try {
    const sent = await sendEmail(
      { kind: "cds", ctx },
      "quote.reminder",
      String(row.email),
      {
        day,
        pathLabel: pathLabel(row.path),
        expiresAt,
        link: quoteSignedReopenLink(row.id, expiresAt),
        unsubscribeLink: quoteUnsubscribeLink(row.id, expiresAt),
        unsubscribePostUrl: quoteUnsubscribePostUrl(row.id, expiresAt),
      },
      { transport, now },
    );
    if (sent.status === "suppressed") {
      result.suppressed += 1;
    } else if (day === 1) {
      result.reminded1 += 1;
    } else {
      result.reminded2 += 1;
    }
  } catch (err) {
    result.sendFailures += 1;
    logFailure(`reminder ${day}`, row.id, err);
  }
}

async function deleteQuotes(rows: RecordModel[]): Promise<number> {
  let n = 0;
  for (const row of rows) {
    try {
      await withSuperuser((pb) => pb.collection("quotes").delete(row.id));
      n += 1;
    } catch (err) {
      logFailure("quote purge", row.id, err);
    }
  }
  return n;
}

/**
 * Delete Submit's pending users (pending_signup, still unverified after 24 h) that never got
 * a membership. Only signup rows carry the mark (A-WR-04): demoted staff, members removed
 * from their last org and hand-made users are never touched.
 */
async function purgeOrphanUsers(now: Date): Promise<number> {
  const cut = new Date(now.getTime() - ORPHAN_USER_MS);
  const users = await withSuperuser((pb) =>
    pb.collection("users").getFullList({
      filter: pb.filter(
        "pending_signup = true && verified = false && staff_role = '' && created <= {:cut}",
        { cut },
      ),
      fields: "id",
    }),
  );
  let n = 0;
  for (const u of users) {
    try {
      const members = await withSuperuser((pb) =>
        pb.collection("memberships").getList(1, 1, {
          filter: pb.filter("user = {:u}", { u: u.id }),
          fields: "id",
        }),
      );
      if (members.totalItems > 0) continue;
      await withSuperuser((pb) => pb.collection("users").delete(u.id));
      n += 1;
    } catch (err) {
      logFailure("orphan user purge", u.id, err);
    }
  }
  return n;
}

async function runOnce(opts: QuoteJobOptions): Promise<QuoteJobResult> {
  const ctx = mintSystemContext({ job: "quotes" });
  assertSystemContext(ctx);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const result: QuoteJobResult = {
    reminded1: 0,
    reminded2: 0,
    skippedActive: 0,
    suppressed: 0,
    sendFailures: 0,
    expired: 0,
    purgedDrafts: 0,
    purgedLeads: 0,
    purgedUsers: 0,
    reconciled: 0,
  };

  // 1. Reminders: read both lists before any claim.
  const due1 = await listQuotes(
    "status = 'saved' && email != '' && reminders_sent = 0 && saved_at != '' && saved_at <= {:cut} && expires_at > {:now}",
    { cut: new Date(now.getTime() - REMINDER_1_MS), now },
  );
  const due2 = await listQuotes(
    "status = 'saved' && email != '' && reminders_sent = 1 && saved_at != '' && saved_at <= {:cut} && expires_at > {:now}",
    { cut: new Date(now.getTime() - REMINDER_2_MS), now },
  );
  for (const row of due1) {
    await remind(ctx, row, 1, now, opts.transport, result);
  }
  for (const row of due2) {
    await remind(ctx, row, 3, now, opts.transport, result);
  }

  // 2. Drafts untouched for 30 days.
  result.purgedDrafts = await deleteQuotes(
    await listQuotes("status = 'draft' && updated <= {:cut}", {
      cut: new Date(now.getTime() - DRAFT_TTL_MS),
    }),
  );

  // 3. Past expiry -> expired.
  const lapsed = await listQuotes(
    "(status = 'saved' || status = 'draft') && expires_at != '' && expires_at <= {:now}",
    { now },
  );
  for (const row of lapsed) {
    try {
      await withSuperuser((pb) =>
        pb.collection("quotes").update(row.id, { status: "expired" }),
      );
      result.expired += 1;
    } catch (err) {
      logFailure("expiry", row.id, err);
    }
  }

  // 4. Expired / blocked leads, 90 days after expiry. Submitted rows are never touched.
  result.purgedLeads = await deleteQuotes(
    await listQuotes(
      "(status = 'expired' || status = 'blocked') && expires_at != '' && expires_at <= {:cut}",
      { cut: new Date(now.getTime() - LEAD_RETENTION_MS) },
    ),
  );

  // 5. Orphan pending users.
  result.purgedUsers = await purgeOrphanUsers(now);

  // 6. R2-WR-01: an approve that raced a Send (or whose reconcile failed) left an org at
  //    intake with its intake sent; move it on to ready_for_build.
  result.reconciled = await reconcileSentOrgs(ctx);

  // Heartbeat (monitor brief section 3).
  await writePlatformMeta(ctx, HEARTBEAT_KEY, now.toISOString());
  await writePlatformMeta(ctx, COUNTS_KEY, JSON.stringify(result));
  return result;
}

/** Run the quote job once, serialised with any concurrent run in this process. */
export async function runQuoteJobs(
  opts: QuoteJobOptions = {},
): Promise<QuoteJobResult> {
  return withJobLock(() => runOnce(opts));
}
