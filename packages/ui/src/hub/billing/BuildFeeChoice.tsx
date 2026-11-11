"use client";
// BuildFeeChoice (10-08; 10-UI-SPEC "Checkout" §5, D181, D-UI-P10-3): a native radio
// group of P6 cards, Pay in full first. The price sits inside the label. RadioCardGroup
// has no price line or Check mark, so this builds the same fieldset with the P6 card
// classes (2px accent border + tint + Check when selected; never colour alone).
import { Check } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { BuildFeeOption, BuildFeeValue } from "./types";

export const BUILD_FEE_LEGEND = "How to pay for your build";

export interface BuildFeeChoiceProps {
  options: readonly BuildFeeOption[];
  value: BuildFeeValue;
  onChange: (value: BuildFeeValue) => void;
  disabled?: boolean;
  name?: string;
}

const NEXT_KEYS = new Set(["ArrowDown", "ArrowRight"]);
const PREV_KEYS = new Set(["ArrowUp", "ArrowLeft"]);

export function BuildFeeChoice({
  options,
  value,
  onChange,
  disabled = false,
  name = "build-fee",
}: BuildFeeChoiceProps) {
  // Browsers move native radios with arrow keys; this mirrors it so the behaviour is
  // explicit and identical everywhere (and testable in jsdom).
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    const step = NEXT_KEYS.has(e.key) ? 1 : PREV_KEYS.has(e.key) ? -1 : 0;
    if (step === 0 || disabled || options.length === 0) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    e.currentTarget
      .closest("fieldset")
      ?.querySelector<HTMLInputElement>(`#${name}-${option.value}`)
      ?.focus();
  }

  return (
    <fieldset className="flex flex-col gap-2 font-hub" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold text-hub-ink">
        {BUILD_FEE_LEGEND}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((o, i) => {
          const id = `${name}-${o.value}`;
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={
                "relative flex min-h-28 cursor-pointer items-start gap-3 rounded-lg border-2 p-6 " +
                "transition-colors duration-150 motion-reduce:transition-none " +
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
                "has-focus-visible:outline-hub-accent " +
                "has-disabled:cursor-not-allowed has-disabled:opacity-50 " +
                (selected
                  ? "border-hub-accent bg-hub-accent-tint"
                  : "border-hub-border bg-hub-surface hover:bg-hub-surface-2")
              }
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                onChange={() => onChange(o.value)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="mt-1 h-4 w-4 shrink-0 focus-visible:outline-none"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xl leading-tight font-semibold text-hub-ink">
                  {o.title}
                </span>
                <span className="font-semibold text-hub-ink tabular-nums">
                  {o.priceLine}
                </span>
                <span className="text-sm text-hub-ink-muted">{o.detail}</span>
              </span>
              {selected ? (
                <Check
                  size={20}
                  aria-hidden="true"
                  className="shrink-0 text-hub-accent"
                />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
