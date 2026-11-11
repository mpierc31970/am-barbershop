// P10 payments: Super Admin decline of a paid customer within 5 business days, with refund
// (10-28; BILL-09; CONTEXT A4 "Decline-after-payment refund, money half"; D214; D-UI-P10-19,
// D-UI-P10-20; invariants 1, 9 and 10).
//
// One chokepoint: `declinePaidOrg(pctx, orgId, { reasonCategory, note })`. Platform context +
// `org_decline` (super_admin only, after the staff MFA sign-in; T-10-28-01). Refused, with
// nothing changed, when the org has not paid, is already declined or closed, was paid more
// than DECLINE_WINDOW_BUSINESS_DAYS business days ago (`withinDeclineWindow`), or build work
// has started (`organizations.build_started_at`; T-10-28-04).
//
// Order (choice 1; T-10-28-02), under withOrgLock(`billing:<org>`):
//   1. `billing_accounts.declined_at` = now (the subscription-cancel handler then skips the
//      remaining-installments invoice and the "add-ons paused" email, 10-15 choice 4),
//   2. `CdsBilling.refundAll` (every CDS charge on the customer, key `decline:<org>`),
//   3. `CdsBilling.cancel({ mode: "now" })` (key `decline:<org>:cancel`),
//   4. `markOrgClosed(pctx, org, "declined")` (P9: preview down, 30-day deletion by the
//      retention job, agreements and payment records kept),
//   5. audit `billing.decline` (category, note, refunded cents), then the `org.declined` email.
// A throw in 2 or 3 clears `declined_at`, audits `billing.decline_failed` and closes nothing;
// the provider idempotency keys make a retry safe.
//
// `readDeclinedNotice(ctx)` gives the hub's declined notice (UI-SPEC "Declined notice") its
// lines, scoped by ctx.orgId only (T-10-28-05). The reason, note and refund come from the
// `billing.decline` audit row, so no new schema field is needed. `markBuildStarted` is the
// audited setter P13's work tracker calls (choice 2).
import {
  authorizeStaff,
  can,
  InvalidInput,
  NotFound,
  type StaffRole,
} from "@cds/core";
import { CLOSED_ORG_DELETE_DAYS } from "@cds/core/legal";
import {
  addBusinessDays,
  BUSINESS_TIME_ZONE,
  DECLINE_WINDOW_BUSINESS_DAYS,
  withinDeclineWindow,
  type CdsBilling,
} from "@cds/core/payments";
import { formatCentsExact } from "@cds/core/pricing";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  assertPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { platformUrl } from "../email/env";
import { declineReasonSentence } from "../email/render/templates";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { agreementDownloadPath } from "../legal/signatures";
import { markOrgClosed } from "../org-closure";
import {
  billingAccountByOrg,
  billingOwnerOf,
  type BillingAccount,
} from "./accounts";
import { cardLineOf } from "./charge-shared";
import { getCdsBilling } from "./factory";
import {
  invoiceMirrorsOf,
  listBillingInvoices,
  type InvoiceMirror,
} from "./invoices";

export type DeclineReasonCategory = "fit" | "capacity" | "scope" | "other";
export const DECLINE_REASON_CATEGORIES: readonly DeclineReasonCategory[] =
  Object.freeze(["fit", "capacity", "scope", "other"]);
/** Choice 3: the `other` note is one sentence of at most 200 characters. */
export const DECLINE_NOTE_MAX = 200;

const ORG_RE = /^[a-z0-9]{15}$/;
const DAY_MS = 86_400_000;
const AUDIT_DECLINE = "billing.decline";
const BUSINESS_DAYS_CAP = 400;

export type DeclineDeps = {
  billing?: CdsBilling;
  now?: () => Date;
  transport?: EmailTransport;
};

