// P10 payments: the signup checkout on CDS's own billing account (AGR-02, BILL-01, BILL-02,
// BILL-10, BILL-11, BILL-15, BILL-19; CONTEXT A2; D66, D181, D262-D264, D296, D299, D300,
// D314, D-UI-P10-5, D-UI-P10-6).
//
// `startCheckout` runs the CONTEXT A2 order exactly, and makes no billing call until every
// check has passed:
//   1. owner and not impersonating (`purchases:run`)
//   2. `requireCurrentSignature(ctx)` (AGR-02; the web action runs it too, defence in depth)
//   3. stage: not closed, not already paid, sent and confirmed (ready_for_build or
//      being_built), never fit_review (choice 1)
//   4. the draft is only ever a subset of what was offered (choice 2, D-UI-P10-5)
//   5. payments open (production on the fake adapter refuses, with a staff alert)
//   6. re-price with priceQuote() from the live catalog; unpriced items block with the locked
//      copy and a staff alert (D264); a figure that differs from the one on screen refuses
//      with PriceChanged (D-UI-P10-6)
//   7. ensureCustomer (id saved first, Pitfall 11), then createCheckout with an idempotency
//      key over org + draft + figure (choice 3). Success and cancel URLs come only from
//      platformUrl() (T-10-16-06).
// The order the completion handler installs from is stored on billing_accounts beside the
// session id (10-12 choice 3). One lock per org (`billing:<org>`) serialises double submits.
import { createHash } from "node:crypto";
import { CdsError, InvalidInput } from "@cds/core";
import type { AddonPath, AddonRegistry } from "@cds/core/addons";
import { PaymentsUnavailable, type CdsBilling } from "@cds/core/payments";
import {
  normaliseSelections,
  priceQuote,
  type QuoteTotals,
} from "@cds/core/pricing";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { readCatalogBillingRefs, readPriceCatalog } from "../catalog";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { mintSystemContext, type OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { intakeFromRow } from "../intake/org-intake";
import { requireCurrentSignature } from "../legal/signatures";
import { staffAlertAddress } from "../media/ops/alerts";
import { requirePermission } from "../repository";
import {
  BILLING_JOB,
  billingAccountByOrg,
  ensureBillingAccount,
  MAX_DRAFT_PAGE_PACKS,
  type BillingAccount,
  type CheckoutDraft,
} from "./accounts";
import {
  buildCheckoutLines,
  CheckoutBlocked,
  checkoutSummaryView,
  orderDueToday,
  PAGES_PACK_KEY,
  type CheckoutSummaryView,
  type PagePacksOrder,
} from "./checkout-lines";
import { cdsBillingFor, paymentsOpen } from "./factory";
import { guardProviderIdWrite } from "./staff-alert";

/** The checkout return and cancel routes (10-22 / 10-23 own the pages). */
export const CHECKOUT_RETURN_PATH =
  "/hub/checkout/return?session={CHECKOUT_SESSION_ID}";
export const CHECKOUT_CANCEL_PATH = "/hub/checkout?cancelled=1";

export const NOT_SENT_COPY = "Send your details to Support first.";
/** UI-SPEC HELD-CHECKOUT. */
export const HELD_CHECKOUT_COPY =
  "We're still checking a couple of details about your business, usually within 2 business days. Checkout opens as soon as that's done, and we'll email you.";
export const CLOSED_COPY = "This site is closed, so checkout is not open.";
/** UI-SPEC PRICE-CHANGED. */
export const PRICE_CHANGED_COPY =
  "A price changed since you opened this page. We've updated your order; check the new total before you pay.";
export const ALREADY_PAID_COPY = "You've already paid. Your billing is here.";
const BAD_ORDER_COPY =
  "That order doesn't look right. Refresh the page and try again.";

/** The re-priced figure differs from the one the owner saw: nothing was charged. */
export class PriceChanged extends CdsError {
  override readonly code = "price_changed";
  readonly dueTodayCents: number;
  constructor(dueTodayCents: number) {
    super(PRICE_CHANGED_COPY);
    this.dueTodayCents = dueTodayCents;
  }
}

/** The org has already paid for its build: billing lives on Settings > Billing. */
export class AlreadyPaid extends CdsError {
  override readonly code = "already_paid";
  constructor() {
    super(ALREADY_PAID_COPY);
  }
}

/**
 * The owner's choices on /hub/checkout (no amounts: those are always re-priced).
 * `pagePacks` (11-27, D185): "5 more pages" packs added before checkout from the Pages tab;
 * the checkout page does not edit it, so a save without it keeps the stored count.
 */
export type CheckoutChoices = Pick<
  CheckoutDraft,
  "addons" | "extras" | "carePlan" | "cadence" | "buildPlan" | "pagePacks"
>;

export type CheckoutDeps = {
  /** The add-on registry: manifests decide which add-ons a path may buy. */
  registry: AddonRegistry;
  billing?: CdsBilling;
  now?: Date;
  /** Staff alert mail (tests capture it). */
  transport?: EmailTransport;
};

const READY_STAGES = new Set(["ready_for_build", "being_built"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

type CheckoutState = {
  orgName: string;
  path: AddonPath | "";
  stage: string;
  closed: boolean;
  intakeAddons: string[];
  intakeExtras: string[];
  activeAddons: string[];
  account: BillingAccount | null;
};

async function loadState(
  pb: PocketBase,
  orgId: string,
): Promise<CheckoutState> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name,path,stage,closed_at" });
  const [intakeRes, active, account] = await Promise.all([
    pb.collection("org_intake").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
    }),
    pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:org} && status = 'active'", {
        org: orgId,
      }),
      fields: "addon",
      sort: "created,id",
    }),
    billingAccountByOrg(pb, orgId),
  ]);
  const intake = intakeFromRow((intakeRes.items[0] as RecordModel) ?? null);
  const path = str(org.path);
  return {
    orgName: str(org.name),
    path: path === "standard" || path === "studio" ? path : "",
    stage: str(org.stage),
    closed: str(org.closed_at) !== "",
    intakeAddons: [...intake.selections.addons],
    intakeExtras: [...intake.selections.extras],
    activeAddons: active.map((r) => str(r.addon)).filter((s) => s !== ""),
    account,
  };
}

