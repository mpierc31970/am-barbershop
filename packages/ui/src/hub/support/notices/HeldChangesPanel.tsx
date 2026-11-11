"use client";
// HeldChangesPanel (12-14 choice 2; COMM-11, D102, D-UI-P12-19; 12-UI-SPEC lines 598-606).
// After the window ends, the held changes wait on the editor: hub-surface-2 (no longer CDS
// speaking), "CDS has finished. Your changes from {time} are waiting.", HELD-APPLY-NOTE,
// primary Apply my changes and ghost Discard my changes. The caller runs the action (12-13
// applyHeldDraft / discard) and shows the toast; this panel only keeps one action running at
// a time. Pure presentation. If the action throws (network drop, a 500), the panel says so
// in an error alert instead of leaving an unhandled rejection (12-REVIEW IN-D01).
import { useState } from "react";
import { Button } from "../../Button";
import { InlineAlert } from "../../feedback";
import { SUPPORT_UI_COPY } from "../copy";
import { clockTime } from "../thread/copy";
import { NOTICES_COPY } from "./copy";

export interface HeldChangesPanelProps {
  /** When the held changes were saved (ISO). */
  savedAt: string;
  timeZone: string;
  onApply: () => Promise<unknown> | void;
  onDiscard: () => Promise<unknown> | void;
  className?: string;
}

export function HeldChangesPanel({
  savedAt,
  timeZone,
  onApply,
  onDiscard,
  className,
}: HeldChangesPanelProps) {
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [failed, setFailed] = useState(false);
  const run = async (which: "apply" | "discard") => {
    if (busy) return;
    setBusy(which);
    setFailed(false);
    try {
      await (which === "apply" ? onApply() : onDiscard());
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section
      data-held-panel=""
      className={
        "flex flex-col gap-3 rounded-lg border border-hub-border bg-hub-surface-2 p-4 font-hub text-hub-ink" +
        (className ? ` ${className}` : "")
      }
    >
      <p role="status" className="text-base font-semibold">
        {NOTICES_COPY.heldFinished(clockTime(savedAt, timeZone))}
      </p>
      <p className="max-w-[68ch] text-base">{NOTICES_COPY.HELD_APPLY_NOTE}</p>
      {failed ? (
        <InlineAlert tone="error">{SUPPORT_UI_COPY.ERR_SAVE}</InlineAlert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={busy === "apply"}
          loadingLabel={NOTICES_COPY.applying}
          disabled={busy === "discard"}
          onClick={() => void run("apply")}
        >
          {NOTICES_COPY.applyChanges}
        </Button>
        <Button
          variant="ghost"
          loading={busy === "discard"}
          loadingLabel={NOTICES_COPY.discarding}
          disabled={busy === "apply"}
          onClick={() => void run("discard")}
        >
          {NOTICES_COPY.discardChanges}
        </Button>
      </div>
    </section>
  );
}
