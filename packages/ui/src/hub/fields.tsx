// Hub form fields: TextField, TextArea, Select (03-UI-SPEC "Hub primitives",
// "Accessibility contract"; D311). Native elements only. Label 14/600 above the control
// (8px gap), control 40px / Body 16, border-strong at rest (3.4:1, WCAG 1.4.11), danger
// border + message on error. aria-describedby lists helper then error; aria-invalid only
// when there is an error. Counters use tabular numerals.
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldChrome {
  id: string;
  label: string;
  helper?: ReactNode;
  error?: ReactNode;
  counter?: { value: number; max: number };
  /** Shown after the label, e.g. an Optional badge (06-UI-SPEC field chrome). */
  labelExtra?: ReactNode;
}

export type TextFieldProps = FieldChrome &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id">;
export type TextAreaProps = FieldChrome &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;
export interface SelectOption {
  value: string;
  label: string;
}
export type SelectProps = Omit<FieldChrome, "counter"> &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options: readonly SelectOption[];
  };

const CONTROL =
  "w-full rounded border bg-hub-surface px-3 font-hub text-base text-hub-ink " +
  "transition-colors duration-150 placeholder:text-hub-ink-muted " +
  "disabled:cursor-not-allowed disabled:bg-hub-surface-2 disabled:text-hub-ink-muted";

function controlClass(hasError: boolean, extra: string): string {
  return `${CONTROL} ${hasError ? "border-hub-danger" : "border-hub-border-strong hover:border-hub-ink-muted"} ${extra}`;
}

/** Ids and ARIA wiring shared by every field. */
export function fieldAria(id: string, helper: unknown, error: unknown) {
  const ids = [helper ? `${id}-helper` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-describedby": ids || undefined,
    "aria-invalid": error ? (true as const) : undefined,
  };
}

function FieldFrame({
  id,
  label,
  helper,
  error,
  counter,
  labelExtra,
  children,
}: FieldChrome & { children: ReactNode }) {
  const over = counter ? counter.value > counter.max : false;
  return (
    <div className="flex flex-col gap-2 font-hub">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm font-semibold text-hub-ink">
            {label}
          </label>
          {labelExtra}
        </span>
        {counter ? (
          <span
            className={`text-sm tabular-nums ${over ? "text-hub-danger" : "text-hub-ink-muted"}`}
          >
            {counter.value.toLocaleString("en-US")} /{" "}
            {counter.max.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      {children}
      {helper ? (
        <p id={`${id}-helper`} className="text-sm text-hub-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  id,
  label,
  helper,
  error,
  counter,
  labelExtra,
  className,
  type = "text",
  ...rest
}: TextFieldProps) {
  return (
    <FieldFrame {...{ id, label, helper, error, counter, labelExtra }}>
      <input
        {...rest}
        {...fieldAria(id, helper, error)}
        id={id}
        type={type}
        className={controlClass(Boolean(error), `h-10 ${className ?? ""}`)}
      />
    </FieldFrame>
  );
}

export function TextArea({
  id,
  label,
  helper,
  error,
  counter,
  labelExtra,
  className,
  rows = 4,
  ...rest
}: TextAreaProps) {
  return (
    <FieldFrame {...{ id, label, helper, error, counter, labelExtra }}>
      <textarea
        {...rest}
        {...fieldAria(id, helper, error)}
        id={id}
        rows={rows}
        className={controlClass(Boolean(error), `py-2 ${className ?? ""}`)}
      />
    </FieldFrame>
  );
}

export function Select({
  id,
  label,
  helper,
  error,
  options,
  labelExtra,
  className,
  ...rest
}: SelectProps) {
  return (
    <FieldFrame {...{ id, label, helper, error, labelExtra }}>
      <select
        {...rest}
        {...fieldAria(id, helper, error)}
        id={id}
        className={controlClass(Boolean(error), `h-10 ${className ?? ""}`)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
