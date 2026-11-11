"use client";
// The live receipt: the /start signature element (ONB-06; 06-UI-SPEC "Receipt", Motion and
// Accessibility contracts; D79, D181, D186, D262, D296, D299, D314). Itemised like a
// printed quote: labels left, amounts right in tabular figures, a dashed rule above the
// totals, one Display figure (Due at checkout).
//
// Every figure comes from priceQuote(): the client copy runs on each change for instant
// feedback, and the parent passes the server-recomputed totals (`serverTotals`) once the
// latest save has come back, which then win (T-06-76). The UI never adds up a price.
//
// `interactive={false}` is the JS-off receipt (D-UI-P6-36): the billing control and the
// Care Plan switch are left out, because the no-script form carries those inputs.
import type { AddonPath } from "@cds/core/addons";
import type { Extra, PathInfo } from "@cds/core/onboarding";
import {
  formatCents,
  formatMonthly,
  priceQuote,
  type BillingCadence,
  type CatalogRow,
  type QuoteSelections,
  type QuoteTotals,
} from "@cds/core/pricing";
import { Button, SegmentedControl, Switch } from "@cds/ui/hub";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { catalogRow, PRICE_SOON } from "./start-logic";

export const EMPTY_RECEIPT =
  "Pick a path to see your price. Every figure here is the real price, before you commit.";
export const SUBMIT_HINT = "Choose your path and business type first.";
export const PRICES_FAILED = "We couldn't load prices just now.";
export const ANNOUNCE_DEBOUNCE_MS = 1000;
export const SUBMIT_HREF = "/start/submit";

export interface ReceiptProps {
  catalog: readonly CatalogRow[] | null;
  path: AddonPath | "";
  /** A business type is chosen (with its text when it is "Something else"). */
  typeChosen: boolean;
  selections: QuoteSelections;
  /** Server-recomputed totals for exactly these choices; null while a save is pending. */
  serverTotals?: QuoteTotals | null;
  /** Add-on slug -> display name. */
  addonNames: Readonly<Record<string, string>>;
  extras: readonly Extra[];
  paths: readonly PathInfo[];
  /** The address the quote is saved to, if any ("Saved to …"). */
  savedEmail?: string | null;
  interactive?: boolean;
  onCadence?: (cadence: BillingCadence) => void;
  onCarePlan?: (on: boolean) => void;
  /** "Save this quote": opens the save card in place. Omitted: no link. */
  onSaveLink?: () => void;
  /** Heading level id prefix; one receipt is mounted at a time. */
  idPrefix?: string;
  /**
   * Replaces Review and submit and the save link (06-17: the read-only receipt on
   * /start/submit shows "Change your quote" instead).
   */
  actions?: ReactNode;
}

/** "$39/mo" or "Price coming soon". */
function monthly(c: number | null): string {
  return c === null ? PRICE_SOON : formatMonthly(c);
}

function once(c: number | null): string {
  return c === null ? PRICE_SOON : formatCents(c);
}

/** "+ 1 item priced soon" / "+ 2 items priced soon". */
export function unpricedNote(n: number): string | null {
  if (n <= 0) return null;
  return `+ ${n} ${n === 1 ? "item" : "items"} priced soon`;
}

/** What the polite live line says: totals only (UI-SPEC Accessibility contract). */
export function totalsAnnouncement(t: QuoteTotals): string {
  return `Due at checkout now ${formatCents(t.dueAtCheckoutCents)}. Monthly ${formatCents(t.monthlyCents)}.`;
}

/** The totals the receipt shows: the server's when in sync, else the client's priceQuote. */
export function receiptTotals(
  catalog: readonly CatalogRow[] | null,
  path: AddonPath | "",
  selections: QuoteSelections,
  serverTotals: QuoteTotals | null | undefined,
): QuoteTotals | null {
  if (!path || !catalog) return null;
  if (serverTotals && serverTotals.path === path) return serverTotals;
  return priceQuote(catalog, selections, path, selections.cadence);
}

