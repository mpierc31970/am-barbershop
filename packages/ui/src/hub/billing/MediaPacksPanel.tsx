"use client";
// MediaPacksPanel (10-13; 10-UI-SPEC section 5, BILL-13, D225): media storage and its
// packs. The media meter "1.2 GB of 7 GB used", Included · 2 GB, one row per pack size
// with its count and price, Add 5 GB / Add 25 GB through ChargeConfirmDialog (one
// confirm; every price label comes from the server's view, never typed here, WR-C05),
// confirm), and Remove one: refused in place with PACK-REMOVE-REFUSED (no dialog) when
// it would overfill, else a danger confirm with the keep button focused. Controlled: the
// server builds the view (labels, ratio, refusal) and runs the actions; `canBuy` comes
// from the server permission (T-10-13-03).
import { useState } from "react";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { UsageMeter } from "../UsageMeter";
import { ChargeConfirmDialog } from "./ChargeConfirmDialog";
import { RemoveConfirmDialog, useChargeFlow } from "./purchase-dialogs";
import type {
  ChargePreview,
  ChargeResult,
  MediaPackSize,
  MediaPacksView,
} from "./types";

const PACK_GB: Record<MediaPackSize, number> = { "5gb": 5, "25gb": 25 };

/** "Add 5 GB, $5/mo" (the price from the view). */
export function addPackLabel(size: MediaPackSize, price: string): string {
  return `Add ${PACK_GB[size]} GB, ${price}`;
}

/** The Remove dialog body; the amount only when the server knows it. */
export function removePackBody(
  size: MediaPackSize,
  drop: string | null,
): string {
  const gb = PACK_GB[size];
  return drop
    ? `Your storage drops by ${gb} GB and your bill drops by ${drop} a month, credited for the rest of this month.`
    : `Your storage drops by ${gb} GB and your bill goes down, credited for the rest of this month.`;
}

export const PACKS_COPY = {
  heading: "Media storage",
  included: "Included · 2 GB",
  removeOne: "Remove one",
  removeConfirm: "Remove pack",
  keep: "Keep pack",
} as const;

export interface MediaPacksPanelProps {
  view: MediaPacksView;
  canBuy: boolean;
  loadPreview: (size: MediaPackSize) => Promise<ChargePreview>;
  /** Confirm with the preview's token (CR-C01). */
  onAdd: (size: MediaPackSize, token: string) => Promise<ChargeResult>;
  onRemove: (size: MediaPackSize) => Promise<ChargeResult>;
  updateCardHref: string;
}

export function MediaPacksPanel({
  view,
  canBuy,
  loadPreview,
  onAdd,
  onRemove,
  updateCardHref,
}: MediaPacksPanelProps) {
  const flow = useChargeFlow<MediaPackSize>(loadPreview);
  const [removing, setRemoving] = useState<MediaPackSize | null>(null);
  const [refused, setRefused] = useState<MediaPackSize | null>(null);

  const ratio = Math.max(0, view.ratio);
  const label = `${view.usedLabel} of ${view.allowanceLabel} used`;

  const askRemove = (size: MediaPackSize) => {
    if (view.removeRefusal[size]) {
      setRefused(size);
      return;
    }
    setRefused(null);
    setRemoving(size);
  };

  const removeSize: MediaPackSize = removing ?? "5gb";

  return (
    <section
      aria-labelledby="media-packs-heading"
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <h2 id="media-packs-heading" className="text-lg font-semibold">
        {PACKS_COPY.heading}
      </h2>
      <UsageMeter
        usage={{
          usedBytes: 0,
          allowanceBytes: 0,
          ratio,
          level: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok",
          label,
          message: "",
        }}
      />
      <ul className="flex flex-col divide-y divide-hub-border text-sm tabular-nums">
        <li className="flex min-h-11 items-center py-2">
          {PACKS_COPY.included}
        </li>
        {(["5gb", "25gb"] as const).map((size) => {
          const price = view.prices[size];
          const count = size === "5gb" ? view.packs5 : view.packs25;
          return (
            <li key={size} className="flex flex-col gap-2 py-2">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                <span>
                  {`+${PACK_GB[size]} GB pack × ${count}`}
                  {count > 0 && price.current ? ` · ${price.current}` : ""}
                </span>
                {canBuy && count > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => askRemove(size)}
                  >
                    {PACKS_COPY.removeOne}
                  </Button>
                ) : null}
              </div>
              {refused === size && view.removeRefusal[size] ? (
                <InlineAlert tone="warning">
                  {view.removeRefusal[size]}
                </InlineAlert>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canBuy ? (
        <div className="flex flex-wrap gap-2">
          {(["5gb", "25gb"] as const).map((size) => {
            const add = view.prices[size].add;
            // An unpriced size ("Price coming soon") is not offered (D264).
            return add ? (
              <Button
                key={size}
                variant="secondary"
                onClick={() => flow.start(size)}
              >
                {addPackLabel(size, add)}
              </Button>
            ) : null;
          })}
        </div>
      ) : null}
      {flow.error ? <InlineAlert tone="error">{flow.error}</InlineAlert> : null}
      <ChargeConfirmDialog
        open={flow.open}
        preview={flow.preview}
        onConfirm={(token) => onAdd(flow.target ?? "5gb", token)}
        onClose={flow.close}
        updateCardHref={updateCardHref}
      />
      <RemoveConfirmDialog
        open={removing !== null}
        title={`Remove a ${PACK_GB[removeSize]} GB pack?`}
        body={removePackBody(removeSize, view.prices[removeSize].drop)}
        removeLabel={PACKS_COPY.removeConfirm}
        keepLabel={PACKS_COPY.keep}
        onRemove={() => onRemove(removing ?? "5gb")}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
