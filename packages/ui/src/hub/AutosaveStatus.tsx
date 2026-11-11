"use client";
// AutosaveStatus (06-18; 06-UI-SPEC "Stages" header, Copywriting "Autosave"; ONB-02).
// Label 14, right-aligned in a step header, one status live region: idle says nothing ·
// "Saving…" · Check + "Saved", which settles to "All changes saved" after 3 s · "Not saved"
// (danger) + a Try again link-button · "1 field needs attention" when a value was refused.
// 12-17: "Editing paused" while a CDS service window locks the target (UI-SPEC line 592).
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AutosaveState } from "./useAutosave";

export const SAVED_SETTLE_MS = 3000;
/** 12-17 (UI-SPEC line 592): an autosave refused by a CDS service window. */
export const AUTOSAVE_PAUSED_COPY = "Editing paused";

export interface AutosaveStatusProps {
  state: AutosaveState;
  invalidCount?: number;
  onRetry?(): void;
}

export function invalidCopy(n: number): string {
  const count = Math.max(1, Math.floor(n));
  return count === 1
    ? "1 field needs attention"
    : `${count} fields need attention`;
}

export function AutosaveStatus({
  state,
  invalidCount = 1,
  onRetry,
}: AutosaveStatusProps) {
  // Each new "saved" starts fresh; the settle timer flips it to "All changes saved".
  const [settled, setSettled] = useState(false);
  const [prev, setPrev] = useState(state);
  if (prev !== state) {
    setPrev(state);
    setSettled(false);
  }
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setSettled(true), SAVED_SETTLE_MS);
    return () => clearTimeout(t);
  }, [state]);

  let body: ReactNode = null;
  if (state === "saving") body = "Saving…";
  else if (state === "saved") {
    body = settled ? (
      "All changes saved"
    ) : (
      <>
        <Check aria-hidden size={16} strokeWidth={2} />
        Saved
      </>
    );
  } else if (state === "error") {
    body = (
      <>
        <span className="text-hub-danger">Not saved.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            Try again
          </button>
        ) : null}
      </>
    );
  } else if (state === "paused") {
    body = AUTOSAVE_PAUSED_COPY;
  } else if (state === "invalid") {
    body = <span className="text-hub-danger">{invalidCopy(invalidCount)}</span>;
  }

  return (
    <p
      role="status"
      className="inline-flex min-h-6 items-center gap-1 font-hub text-sm text-hub-ink-muted"
    >
      {body}
    </p>
  );
}
