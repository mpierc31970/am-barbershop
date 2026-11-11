// Hub Switch (03-UI-SPEC "Hub primitives", D-UI-1). A native checkbox with role="switch",
// so keyboard, form and screen-reader behaviour come from the platform. The track is
// drawn with appearance-none on the input itself; the label sits to its right and is
// part of the 44px hit area on coarse pointers.
import type { InputHTMLAttributes } from "react";

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "role" | "checked" | "onChange"
> {
  id: string;
  label: string;
  /** Keep the label for screen readers only (table cells whose column says the rest). */
  labelHidden?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({
  id,
  label,
  labelHidden = false,
  checked,
  onChange,
  className,
  ...rest
}: SwitchProps) {
  return (
    <div className="inline-flex items-center gap-2 font-hub pointer-coarse:min-h-11">
      <input
        {...rest}
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className={
          "relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full " +
          "bg-hub-border-strong transition-colors duration-150 " +
          "before:absolute before:top-0.5 before:left-0.5 before:h-5 before:w-5 " +
          "before:rounded-full before:bg-hub-surface before:transition-transform " +
          "before:duration-150 checked:bg-hub-accent checked:before:translate-x-4 " +
          "disabled:cursor-not-allowed disabled:opacity-50" +
          (className ? ` ${className}` : "")
        }
      />
      <label
        htmlFor={id}
        className={
          labelHidden ? "sr-only" : "cursor-pointer text-base text-hub-ink"
        }
      >
        {label}
      </label>
    </div>
  );
}