export type DeclineCase = {
  orgId: string;
  orgName: string;
  /** ISO, or null when the org never paid. */
  paidAt: string | null;
  /** Whole business days since paid_at (business time zone); 0 when unpaid. */
  businessDaysSince: number;
  /** ISO, or null when build work has not started. */
  buildStartedAt: string | null;
  /** Paid, not yet refunded, across the org's mirrored invoices (integer cents). */
  refundableCents: number;
  /** How many invoices that is. */
  invoices: number;
  /** The exact "Refused: …" line, or null when the decline may go ahead. */
  refusal: string | null;
  /**
   * WR-E08: an earlier decline started (declined_at set) but did not finish closing the
   * site. Running it again resumes: steps already done are not repeated.
   */
  resuming: boolean;
};

export type DeclineInput = {
  reasonCategory: DeclineReasonCategory;
  note: string | null;
};

export type DeclineResult = {
  refundedCents: number;
  /** "8 Nov 2026": closed_at + CLOSED_ORG_DELETE_DAYS (choice 4). */
  deleteOn: string;
  emailed: boolean;
};

export type DeclinedNotice = {
  /** "$1,539.00" (DECLINED-BODY's {amount}; 10-32). */
  refundedAmount: string;
  /** "$1,539.00 to Visa ending 4242 on 9 Oct 2026" */
  refundedLabel: string;
  /** "8 Nov 2026" */
  deleteOnLabel: string;
  reasonSentence: string;
  /** Owner and Admin only (agreements:read); null otherwise or with no signature. */
  agreementHref: string | null;
  /** Owner only (billing:read); [] for everyone else. */
  invoices: InvoiceMirror[];
};

/** Audit action recording what a decline has refunded so far (WR-E08). */
const AUDIT_DECLINE_PARTIAL = "billing.decline_partial";

/**
 * WR-E08: a decline that stopped part way. The site is not closed yet; money may already be
 * refunded. Run the same decline again to finish it (it resumes; nothing is repeated).
 */
export class DeclineIncomplete extends Error {
  readonly step: string;
  constructor(step: string, cause: unknown) {
    super(
      `Decline stopped at the ${step} step (${cause instanceof Error ? cause.message : "error"}). Run it again to finish; nothing done so far is repeated.`,
    );
    this.name = "DeclineIncomplete";
    this.step = step;
  }
}

/** What earlier, unfinished runs of this decline refunded (their latest record). */
async function refundedSoFar(pb: PocketBase, orgId: string): Promise<number> {
  const res = await pb.collection("audit_log").getList(1, 1, {
    filter: pb.filter("organization = {:org} && action = {:action}", {
      org: orgId,
      action: AUDIT_DECLINE_PARTIAL,
    }),
    sort: "-created,-id",
    fields: "meta",
  });
  const meta = (res.items[0]?.meta ?? {}) as Record<string, unknown>;
  const cents = meta.refundedCents;
  return typeof cents === "number" && Number.isSafeInteger(cents) ? cents : 0;
}

/** A refusal: nothing changed. The message is the full UI-SPEC "Refused: …" line. */
export class DeclineRefused extends InvalidInput {
  constructor(message: string) {
    super(message);
    this.name = "DeclineRefused";
  }
}

const LONG_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
});

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "8 Nov 2026" in the business time zone. */
export function declineDay(d: Date): string {
  return LONG_DAY.format(d);
}

function staff(pctx: PlatformContext, feature: string): void {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole as StaffRole, feature);
}

function checkOrgId(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== "string" || !ORG_RE.test(orgId)) {
    throw new InvalidInput("invalid organization id");
  }
}

/** Whole business days from paidAt to now: n where addBusinessDays(paidAt, n) <= now. */
export function businessDaysSince(paidAt: Date, now: Date): number {
  let n = 0;
  while (
    n < BUSINESS_DAYS_CAP &&
    addBusinessDays(paidAt, n + 1).getTime() <= now.getTime()
  ) {
    n += 1;
  }
  return n;
}

async function orgRow(pb: PocketBase, orgId: string): Promise<RecordModel> {
  const res = await pb.collection("organizations").getList(1, 1, {
    filter: pb.filter("id = {:id}", { id: orgId }),
    fields: "id,name,closed_reason,closed_at,build_started_at",
  });
  const r = res.items[0];
  if (!r) throw new NotFound();
  return r;
}

type CaseState = {
  org: RecordModel;
  account: BillingAccount | null;
  c: DeclineCase;
};

