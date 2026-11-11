// /hub/checkout: the owner's checkout review (10-22; AGR-02, BILL-01, BILL-10, BILL-11,
// BILL-15, BILL-19; CONTEXT A2; 10-UI-SPEC "Checkout"; D181, D262, D296, D299, D314,
// D-UI-P10-1..7). Operate mode: the focal point is Due today, then Continue to payment.
// The agreement gate stays on (requireHubSession default) for re-accept; an owner who never
// signed sees the order read-only with ERR-GATE and Review and sign. Every figure comes from
// the server (checkoutOrderFor → priceQuote); the client island adds nothing up.
// Who sees what: Owner interactive; Admin and staff impersonating read-only; Editor and
// Viewer → /hub; intake → /hub/setup; fit_review → HELD-CHECKOUT only; paid → Billing tab;
// closed → /hub; production on the fake adapter → OPEN-SOON; catalog failure → ERR-PRICES.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { can } from "@cds/core";
import { checkoutOrderFor, readCheckoutState } from "@cds/db";
import { EmptyState, InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FrameTitle } from "../FrameTitle";
import { getAgreementStatus } from "../../../../lib/agreement-gate";
import {
  BILLING_TAB,
  CHECKOUT_TITLE,
  ERR_PRICES,
  HELD_CHECKOUT,
  INTRO_CHECKOUT,
  OPEN_SOON_B,
  OPEN_SOON_H,
  buildOrderView,
  type CheckoutOrderView,
  type PricedOrder,
} from "../../../../lib/checkout-order";
import { requireHubSession } from "../../../../lib/session";
import {
  CheckoutForm,
  type CheckoutMode,
  type CheckoutNotice,
} from "./CheckoutForm";

export const metadata: Metadata = { title: CHECKOUT_TITLE };

export const dynamic = "force-dynamic";

const COLUMN = "mx-auto flex w-full max-w-[720px] flex-col gap-6 font-hub pt-8";
const WIDE = "mx-auto flex w-full max-w-[1128px] flex-col gap-6 font-hub pt-8";
const H1 = "text-[1.75rem] leading-tight font-semibold text-hub-ink";
const READY = new Set(["ready_for_build", "being_built"]);

type Search = {
  cancelled?: string | string[];
  payment?: string | string[];
  price?: string | string[];
};

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function noticeOf(sp: Search): CheckoutNotice {
  if (one(sp.payment) === "failed") return "payment_failed";
  if (one(sp.price) === "changed") return "price_changed";
  if (one(sp.cancelled) === "1") return "cancelled";
  return null;
}

function Header() {
  return (
    <div className="flex flex-col gap-2">
      <FrameTitle className={H1} helpId="checkout" name="checkout">
        {CHECKOUT_TITLE}
      </FrameTitle>
      <p className="max-w-[56ch] text-base text-hub-ink-muted">
        {INTRO_CHECKOUT}
      </p>
    </div>
  );
}

function LoadError() {
  return (
    <div className={COLUMN}>
      <FrameTitle className={H1} helpId="checkout" name="checkout">
        {CHECKOUT_TITLE}
      </FrameTitle>
      <InlineAlert
        tone="error"
        action={
          <Link
            href="/hub/checkout"
            className={buttonClasses("secondary", "sm")}
          >
            Try again
          </Link>
        }
      >
        {ERR_PRICES}
      </InlineAlert>
    </div>
  );
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireHubSession();
  const { ctx } = session;
  // Editors and Viewers have no billing surface (Owner pays; Admin reads, UI-SPEC).
  if (!can(ctx, "addons", "read")) redirect("/hub");
  const sp = await searchParams;

  let state;
  try {
    state = await readCheckoutState(ctx);
  } catch (err) {
    console.error(
      "[checkout] state failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <LoadError />;
  }

  if (state.closed) redirect("/hub");
  if (state.paidAt) redirect(`${BILLING_TAB}&notice=already-paid`);
  if (state.stage === "fit_review") {
    return (
      <div className={COLUMN}>
        <FrameTitle className={H1} helpId="checkout" name="checkout">
          {CHECKOUT_TITLE}
        </FrameTitle>
        <InlineAlert
          tone="info"
          action={
            <Link href="/hub/setup" className={buttonClasses("ghost", "sm")}>
              Back to setting up your site
            </Link>
          }
        >
          {HELD_CHECKOUT}
        </InlineAlert>
      </div>
    );
  }
  if (!READY.has(state.stage) || state.path === "") redirect("/hub/setup");
  if (!state.paymentsOpen) {
    return (
      <div className={COLUMN}>
        <FrameTitle className={H1} helpId="checkout" name="checkout">
          {CHECKOUT_TITLE}
        </FrameTitle>
        <EmptyState heading={OPEN_SOON_H} body={OPEN_SOON_B} />
      </div>
    );
  }

  let view: CheckoutOrderView;
  let mode: CheckoutMode;
  let ownerName: string | null = null;
  try {
    const [order, status] = await Promise.all([
      checkoutOrderFor(ctx, null, { registry: ADDON_REGISTRY }),
      getAgreementStatus(ctx),
    ]);
    view = buildOrderView(order as PricedOrder, ADDON_REGISTRY.list());
    ownerName = status.lastSignerName;
    mode = ctx.impersonator
      ? "impersonating"
      : ctx.role !== "owner"
        ? "admin"
        : status.state !== "current"
          ? "unsigned"
          : "interactive";
  } catch (err) {
    console.error(
      "[checkout] order failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <LoadError />;
  }

  return (
    <div className={WIDE}>
      <Header />
      <CheckoutForm
        initial={view}
        mode={mode}
        notice={noticeOf(sp)}
        testMode={state.testMode}
        ownerName={ownerName}
        signHref="/hub/agreement?next=/hub/checkout"
      />
    </div>
  );
}
