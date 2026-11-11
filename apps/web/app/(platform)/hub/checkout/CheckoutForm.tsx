"use client";
// Checkout client island (10-22; 10-UI-SPEC "Checkout"; D181, D299, D314, D-UI-P10-1..6).
// Renders the server's order view and never adds up a price: every change (build plan,
// Remove / Undo of an add-on or extra, Care Plan, cadence) goes to previewCheckoutAction,
// which saves the draft and returns the re-priced view (10-22 choice 1). Continue to payment
// posts the Due today figure the owner saw; a mismatch reloads the order with PRICE-CHANGED
// (choice 2). The action returns { url } / { redirect }; navigation happens here (choice 3).
// Extras are remove-only (choice 5, D-UI-P10-5). Read-only for Admin, staff impersonating
// and an owner who has not signed (ERR-GATE + Review and sign).
import {
  BuildFeeChoice,
  CheckoutSummary,
  type BuildFeeValue,
} from "@cds/ui/hub/billing";
import {
  Button,
  EmptyState,
  InlineAlert,
  SegmentedControl,
  Switch,
  buttonClasses,
  useToast,
} from "@cds/ui/hub";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CADENCE_HELPER,
  CANCELLED_CHECKOUT,
  CARE_HELPER,
  CONTINUE_LABEL,
  ERR_CHECKOUT,
  ERR_GATE,
  ERR_PAY,
  IMPERSONATING_PAY,
  MORE_ADDONS,
  OPEN_SOON_B,
  OPEN_SOON_H,
  PENDING_LABEL,
  PRICE_CHANGED,
  TEST_CHECKOUT,
  UNPRICED_COPY,
  notOwnerPay,
  removedToast,
  unpricedReason,
  type CheckoutChoicesView,
  type CheckoutOrderView,
  type CheckoutRow,
} from "../../../../lib/checkout-order";
import {
  previewCheckoutAction,
  startCheckoutAction,
} from "../../../actions/checkout";

export type CheckoutMode =
  "interactive" | "unsigned" | "admin" | "impersonating";
export type CheckoutNotice =
  "cancelled" | "payment_failed" | "price_changed" | null;

export const UPDATE_FAILED =
  "We couldn't update your order. Check your connection and try again.";
const NO_TOTAL = "Your total shows once every item in your order has a price.";

const CADENCE_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly, 2 months free" },
] as const;

const H2 = "text-xl leading-tight font-semibold text-hub-ink";
const SECTION = "flex flex-col gap-4 pt-12 first:pt-0";
const ROW =
  "flex items-start justify-between gap-4 border-b border-hub-border py-4";

export interface CheckoutFormProps {
  initial: CheckoutOrderView;
  mode: CheckoutMode;
  notice: CheckoutNotice;
  testMode: boolean;
  ownerName: string | null;
  /** Review and sign, returning here (`/hub/agreement?next=/hub/checkout`). */
  signHref: string;
}