function Line({
  label,
  amount,
  sub,
  muted,
}: {
  label: ReactNode;
  amount: string;
  sub?: string | null;
  muted?: boolean;
}) {
  return (
    <li className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0">{label}</span>
        <span
          className={
            "shrink-0 text-right tabular-nums " +
            (muted || amount === PRICE_SOON ? "text-sm text-hub-ink-muted" : "")
          }
        >
          {amount}
        </span>
      </div>
      {sub ? <span className="text-sm text-hub-ink-muted">{sub}</span> : null}
    </li>
  );
}

const CADENCES: readonly { value: BillingCadence; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly, 2 months free" },
];

/** A figure that cross-fades (150 ms) whenever its text changes. */
function Figure({ text, className }: { text: string; className?: string }) {
  return (
    <span
      key={text}
      className={
        "tabular-nums transition-opacity duration-150 starting:opacity-0 " +
        "motion-reduce:transition-none " +
        (className ?? "")
      }
    >
      {text}
    </span>
  );
}

export function Receipt({
  catalog,
  path,
  typeChosen,
  selections,
  serverTotals,
  addonNames,
  extras,
  paths,
  savedEmail,
  interactive = true,
  onCadence,
  onCarePlan,
  onSaveLink,
  idPrefix = "receipt",
  actions,
}: ReceiptProps) {
  const totals = receiptTotals(catalog, path, selections, serverTotals);
  const titleId = `${idPrefix}-title`;

  // The live line: totals only, debounced 1 s, never the first render.
  const summary = totals ? totalsAnnouncement(totals) : "";
  const [announced, setAnnounced] = useState("");
  const lastSummary = useRef(summary);
  useEffect(() => {
    if (summary === lastSummary.current) return;
    const timer = setTimeout(() => {
      lastSummary.current = summary;
      setAnnounced(summary);
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [summary]);

  // The Due figure's row gets a 600 ms tint after a change (not on first render).
  const dueText = totals ? formatCents(totals.dueAtCheckoutCents) : "";
  const firstDue = useRef(dueText);
  const tint = dueText !== firstDue.current;

  const pathInfo = paths.find((p) => p.id === path);
  const canSubmit = Boolean(path) && typeChosen;
  const note = totals ? unpricedNote(totals.unpricedCount) : null;
  const careRow = path ? catalogRow(catalog, "care_plan", "care", path) : null;
  const carePrice =
    typeof careRow?.monthlyCents === "number"
      ? formatMonthly(careRow.monthlyCents)
      : PRICE_SOON;
  const extraLabel = (key: string) =>
    extras.find((e) => e.key === key)?.label ?? key;

  return (
    <aside
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-base text-hub-ink"
    >
      <div>
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          Your quote
        </h2>
        {pathInfo ? (
          <p className="text-sm text-hub-ink-muted">{pathInfo.label} website</p>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {announced}
      </p>

      {!path ? (
        <p className="text-hub-ink-muted">{EMPTY_RECEIPT}</p>
      ) : !totals ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p>{PRICES_FAILED}</p>
          {interactive ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <section aria-label="One-time" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">One-time</h3>
            <ul className="flex flex-col gap-4">
              <Line
                label="Website build"
                amount={once(totals.build.cents)}
                sub={
                  totals.build.cents !== null &&
                  totals.build.installments > 1 &&
                  totals.build.eachCents !== null
                    ? `or ${totals.build.installments} × ${formatCents(totals.build.eachCents)} with no surcharge`
                    : null
                }
              />
              {totals.extras.map((e) => (
                <Line
                  key={e.key}
                  label={extraLabel(e.key)}
                  amount={once(e.oneTimeCents)}
                />
              ))}
            </ul>
          </section>

          <section aria-label="Monthly" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Monthly</h3>
            <ul className="flex flex-col gap-4">
              <Line
                label={`${pathInfo?.label ?? path} plan`}
                amount={monthly(totals.plan.monthlyCents)}
                sub="Hosting, support and 10 pages"
              />
              {totals.addons.map((a, i) => (
                <Line
                  key={a.key}
                  label={addonNames[a.key] ?? a.key}
                  amount={monthly(a.monthlyCents)}
                  sub={i === 0 ? "Added now, setup is free" : null}
                />
              ))}
              {!interactive && totals.carePlan ? (
                <Line
                  label="Care Plan"
                  amount={monthly(totals.carePlan.monthlyCents)}
                />
              ) : null}
            </ul>
            {interactive ? (
              <div className="flex flex-col gap-1">
                <Switch
                  id={`${idPrefix}-care`}
                  label={`Add the Care Plan · ${carePrice}`}
                  checked={selections.carePlan}
                  onChange={(on) => onCarePlan?.(on)}
                  aria-describedby={`${idPrefix}-care-help`}
                />
                <p
                  id={`${idPrefix}-care-help`}
                  className="text-sm text-hub-ink-muted"
                >
                  We make changes for you, beyond how-to help.
                </p>
              </div>
            ) : null}
          </section>

          {interactive ? (
            <div className="flex flex-col gap-2">
              <span
                id={`${idPrefix}-billing`}
                className="text-sm font-semibold"
              >
                Billing
              </span>
              <SegmentedControl
                name={`${idPrefix}-cadence`}
                label="Billing"
                labelledBy={`${idPrefix}-billing`}
                options={CADENCES}
                value={selections.cadence}
                onChange={(c) => onCadence?.(c)}
              />
              {selections.cadence === "yearly" ? (
                <p className="text-sm text-hub-ink-muted">
                  Yearly covers the plan and add-ons. The build fee is the same.
                </p>
              ) : null}
            </div>
          ) : null}

          <hr className="border-0 border-t border-dashed border-hub-border-strong" />

          <div className="flex flex-col gap-2">
            <div
              key={tint ? `due-${dueText}` : "due"}
              className={
                "-mx-2 flex items-baseline justify-between gap-4 rounded px-2 " +
                (tint
                  ? "transition-colors duration-[600ms] starting:bg-hub-accent-tint motion-reduce:transition-none motion-reduce:starting:bg-transparent"
                  : "")
              }
            >
              <span className="font-semibold">Due at checkout</span>
              <Figure
                text={dueText}
                className="text-[1.75rem] leading-tight font-semibold"
              />
            </div>
            {totals.build.cents !== null && totals.build.installments > 1 ? (
              <p className="text-sm text-hub-ink-muted tabular-nums">
                With {totals.build.installments} build payments:{" "}
                {formatCents(totals.dueAtCheckoutWithInstallmentsCents)} at
                checkout
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-4">
              <span>First-year total</span>
              <Figure
                text={formatCents(totals.firstYearCents)}
                className="font-semibold"
              />
            </div>
          </div>

          {note ? <p className="text-sm text-hub-ink-muted">{note}</p> : null}

          <div className="flex flex-col gap-1 text-sm text-hub-ink-muted">
            <p>Plus sales tax where applicable.</p>
            <p>
              You pay your own payment processor&apos;s fees. We take no cut.
            </p>
          </div>
        </>
      )}

      {actions ? (
        <div className="flex flex-col gap-2">{actions}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {canSubmit ? (
            <Link
              href={SUBMIT_HREF}
              className="inline-flex h-10 w-full items-center justify-center rounded bg-hub-accent font-semibold text-hub-surface transition-colors duration-150 hover:bg-hub-accent-hover pointer-coarse:min-h-11"
            >
              Review and submit
            </Link>
          ) : (
            <>
              <a
                role="link"
                aria-disabled="true"
                aria-describedby={`${idPrefix}-submit-hint`}
                tabIndex={0}
                className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded bg-hub-accent font-semibold text-hub-surface opacity-50 pointer-coarse:min-h-11"
              >
                Review and submit
              </a>
              <p
                id={`${idPrefix}-submit-hint`}
                className="text-sm text-hub-ink-muted"
              >
                {SUBMIT_HINT}
              </p>
            </>
          )}
          {savedEmail ? (
            <p className="text-sm text-hub-ink-muted">Saved to {savedEmail}</p>
          ) : path && onSaveLink ? (
            <button
              type="button"
              onClick={onSaveLink}
              className="self-start text-sm text-hub-accent underline underline-offset-4"
            >
              Save this quote
            </button>
          ) : null}
        </div>
      )}
    </aside>
  );
}
