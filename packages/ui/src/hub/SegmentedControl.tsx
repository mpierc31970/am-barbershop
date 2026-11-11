"use client";
// SegmentedControl (10-05; 10-UI-SPEC "Design System", D-UI-P10-1): the /start receipt's
// Monthly / Yearly control, extracted unchanged so checkout's cadence choice (BILL-10)
// is the control the owner already learned. A radiogroup with roving tabIndex; arrow keys
// move selection and focus. 36px, 44px on coarse pointers. Selection is ink on surface,
// never accent (UI-SPEC Color).
import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Stable name for the group (data attribute; one tab stop per group). */
  name: string;
  /** Accessible name (aria-label). Ignored when `labelledBy` is given. */
  label: string;
  /** Id of a visible label element; uses aria-labelledby instead of aria-label. */
  labelledBy?: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(v: T): void;
  disabled?: boolean;
}

const KEYS_NEXT = ["ArrowRight", "ArrowDown"];
const KEYS_PREV = ["ArrowLeft", "ArrowUp"];

export function SegmentedControl<T extends string>({
  name,
  label,
  labelledBy,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;

  function onKey(e: KeyboardEvent, i: number) {
    const next = KEYS_NEXT.includes(e.key);
    const prev = KEYS_PREV.includes(e.key);
    if (!next && !prev) return;
    e.preventDefault();
    if (disabled || n === 0) return;
    const j = (i + (next ? 1 : -1) + n) % n;
    onChange(options[j]!.value);
    refs.current[j]?.focus();
  }

  return (
    <div
      role="radiogroup"
      {...(labelledBy
        ? { "aria-labelledby": labelledBy }
        : { "aria-label": label })}
      aria-disabled={disabled || undefined}
      data-segmented={name}
      className={`grid ${
        n === 2 ? "grid-cols-2" : n === 3 ? "grid-cols-3" : "grid-flow-col"
      } gap-1 rounded border border-hub-border-strong p-0.5`}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(o.value);
            }}
            onKeyDown={(e) => onKey(e, i)}
            className={
              "min-h-9 rounded-sm px-2 text-sm transition-colors duration-150 pointer-coarse:min-h-11 " +
              (on
                ? "border border-hub-ink bg-hub-surface font-semibold text-hub-ink"
                : "border border-transparent text-hub-ink-muted hover:text-hub-ink")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