function refusalFor(
  org: RecordModel,
  account: BillingAccount | null,
  paidAt: Date | null,
  buildStarted: Date | null,
  now: Date,
): string | null {
  // WR-E08: started but never closed -> resumable, whatever the window says now.
  if (account?.declinedAt && String(org.closed_reason ?? "") === "")
    return null;
  if (account?.declinedAt || org.closed_reason === "declined") {
    const at = toDate(account?.declinedAt ?? org.closed_at);
    return `Refused: this site was already declined${at ? ` on ${DAY_MONTH.format(at)}` : ""}.`;
  }
  if (String(org.closed_reason ?? "") !== "") {
    return "Refused: this site is already closed.";
  }
  if (!account || !paidAt) return "Refused: this site hasn't paid yet.";
  if (buildStarted) {
    return `Refused: build work started on ${DAY_MONTH.format(buildStarted)}.`;
  }
  if (!withinDeclineWindow(paidAt, now)) {
    const days = businessDaysSince(paidAt, now);
    return `Refused: paid ${days} business day${days === 1 ? "" : "s"} ago (limit ${DECLINE_WINDOW_BUSINESS_DAYS}).`;
  }
  return null;
}

async function loadCase(
  pb: PocketBase,
  orgId: string,
  now: Date,
): Promise<CaseState> {
  const org = await orgRow(pb, orgId);
  const account = await billingAccountByOrg(pb, orgId);
  const paidAt = toDate(account?.paidAt);
  const buildStarted = toDate(org.build_started_at);
  const paid = (await invoiceMirrorsOf(pb, orgId)).filter(
    (i) => i.status === "paid" && i.amountCents - i.refundedCents > 0,
  );
  return {
    org,
    account,
    c: {
      orgId,
      orgName: String(org.name ?? ""),
      paidAt: paidAt?.toISOString() ?? null,
      businessDaysSince: paidAt ? businessDaysSince(paidAt, now) : 0,
      buildStartedAt: buildStarted?.toISOString() ?? null,
      refundableCents: paid.reduce(
        (n, i) => n + (i.amountCents - i.refundedCents),
        0,
      ),
      invoices: paid.length,
      refusal: refusalFor(org, account, paidAt, buildStarted, now),
      resuming:
        account?.declinedAt != null && String(org.closed_reason ?? "") === "",
    },
  };
}

/** Staff: the case the CLI prints before confirming (org_decline). Changes nothing. */
export async function declineCase(
  pctx: PlatformContext,
  orgId: string,
  deps: Pick<DeclineDeps, "now"> = {},
): Promise<DeclineCase> {
  staff(pctx, "org_decline");
  checkOrgId(orgId);
  const now = (deps.now ?? (() => new Date()))();
  return withSuperuser(async (pb) => (await loadCase(pb, orgId, now)).c);
}

function validInput(input: DeclineInput): {
  category: DeclineReasonCategory;
  note: string | null;
} {
  const category = input?.reasonCategory;
  if (!(DECLINE_REASON_CATEGORIES as readonly string[]).includes(category)) {
    throw new InvalidInput(
      "reason category must be fit, capacity, scope or other",
    );
  }
  const raw = typeof input.note === "string" ? input.note.trim() : "";
  if (raw.length > DECLINE_NOTE_MAX) {
    throw new InvalidInput(
      `note must be at most ${DECLINE_NOTE_MAX} characters`,
    );
  }
  if (/[\r\n]/.test(raw)) throw new InvalidInput("note must be one sentence");
  if (category === "other" && raw === "") {
    throw new InvalidInput("reason category other needs a note");
  }
  return { category, note: raw === "" ? null : raw };
}

async function setDeclinedAt(
  pb: PocketBase,
  accountId: string,
  value: string,
): Promise<void> {
  await pb.collection("billing_accounts").update(accountId, {
    declined_at: value,
  });
}

/** The org's newest signature id, or null. */
async function newestSignatureId(
  pb: PocketBase,
  orgId: string,
): Promise<string | null> {
  const res = await pb.collection("agreement_signatures").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "-signed_at,-id",
    fields: "id",
  });
  return res.items[0]?.id ?? null;
}

