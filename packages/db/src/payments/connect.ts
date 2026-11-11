// P10 payments: tenant Connect (Standard) onboarding and account status (BILL-06, PAY-03,
// PAY-10; CONTEXT A1; D51, D52, D146, D156, D256, D285, D296). PAY-10 / BILL-07: the tenant
// is the merchant of record; this module never accepts or sets any application fee.
//
// - `startStripeConnect` is owner only and refused under impersonation (`connect:write`,
//   TEN-15). The onboarding link is minted per request from the gateway and returned; it is
//   never stored, logged or emailed (T-10-14-02). Return / refresh URLs come from
//   `platformUrl()` only, never from input.
// - `gateway_accounts` keeps the three stored statuses (connected / restricted /
//   disconnected); the screen state is derived (10-14 choice 1). The full account id never
//   leaves the server: views carry its last 4 characters only (choice 2).
// - `applyAccountState` is the one transition path for account events and the manual
//   re-check. Internal: the payments barrel re-exports the public names only.
import { NotFound, toBrowser } from "@cds/core";
import type { PaymentGateway, ProviderAccount } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { requirePermission } from "../repository";
import { BILLING_JOB, billingOrgContext, billingOwnerOf } from "./accounts";
import { paymentGatewayFor } from "./factory";
import { guardProviderIdWrite } from "./staff-alert";

const COLLECTION = "gateway_accounts";

/** Where Stripe sends the owner back after onboarding (10-14 choice 4). */
export const CONNECT_RETURN_PATH = "/hub/settings?tab=payments&connect=return";
/** A 10-25 route that mints a fresh onboarding link silently (links are single use). */
export const CONNECT_REFRESH_PATH = "/hub/settings/connect/refresh";
/** The Payments tab; the owner email links here, never to an onboarding link (T-10-14-02). */
const PAYMENTS_TAB_PATH = "/hub/settings?tab=payments";
/** UI-SPEC PAYMENT-PAUSED-SITE (D146, D156). */
export const PAYMENT_PAUSED_SITE_COPY =
  "Online payment is paused; you can still book and pay in person.";

export type ConnectState =
  | "not_connected"
  | "setup_unfinished"
  | "connected"
  | "restricted"
  | "disconnected";

export type ConnectStatusView = {
  state: ConnectState;
  displayName: string | null;
  /** Last 4 characters of the account id ("acct ending 4f2Q"); never the full id. */
  accountSuffix: string | null;
  chargesEnabled: boolean;
  checkedAt: string | null;
  wasConnected: boolean;
};

export type CanTakePayments =
  | { ok: true }
  | {
      ok: false;
      reason: Exclude<ConnectState, "connected">;
      message: string;
    };

type StoredStatus = ProviderAccount["status"];

/** Server-only row shape (carries the full account id). */
export type GatewayAccountRow = {
  id: string;
  organization: string;
  provider: string;
  accountId: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  displayName: string;
  status: StoredStatus;
  checkedAt: string | null;
  alertedStatus: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toStatus(v: unknown): StoredStatus {
  return v === "connected" || v === "disconnected" ? v : "restricted";
}

function toRow(r: RecordModel): GatewayAccountRow {
  const checked = str(r.checked_at);
  return {
    id: r.id,
    organization: str(r.organization),
    provider: str(r.provider),
    accountId: str(r.account_id),
    chargesEnabled: r.charges_enabled === true,
    detailsSubmitted: r.details_submitted === true,
    displayName: str(r.display_name),
    status: toStatus(r.status),
    checkedAt: checked === "" ? null : checked,
    alertedStatus: str(r.alerted_status),
  };
}

/** The org's gateway account (latest updated), or null. Internal. */
async function gatewayRecordByOrg(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "-updated,-id",
  });
  return res.items[0] ?? null;
}

export async function gatewayAccountByOrg(
  pb: PocketBase,
  orgId: string,
): Promise<GatewayAccountRow | null> {
  const r = await gatewayRecordByOrg(pb, orgId);
  return r ? toRow(r) : null;
}

/** The row for a provider account id (Connect events name the account), or null. Internal. */
export async function gatewayAccountById(
  pb: PocketBase,
  accountId: string,
): Promise<GatewayAccountRow | null> {
  if (accountId === "") return null;
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("account_id = {:a}", { a: accountId }),
    sort: "-updated,-id",
  });
  const r = res.items[0];
  return r ? toRow(r) : null;
}

