// P10 payments: the webhook event ledger (PAY-01, CONTEXT A1, RESEARCH Pattern 1).
//
// Every event, from a Stripe webhook, the fake adapter or reconcile, is claimed here before
// any handler runs. The unique (provider, event_id) index means a replay finds the same row;
// a row counts as done only once `processed_at` is set, so a handler that crashed after the
// claim is retried instead of skipped (RESEARCH Pitfall 1).
//
// Ids only (T-10-09-04): provider, event id, type, account, org ref and the provider object
// id. Never a payload; a failure stores the error name + message capped at 300 chars.
// Platform collection: no org context, superuser client through the chokepoint (invariant 1).
import type {
  NormalisedEvent,
  NormalisedEventType,
  PaymentProvider,
} from "@cds/core/payments";
import { randomBytes } from "node:crypto";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";

const COLLECTION = "payment_events";
const ERROR_MAX = 300;
/**
 * WR-E07 / WR-A06: how long a claim holds. A handler finishes in seconds; a claim older than
 * this belongs to a process that died, and the event may be taken again.
 */
export const CLAIM_LEASE_MS = 5 * 60_000;

export type LedgerOutcome = "applied" | "ignored" | "failed";

export type ClaimInput = {
  provider: PaymentProvider;
  eventId: string;
  type: NormalisedEventType;
  account: string | null;
  orgRef: string | null;
  /** The provider object the event points at (session, invoice, subscription …). */
  objectRef?: string | null;
};

export type ClaimResult = {
  id: string;
  processed: boolean;
  attempts: number;
  /** Another process holds a fresh claim: do not run the handler now (retry later). */
  inProgress: boolean;
};