/**
 * Staff (super_admin): refund every CDS charge, cancel the subscription and remaining
 * installments, close the org as declined and email the owner (BILL-09, D214). Throws
 * DeclineRefused (nothing changed) per the module header.
 */
export async function declinePaidOrg(
  pctx: PlatformContext,
  orgId: string,
  input: DeclineInput,
  deps: DeclineDeps = {},
): Promise<DeclineResult> {
  staff(pctx, "org_decline");
  checkOrgId(orgId);
  const { category, note } = validInput(input);
  const nowOf = deps.now ?? (() => new Date());

  const done = await withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const now = nowOf();
      const { account, c } = await loadCase(pb, orgId, now);
      if (c.refusal || !account) {
        throw new DeclineRefused(
          c.refusal ?? "Refused: this site hasn't paid yet.",
        );
      }
      const billing = deps.billing ?? getCdsBilling();
      // WR-E08: declined_at is the "decline in progress" marker and is never rolled back:
      // money may already have left. A failed step is audited and the run can be repeated;
      // a repeat resumes (refusalFor), and every provider step is idempotent by state.
      const resuming = c.resuming;
      if (!resuming) await setDeclinedAt(pb, account.id, now.toISOString());
      const earlier = resuming ? await refundedSoFar(pb, orgId) : 0;
      let step = "refund";
      let refunded = { refundedCents: earlier, count: 0 };
      let closedAt = "";
      try {
        if (account.customerId !== "") {
          const r = await billing.refundAll({
            customerId: account.customerId,
            idempotencyKey: `decline:${orgId}`,
          });
          refunded = {
            refundedCents: earlier + r.refundedCents,
            count: r.count,
          };
        }
        if (refunded.refundedCents > earlier || !resuming) {
          // What has been refunded so far, so a resumed run reports the full amount.
          await pb.collection("audit_log").create(
            auditBody(pctx, {
              action: AUDIT_DECLINE_PARTIAL,
              organization: orgId,
              targetCollection: "billing_accounts",
              targetId: account.id,
              meta: { category, refundedCents: refunded.refundedCents },
            }),
          );
        }
        step = "cancel";
        // A resumed run whose cancel already went through does not cancel twice.
        const live =
          account.subscriptionId !== "" &&
          (!resuming ||
            (await billing.fetchSubscription(account.subscriptionId)).status !==
              "canceled");
        if (live) {
          await billing.cancel({
            subscriptionId: account.subscriptionId,
            mode: "now",
            idempotencyKey: `decline:${orgId}:cancel`,
          });
        }
        step = "close";
        const closed = await markOrgClosed(pctx, orgId, "declined", { now });
        closedAt = closed.closedAt;
      } catch (err) {
        await pb.collection("audit_log").create(
          auditBody(pctx, {
            action: "billing.decline_failed",
            organization: orgId,
            targetCollection: "billing_accounts",
            targetId: account.id,
            meta: {
              category,
              step,
              refundedCents: refunded.refundedCents,
              error: err instanceof Error ? err.name : "Error",
            },
          }),
        );
        throw new DeclineIncomplete(step, err);
      }
      await pb.collection("audit_log").create(
        auditBody(pctx, {
          action: AUDIT_DECLINE,
          organization: orgId,
          targetCollection: "organizations",
          targetId: orgId,
          meta: {
            category,
            note,
            refundedCents: refunded.refundedCents,
            refunds: refunded.count,
          },
        }),
      );
      const deleteOn = declineDay(
        new Date(
          new Date(closedAt).getTime() + CLOSED_ORG_DELETE_DAYS * DAY_MS,
        ),
      );
      const signature = await newestSignatureId(pb, orgId);
      return { refundedCents: refunded.refundedCents, deleteOn, signature };
    }),
  );

  // The email never undoes the decline; a failure is logged (ids only).
  let emailed = false;
  try {
    const owner = await withSuperuser((pb) => billingOwnerOf(pb, orgId));
    if (!owner || owner.email === "") {
      console.error(`[payments] decline ${orgId}: no owner email`);
    } else {
      await sendEmail(
        { kind: "cds", ctx: mintSystemContext({ job: "billing" }) },
        "org.declined",
        owner.email,
        {
          refundedCents: done.refundedCents,
          reason: category,
          otherNote: category === "other" ? note : null,
          deleteOn: done.deleteOn,
          agreementUrl: platformUrl(
            done.signature ? agreementDownloadPath(done.signature) : "/hub",
          ),
        },
        deps.transport ? { transport: deps.transport } : {},
      );
      emailed = true;
    }
  } catch (err) {
    console.error(
      `[payments] decline ${orgId} email not sent: ${err instanceof Error ? err.name : "Error"}`,
    );
  }
  return {
    refundedCents: done.refundedCents,
    deleteOn: done.deleteOn,
    emailed,
  };
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/**
 * Any member of a declined org: the hub's declined notice, or null when the org is not
 * closed as declined. Read by ctx.orgId only (T-10-28-05).
 */