function offeredOnPath(
  registry: AddonRegistry,
  slug: string,
  path: AddonPath | "",
): boolean {
  const m = registry.get(slug);
  return path !== "" && m !== undefined && m.paths.includes(path);
}

/** Add-ons the order may hold: intake selection plus active add-ons, offered on the path. */
function allowedAddons(s: CheckoutState, registry: AddonRegistry): string[] {
  const out: string[] = [];
  for (const slug of [...s.intakeAddons, ...s.activeAddons]) {
    if (!out.includes(slug) && offeredOnPath(registry, slug, s.path)) {
      out.push(slug);
    }
  }
  return out;
}

/**
 * Validate the owner's choices (choice 2, D-UI-P10-5, T-10-16-03): add-ons and extras can
 * only be removed at checkout, never added. Throws InvalidInput.
 */
function validChoices(
  raw: unknown,
  s: CheckoutState,
  registry: AddonRegistry,
): CheckoutChoices {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput(BAD_ORDER_COPY);
  }
  const r = raw as Record<string, unknown>;
  const sel = normaliseSelections({
    addons: r.addons,
    extras: r.extras,
    carePlan: r.carePlan,
    cadence: r.cadence,
  });
  if (r.carePlan !== undefined && typeof r.carePlan !== "boolean") {
    throw new InvalidInput(BAD_ORDER_COPY);
  }
  const buildPlan = r.buildPlan ?? "full";
  if (buildPlan !== "full" && buildPlan !== "installments") {
    throw new InvalidInput(BAD_ORDER_COPY);
  }
  const allowed = allowedAddons(s, registry);
  for (const slug of sel.addons) {
    if (!allowed.includes(slug)) throw new InvalidInput(BAD_ORDER_COPY);
  }
  for (const key of sel.extras) {
    if (!s.intakeExtras.includes(key)) throw new InvalidInput(BAD_ORDER_COPY);
  }
  const pagePacks = r.pagePacks ?? savedPagePacks(s);
  if (
    typeof pagePacks !== "number" ||
    !Number.isSafeInteger(pagePacks) ||
    pagePacks < 0 ||
    pagePacks > MAX_DRAFT_PAGE_PACKS
  ) {
    throw new InvalidInput(BAD_ORDER_COPY);
  }
  return {
    addons: [...sel.addons],
    extras: [...sel.extras],
    carePlan: sel.carePlan,
    cadence: sel.cadence,
    buildPlan,
    pagePacks,
  };
}

