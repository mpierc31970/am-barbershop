"use client";
// PagesFullPanel (11-28; DASH-08, D185; UI-SPEC "Page allowance and page packs" › "At the
// limit"). Replaces the Add page primary and its inline row once the site has used its whole
// page allowance. One panel, one message, chosen by who is looking:
//   Owner                    PAGES-FULL (D185; allowance and catalog price, WR-C02)
//                            + primary "Add 5 more pages, {price}" (calls onBuy)
//   Admin, Editor, Viewer    PAGES-FULL-MEMBER, no action
//   CDS staff impersonating  IMPERSONATING-BUY, no action
//   Owner, billing paused    PAUSED-NO-ADD + link "Update card and pay"
//   Owner, pack unpriced     PAGES-FULL + aria-disabled button + UNPRICED-ADDON reason
// The server refuses every one of these again (`purchases:run`, impersonation deny-list,
// paused and unpriced checks in @cds/db charges.ts); this is only what the person sees.
import { pagesFullCopy, pagesFullMemberCopy } from "@cds/core/content";
import { Button, buttonClasses } from "@cds/ui/hub";
import Link from "next/link";
import {
  PAUSED_NO_ADD,
  UNPRICED_ADDON_REASON,
  UPDATE_CARD_AND_PAY,
} from "../add-ons/catalog-logic";
import { CARD_HREF } from "../settings/billing-copy";

export const PAGES_FULL_COPY = {
  /** UI-SPEC IMPERSONATING-BUY. */
  impersonating:
    "You're viewing as CDS staff, so buying is turned off. Only the owner can add pages.",
  paused: PAUSED_NO_ADD,
  unpriced: UNPRICED_ADDON_REASON,
  updateCardAndPay: UPDATE_CARD_AND_PAY,
  /** The inline refusal's owner link (UI-SPEC "Server refusal"). */
  addLink: "Add 5 more pages",
} as const;

/** "Add 5 more pages, $10/mo" (the price label comes from the server's catalog read). */
export function addPagesLabel(priceLabel: string | null): string {
  return priceLabel ? `Add 5 more pages, ${priceLabel}` : "Add 5 more pages";
}

/** Who is looking at the Pages tab: drives the at-limit message (server-built). */
export interface PagesFullWho {
  role: string;
  impersonating: boolean;
  /** Billing lapsed or canceled: nothing new is added (PAUSED-NO-ADD). */
  paused: boolean;
  /** The pages pack has no catalog price for this path (D264). */
  unpriced: boolean;
  /** "$10/mo" from the catalog; null while unpriced or unknown. */
  priceLabel: string | null;
}

export type PagesFullView =
  | { kind: "buy"; text: string }
  | { kind: "unpriced"; text: string }
  | { kind: "paused"; text: string }
  | { kind: "none"; text: string };

/** The panel's message and action for this viewer (also used by the inline refusal). */
export function pagesFullView(
  who: Omit<PagesFullWho, "priceLabel"> & { priceLabel?: string | null },
  allowance: number,
): PagesFullView {
  if (who.impersonating) {
    return { kind: "none", text: PAGES_FULL_COPY.impersonating };
  }
  if (who.role !== "owner") {
    return { kind: "none", text: pagesFullMemberCopy(allowance) };
  }
  if (who.paused) return { kind: "paused", text: PAUSED_NO_ADD };
  // WR-C02: the price in the sentence is the catalog's label; none while unpriced.
  if (who.unpriced || !who.priceLabel) {
    return { kind: "unpriced", text: pagesFullCopy(allowance) };
  }
  return { kind: "buy", text: pagesFullCopy(allowance, who.priceLabel) };
}

export interface PagesFullPanelProps extends PagesFullWho {
  allowance: number;
  /** Opens the P10 ChargeConfirmDialog with the server's preview. */
  onBuy: () => void;
  /** True while a purchase dialog is open or loading (extra clicks are ignored). */
  busy?: boolean;
}

export function PagesFullPanel({
  role,
  impersonating,
  paused,
  unpriced,
  priceLabel,
  allowance,
  onBuy,
  busy = false,
}: PagesFullPanelProps) {
  const view = pagesFullView(
    {
      role,
      impersonating,
      paused,
      unpriced: unpriced || !priceLabel,
      priceLabel,
    },
    allowance,
  );
  return (
    <div
      data-pages-full=""
      className="flex flex-col gap-3 rounded-lg bg-hub-surface-2 p-4 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between"
    >
      <div className="flex max-w-[68ch] flex-col gap-1">
        <p className="text-base text-hub-ink">{view.text}</p>
        {view.kind === "unpriced" ? (
          <p className="text-sm text-hub-ink-muted" id="pages-full-unpriced">
            {PAGES_FULL_COPY.unpriced}
          </p>
        ) : null}
      </div>
      {view.kind === "buy" ? (
        <Button
          variant="primary"
          onClick={() => {
            if (!busy) onBuy();
          }}
        >
          {addPagesLabel(priceLabel)}
        </Button>
      ) : null}
      {view.kind === "unpriced" ? (
        <Button
          variant="primary"
          aria-disabled="true"
          aria-describedby="pages-full-unpriced"
          onClick={(e) => e.preventDefault()}
        >
          {addPagesLabel(null)}
        </Button>
      ) : null}
      {view.kind === "paused" ? (
        <Link href={CARD_HREF} className={buttonClasses("secondary")}>
          {PAGES_FULL_COPY.updateCardAndPay}
        </Link>
      ) : null}
    </div>
  );
}
