"use client";
// CaseDialog (13-09; STAFF-06, STAFF-05; 13-UI-SPEC "Destructive and irreversible actions",
// "Accessibility contract"; T-13-09-03). The console's version of the CLI "print the case,
// then ask y/N": the hub Dialog with the consequence line, the case as a description list
// (read before the buttons), an optional reason field (3-500 characters; confirm stays
// disabled until it fits) and an optional checkbox ("Launch anyway"; required by default),
// then exactly one primary button and one safe button. Destructive actions focus the safe
// button and use the destructive fill. `onConfirm(values)` may return a StaffActionResult
// (usually useStaffAction's run): ok closes the dialog, a failure shows its message in the
// dialog and keeps the inputs. While the action runs the dialog cannot be closed.
import { P13_COPY } from "@cds/core/staff";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../hub/Button";
import { Dialog } from "../../hub/Dialog";
import { InlineAlert } from "../../hub/feedback";
import { TextArea } from "../../hub/fields";
import { STAFF_DIALOG_COPY } from "./copy";
import { rethrowControlFlow } from "./useStaffAction";

export interface CaseReasonField {
  label: string;
  /** Default 3. */
  min?: number;
  /** Default 500. */
  max?: number;
  helper?: string;
}

export interface CaseCheckbox {
  label: string;
  /** Confirm needs it ticked (default true). */
  required?: boolean;
}

export interface CaseValues {
  reason?: string;
  checked?: boolean;
}

export interface CaseDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  consequence: string;
  caseRows: readonly (readonly [string, string])[];
  confirmLabel: string;
  safeLabel: string;
  destructive?: boolean;
  reasonField?: CaseReasonField;
  checkbox?: CaseCheckbox;
  onConfirm: (values: CaseValues) => unknown;
  /** Close after an ok result (default true). */
  closeOnSuccess?: boolean;
  /** P14 (14-38): an InlineAlert shown under the consequence (e.g. CANCEL-DELEGATED). */
  alert?: ReactNode;
  /** P14 (14-38): focus the safe button on open (default: `destructive`). */
  safeFocus?: boolean;
}

function failedMessage(r: unknown): string | null | undefined {
  if (!r || typeof r !== "object" || !("ok" in r)) return undefined;
  const res = r as { ok: boolean; code?: string; message?: string };
  if (res.ok) return null;
  // A stopped step-up or an ended session says nothing here (the browser is leaving or
  // the person chose to stop).
  if (res.code === "step_up_needed" || res.code === "session_ended") return "";
  return res.message ?? "";
}

export function CaseDialog({
  open,
  onClose,
  title,
  consequence,
  caseRows,
  confirmLabel,
  safeLabel,
  destructive = false,
  reasonField,
  checkbox,
  onConfirm,
  closeOnSuccess = true,
  alert,
  safeFocus,
}: CaseDialogProps) {
  const focusSafe = safeFocus ?? destructive;
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const base = useId();

  // Fresh inputs each time it opens; the safe button takes focus after showModal (the
  // Dialog child's effect runs first) for destructive actions.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setChecked(false);
    setError(null);
    setPending(false);
    if (focusSafe) safeRef.current?.focus();
  }, [open, focusSafe]);

  const min = reasonField?.min ?? 3;
  const max = reasonField?.max ?? 500;
  const reasonLen = reason.trim().length;
  const reasonOk = !reasonField || (reasonLen >= min && reasonLen <= max);
  const checkOk = !checkbox || checkbox.required === false || checked;
  const canConfirm = reasonOk && checkOk && !pending;

  async function confirm() {
    if (!canConfirm) return;
    const values: CaseValues = {};
    if (reasonField) values.reason = reason.trim();
    if (checkbox) values.checked = checked;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(values);
      const msg = failedMessage(result);
      if (msg === null && closeOnSuccess) {
        onClose();
        return;
      }
      if (msg) setError(msg);
    } catch (err) {
      // WR-E01: an onConfirm that throws (not wrapped in useStaffAction) still shows an error.
      rethrowControlFlow(err);
      setError(P13_COPY.ERR_SEND);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            ref={safeRef}
            variant="secondary"
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {safeLabel}
          </Button>
          <Button
            data-case-primary=""
            variant={destructive ? "destructive" : "primary"}
            onClick={() => void confirm()}
            disabled={!canConfirm}
            loading={pending}
            loadingLabel={STAFF_DIALOG_COPY.working}
            className="max-sm:w-full"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {consequence ? <p className="text-base">{consequence}</p> : null}
        {alert ?? null}
        {caseRows.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded border border-hub-border bg-hub-surface-2 p-4 text-sm sm:grid-cols-[max-content_1fr]">
            {caseRows.map(([label, value], i) => (
              <div key={`${label}-${i}`} className="contents">
                <dt className="text-hub-ink-muted">{label}</dt>
                <dd className="min-w-0 break-words text-hub-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {reasonField ? (
          <TextArea
            id={`${base}-reason`}
            label={reasonField.label}
            helper={reasonField.helper}
            value={reason}
            maxLength={max}
            rows={3}
            counter={{ value: reason.length, max }}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        ) : null}
        {checkbox ? (
          <div className="flex items-center gap-2 pointer-coarse:min-h-11">
            <input
              id={`${base}-check`}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.currentTarget.checked)}
              className="h-4 w-4 accent-hub-accent"
            />
            <label htmlFor={`${base}-check`} className="text-base">
              {checkbox.label}
            </label>
          </div>
        ) : null}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