/** Pages packs already on the stored order (0 when none). */
function savedPagePacks(s: CheckoutState): number {
  return s.account?.checkoutDraft?.pagePacks ?? 0;
}

/** The stage gate (choice 1). Throws the owner copy for each refusal. */
function assertCheckoutOpen(s: CheckoutState): void {
  if (s.closed) throw new InvalidInput(CLOSED_COPY);
  if (s.account?.paidAt) throw new AlreadyPaid();
  if (s.stage === "fit_review") throw new InvalidInput(HELD_CHECKOUT_COPY);
  if (s.stage === "intake") throw new InvalidInput(NOT_SENT_COPY);
  if (!READY_STAGES.has(s.stage) || s.path === "") {
    throw new InvalidInput(NOT_SENT_COPY);
  }
}

function defaultChoices(
  s: CheckoutState,
  registry: AddonRegistry,
): CheckoutChoices {
  return {
    addons: allowedAddons(s, registry),
    extras: [...s.intakeExtras],
    carePlan: false,
    cadence: "monthly",
    buildPlan: "full",
    pagePacks: savedPagePacks(s),
  };
}

function addonNames(
  registry: AddonRegistry,
  slugs: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slug of slugs) {
    const m = registry.get(slug);
    if (m) out[slug] = m.name;
  }
  return out;
}

type StaffAlertEvent = "unpriced_item" | "payments_unavailable";

/** One staff alert; a send failure is logged, never thrown to the owner. */
async function staffAlert(
  event: StaffAlertEvent,
  orgId: string,
  orgName: string,
  detail: string,
  transport: EmailTransport | undefined,
): Promise<void> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn(`[payments] checkout: no staff alert address (org ${orgId})`);
    return;
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: mintSystemContext({ job: BILLING_JOB }) },
      "billing.staff_alert",
      to,
      { event, orgName: orgName === "" ? orgId : orgName, orgId, detail },
      transport ? { transport } : {},
    );
  } catch (err) {
    console.error(
      `[payments] checkout: staff alert ${event} for org ${orgId} not sent: ${errName(err)}`,
    );
  }
}

function priceChoices(
  catalog: Parameters<typeof priceQuote>[0],
  c: CheckoutChoices,
  path: AddonPath,
): QuoteTotals {
  return priceQuote(
    catalog,
    {
      addons: c.addons,
      extras: c.extras,
      carePlan: c.carePlan,
      cadence: c.cadence,
    },
    path,
    c.cadence,
  );
}

/** The order's pages packs priced from the catalog (11-27); undefined when there are none. */
function pagePacksOrder(
  catalog: Parameters<typeof priceQuote>[0],
  c: Pick<CheckoutChoices, "pagePacks">,
  path: AddonPath,
): PagePacksOrder | undefined {
  const quantity = c.pagePacks ?? 0;
  if (quantity <= 0) return undefined;
  const row = catalog.find(
    (r) =>
      r.itemKind === "pack" && r.itemKey === PAGES_PACK_KEY && r.path === path,
  );
  const cents = row?.monthlyCents;
  return {
    quantity,
    monthlyCents:
      typeof cents === "number" && Number.isSafeInteger(cents) && cents >= 0
        ? cents
        : null,
  };
}

