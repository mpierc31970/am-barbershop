// P10 payments: the one event processor (PAY-01, CONTEXT A1, RESEARCH Pattern 1).
//
// Every event, from the CDS webhook, the Connect webhook, the fake adapter or reconcile,
// runs through processNormalisedEvent: claim the ledger row first, skip it if already
// processed (200 "duplicate", nothing changes), dispatch to the handler, record the outcome.
// A throwing handler leaves processed_at empty and answers 500 so Stripe retries; the
// reconcile job also calls retryFailedEvents (T-10-09-02).
//
// The processor only claims, dispatches and completes; handlers take their own per-org
// lock `billing:<org>` (10-09 choice 1). Logs carry provider, event id and type only, never
// a payload (T-10-09-04).
import {
  WebhookSignatureInvalid,
  type CdsBilling,
  type NormalisedEvent,
  type PaymentGateway,
} from "@cds/core/payments";
import type { AddonDeps } from "../addons/types";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import type { EmailTransport } from "../email/transport";
import { billingAccountByCustomer } from "./accounts";
import { gatewayAccountById } from "./connect";
import { getCdsBilling, getPaymentGateway } from "./factory";
import { HANDLERS, type HandlerMap } from "./handlers/index";
import {
  claimEvent,
  completeEvent,
  eventFromRow,
  failedEvents,
  objectRefOf,
} from "./ledger";

export type ProcessDeps = {
  billing?: CdsBilling;
  gateway?: PaymentGateway;
  handlers?: HandlerMap;
  now?: Date;
  transport?: EmailTransport;
  addons?: AddonDeps;
};

let addonDepsFactory: (() => AddonDeps) | null = null;

/**
 * The app registers its add-on deps factory once (apps/web/lib/addons.ts), so events that
 * arrive without explicit deps (fake emits, webhooks) can still install paid add-ons (10-12).
 */
export function registerPaymentAddonDeps(
  factory: (() => AddonDeps) | null,
): void {
  addonDepsFactory = factory;
}

function addonDepsFor(deps: ProcessDeps): AddonDeps | undefined {
  if (deps.addons) return deps.addons;
  return addonDepsFactory ? addonDepsFactory() : undefined;
}

export type ProcessOutcome =
  | "applied"
  | "ignored"
  | "failed"
  | "duplicate"
  /** WR-E07: another process holds the event's claim; nothing ran here. */
  | "in_progress";

export type ProcessResult = { status: 200 | 500; outcome: ProcessOutcome };

/**
 * What a webhook route answers. `orgId` is set only when the event was applied and its org
 * is known, so the route can revalidate that org's `org:<id>:addons` cache (10-24 choice 2).
 */
export type WebhookResult = { status: 200 | 400 | 500; orgId: string | null };

const RETRY_BATCH = 50;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function tag(e: NormalisedEvent): string {
  return `${e.provider} ${e.id} ${e.type}`;
}

async function dispatch(
  e: NormalisedEvent,
  deps: ProcessDeps,
): Promise<ProcessResult> {
  let claim;
  try {
    claim = await claimEvent({
      provider: e.provider,
      eventId: e.id,
      type: e.type,
      account: e.account,
      orgRef: e.orgId,
      objectRef: objectRefOf(e),
    });
  } catch (err) {
    console.error(`[payments] could not claim ${tag(e)}: ${errName(err)}`);
    return { status: 500, outcome: "failed" };
  }
  if (claim.processed) return { status: 200, outcome: "duplicate" };
  // Another instance (or the CLI beside the app) is running it now: 500 so Stripe
  // redelivers later, by when it is done (duplicate) or its claim is stale (taken over).
  if (claim.inProgress) return { status: 500, outcome: "in_progress" };

  const handler = (deps.handlers ?? HANDLERS)[e.type];
  try {
    if (!handler) {
      await completeEvent(claim.id, "ignored");
      return { status: 200, outcome: "ignored" };
    }
    const addons = addonDepsFor(deps);
    const outcome = await handler(e, {
      billing: deps.billing ?? getCdsBilling(),
      gateway: deps.gateway ?? getPaymentGateway(),
      now: deps.now ?? new Date(),
      ...(deps.transport ? { transport: deps.transport } : {}),
      ...(addons ? { addons } : {}),
    });
    await completeEvent(claim.id, outcome);
    return { status: 200, outcome };
  } catch (err) {
    console.error(`[payments] event ${tag(e)} failed: ${errName(err)}`);
    try {
      await completeEvent(claim.id, "failed", err);
    } catch (inner) {
      console.error(
        `[payments] could not record failure of ${tag(e)}: ${errName(inner)}`,
      );
    }
    return { status: 500, outcome: "failed" };
  }
}