export async function readDeclinedNotice(
  ctx: OrgContext,
): Promise<DeclinedNotice | null> {
  assertOrgContext(ctx);
  const base = await withSuperuser(async (pb) => {
    const org = await orgRow(pb, ctx.orgId).catch(() => null);
    if (!org || org.closed_reason !== "declined") return null;
    const account = await billingAccountByOrg(pb, ctx.orgId);
    const audits = await pb.collection("audit_log").getList(1, 1, {
      filter: pb.filter("organization = {:org} && action = {:action}", {
        org: ctx.orgId,
        action: AUDIT_DECLINE,
      }),
      sort: "-created,-id",
      fields: "meta,created",
    });
    const audit = audits.items[0];
    const signature = can(ctx, "agreements", "read")
      ? await newestSignatureId(pb, ctx.orgId)
      : null;
    return { org, account, audit, signature };
  });
  if (!base) return null;
  const meta = (base.audit?.meta ?? {}) as Record<string, unknown>;
  const category = (DECLINE_REASON_CATEGORIES as readonly string[]).includes(
    String(meta.category),
  )
    ? (meta.category as DeclineReasonCategory)
    : null;
  const note = typeof meta.note === "string" ? meta.note : null;
  const refundedAt =
    toDate(base.account?.declinedAt) ??
    toDate(base.audit?.created) ??
    toDate(base.org.closed_at);
  const card = cardLineOf(base.account);
  const amount = formatCentsExact(int(meta.refundedCents));
  const refundedLabel = [
    amount,
    card ? `to ${card}` : "",
    refundedAt ? `on ${declineDay(refundedAt)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const closedAt = toDate(base.org.closed_at);
  const deleteOnLabel = closedAt
    ? declineDay(new Date(closedAt.getTime() + CLOSED_ORG_DELETE_DAYS * DAY_MS))
    : "";
  const invoices = can(ctx, "billing", "read")
    ? await listBillingInvoices(ctx)
    : [];
  return {
    refundedAmount: amount,
    refundedLabel,
    deleteOnLabel,
    reasonSentence: category ? declineReasonSentence(category, note) : "",
    agreementHref: base.signature
      ? agreementDownloadPath(base.signature)
      : null,
    invoices,
  };
}

/**
 * Staff (`work_quote`: super_admin, support_agent): record that build work started, which
 * ends the decline window (choice 2). Keeps an earlier value; audited
 * `organization.build_started` in the same batch.
 */
export async function markBuildStarted(
  pctx: PlatformContext,
  orgId: string,
  at?: Date,
): Promise<{ buildStartedAt: string }> {
  staff(pctx, "work_quote");
  checkOrgId(orgId);
  const when = at ?? new Date();
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
    throw new InvalidInput("invalid build start date");
  }
  return withSuperuser(async (pb) => {
    const org = await orgRow(pb, orgId);
    const existing = toDate(org.build_started_at);
    if (existing) return { buildStartedAt: existing.toISOString() };
    const iso = when.toISOString();
    const batch = pb.createBatch();
    batch.collection("organizations").update(orgId, { build_started_at: iso });
    batch.collection("audit_log").create(
      auditBody(pctx, {
        action: "organization.build_started",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { at: iso },
      }),
    );
    await batch.send();
    return { buildStartedAt: iso };
  });
}
