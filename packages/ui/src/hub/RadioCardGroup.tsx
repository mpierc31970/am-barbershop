// Hub RadioCardGroup (03-UI-SPEC "Hub primitives"; used by pop-up triggers, button
// actions). A native fieldset of radios drawn as cards: the whole card is the label,
// selection shows as a 2px accent border plus the native radio (never colour alone).
import type { ReactNode } from "react";

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  /** Optional visual on the card, e.g. a LayoutThumb. */
  adornment?: ReactNode;
  /** Optional content under the title and description, e.g. a live sample (06-19). */
  body?: ReactNode;
  disabled?: boolean;
  /** Extra classes on the card, e.g. `sm:col-span-2` for a last full-width card (12-10). */
  className?: string;
}

export interface RadioCardGroupProps<T extends string> {
  name: string;
  legend: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Visually hide the legend when a heading above already names the group. */
  hideLegend?: boolean;
  /** Id of the group's error (or hint) text, read when focus enters the group. */
  describedBy?: string;
  /** Marks every radio aria-invalid (a required choice not made). */
  invalid?: boolean;
}

export function RadioCardGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  hideLegend = false,
  describedBy,
  invalid = false,
}: RadioCardGroupProps<T>) {
  return (
    <fieldset
      aria-describedby={describedBy}
      className="flex flex-col gap-2 font-hub"
    >
      <legend
        className={
          hideLegend ? "sr-only" : "mb-2 text-sm font-semibold text-hub-ink"
        }
      >
        {legend}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={
                "flex cursor-pointer items-start gap-3 rounded border bg-hub-surface p-4 " +
                "transition-colors duration-150 hover:bg-hub-surface-2 " +
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
                "has-focus-visible:outline-hub-accent " +
                "has-disabled:cursor-not-allowed has-disabled:opacity-50 " +
                (o.className ? `${o.className} ` : "") +
                (selected
                  ? "border-hub-accent outline outline-1 outline-hub-accent"
                  : "border-hub-border")
              }
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                disabled={o.disabled}
                aria-invalid={invalid || undefined}
                onChange={() => onChange(o.value)}
                className="mt-0.5 h-4 w-4 shrink-0 focus-visible:outline-none"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold text-hub-ink">
                  {o.title}
                </span>
                {o.description ? (
                  <span className="text-sm text-hub-ink-muted">
                    {o.description}
                  </span>
                ) : null}
                {o.body ? <span className="mt-2 block">{o.body}</span> : null}
              </span>
              {o.adornment ? (
                <span className="shrink-0">{o.adornment}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