/**
 * True once the account has been connected. `alerted_status` is the last state reported
 * (set to `connected` on first connection, then restricted / disconnected only after it),
 * so a non-empty value means the account was connected at some point.
 */
function wasConnectedOf(row: GatewayAccountRow): boolean {
  return row.status === "connected" || row.alertedStatus !== "";
}

function stateOf(row: GatewayAccountRow | null): ConnectState {
  if (!row) return "not_connected";
  if (row.status === "disconnected") return "disconnected";
  if (row.status === "connected" && row.chargesEnabled) return "connected";
  if (!row.detailsSubmitted) return "setup_unfinished";
  return "restricted";
}

function suffixOf(accountId: string): string | null {
  return accountId.length >= 4 ? accountId.slice(-4) : null;
}

/**
 * BILL-05: copied fields come from the browser-allowlisted projection of the record. The
 * derived ones (state, wasConnected, the masked 4-character suffix) read the full row and
 * never carry the account id or the alert state themselves.
 */
function viewOf(record: RecordModel | null): ConnectStatusView {
  const row = record ? toRow(record) : null;
  const shown = record
    ? toRow(toBrowser(COLLECTION, record) as RecordModel)
    : null;
  return {
    state: stateOf(row),
    displayName: shown && shown.displayName !== "" ? shown.displayName : null,
    accountSuffix: row ? suffixOf(row.accountId) : null,
    chargesEnabled: shown?.status === "connected" && shown.chargesEnabled,
    checkedAt: shown?.checkedAt ?? null,
    wasConnected: row ? wasConnectedOf(row) : false,
  };
}

export type ApplyAccountDeps = {
  now: Date;
  transport?: EmailTransport;
  /** The member's context for a manual re-check; system runs use the billing job's. */
  auditCtx?: OrgContext;
};

/**
 * Write the provider's view of one account onto its row, with a `connect.status` audit row
 * in the same batch when the status changes. The caller holds `billing:<org>`.
 *
 * One alert per state change (10-14 choice 3): when an account that was once connected
 * becomes restricted or disconnected and `alerted_status` differs, `alerted_status` is set
 * in the same write, then staff get one `billing.staff_alert` and the owner one
 * "Finish setting up Stripe" email. A replay or a repeat update finds `alerted_status`
 * already equal and sends nothing. Back to connected sets `alerted_status` and sends no
 * owner email. A lost email is logged (org id and status only), never a failed event.
 */
