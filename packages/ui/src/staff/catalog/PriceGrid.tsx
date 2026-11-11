"use client";
// PriceGrid (13-37 choice 3; STAFF-07, D161, D264; 13-UI-SPEC "Prices" lines 858-865). The one
// price catalog as a table, a <tbody> per kind with a group row ("Base fee", "Build fee",
// "Add-ons", "Page packs", "Care Plan", …): Key · Standard · Studio · Provider price ("Synced",
// "Missing" warning). A Super Admin's price cells are buttons "Edit {key} {path} price" opening
// an inline editor (Amount in dollars, cents-safe; Price coming soon switch) → Preview price →
// PriceCasePreview (step-up first, through the caller's useStaffAction) → Save price. Agents
// see the grid read-only: disabled cells and "Super Admin only" in the header.
import { P13_COPY } from "@cds/core/staff";
import { useId, useState } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { TextField } from "../../hub/fields";
import { Switch } from "../../hub/Switch";
import type { StaffActionResult } from "../dialogs";
import { CATALOG_COPY as C } from "./copy";
import { PriceCasePreview, type PricePreviewView } from "./PriceCasePreview";

export type PricePathId = "standard" | "studio";

export interface PriceCellView {
  /** Current cents; null = Price coming soon or no row yet. */
  cents: number | null;
  /** "$79.00/mo", "$1,500.00 once", "Price coming soon" or "—" (no row). */
  text: string;
  /** Studio Booking on Standard: never offered there. */
  offered: boolean;
  /** Provider price state for this cell (none = unpriced). */
  sync: "synced" | "missing" | "none";
}

export interface PriceRowView {
  kind: string;
  key: string;
  label: string;
  cells: Record<PricePathId, PriceCellView>;
}

export interface PriceGroupView {
  kind: string;
  label: string;
  rows: PriceRowView[];
}

export interface PriceTargetInput {
  kind: string;
  key: string;
  path: PricePathId;
  cents: number | null;
}

export interface PriceGridProps {
  groups: readonly PriceGroupView[];
  canEdit: boolean;
  onPreview: (
    t: PriceTargetInput,
  ) => Promise<StaffActionResult<PricePreviewView>>;
  onSave: (
    t: PriceTargetInput & { sitesChecked: boolean },
  ) => Promise<StaffActionResult<{ message: string }>>;
  onSaved?: (message: string) => void;
}

const PATHS: readonly PricePathId[] = ["standard", "studio"];
const MAX_CENTS = 10_000_000;

/** "19", "19.5", "19.00", "1,500" → cents; null when it isn't an amount. No float maths. */
export function parseDollars(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents <= MAX_CENTS ? cents : null;
}