// ---------------------------------------------------------------------------------------
// Public (OrgContext first, invariant 1)

/**
 * The saved checkout choices, or defaults from the P6 intake (its add-ons and extras, plus
 * add-ons already active on the site; Care Plan off, monthly, paid in full). Owner and Admin
 * (Admin sees the order read-only, UI-SPEC).
 */
export async function readCheckoutDraft(
  ctx: OrgContext,
  registry: AddonRegistry,
): Promise<CheckoutChoices> {
  requirePermission(ctx, "addons", "read");
  return withSuperuser(async (pb) => {
    const s = await loadState(pb, ctx.orgId);
    const saved = s.account?.checkoutDraft;
    if (saved) {
      try {
        return validChoices(saved, s, registry);
      } catch {
        // The intake or the path changed since: fall back to fresh defaults.
      }
    }
    return defaultChoices(s, registry);
  });
}

/** Persist the owner's choices (validated, D-UI-P10-5). Owner only, never impersonating. */
export async function saveCheckoutDraft(
  ctx: OrgContext,
  draft: CheckoutChoices,
  registry: AddonRegistry,
  deps: { billing?: CdsBilling } = {},
): Promise<CheckoutChoices> {
  requirePermission(ctx, "purchases", "run");
  return withOrgLock(`billing:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const s = await loadState(pb, ctx.orgId);
      if (s.account?.paidAt) throw new AlreadyPaid();
      // 11-50: pages packs change only through buyPack/removePack (which hold the
      // too-many-pages refusal); a checkout save always keeps the stored count.
      const choices = validChoices(
        { ...draft, pagePacks: undefined },
        s,
        registry,
      );
      await writeDraft(pb, ctx, s, choices, deps.billing, {
        action: "billing.checkout_draft_saved",
        meta: {
          addons: choices.addons.length,
          extras: choices.extras.length,
          carePlan: choices.carePlan,
          cadence: choices.cadence,
          buildPlan: choices.buildPlan,
          pagePacks: choices.pagePacks,
        },
      });
      return choices;
    }),
  );
}

/** Store the validated order and its audit row (caller holds `billing:<org>`). */
async function writeDraft(
  pb: PocketBase,
  ctx: OrgContext,
  s: CheckoutState,
  choices: CheckoutChoices,
  billingDep: CdsBilling | undefined,
  audit: { action: string; meta: Record<string, unknown> },
): Promise<void> {
  const account =
    s.account ??
    (await ensureBillingAccount(pb, ctx.orgId, await providerFor(ctx.orgId)));
  // CR-E02: the stored order always matches the one payable session. Changing the
  // order expires the open session (a fresh one starts at Pay), so an old tab cannot
  // pay the previous order against these choices.
  const billing = billingDep ?? (await cdsBillingFor(ctx.orgId));
  const open =
    account.provider === billing.provider ? account.checkoutSessionId : "";
  if (open !== "") {
    if ((await billing.expireCheckout(open)) === "complete") {
      throw new AlreadyPaid();
    }
  }
  const batch = pb.createBatch();
  batch.collection("billing_accounts").update(account.id, {
    checkout_draft: choices,
    ...(open !== "" ? { checkout_session_id: "" } : {}),
  });
  batch.collection("audit_log").create(
    auditBody(ctx, {
      action: audit.action,
      targetCollection: "billing_accounts",
      targetId: account.id,
      meta: audit.meta,
    }),
  );
  await batch.send();
}

/**
 * Internal (charges.ts, 11-27 choice 2): set the pre-checkout order's pages packs to `qty`,
 * keeping every other choice (the saved draft, or the intake defaults when none is valid).
 * The caller holds `billing:<org>` and has checked the permission and the confirm token.
 * Throws AlreadyPaid once the checkout is paid.
 */
export async function setDraftPagePacks(
  ctx: OrgContext,
  qty: number,
  registry: AddonRegistry,
  billing: CdsBilling | undefined,
  audit: { action: string; meta: Record<string, unknown> },
): Promise<CheckoutChoices> {
  requirePermission(ctx, "purchases", "run");
  return withSuperuser(async (pb) => {
    const s = await loadState(pb, ctx.orgId);
    if (s.account?.paidAt) throw new AlreadyPaid();
    let base: CheckoutChoices;
    try {
      base = s.account?.checkoutDraft
        ? validChoices(s.account.checkoutDraft, s, registry)
        : defaultChoices(s, registry);
    } catch {
      base = defaultChoices(s, registry);
    }
    const choices = validChoices({ ...base, pagePacks: qty }, s, registry);
    await writeDraft(pb, ctx, s, choices, billing, audit);
    return choices;
  });
}

async function providerFor(orgId: string): Promise<CdsBilling["provider"]> {
  return (await cdsBillingFor(orgId)).provider;
}

/**
 * The owner's order summary for the checkout page: choices re-priced from the live catalog.
 * Throws CheckoutBlocked when an item is unpriced (the page shows the UNPRICED alert).
 */
export async function checkoutSummaryFor(
  ctx: OrgContext,
  choices: CheckoutChoices,
  deps: CheckoutDeps,
): Promise<CheckoutSummaryView> {
  requirePermission(ctx, "addons", "read");
  const s = await withSuperuser((pb) => loadState(pb, ctx.orgId));
  if (s.path === "") throw new InvalidInput(NOT_SENT_COPY);
  const c = validChoices(choices, s, deps.registry);
  const catalog = await readPriceCatalog();
  const totals = priceChoices(catalog, c, s.path);
  const billing = deps.billing ?? (await cdsBillingFor(ctx.orgId));
  return checkoutSummaryView(
    totals,
    {
      buildPlan: c.buildPlan,
      testMode: billing.provider === "fake",
      addonNames: addonNames(deps.registry, c.addons),
      pagePacks: pagePacksOrder(catalog, c, s.path),
    },
    deps.now ?? new Date(),
  );
}

/**
 * Start the CDS checkout (CONTEXT A2 order, see the file header). Returns the hosted payment
 * URL (Stripe Checkout, or `/test-pay/<id>` on the fake adapter).
 */
export async function startCheckout(
  ctx: OrgContext,
  draft: CheckoutChoices,
  opts: { expectedDueTodayCents: number },
  deps: CheckoutDeps,
): Promise<{ url: string }> {
  // 1. Owner only; ImpersonationDenied for staff acting as the owner (D285, TEN-15).
  requirePermission(ctx, "purchases", "run");
  // 2. AGR-02: the current agreement is signed, before anything else is read or called.
  await requireCurrentSignature(ctx);
  const orgId = ctx.orgId;

  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      // 3. Stage.
      const s = await loadState(pb, orgId);
      assertCheckoutOpen(s);
      const path = s.path as AddonPath;
      // 4. The order is a subset of what was offered.
      const choices = validChoices(draft, s, deps.registry);

      // 5. Payments open (production on the fake adapter never takes money).
      if (!paymentsOpen()) {
        await staffAlert(
          "payments_unavailable",
          orgId,
          s.orgName,
          "An owner tried to pay, but production is running the test payment adapter. Set CDS_PAYMENTS=stripe.",
          deps.transport,
        );
        throw new PaymentsUnavailable();
      }

      // 6. Re-price from the live catalog (never a browser figure, T-10-16-02).
      const catalog = await readPriceCatalog();
      const totals = priceChoices(catalog, choices, path);
      const pagePacks = pagePacksOrder(catalog, choices, path);
      if (pagePacks && pagePacks.monthlyCents === null) {
        totals.unpriced.push(PAGES_PACK_KEY);
        totals.unpricedCount += 1;
      }
      if (totals.unpricedCount > 0) {
        await staffAlert(
          "unpriced_item",
          orgId,
          s.orgName,
          `Checkout is blocked by unpriced items: ${totals.unpriced.join(", ")}. Set them with prices:set.`,
          deps.transport,
        );
        throw new CheckoutBlocked(totals.unpriced);
      }
      const due = orderDueToday(totals, choices.buildPlan, pagePacks);
      if (due !== opts.expectedDueTodayCents) throw new PriceChanged(due);
      const built = buildCheckoutLines({
        totals,
        refs: await readCatalogBillingRefs(),
        cadence: choices.cadence,
        buildPlan: choices.buildPlan,
        carePlan: choices.carePlan,
        addonNames: addonNames(deps.registry, choices.addons),
        ...(pagePacks ? { pagePacks } : {}),
      });

      const billing = deps.billing ?? (await cdsBillingFor(ctx.orgId));
      // WR-E05: on Stripe every recurring item needs its synced catalog price. An inline
      // price carries no CDS kind on the price, and the yearly deferred items cannot be
      // added after payment without one. Refuse before any provider call.
      if (billing.provider === "stripe") {
        const unsynced = [...built.lines, ...built.deferredMonthly].filter(
          (l) => l.interval !== "once" && !l.priceRef,
        );
        if (unsynced.length > 0) {
          await staffAlert(
            "unpriced_item",
            orgId,
            s.orgName,
            `Checkout is blocked: no synced Stripe price for ${unsynced
              .map((l) => `${l.kind}:${l.key}`)
              .join(", ")}. Run npm run prices:set -- --sync-all.`,
            deps.transport,
          );
          throw new CheckoutBlocked(unsynced.map((l) => l.label));
        }
      }

      // 7. Customer first (saved before the session, Pitfall 11), then the session.
      const account =
        s.account ?? (await ensureBillingAccount(pb, orgId, billing.provider));
      const owner = await pb
        .collection("users")
        .getOne(ctx.actor, { fields: "id,email,name" });
      const { customerId } = await billing.ensureCustomer({
        orgId,
        customerId: account.customerId === "" ? null : account.customerId,
        name: s.orgName,
        email: str(owner.email),
        idempotencyKey: `customer:${orgId}`,
      });
      if (customerId !== account.customerId) {
        // WR-A01: a customer id another org holds is refused, never shared.
        await guardProviderIdWrite(
          pb,
          orgId,
          "customer id",
          () =>
            pb.collection("billing_accounts").update(account.id, {
              customer_id: customerId,
              provider: billing.provider,
            }),
          deps.transport,
        );
      }
      // CR-E02: one payable session per org. The previous one is expired before a new one
      // exists, so an old tab can never pay against this order (or start a second
      // subscription). Already paid there: that payment is being confirmed, never re-sold.
      const previous =
        account.provider === billing.provider ? account.checkoutSessionId : "";
      if (previous !== "") {
        if ((await billing.expireCheckout(previous)) === "complete") {
          throw new AlreadyPaid();
        }
      }
      // The previous session id is in the key, so the provider never hands back the session
      // just expired.
      const idempotencyKey = createHash("sha256")
        .update(`${orgId}${JSON.stringify(choices)}${due}${previous}`)
        .digest("hex");
      const session = await billing.createCheckout({
        orgId,
        customerId,
        lines: built.lines,
        deferredMonthly: built.deferredMonthly,
        cadence: choices.cadence,
        successUrl: platformUrl(CHECKOUT_RETURN_PATH),
        cancelUrl: platformUrl(CHECKOUT_CANCEL_PATH),
        idempotencyKey,
      });

      const stored: CheckoutDraft = {
        ...choices,
        deferredMonthly: built.deferredMonthly,
        sessionId: session.sessionId,
      };
      if (totals.build.cents !== null) stored.buildCents = totals.build.cents;
      const batch = pb.createBatch();
      batch.collection("billing_accounts").update(account.id, {
        checkout_session_id: session.sessionId,
        checkout_draft: stored,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "billing.checkout_started",
          targetCollection: "billing_accounts",
          targetId: account.id,
          meta: {
            dueTodayCents: due,
            sessionId: session.sessionId,
            cadence: choices.cadence,
            buildPlan: choices.buildPlan,
            pagePacks: choices.pagePacks ?? 0,
          },
        }),
      );
      await batch.send();
      return { url: session.url };
    }),
  );
}

// ---------------------------------------------------------------------------------------
// The checkout pages (10-22): page state, the priced order, the return status.

/** What /hub/checkout and the Setup item need to pick their state (owner or admin). */
export type CheckoutPageState = {
  stage: string;
  path: AddonPath | "";
  closed: boolean;
  /** ISO time of the first build payment, or null. */
  paidAt: string | null;
  /** false only in production on the fake adapter (OPEN-SOON). */
  paymentsOpen: boolean;
  /** The fake adapter is active (TEST-CHECKOUT). */
  testMode: boolean;
};

/** The org's checkout state. Owner and Admin (`addons:read`); no provider ids. */
export async function readCheckoutState(
  ctx: OrgContext,
): Promise<CheckoutPageState> {
  requirePermission(ctx, "addons", "read");
  const [org, account] = await withSuperuser((pb) =>
    Promise.all([
      pb
        .collection("organizations")
        .getOne(ctx.orgId, { fields: "id,path,stage,closed_at" }),
      billingAccountByOrg(pb, ctx.orgId),
    ]),
  );
  const path = str(org.path);
  return {
    stage: str(org.stage),
    path: path === "standard" || path === "studio" ? path : "",
    closed: str(org.closed_at) !== "",
    paidAt: account?.paidAt ?? null,
    paymentsOpen: paymentsOpen(),
    testMode: (await providerFor(ctx.orgId)) === "fake",
  };
}

/** The order as the checkout page shows it: every figure from priceQuote, server-side. */
export type CheckoutOrder = {
  choices: CheckoutChoices;
  path: AddonPath;
  totals: QuoteTotals;
  /** null when anything is unpriced (no figure rather than a wrong one, D264). */
  summary: CheckoutSummaryView | null;
  /** The Care Plan's monthly price for the switch label, null when unpriced. */
  carePlanMonthlyCents: number | null;
};

/**
 * Price the given choices (validated as a subset of the offer), or the saved draft when
 * `choices` is null. Owner and Admin (`addons:read`). Reads the live catalog, uncached, so
 * the figure shown is the one `startCheckout` re-prices to.
 */
export async function checkoutOrderFor(
  ctx: OrgContext,
  choices: CheckoutChoices | null,
  deps: CheckoutDeps,
): Promise<CheckoutOrder> {
  requirePermission(ctx, "addons", "read");
  const s = await withSuperuser((pb) => loadState(pb, ctx.orgId));
  if (s.path === "") throw new InvalidInput(NOT_SENT_COPY);
  const path = s.path;
  let c: CheckoutChoices;
  if (choices) {
    c = validChoices(choices, s, deps.registry);
  } else {
    const saved = s.account?.checkoutDraft;
    try {
      c = saved
        ? validChoices(saved, s, deps.registry)
        : defaultChoices(s, deps.registry);
    } catch {
      c = defaultChoices(s, deps.registry);
    }
  }
  const catalog = await readPriceCatalog();
  const totals = priceChoices(catalog, c, path);
  const care = catalog.find(
    (r) => r.itemKind === "care_plan" && r.path === path,
  );
  let summary: CheckoutSummaryView | null = null;
  if (totals.unpricedCount === 0) {
    const billing = deps.billing ?? (await cdsBillingFor(ctx.orgId));
    try {
      summary = checkoutSummaryView(
        totals,
        {
          buildPlan: c.buildPlan,
          testMode: billing.provider === "fake",
          addonNames: addonNames(deps.registry, c.addons),
          pagePacks: pagePacksOrder(catalog, c, path),
        },
        deps.now ?? new Date(),
      );
    } catch (err) {
      // An unpriced pages pack: no figure rather than a wrong one (D264).
      if (!(err instanceof CheckoutBlocked)) throw err;
    }
  }
  return {
    choices: c,
    path,
    totals,
    summary,
    carePlanMonthlyCents: care?.monthlyCents ?? null,
  };
}

/** The return page's answer for one session id (10-22 choice 4). */
export type CheckoutReturnStatus =
  | { state: "unknown" }
  | { state: "confirming" }
  | { state: "failed" }
  | {
      state: "received";
      /** From the mirrored checkout invoice; null until it is mirrored. */
      paidCents: number | null;
      taxCents: number | null;
      /** The first Then line of the paid order ("$39 a month from 8 Nov"), or null. */
      nextBill: string | null;
      /** The owner's email the receipt went to. */
      receiptEmail: string;
    };

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,255}$/;

/**
 * Where the caller org's checkout stands, for one session id (T-10-22-03). Answers only
 * when the id is the org's own stored `checkout_session_id`; any other id is `unknown` and
 * no data. Owner only (`billing:read`). Paid = the org's own account carries `paid_at`
 * (never the session id alone); an expired provider session is `failed`.
 */
export async function checkoutReturnStatus(
  ctx: OrgContext,
  sessionId: string,
  deps: CheckoutDeps,
): Promise<CheckoutReturnStatus> {
  requirePermission(ctx, "billing", "read");
  if (!SESSION_ID_RE.test(sessionId)) return { state: "unknown" };
  return withSuperuser(async (pb) => {
    const account = await billingAccountByOrg(pb, ctx.orgId);
    if (
      !account ||
      account.checkoutSessionId === "" ||
      account.checkoutSessionId !== sessionId
    ) {
      return { state: "unknown" };
    }
    if (account.paidAt) {
      const [invoices, owner] = await Promise.all([
        pb.collection("billing_invoices").getList(1, 1, {
          filter: pb.filter("organization = {:org} && kind = 'checkout'", {
            org: ctx.orgId,
          }),
          sort: "-issued_at,-id",
          fields: "id,amount_cents,tax_cents",
        }),
        pb
          .collection("users")
          .getOne(ctx.actor, { fields: "id,email" })
          .catch(() => null),
      ]);
      const inv = invoices.items[0];
      let nextBill: string | null = null;
      const draft = account.checkoutDraft;
      const path = str(
        (
          await pb
            .collection("organizations")
            .getOne(ctx.orgId, { fields: "id,path" })
        ).path,
      );
      if (draft && (path === "standard" || path === "studio")) {
        try {
          const catalog = await readPriceCatalog();
          const totals = priceChoices(catalog, draft, path);
          const view = checkoutSummaryView(
            totals,
            {
              buildPlan: draft.buildPlan,
              testMode: false,
              pagePacks: pagePacksOrder(catalog, draft, path),
            },
            new Date(account.paidAt),
          );
          nextBill = view.then[0]?.text ?? null;
        } catch {
          nextBill = null;
        }
      }
      return {
        state: "received",
        paidCents: inv ? numOrNull(inv.amount_cents) : null,
        taxCents: inv ? numOrNull(inv.tax_cents) : null,
        nextBill,
        receiptEmail: owner ? str(owner.email) : "",
      };
    }
    try {
      const billing = deps.billing ?? (await cdsBillingFor(ctx.orgId));
      const session = await billing.fetchCheckoutSession(sessionId);
      if (session.orgId && session.orgId !== ctx.orgId) {
        return { state: "unknown" };
      }
      if (session.status === "expired") return { state: "failed" };
    } catch (err) {
      console.warn(`[payments] checkout status read failed: ${errName(err)}`);
    }
    return { state: "confirming" };
  });
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
}