export async function applyAccountState(
  pb: PocketBase,
  orgId: string,
  account: ProviderAccount,
  h: ApplyAccountDeps,
): Promise<{ from: StoredStatus; to: StoredStatus; alerted: boolean } | null> {
  const row = await gatewayAccountById(pb, account.accountId);
  if (!row || row.organization !== orgId) return null;
  const to: StoredStatus = account.status;
  const patch: Record<string, unknown> = {
    charges_enabled: account.chargesEnabled,
    details_submitted: account.detailsSubmitted,
    status: to,
    checked_at: h.now.toISOString(),
  };
  if (account.displayName !== null) patch.display_name = account.displayName;
  const alerted =
    (to === "restricted" || to === "disconnected") &&
    wasConnectedOf(row) &&
    row.alertedStatus !== to;
  if (to === "connected" || alerted) patch.alerted_status = to;
  const batch = pb.createBatch();
  batch.collection(COLLECTION).update(row.id, patch);
  if (row.status !== to) {
    const auditCtx = h.auditCtx ?? (await systemCtxFor(pb, orgId));
    batch.collection("audit_log").create(
      auditBody(auditCtx, {
        action: "connect.status",
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { from: row.status, to },
      }),
    );
  }
  await batch.send();
  if (alerted && (to === "restricted" || to === "disconnected")) {
    console.warn(`[payments] connect: org ${orgId} is ${to}`);
    await notifyStopped(pb, orgId, to, h.transport);
    // 11-21 (DASH-35): bell / push alert for the Owner and Admins. Key = the Owner's
    // Needs-you item (`billing:finish_stripe`), so it clears once Stripe is fixed. The owner
    // email above is the dedicated email. raiseAlert never throws.
    await raiseAlert(
      { orgId, as: mintSystemContext({ job: BILLING_JOB }) },
      {
        type: "payments.payouts_paused",
        sourceKey: "billing:finish_stripe",
        title:
          to === "restricted"
            ? "Stripe paused your payouts. Finish Stripe setup."
            : "Stripe is disconnected. Online payments are off.",
        safeTitle: "Stripe needs attention",
        href: "/hub/settings?tab=payments",
        actionLabel: "Finish Stripe setup",
      },
      { dedicatedEmail: true, now: h.now },
    );
  }
  return { from: row.status, to, alerted };
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

/** One staff alert and one owner email for a stop (restricted / disconnected). */
async function notifyStopped(
  pb: PocketBase,
  orgId: string,
  to: "restricted" | "disconnected",
  transport: EmailTransport | undefined,
): Promise<void> {
  const opts = transport ? { transport } : {};
  const sys = mintSystemContext({ job: BILLING_JOB });
  let orgName = "";
  try {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name" });
    orgName = str(org.name);
  } catch (err) {
    console.error(`[payments] connect: org ${orgId} name: ${errName(err)}`);
  }
  const staff = staffAlertAddress();
  if (!staff) {
    console.warn(`[payments] connect: no staff alert address (org ${orgId})`);
  } else {
    try {
      await sendEmail(
        { kind: "cds", ctx: sys },
        "billing.staff_alert",
        staff,
        {
          event:
            to === "restricted" ? "stripe_restricted" : "stripe_disconnected",
          orgName: orgName === "" ? orgId : orgName,
          orgId,
          detail:
            to === "restricted"
              ? "Stripe turned off charges on the tenant's account. Online payment is paused on their site."
              : "The tenant disconnected CDS from their Stripe account. Online payment is paused on their site.",
        },
        opts,
      );
    } catch (err) {
      console.error(
        `[payments] connect: staff alert for org ${orgId} (${to}) not sent: ${errName(err)}`,
      );
    }
  }
  try {
    const owner = await billingOwnerOf(pb, orgId);
    if (!owner || owner.email === "") {
      console.error(`[payments] connect: org ${orgId} has no owner email`);
      return;
    }
    await sendEmail(
      { kind: "cds", ctx: sys },
      "billing.stripe_setup",
      owner.email,
      {
        orgName,
        setupUrl: platformUrl(PAYMENTS_TAB_PATH),
      },
      opts,
    );
  } catch (err) {
    console.error(
      `[payments] connect: owner email for org ${orgId} (${to}) not sent: ${errName(err)}`,
    );
  }
}

async function systemCtxFor(
  pb: PocketBase,
  orgId: string,
): Promise<OrgContext> {
  const owner = await billingOwnerOf(pb, orgId);
  return billingOrgContext(orgId, owner?.id ?? "");
}

// ---------------------------------------------------------------------------------------
// Public (OrgContext first, invariant 1)

/**
 * Start (or resume) Stripe Connect onboarding for the org. Owner only, never under
 * impersonation. Returns the onboarding URL, which the caller redirects to and discards.
 */
export async function startStripeConnect(
  ctx: OrgContext,
  deps: { gateway?: PaymentGateway } = {},
): Promise<{ url: string }> {
  requirePermission(ctx, "connect", "write");
  const gateway = deps.gateway ?? (await paymentGatewayFor(ctx.orgId));
  return withOrgLock(`billing:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const existing = await gatewayAccountByOrg(pb, ctx.orgId);
      // WR-E02: a disconnected account can never be onboarded again; reconnecting makes a
      // new one, under a key tied to the account it replaces (never the first key).
      const reconnect = existing?.status === "disconnected";
      const started = await gateway.startConnect({
        orgId: ctx.orgId,
        accountId: reconnect ? null : (existing?.accountId ?? null),
        mode: existing && !reconnect ? "existing" : "new",
        returnUrl: platformUrl(CONNECT_RETURN_PATH),
        refreshUrl: platformUrl(CONNECT_REFRESH_PATH),
        idempotencyKey: reconnect
          ? `connect:${ctx.orgId}:account:after:${existing.accountId}`
          : `connect:${ctx.orgId}:account`,
      });
      const now = new Date().toISOString();
      const fresh = {
        provider: gateway.provider,
        account_id: started.accountId,
        charges_enabled: false,
        details_submitted: false,
        status: "restricted",
        checked_at: now,
      };
      const batch = pb.createBatch();
      let targetId: string;
      if (!existing) {
        targetId = randomId();
        batch
          .collection(COLLECTION)
          .create({ id: targetId, organization: ctx.orgId, ...fresh });
      } else {
        targetId = existing.id;
        if (existing.accountId !== started.accountId) {
          // The old account was disconnected; the gateway made a new one.
          batch.collection(COLLECTION).update(existing.id, fresh);
        }
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "connect.start",
          targetCollection: COLLECTION,
          targetId,
          meta: { provider: gateway.provider },
        }),
      );
      // WR-A01: an account id another org holds is refused, never shared.
      await guardProviderIdWrite(pb, ctx.orgId, "Connect account id", () =>
        batch.send(),
      );
      return { url: started.url };
    }),
  );
}

/**
 * WR-D02: a fresh onboarding link for the org's existing Connect account (Stripe's
 * `refresh_url` is a GET, so a cross-site navigation can reach it). Never creates or replaces
 * an account and writes nothing: with no account row, or a disconnected one, it throws
 * NotFound and the caller goes back to the Payments tab, where Connect is a deliberate POST.
 * Owner only, never under impersonation (`connect:write`).
 */
export async function refreshConnectLink(
  ctx: OrgContext,
  deps: { gateway?: PaymentGateway } = {},
): Promise<{ url: string }> {
  requirePermission(ctx, "connect", "write");
  const gateway = deps.gateway ?? (await paymentGatewayFor(ctx.orgId));
  const existing = await withSuperuser((pb) =>
    gatewayAccountByOrg(pb, ctx.orgId),
  );
  if (!existing || existing.status === "disconnected" || !existing.accountId) {
    throw new NotFound("No Stripe account to finish setting up.");
  }
  const started = await gateway.startConnect({
    orgId: ctx.orgId,
    accountId: existing.accountId,
    mode: "existing",
    returnUrl: platformUrl(CONNECT_RETURN_PATH),
    refreshUrl: platformUrl(CONNECT_REFRESH_PATH),
  });
  return { url: started.url };
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

/** The Payments tab's view of the org's account (owner and admin). */
export async function readConnectStatus(
  ctx: OrgContext,
): Promise<ConnectStatusView> {
  requirePermission(ctx, "connect", "read");
  const record = await withSuperuser((pb) => gatewayRecordByOrg(pb, ctx.orgId));
  return viewOf(record);
}

/** Manual re-check: ask the gateway for the account's state and apply it. */
export async function refreshConnectStatus(
  ctx: OrgContext,
  deps: {
    gateway?: PaymentGateway;
    transport?: EmailTransport;
    now?: Date;
  } = {},
): Promise<ConnectStatusView> {
  requirePermission(ctx, "connect", "read");
  const gateway = deps.gateway ?? (await paymentGatewayFor(ctx.orgId));
  return withOrgLock(`billing:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const row = await gatewayAccountByOrg(pb, ctx.orgId);
      if (!row) return viewOf(null);
      const account = await gateway.accountStatus(row.accountId);
      await applyAccountState(pb, ctx.orgId, account, {
        now: deps.now ?? new Date(),
        transport: deps.transport,
        auditCtx: ctx,
      });
      return viewOf(await gatewayRecordByOrg(pb, ctx.orgId));
    }),
  );
}

