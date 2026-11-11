"use client";
// RemoveRecordDialog (14-32 choice 1; 14-UI-SPEC "RemoveRecordDialog", "Destructive and
// irreversible actions"). Title "Remove this TXT record?", REC-REMOVE-B and the record in
// font-mono (text nodes only, T-14-32-02), the safe button Keep record autofocused, destructive
// Remove record (pending Removing…). A refusal stays in the dialog as an error alert.
import { P14_COPY } from "@cds/core/dns";
import { useState } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { RECORDS_UI_COPY as C } from "./records-copy";
import { displayRecordName } from "./RecordGroupList";

export interface RemovableRecord {
  type: string;
  name: string;
  value: string;
}

export interface RemoveRecordDialogProps {
  open: boolean;
  onClose(): void;
  domain: string;
  record: RemovableRecord | null;
  action(): Promise<HubActionResult<unknown>>;
  /** After a removal: the toast words ("TXT record removed."). */
  onRemoved?(message: string): void;
}

export function RemoveRecordDialog({
  open,
  onClose,
  domain,
  record,
  action,
  onRemoved,
}: RemoveRecordDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = record?.type ?? "TXT";

  async function confirm() {
    if (pending || !record) return;
    setPending(true);
    try {
      const res = await action();
      if (res.ok) {
        setError(null);
        onRemoved?.(C.removed(type));
        onClose();
      } else {
        setError(res.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={P14_COPY.REC_REMOVE_H({ type })}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            autoFocus
            data-safe=""
            onClick={() => {
              setError(null);
              onClose();
            }}
          >
            {P14_COPY.BTN_KEEP_RECORD}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            loadingLabel={C.removing}
            onClick={() => void confirm()}
          >
            {P14_COPY.BTN_REMOVE_RECORD}
          </Button>
        </>
      }
    >
      <div data-remove-record="" className="flex flex-col gap-4">
        <p>{P14_COPY.REC_REMOVE_B({ domain })}</p>
        {record ? (
          <p className="flex flex-col gap-1 rounded bg-hub-surface-2 p-3 font-mono text-sm [overflow-wrap:anywhere]">
            <span>
              {record.type} {displayRecordName(record.name, domain)}
            </span>
            <span className="text-hub-ink-muted">{record.value}</span>
          </p>
        ) : null}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
