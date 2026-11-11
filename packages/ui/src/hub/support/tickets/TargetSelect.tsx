"use client";
// TargetSelect (12-10 choice 3; COMM-06; 12-UI-SPEC Get help form line 391-392, a11y "Target
// select"). A native <select> labelled About with <optgroup>s from `buildTargetOptions`: Your
// site (Whole site, the default) · Pages · Add-ons · Site parts. Option values are `kind:id`,
// the same form `?target=` and `validateTarget` use. Presentation only: the server validates
// the value against its own options (T-12-10-03). A `value` that matches no option (a stale
// `?target=page:<deleted>`) shows as Whole site, and a controlled parent is told so it never
// keeps an invalid value the select isn't showing (12-REVIEW IN-D07).
import { WHOLE_SITE, type TargetGroup } from "@cds/core/support";
import { useEffect, useId, type ChangeEvent } from "react";
import { fieldAria } from "../../fields";
import { TICKETS_COPY, targetValue } from "./copy";

export interface TargetSelectProps {
  options: readonly TargetGroup[];
  /** `kind:id`; default Whole site. Controlled when `onChange` is given. */
  value?: string | null;
  onChange?: (value: string) => void;
  /** Form field name. Default "target". */
  name?: string;
  id?: string;
  error?: string | null;
}

const CONTROL =
  "h-10 w-full rounded border bg-hub-surface px-3 font-hub text-base text-hub-ink " +
  "transition-colors duration-150";

export function TargetSelect({
  options,
  value,
  onChange,
  name = "target",
  id,
  error,
}: TargetSelectProps) {
  const auto = useId();
  const selectId = id ?? `target-${auto}`;
  const whole = targetValue(WHOLE_SITE);
  const known = options.some((g) =>
    g.options.some((o) => targetValue(o) === value),
  );
  const selected = value && known ? value : whole;
  const stale = !!value && !known;
  useEffect(() => {
    if (stale && onChange) onChange(whole);
  }, [stale, onChange, whole]);
  const helper = TICKETS_COPY.targetHelper;
  const valueProps = onChange
    ? {
        value: selected,
        onChange: (e: ChangeEvent<HTMLSelectElement>) =>
          onChange(e.currentTarget.value),
      }
    : { defaultValue: selected };
  return (
    <div className="flex flex-col gap-1 font-hub" data-target-select="">
      <label htmlFor={selectId} className="text-sm font-semibold text-hub-ink">
        {TICKETS_COPY.targetLabel}
      </label>
      <select
        id={selectId}
        name={name}
        {...valueProps}
        {...fieldAria(selectId, helper, error)}
        className={`${CONTROL} ${error ? "border-hub-danger" : "border-hub-border-strong hover:border-hub-ink-muted"}`}
      >
        {options.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={targetValue(o)} value={targetValue(o)}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p id={`${selectId}-helper`} className="text-sm text-hub-ink-muted">
        {helper}
      </p>
      {error ? (
        <p id={`${selectId}-error`} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