export type LedgerRow = {
  id: string;
  provider: PaymentProvider;
  eventId: string;
  type: NormalisedEventType;
  account: string | null;
  orgRef: string | null;
  objectRef: string | null;
  receivedAt: string;
  processedAt: string | null;
  outcome: LedgerOutcome | null;
  attempts: number;
  error: string;
  claimedAt: string | null;
  claimId: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toRow(r: RecordModel): LedgerRow {
  const outcome = str(r.outcome);
  return {
    id: r.id,
    provider: str(r.provider) as PaymentProvider,
    eventId: str(r.event_id),
    type: str(r.type) as NormalisedEventType,
    account: str(r.account) || null,
    orgRef: str(r.org_ref) || null,
    objectRef: str(r.object_ref) || null,
    receivedAt: str(r.received_at),
    processedAt: str(r.processed_at) || null,
    outcome: outcome ? (outcome as LedgerOutcome) : null,
    attempts: typeof r.attempts === "number" ? r.attempts : 0,
    error: str(r.error),
    claimedAt: str(r.claimed_at) || null,
    claimId: str(r.claim_id),
  };
}

function newClaimId(): string {
  return randomBytes(12).toString("hex");
}

/** A claim still inside its lease (taken less than CLAIM_LEASE_MS ago). */
function freshClaim(row: LedgerRow, now: number): boolean {
  if (!row.claimedAt) return false;
  const at = new Date(row.claimedAt).getTime();
  return !Number.isNaN(at) && now - at < CLAIM_LEASE_MS;
}

function cap(s: string | null, max: number): string {
  return (s ?? "").slice(0, max);
}

/** "Name: message", at most 300 chars. Never a stack, never a payload. */
export function ledgerError(err: unknown): string {
  if (err instanceof Error) {
    return cap(`${err.name}: ${err.message}`, ERROR_MAX);
  }
  return cap(typeof err === "string" ? err : "Unknown error", ERROR_MAX);
}

/** The provider object id an event points at (stored as `object_ref`). */
export function objectRefOf(e: NormalisedEvent): string {
  switch (e.type) {
    case "checkout.completed":
    case "checkout.expired":
      return e.sessionId;
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
    case "invoice.voided":
      return e.invoiceId;
    case "subscription.updated":
    case "subscription.deleted":
    case "subscription.pending_update_applied":
    case "subscription.pending_update_expired":
      return e.subscriptionId;
    case "account.updated":
    case "account.deauthorized":
      return e.accountId;
    case "charge.refunded":
      return e.customerId;
    case "ignored":
      return e.originalType;
  }
}

/** Rebuilds the normalised event a ledger row recorded (the retry sweep). */
export function eventFromRow(row: LedgerRow): NormalisedEvent {
  const base = {
    id: row.eventId,
    provider: row.provider,
    account: row.account,
    orgId: row.orgRef,
    createdAt: row.receivedAt,
  };
  const ref = row.objectRef ?? "";
  switch (row.type) {
    case "checkout.completed":
    case "checkout.expired":
      return { ...base, type: row.type, sessionId: ref };
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
    case "invoice.voided":
      return { ...base, type: row.type, invoiceId: ref };
    case "subscription.updated":
    case "subscription.deleted":
    case "subscription.pending_update_applied":
    case "subscription.pending_update_expired":
      return { ...base, type: row.type, subscriptionId: ref };
    case "account.updated":
    case "account.deauthorized":
      return { ...base, type: row.type, accountId: ref };
    case "charge.refunded":
      return { ...base, type: row.type, customerId: ref };
    default:
      return { ...base, type: "ignored", originalType: ref || row.type };
  }
}

/**
 * Claim one event: create its ledger row, or find the existing one when the unique
 * (provider, event_id) index says it was seen before. `processed` reflects the stored
 * `processed_at`, so an earlier failure is claimable again.
 *
 * WR-E07 / WR-A06: a claim is a lease shared across processes (`claimed_at`, `claim_id`).
 * An unprocessed row with a fresh claim from someone else is `inProgress`: the caller must
 * not run the handler (a webhook answers 500 so Stripe retries later). A stale or released
 * claim is taken over by writing our claim id and reading it back; whoever's id is stored
 * runs the handler.
 */
export async function claimEvent(input: ClaimInput): Promise<ClaimResult> {
  if (!input.eventId) throw new Error("claimEvent needs an event id");
  const claimId = newClaimId();
  return withSuperuser(async (pb) => {
    const find = () =>
      pb.collection(COLLECTION).getFirstListItem(
        pb.filter("provider = {:p} && event_id = {:e}", {
          p: input.provider,
          e: input.eventId,
        }),
      );
    try {
      const now = new Date().toISOString();
      const created = await pb.collection(COLLECTION).create({
        provider: input.provider,
        event_id: cap(input.eventId, 255),
        type: cap(input.type, 100),
        account: cap(input.account, 255),
        org_ref: cap(input.orgRef, 32),
        object_ref: cap(input.objectRef ?? null, 255),
        received_at: now,
        attempts: 0,
        claimed_at: now,
        claim_id: claimId,
      });
      return {
        id: created.id,
        processed: false,
        attempts: 0,
        inProgress: false,
      };
    } catch (err) {
      if (!(err instanceof ClientResponseError) || err.status !== 400) {
        throw err;
      }
      // Unique-index violation: the event was claimed before (a replay or a retry).
      let existing: RecordModel;
      try {
        existing = await find();
      } catch {
        throw err;
      }
      const row = toRow(existing);
      const base = { id: row.id, attempts: row.attempts };
      if (row.processedAt !== null) {
        return { ...base, processed: true, inProgress: false };
      }
      if (freshClaim(row, Date.now())) {
        return { ...base, processed: false, inProgress: true };
      }
      // Take the stale (or released) claim over, then read back whose it is.
      await pb.collection(COLLECTION).update(row.id, {
        claimed_at: new Date().toISOString(),
        claim_id: claimId,
      });
      const after = toRow(await pb.collection(COLLECTION).getOne(row.id));
      if (after.processedAt !== null) {
        return { ...base, processed: true, inProgress: false };
      }
      return {
        ...base,
        processed: false,
        inProgress: after.claimId !== claimId,
      };
    }
  });
}

/**
 * Record a handler's outcome. `applied` / `ignored` set `processed_at`; `failed` leaves
 * `processed_at` empty (retried by the sweep and by the provider), counts the attempt and
 * stores a capped error.
 */
export async function completeEvent(
  id: string,
  outcome: LedgerOutcome,
  error?: unknown,
): Promise<void> {
  await withSuperuser(async (pb) => {
    if (outcome === "failed") {
      // The claim is released: the sweep or a redelivery may take it at once.
      await pb.collection(COLLECTION).update(id, {
        outcome: "failed",
        processed_at: "",
        "attempts+": 1,
        error: ledgerError(error),
        claimed_at: "",
      });
      return;
    }
    await pb.collection(COLLECTION).update(id, {
      outcome,
      processed_at: new Date().toISOString(),
      error: "",
    });
  });
}

/**
 * Rows to run again, oldest first: the last attempt failed, or (WR-E07) a process claimed
 * the row and died before recording any outcome, so its lease has run out. Never a row whose
 * claim is still fresh.
 */
export async function failedEvents(limit: number): Promise<LedgerRow[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const stale = new Date(Date.now() - CLAIM_LEASE_MS);
  return withSuperuser(async (pb) => {
    const page = await pb.collection(COLLECTION).getList(1, n, {
      filter: pb.filter(
        'processed_at = "" && (outcome = "failed" || (outcome = "" && ((claimed_at != "" && claimed_at < {:s}) || (claimed_at = "" && received_at < {:s}))))',
        { s: stale },
      ),
      sort: "received_at",
      skipTotal: true,
    });
    return page.items.map(toRow);
  });
}

/** How many events were received at least `olderThanMinutes` ago and are still unprocessed. */
export async function eventBacklog(olderThanMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(0, olderThanMinutes) * 60_000);
  return withSuperuser(async (pb) => {
    const page = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter('processed_at = "" && received_at <= {:c}', {
        c: cutoff,
      }),
    });
    return page.totalItems;
  });
}

/** One ledger row by id (tests and staff tooling). */
export async function ledgerRow(id: string): Promise<LedgerRow> {
  return withSuperuser(async (pb) =>
    toRow(await pb.collection(COLLECTION).getOne(id)),
  );
}