/**
 * Process one normalised event idempotently. In-process deliveries of the same event are
 * serialised, so a concurrent replay sees the first one's outcome.
 */
export function processNormalisedEvent(
  e: NormalisedEvent,
  deps: ProcessDeps = {},
): Promise<ProcessResult> {
  return withOrgLock(`payment-event:${e.provider}:${e.id}`, () =>
    dispatch(e, deps),
  );
}

/**
 * The org an applied event changed: the event's own org, else the org owning the Connect
 * account, else the org holding the customer (charge.refunded). Null when unknown or the
 * lookup fails (a cache refresh is best effort; the 60 s cache catches up).
 */
async function orgOfEvent(e: NormalisedEvent): Promise<string | null> {
  if (e.orgId) return e.orgId;
  try {
    return await withSuperuser(async (pb) => {
      const accountId =
        "accountId" in e && typeof e.accountId === "string"
          ? e.accountId
          : (e.account ?? "");
      if (accountId !== "") {
        const row = await gatewayAccountById(pb, accountId);
        if (row) return row.organization;
      }
      if ("customerId" in e && typeof e.customerId === "string") {
        const acct = await billingAccountByCustomer(pb, e.customerId);
        if (acct) return acct.organization;
      }
      return null;
    });
  } catch (err) {
    console.error(
      `[payments] could not resolve org of ${tag(e)}: ${errName(err)}`,
    );
    return null;
  }
}

async function processWebhook(
  normalise: () => Promise<NormalisedEvent>,
  deps: ProcessDeps,
  source: string,
): Promise<WebhookResult> {
  let e: NormalisedEvent;
  try {
    e = await normalise();
  } catch (err) {
    if (err instanceof WebhookSignatureInvalid) {
      console.warn(`[payments] ${source} webhook rejected: bad signature`);
      return { status: 400, orgId: null };
    }
    console.error(
      `[payments] ${source} webhook could not be read: ${errName(err)}`,
    );
    return { status: 500, orgId: null };
  }
  const { status, outcome } = await processNormalisedEvent(e, deps);
  const orgId = outcome === "applied" ? await orgOfEvent(e) : null;
  return { status, orgId };
}

/** The CDS-account webhook (`/api/webhooks/stripe`): verify, normalise, process. */
export function processCdsWebhook(
  raw: string,
  signature: string,
  deps: ProcessDeps = {},
): Promise<WebhookResult> {
  return processWebhook(
    () => (deps.billing ?? getCdsBilling()).normaliseWebhook(raw, signature),
    deps,
    "cds",
  );
}

/** The Connect webhook (`/api/webhooks/stripe-connect`): verify, normalise, process. */
export function processConnectWebhook(
  raw: string,
  signature: string,
  deps: ProcessDeps = {},
): Promise<WebhookResult> {
  return processWebhook(
    () =>
      (deps.gateway ?? getPaymentGateway()).normaliseWebhook(raw, signature),
    deps,
    "connect",
  );
}

/** Run failed, unprocessed events again (the reconcile job's sweep). */
export async function retryFailedEvents(
  deps: ProcessDeps = {},
  limit: number = RETRY_BATCH,
): Promise<{ retried: number; applied: number; failed: number }> {
  const rows = await failedEvents(limit);
  let applied = 0;
  let failed = 0;
  for (const row of rows) {
    const r = await processNormalisedEvent(eventFromRow(row), deps);
    if (r.outcome === "failed") failed += 1;
    else if (r.outcome !== "in_progress") applied += 1;
  }
  return { retried: rows.length, applied, failed };
}
