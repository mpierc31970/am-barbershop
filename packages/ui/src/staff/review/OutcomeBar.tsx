"use client";
// OutcomeBar (13-38 choice 3; D-UI-P13-10; 13-UI-SPEC "Case page" OutcomeBar). Sticky at the
// foot of the case page's left column (--hub-surface, 1px top border, 16px padding): secondary
// Clear hold · Ask to fix · Remove content · Suspend…. No primary: the outcome is a judgement.
// The destructive fill lives inside each CaseDialog, never here. A button the role can't use is
// disabled with the "Super Admin only" hint; an outcome that doesn't apply is left out.
import { useId } from "react";
import { Button } from "../../hub/Button";
import { REVIEW_COPY } from "./copy";

const C = REVIEW_COPY;

export type OutcomeBarOutcome =
  "cleared" | "fix_requested" | "removed" | "suspended";

export const OUTCOME_BAR_ORDER: readonly OutcomeBarOutcome[] = [
  "cleared",
  "fix_requested",
  "removed",
  "suspended",
];

export interface OutcomeBarProps {
  onOutcome: (outcome: OutcomeBarOutcome) => void;
  /** Outcomes that don't apply here (e.g. Remove content with no page or file). */
  hidden?: readonly OutcomeBarOutcome[];
  /** Outcomes this role can't use: shown disabled with "Super Admin only". */
  superOnly?: readonly OutcomeBarOutcome[];
  /** Everything disabled (closed case, a dialog running). */
  disabled?: boolean;
}

export function OutcomeBar({
  onOutcome,
  hidden = [],
  superOnly = [],
  disabled = false,
}: OutcomeBarProps) {
  const hintId = useId();
  const shown = OUTCOME_BAR_ORDER.filter((o) => !hidden.includes(o));
  const anyLocked = shown.some((o) => superOnly.includes(o));
  return (
    <div
      role="group"
      aria-label={C.outcomesLabel}
      className="sticky bottom-0 flex flex-col gap-2 border-t border-hub-border bg-hub-surface p-4 font-hub"
    >
      <div className="flex flex-wrap gap-2">
        {shown.map((o) => {
          const locked = superOnly.includes(o);
          return (
            <Button
              key={o}
              type="button"
              variant="secondary"
              disabled={disabled || locked}
              aria-describedby={locked ? hintId : undefined}
              onClick={() => onOutcome(o)}
            >
              {C.outcomes[o]}
            </Button>
          );
        })}
      </div>
      {anyLocked ? (
        <p id={hintId} className="text-sm text-hub-ink-muted">
          {C.superOnly}
        </p>
      ) : null}
    </div>
  );
}