function OrderRow({
  row,
  disabled,
  onRemove,
}: {
  row: CheckoutRow;
  disabled: boolean;
  onRemove: (row: CheckoutRow) => void;
}) {
  return (
    <li className="flex flex-col">
      <div className={ROW}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-hub-ink">
            {row.name}
          </span>
          {row.sub ? (
            <span className="text-sm text-hub-ink-muted">{row.sub}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={
              row.unpriced || row.amountLabel === "Included"
                ? "text-sm text-hub-ink-muted"
                : "text-base font-semibold text-hub-ink tabular-nums"
            }
          >
            {row.amountLabel}
          </span>
          {row.removable ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Remove ${row.name} from your order`}
              className="min-h-11"
              onClick={() => onRemove(row)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {row.unpriced ? (
        <div className="pb-4">
          <InlineAlert tone="warning">{UNPRICED_COPY}</InlineAlert>
        </div>
      ) : null}
    </li>
  );
}

export function CheckoutForm({
  initial,
  mode,
  notice: initialNotice,
  testMode,
  ownerName,
  signHref,
}: CheckoutFormProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/hub/checkout";
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<CheckoutNotice>(initialNotice);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [openSoon, setOpenSoon] = useState(false);
  const choicesRef = useRef<CheckoutChoicesView>(initial.choices);
  const seq = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);

  const readOnly = mode !== "interactive";
  const controlsDisabled = readOnly || submitting;

  // The return notices are one-time: strip them from the URL after the first render.
  const hasNoticeParam =
    params?.has("cancelled") || params?.has("payment") || params?.has("price");
  useEffect(() => {
    if (!hasNoticeParam) return;
    router.replace(pathname, { scroll: false });
  }, [hasNoticeParam, pathname, router]);

  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  async function change(next: CheckoutChoicesView): Promise<boolean> {
    if (readOnly) return false;
    const mine = ++seq.current;
    const previous = choicesRef.current;
    choicesRef.current = next;
    setView((v) => ({ ...v, choices: next }));
    setUpdating(true);
    setUpdateError(null);
    try {
      const res = await previewCheckoutAction(next);
      if (mine !== seq.current) return true;
      if (res.ok) {
        choicesRef.current = res.data.view.choices;
        setView(res.data.view);
        return true;
      }
      choicesRef.current = previous;
      setView((v) => ({ ...v, choices: previous }));
      setUpdateError(res.message);
      return false;
    } catch {
      if (mine !== seq.current) return false;
      choicesRef.current = previous;
      setView((v) => ({ ...v, choices: previous }));
      setUpdateError(UPDATE_FAILED);
      return false;
    } finally {
      if (mine === seq.current) setUpdating(false);
    }
  }

  function remove(row: CheckoutRow) {
    const c = choicesRef.current;
    const field = row.kind === "addon" ? "addons" : "extras";
    const next = { ...c, [field]: c[field].filter((k) => k !== row.key) };
    void change(next).then((ok) => {
      if (!ok) return;
      toast.show({
        message: removedToast(row.name),
        action: {
          label: "Undo",
          onClick: () => {
            const now = choicesRef.current;
            if (now[field].includes(row.key)) return;
            void change({ ...now, [field]: [...now[field], row.key] });
          },
        },
      });
    });
  }

  async function reprice() {
    try {
      const res = await previewCheckoutAction(choicesRef.current);
      if (res.ok) {
        choicesRef.current = res.data.view.choices;
        setView(res.data.view);
      }
    } catch {
      // The order on screen stays; the next change or reload re-prices it.
    }
  }

  async function pay() {
    const summary = view.summary;
    if (!summary || submitting || readOnly || updating) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await startCheckoutAction({
        choices: choicesRef.current,
        expectedDueTodayCents: summary.dueTodayCents,
      });
      if (!res.ok) {
        setSubmitError(res.message);
        setSubmitting(false);
        return;
      }
      const out = res.data;
      if ("url" in out) {
        // External: Stripe Checkout or the CDS test page. Controls stay disabled.
        window.location.assign(out.url);
        return;
      }
      if ("redirect" in out) {
        router.push(out.redirect);
        return;
      }
      setSubmitting(false);
      if (out.error === "price_changed") {
        setNotice("price_changed");
        await reprice();
      } else if (out.error === "unpriced") {
        await reprice();
      } else if (out.error === "open_soon") {
        setOpenSoon(true);
      } else {
        setSubmitError(ERR_CHECKOUT);
      }
    } catch {
      setSubmitting(false);
      setSubmitError(ERR_CHECKOUT);
    }
  }

  if (openSoon) {
    return <EmptyState heading={OPEN_SOON_H} body={OPEN_SOON_B} />;
  }

  const c = view.choices;
  const blocked = view.summary === null || view.unpricedNames.length > 0;
  const reasonId = "checkout-primary-reason";

  let primary;
  if (mode === "unsigned") {
    primary = (
      <div className="flex flex-col gap-4">
        <InlineAlert tone="info">{ERR_GATE}</InlineAlert>
        <Link
          href={signHref}
          className={`${buttonClasses("primary", "md")} w-full`}
        >
          Review and sign
        </Link>
      </div>
    );
  } else if (mode === "admin" || mode === "impersonating") {
    primary = null;
  } else {
    primary = (
      <div className="flex flex-col gap-2">
        {submitError ? (
          <div ref={errorRef} tabIndex={-1} className="outline-none">
            <InlineAlert tone="error">{submitError}</InlineAlert>
          </div>
        ) : null}
        <Button
          variant="primary"
          className="w-full"
          loading={submitting}
          loadingLabel={PENDING_LABEL}
          aria-disabled={blocked || updating ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => {
            if (blocked) return;
            void pay();
          }}
        >
          {CONTINUE_LABEL}
        </Button>
        {blocked ? (
          <p
            id={reasonId}
            aria-live="polite"
            className="text-sm text-hub-ink-muted"
          >
            {unpricedReason(view.unpricedNames)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {testMode ? <InlineAlert tone="info">{TEST_CHECKOUT}</InlineAlert> : null}
      {notice === "cancelled" ? (
        <InlineAlert tone="info">{CANCELLED_CHECKOUT}</InlineAlert>
      ) : null}
      {notice === "payment_failed" ? (
        <InlineAlert tone="error">{ERR_PAY}</InlineAlert>
      ) : null}
      {notice === "price_changed" ? (
        <InlineAlert tone="info">{PRICE_CHANGED}</InlineAlert>
      ) : null}
      {mode === "admin" ? (
        <InlineAlert tone="info">{notOwnerPay(ownerName)}</InlineAlert>
      ) : null}
      {mode === "impersonating" ? (
        <InlineAlert tone="info">{IMPERSONATING_PAY}</InlineAlert>
      ) : null}
      {updateError ? (
        <InlineAlert tone="error">{updateError}</InlineAlert>
      ) : null}

      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,720px)_360px]">
        <div className="flex min-w-0 flex-col">
          <section aria-labelledby="build-title" className={SECTION}>
            <h2 id="build-title" className={H2}>
              Your website build
            </h2>
            <BuildFeeChoice
              options={view.buildOptions}
              value={c.buildPlan}
              disabled={controlsDisabled}
              onChange={(v: BuildFeeValue) =>
                void change({ ...choicesRef.current, buildPlan: v })
              }
            />
          </section>

          <section aria-labelledby="plan-title" className={SECTION}>
            <h2 id="plan-title" className={H2}>
              Your plan
            </h2>
            <ul className="flex flex-col">
              <li className={ROW}>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-base font-semibold text-hub-ink">
                    {view.plan.name}
                  </span>
                  <span className="text-sm text-hub-ink-muted">
                    {view.plan.sub}
                  </span>
                </div>
                <span className="shrink-0 text-base font-semibold text-hub-ink tabular-nums">
                  {view.plan.amountLabel}
                </span>
              </li>
              {view.addonRows.map((row) => (
                <OrderRow
                  key={row.key}
                  row={row}
                  disabled={controlsDisabled}
                  onRemove={remove}
                />
              ))}
              <li className={`${ROW} flex-col`}>
                <Switch
                  id="care-plan"
                  label={view.carePlanLabel}
                  checked={c.carePlan}
                  disabled={controlsDisabled}
                  aria-describedby="care-plan-help"
                  onChange={(on) =>
                    void change({ ...choicesRef.current, carePlan: on })
                  }
                />
                <p id="care-plan-help" className="text-sm text-hub-ink-muted">
                  {CARE_HELPER}
                </p>
              </li>
            </ul>
            {view.extraRows.length > 0 ? (
              <div className="flex flex-col gap-2 pt-6">
                <h3
                  id="extras-title"
                  className="text-base font-semibold text-hub-ink"
                >
                  Extras
                </h3>
                <ul aria-labelledby="extras-title" className="flex flex-col">
                  {view.extraRows.map((row) => (
                    <OrderRow
                      key={row.key}
                      row={row}
                      disabled={controlsDisabled}
                      onRemove={remove}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-sm text-hub-ink-muted">{MORE_ADDONS}</p>
          </section>

          <section aria-labelledby="cadence-title" className={SECTION}>
            <h2 id="cadence-title" className={H2}>
              How often to pay
            </h2>
            <SegmentedControl
              name="cadence"
              label="How often to pay"
              labelledBy="cadence-title"
              options={CADENCE_OPTIONS}
              value={c.cadence}
              disabled={controlsDisabled}
              onChange={(v) =>
                void change({ ...choicesRef.current, cadence: v })
              }
            />
            <p className="text-sm text-hub-ink-muted">{CADENCE_HELPER}</p>
          </section>
        </div>

        <div className="lg:sticky lg:top-8">
          {view.summary ? (
            <CheckoutSummary
              view={view.summary}
              liveText={view.liveText}
              primary={primary}
            />
          ) : (
            <aside
              aria-labelledby="order-title"
              className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-base text-hub-ink"
            >
              <h2
                id="order-title"
                className="text-xl leading-tight font-semibold"
              >
                Your order
              </h2>
              <p className="text-sm text-hub-ink-muted">{NO_TOTAL}</p>
              {primary}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
