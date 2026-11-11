// AcceptProgress (09-UI-SPEC "Signing screen" item 4; P6 setup progress bar classes).
// Sticky 48px bar: Label 600 "N of M accepted", 4px track with a success fill (never
// accent), role=progressbar, the count announced politely on each tick. Width eases in
// 150ms; no transition under reduced motion. The page decides when to unstick it (it
// would cover the Sign button), via `sticky`.
import { progressLabel, SIGNING_COPY } from "./signing-state";

export interface AcceptProgressProps {
  done: number;
  total: number;
  /** Default true. The page turns it off once the signature panel is in view. */
  sticky?: boolean;
}

export function AcceptProgress({
  done,
  total,
  sticky = true,
}: AcceptProgressProps) {
  const label = progressLabel(done, total);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      className={
        "z-10 flex h-12 items-center gap-4 bg-hub-surface px-4 font-hub " +
        (sticky ? "sticky top-0" : "")
      }
    >
      <p
        aria-live="polite"
        className="shrink-0 text-sm font-semibold text-hub-ink tabular-nums"
      >
        {label}
      </p>
      <div
        role="progressbar"
        aria-label={SIGNING_COPY.progressAriaLabel}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={label}
        className="h-1 w-full overflow-hidden rounded bg-hub-border"
      >
        <div
          className="h-full rounded bg-hub-success transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
