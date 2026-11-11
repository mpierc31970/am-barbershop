"use client";
// CarePlanPanel (10-13; 10-UI-SPEC section 4, BILL-19, D299): the optional Care Plan.
// Off: CARE-OFF and, for buyers, Add the Care Plan, {price}/mo through ChargeConfirmDialog
// (the label comes from the server's catalog price, WR-C05; no button while it is unset).
// On: the minutes meter ("25 of 60 minutes used in October"; ink, warning at 48, danger
// at 60 via the UsageMeter 80%/100% rule), CARE-RESET, up to 5 entries newest first with
// a Show all disclosure, and Remove the Care Plan behind a danger confirm with Keep Care
// Plan focused. Controlled: the server builds the view and runs the actions; `canBuy`
// comes from the server permission (T-10-13-03), which the actions check again.
import { useState } from "react";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { UsageMeter } from "../UsageMeter";
import { ChargeConfirmDialog } from "./ChargeConfirmDialog";
import { RemoveConfirmDialog, useChargeFlow } from "./purchase-dialogs";
import type { CarePlanView, ChargePreview, ChargeResult } from "./types";

/** The Care Plan's monthly hour (D299). */
export const CARE_PLAN_MINUTES = 60;
const ENTRY_LIMIT = 5;

export const CARE_COPY = {
  heading: "Care Plan",
  off: "1 hour a month of changes made for you by Support, on top of the support every plan includes. Unused time doesn't carry over.",
  meterLabel: "Care Plan minutes used",
  empty: "No time used yet this month.",
  remove: "Remove the Care Plan",
  removeTitle: "Remove the Care Plan?",
  removeBody:
    "Support stops making changes for you today, and your next bill is credited for the rest of the month. The support every plan includes doesn't change.",
  removeConfirm: "Remove Care Plan",
  keep: "Keep Care Plan",
} as const;

export interface CarePlanPanelProps {
  view: CarePlanView;
  canBuy: boolean;
  loadAddPreview: () => Promise<ChargePreview>;
  /** Confirm with the preview's token (CR-C01). */
  onAdd: (token: string) => Promise<ChargeResult>;
  onRemove: () => Promise<ChargeResult>;
  updateCardHref: string;
}

export function CarePlanPanel({
  view,
  canBuy,
  loadAddPreview,
  onAdd,
  onRemove,
  updateCardHref,
}: CarePlanPanelProps) {
  const flow = useChargeFlow<"care">(() => loadAddPreview());
  const [removing, setRemoving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const used = Math.max(0, view.usedMinutes);
  const ratio = used / CARE_PLAN_MINUTES;
  const label = `${used} of ${CARE_PLAN_MINUTES} minutes used in ${view.monthLabel}`;
  const entries = showAll ? view.entries : view.entries.slice(0, ENTRY_LIMIT);
  const more = view.entries.length > ENTRY_LIMIT && !showAll;

  return (
    <section
      aria-labelledby="care-plan-heading"
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <h2 id="care-plan-heading" className="text-lg font-semibold">
        {CARE_COPY.heading}
      </h2>
      {view.on ? (
        <>
          <UsageMeter
            label={CARE_COPY.meterLabel}
            usage={{
              usedBytes: used,
              allowanceBytes: CARE_PLAN_MINUTES,
              ratio,
              level: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok",
              label,
              message: "",
            }}
          />
          <p className="text-sm text-hub-ink-muted">{view.resetLabel}</p>
          {view.entries.length === 0 ? (
            <p className="text-sm text-hub-ink-muted">{CARE_COPY.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {entries.map((e, i) => (
                <li
                  key={`${e.date}-${i}`}
                  data-care-entry=""
                  className="flex flex-wrap gap-x-2 tabular-nums"
                >
                  <span>{e.date}</span>
                  <span aria-hidden="true">·</span>
                  <span>{e.minutes} min</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-hub-ink-muted">{e.note}</span>
                </li>
              ))}
            </ul>
          )}
          {more ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={false}
                onClick={() => setShowAll(true)}
              >
                {`Show all ${view.totalEntries}`}
              </Button>
            </div>
          ) : null}
          {canBuy ? (
            <div>
              <Button
                variant="secondary"
                size="sm"
                className="text-hub-danger"
                onClick={() => setRemoving(true)}
              >
                {CARE_COPY.remove}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="max-w-[68ch]">{CARE_COPY.off}</p>
          {canBuy && view.addLabel ? (
            <div>
              <Button variant="secondary" onClick={() => flow.start("care")}>
                {view.addLabel}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {flow.error ? <InlineAlert tone="error">{flow.error}</InlineAlert> : null}
      <ChargeConfirmDialog
        open={flow.open}
        preview={flow.preview}
        onConfirm={onAdd}
        onClose={flow.close}
        updateCardHref={updateCardHref}
      />
      <RemoveConfirmDialog
        open={removing}
        title={CARE_COPY.removeTitle}
        body={CARE_COPY.removeBody}
        removeLabel={CARE_COPY.removeConfirm}
        keepLabel={CARE_COPY.keep}
        onRemove={onRemove}
        onClose={() => setRemoving(false)}
      />
    </section>
  );
}