function dollarsOf(cents: number | null): string {
  if (cents === null) return "";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function rowSync(row: PriceRowView): "synced" | "missing" | "none" {
  const states = PATHS.map((p) => row.cells[p].sync);
  if (states.includes("missing")) return "missing";
  if (states.includes("synced")) return "synced";
  return "none";
}

type Editing = { row: PriceRowView; path: PricePathId };

function CellEditor({
  editing,
  onCancel,
  onPreview,
}: {
  editing: Editing;
  onCancel: () => void;
  onPreview: (cents: number | null) => Promise<string | null>;
}) {
  const base = useId();
  const cell = editing.row.cells[editing.path];
  const [amount, setAmount] = useState(dollarsOf(cell.cents));
  const [soon, setSoon] = useState(cell.cents === null && cell.sync === "none");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pathLabel = C.priceCols[editing.path];

  async function preview() {
    const cents = soon ? null : parseDollars(amount);
    if (!soon && cents === null) {
      setError(C.amountBad);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const msg = await onPreview(cents);
      if (msg) setError(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={C.editPriceLabel(editing.row.label, pathLabel)}
      className="flex w-[320px] max-w-full flex-col gap-3 rounded border border-hub-border-strong bg-hub-surface p-4 shadow-md"
    >
      <TextField
        id={`${base}-amount`}
        label={C.amount}
        inputMode="decimal"
        value={amount}
        disabled={soon}
        helper={C.amountHelp}
        error={error ?? undefined}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Switch
        id={`${base}-soon`}
        label={C.comingSoonSwitch}
        checked={soon}
        onChange={setSoon}
      />
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => void preview()}
        >
          {C.previewPrice}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          {C.cancel}
        </Button>
      </div>
    </div>
  );
}

export function PriceGrid({
  groups,
  canEdit,
  onPreview,
  onSave,
  onSaved,
}: PriceGridProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pendingSave, setPendingSave] = useState<{
    target: PriceTargetInput;
    preview: PricePreviewView;
  } | null>(null);

  async function preview(cents: number | null): Promise<string | null> {
    if (!editing) return null;
    const target: PriceTargetInput = {
      kind: editing.row.kind,
      key: editing.row.key,
      path: editing.path,
      cents,
    };
    const r = await onPreview(target);
    if (r.ok) {
      setPendingSave({ target, preview: r.data });
      return null;
    }
    if (r.code === "step_up_needed" || r.code === "session_ended") return null;
    return r.message;
  }

  async function save(sitesChecked: boolean) {
    if (!pendingSave) return { ok: true as const, data: null };
    const r = await onSave({ ...pendingSave.target, sitesChecked });
    if (r.ok) {
      setEditing(null);
      onSaved?.(r.data.message);
    }
    return r;
  }

  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="overflow-x-auto rounded border border-hub-border">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{C.pricesCaption}</caption>
          <thead className="bg-hub-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                {C.priceCols.key}
              </th>
              {PATHS.map((p) => (
                <th key={p} scope="col" className="px-3 py-2 font-semibold">
                  {C.priceCols[p]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-semibold">
                <span className="flex items-center justify-between gap-2">
                  {C.priceCols.provider}
                  {canEdit ? null : (
                    <span className="text-xs font-semibold text-hub-ink-muted">
                      {P13_COPY.SUPER_ONLY}
                    </span>
                  )}
                </span>
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.kind}>
              <tr className="border-t border-hub-border bg-hub-surface">
                <th
                  colSpan={4}
                  scope="colgroup"
                  className="px-3 pb-1 pt-4 text-sm font-semibold text-hub-ink"
                >
                  {g.label}
                </th>
              </tr>
              {g.rows.map((row) => {
                const sync = rowSync(row);
                return (
                  <tr
                    key={`${row.kind}:${row.key}`}
                    className="border-t border-hub-border"
                  >
                    <th scope="row" className="px-3 py-2 font-normal">
                      <span className="block">{row.label}</span>
                      <span className="block font-mono text-xs text-hub-ink-muted">
                        {row.key}
                      </span>
                    </th>
                    {PATHS.map((p) => {
                      const cell = row.cells[p];
                      const isEditing =
                        editing?.row.key === row.key &&
                        editing.row.kind === row.kind &&
                        editing.path === p;
                      const muted = cell.cents === null;
                      return (
                        <td key={p} className="px-3 py-2 align-top">
                          {cell.offered ? (
                            <button
                              type="button"
                              disabled={!canEdit}
                              aria-label={C.editPriceLabel(
                                row.label,
                                C.priceCols[p],
                              )}
                              aria-expanded={canEdit ? isEditing : undefined}
                              title={canEdit ? undefined : P13_COPY.SUPER_ONLY}
                              onClick={() =>
                                setEditing(isEditing ? null : { row, path: p })
                              }
                              className={`rounded px-2 py-1 text-left tabular-nums hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent disabled:cursor-not-allowed disabled:hover:bg-transparent ${muted ? "text-hub-ink-muted" : "text-hub-ink"}`}
                            >
                              {cell.text}
                            </button>
                          ) : (
                            <span className="px-2 text-hub-ink-muted">
                              {C.notOffered}
                            </span>
                          )}
                          {isEditing ? (
                            <div className="mt-2">
                              <CellEditor
                                editing={editing}
                                onCancel={() => setEditing(null)}
                                onPreview={preview}
                              />
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 align-top">
                      {sync === "synced" ? (
                        C.synced
                      ) : sync === "missing" ? (
                        <Badge tone="h-warn">{C.missing}</Badge>
                      ) : (
                        <span className="text-hub-ink-muted">{C.noPrice}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {!canEdit ? (
        <InlineAlert tone="info">{P13_COPY.SUPER_ONLY}</InlineAlert>
      ) : null}
      <PriceCasePreview
        open={pendingSave !== null}
        preview={pendingSave?.preview ?? null}
        onClose={() => setPendingSave(null)}
        onSave={save}
      />
    </div>
  );
}
