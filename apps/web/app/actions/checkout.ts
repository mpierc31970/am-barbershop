"use server";
// Checkout Server Actions (10-22; AGR-02, BILL-01, BILL-10, BILL-11, BILL-15, BILL-19;
// CONTEXT A2; 10-UI-SPEC "Checkout", "Checkout return"; T-10-22-01..05).
// Public POST endpoints: every argument is untrusted and shape-checked in clean(). The org,
// role and impersonation come only from the session cookie (runAction).
//   - startCheckoutAction: owner and not impersonating, then requireCurrentSignature (AGR-02,
//     defence in depth: startCheckout checks again), then startCheckout. An unsigned owner
//     gets { redirect } and no billing call is made. The caller navigates (no redirect inside
//     runAction, 10-22 choice 3); the payment URL comes only from the adapter.
//   - previewCheckoutAction: saves the draft and returns the server-priced view (choice 1).
//   - checkoutStatusAction: answers only for the caller org's stored session id (choice 4).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied, InvalidInput, can } from "@cds/core";
import {
  checkoutOrderFor,
  checkoutReturnStatus,
  requireCurrentSignature,
  saveCheckoutDraft,
  startCheckout,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import {
  AGREEMENT_NEXT,
  BILLING_TAB,
  IMPERSONATING_PAY,
  buildOrderView,
  notOwnerPay,
  paidLines,
  type CheckoutChoicesView,
  type CheckoutOrderView,
  type PaidLines,
  type PricedOrder,
} from "../../lib/checkout-order";
import type { HubSession } from "../../lib/session";

const COPY = {
  forbidden: notOwnerPay(null),
  impersonation: IMPERSONATING_PAY,
};
const BAD_ORDER =
  "That order doesn't look right. Refresh the page and try again.";

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,255}$/;
const MAX_ITEMS = 40;
const MAX_CENTS = 100_000_000;

export type StartCheckoutOutcome =
  | { url: string }
  | { redirect: string }
  | {
      error: "price_changed" | "unpriced" | "open_soon" | "failed";
      unpriced?: string[];
    };

export type CheckoutStatusOutcome = {
  state: "confirming" | "received" | "failed";
  paid?: PaidLines;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function slugs(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) {
    throw new InvalidInput(BAD_ORDER);
  }
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== "string" || !SLUG_RE.test(s)) {
      throw new InvalidInput(BAD_ORDER);
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Shape check only (T-10-22-02); the chokepoint checks the order against the offer. */
function clean(raw: unknown): CheckoutChoicesView {
  if (!isObj(raw)) throw new InvalidInput(BAD_ORDER);
  const { addons, extras, carePlan, cadence, buildPlan } = raw;
  if (typeof carePlan !== "boolean") throw new InvalidInput(BAD_ORDER);
  if (cadence !== "monthly" && cadence !== "yearly") {
    throw new InvalidInput(BAD_ORDER);
  }
  if (buildPlan !== "full" && buildPlan !== "installments") {
    throw new InvalidInput(BAD_ORDER);
  }
  // Allow-listed keys only: anything else on the object is dropped.
  return {
    addons: slugs(addons),
    extras: slugs(extras),
    carePlan,
    cadence,
    buildPlan,
  };
}

function cents(v: unknown): number {
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    v < 0 ||
    v > MAX_CENTS
  ) {
    throw new InvalidInput(BAD_ORDER);
  }
  return v;
}

/** Owner, signed in as themselves (D285, TEN-15); refusals carry the checkout copy. */
function assertPayer(s: HubSession): void {
  if (s.ctx.impersonator) throw new ImpersonationDenied();
  if (!can(s.ctx, "purchases", "run")) throw new Forbidden();
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[checkout] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

function manifests() {
  return ADDON_REGISTRY.list();
}

/** Continue to payment: the gated start (CONTEXT A2 order). */
export async function startCheckoutAction(
  input: unknown,
): Promise<ActionResult<StartCheckoutOutcome>> {
  const res = await runAction(async (s): Promise<StartCheckoutOutcome> => {
    assertPayer(s);
    if (!isObj(input)) throw new InvalidInput(BAD_ORDER);
    const choices = clean(input.choices);
    const expectedDueTodayCents = cents(input.expectedDueTodayCents);
    // AGR-02 at the web edge: no billing call for an unsigned or outdated owner.
    try {
      await requireCurrentSignature(s.ctx);
    } catch (err) {
      if (codeOf(err) === "agreement_required") {
        return { redirect: AGREEMENT_NEXT };
      }
      throw err;
    }
    try {
      const { url } = await startCheckout(
        s.ctx,
        choices,
        { expectedDueTodayCents },
        { registry: ADDON_REGISTRY },
      );
      return { url };
    } catch (err) {
      switch (codeOf(err)) {
        case "agreement_required":
          return { redirect: AGREEMENT_NEXT };
        case "already_paid":
          return { redirect: `${BILLING_TAB}&notice=already-paid` };
        case "price_changed":
          return { error: "price_changed" };
        case "checkout_blocked": {
          const list = (err as { unpriced?: unknown }).unpriced;
          return {
            error: "unpriced",
            unpriced: Array.isArray(list)
              ? list.filter((x): x is string => typeof x === "string")
              : [],
          };
        }
        case "payments_unavailable":
          return { error: "open_soon" };
        case "forbidden":
        case "impersonation_denied":
          throw err;
        default:
          // Message only: never the stack, the order or the owner's details.
          console.error(
            "[checkout] start failed",
            err instanceof Error ? err.message : typeof err,
          );
          return { error: "failed" };
      }
    }
  }, COPY);
  // runAction's own re-accept gate (outdated owner) is a redirect here too.
  if (!res.ok && res.code === "agreement_required") {
    return { ok: true, data: { redirect: AGREEMENT_NEXT } };
  }
  return res;
}

/** Save the owner's choices and return the re-priced order (10-22 choice 1). */
export async function previewCheckoutAction(input: unknown): Promise<
  ActionResult<{
    view: CheckoutOrderView;
    liveText: string;
    draft: CheckoutChoicesView;
  }>
> {
  const res = await runAction(async (s) => {
    assertPayer(s);
    const choices = clean(input);
    const saved = await saveCheckoutDraft(s.ctx, choices, ADDON_REGISTRY);
    const order = (await checkoutOrderFor(s.ctx, saved, {
      registry: ADDON_REGISTRY,
    })) as PricedOrder;
    const view = buildOrderView(order, manifests());
    return { view, liveText: view.liveText, draft: view.choices };
  }, COPY);
  if (res.ok) refreshHub();
  return res;
}

/** The return page's poll: the caller org's own session only (T-10-22-03). */
export async function checkoutStatusAction(
  sessionId: unknown,
): Promise<ActionResult<CheckoutStatusOutcome>> {
  return runAction(async (s): Promise<CheckoutStatusOutcome> => {
    if (typeof sessionId !== "string" || !SESSION_RE.test(sessionId)) {
      return { state: "failed" };
    }
    const st = await checkoutReturnStatus(s.ctx, sessionId, {
      registry: ADDON_REGISTRY,
    });
    if (st.state === "received") {
      return { state: "received", paid: paidLines(st) };
    }
    if (st.state === "confirming") return { state: "confirming" };
    // unknown (not this org's session) and failed: no data either way.
    return { state: "failed" };
  });
}