/**
 * Whether the org's site can take online payments now (PAY-03). Any role may ask; the
 * answer carries no account data. Tenants without an account use pay-in-person (D146).
 */
export async function canTakePayments(
  ctx: OrgContext,
): Promise<CanTakePayments> {
  assertOrgContext(ctx);
  const row = await withSuperuser((pb) => gatewayAccountByOrg(pb, ctx.orgId));
  const state = stateOf(row);
  if (state === "connected") return { ok: true };
  return { ok: false, reason: state, message: PAYMENT_PAUSED_SITE_COPY };
}

/**
 * P14 (14-39; LIFE-01, D282): the site left CDS. The org's Connect row becomes
 * `disconnected` (charges off, `alerted_status` set so no "Stripe is disconnected" mail goes
 * out), so CDS creates no more charges on it and checkout falls back to pay-in-person
 * (D146). The Stripe account is the tenant's and is never deleted. Audited
 * `connect.offboarded` (system). Internal: the payments barrel does not export it.
 */
export async function endConnectForOffboarding(
  orgId: string,
  opts: { now?: Date } = {},
): Promise<{ disconnected: boolean }> {
  const now = opts.now ?? new Date();
  return withSuperuser(async (pb) => {
    const row = await gatewayAccountByOrg(pb, orgId);
    if (!row || row.status === "disconnected") return { disconnected: false };
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(row.id, {
      status: "disconnected",
      charges_enabled: false,
      alerted_status: "disconnected",
      checked_at: now.toISOString(),
    });
    batch.collection("audit_log").create(
      auditBody(mintSystemContext({ job: "offboarding" }), {
        action: "connect.offboarded",
        organization: orgId,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { from: row.status },
      }),
    );
    await batch.send();
    return { disconnected: true };
  });
}
