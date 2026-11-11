"use client";
// PriceCasePreview (13-37 choice 3; STAFF-07, D161, D264; 13-UI-SPEC "Prices" and the price
// dialog row, line 1079; T-13-37-04). The prices:set case in a CaseDialog: "Change {key}
// {path}?", "Old → new: $15.00/mo → $19.00/mo", whether a new provider price is created, and
// when an add-on goes to or from $0 the sites it affects (every site on that path) with the
// I've checked these sites box, which Save price needs. Save price · Keep price.
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import { CaseDialog } from "../dialogs";
import { CATALOG_COPY as C } from "./copy";

export interface PricePreviewView {
  label: string;
  pathLabel: string;
  oldText: string;
  newText: string;
  newProviderPrice: boolean;
  crossesZero: boolean;
  toFree: boolean;
  pathOrgs: number;
}

export interface PriceCasePreviewProps {
  open: boolean;
  preview: PricePreviewView | null;
  onClose: () => void;
  /** Usually useStaffAction(savePriceAction); ok closes the dialog. */
  onSave: (sitesChecked: boolean) => unknown;
}

/** The dialog's case rows (exported for the grid's tests and the CLI parity check). */
export function priceCaseRows(
  p: PricePreviewView,
): (readonly [string, string])[] {
  const rows: (readonly [string, string])[] = [
    [C.providerRow, p.newProviderPrice ? C.providerLine : C.providerSame],
  ];
  if (p.crossesZero) {
    rows.push([
      C.sitesRow,
      p.toFree
        ? C.toFreeLine(p.label, p.pathLabel, p.pathOrgs)
        : C.fromFreeLine(p.label, p.pathLabel, p.pathOrgs),
    ]);
  }
  return rows;
}

export function PriceCasePreview({
  open,
  preview,
  onClose,
  onSave,
}: PriceCasePreviewProps) {
  if (!preview) return null;
  const d = P13_DIALOGS.price_save;
  return (
    <CaseDialog
      open={open}
      onClose={onClose}
      title={fillCopy(d.title, { key: preview.label, path: preview.pathLabel })}
      consequence={C.oldNew(preview.oldText, preview.newText)}
      caseRows={priceCaseRows(preview)}
      confirmLabel={d.confirm}
      safeLabel={d.safe}
      {...(preview.crossesZero
        ? { checkbox: { label: C.sitesChecked, required: true } }
        : {})}
      onConfirm={(v) => onSave(v.checked === true)}
    />
  );
}
