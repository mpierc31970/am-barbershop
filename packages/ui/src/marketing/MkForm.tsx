// Owner: 15-11 (P15-P1). Marketing form primitives for Contact (15-19) and the restyled Report (15-20)
// (UI-SPEC Contact, Report, Interaction states, Accessibility contract). Behaviour mirrors the hub
// fields (label above, help then error in aria-describedby, aria-invalid only on error); styling is
// mk-* only. Ids and names are caller-supplied, so /report keeps its existing ids (A3-Q3).
// Server-safe: no hooks. The message counter is controlled by the caller (its client form owns the
// value), so this module needs no "use client".
import { CircleAlert } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { messageCounterLine } from "@cds/core/marketing";

const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

const LABEL = "text-[18px] leading-[1.55] font-bold text-mk-fg";
const HELP = "text-[14px] leading-[1.4] text-mk-muted";
const CONTROL =
  "w-full bg-mk-card px-3 text-[18px] leading-[1.55] text-mk-ink placeholder:text-mk-ink-muted transition-colors duration-[var(--mk-dur-fast)] ease-linear";

function controlBorder(hasError: boolean): string {
  return hasError
    ? "border-2 border-mk-danger"
    : "border border-mk-rule-strong hover:border-mk-ink focus-visible:border-mk-ink";
}

/** Ids for a field's help and error lines. */
export function mkHelpId(id: string): string {
  return `${id}-help`;
}
export function mkErrorId(id: string): string {
  return `${id}-error`;
}

/** aria-describedby (help, then error) and aria-invalid for a control. */
export function mkFieldAria(
  id: string,
  help: unknown,
  error: unknown,
): { "aria-describedby"?: string; "aria-invalid"?: true } {
  const ids = [help ? mkHelpId(id) : null, error ? mkErrorId(id) : null]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-describedby": ids || undefined,
    "aria-invalid": error ? true : undefined,
  };
}

/** Inline error: CircleAlert + text (never colour alone). */
export function MkFieldError({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <p
      id={mkErrorId(id)}
      className="m-0 flex items-start gap-2 text-[14px] leading-[1.4] font-bold text-mk-danger"
    >
      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export type MkFieldProps = {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** After the label, e.g. a counter. */
  labelExtra?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Field chrome: visible label above the control (8px), help, then the inline error. */
export function MkField({
  id,
  label,
  help,
  error,
  labelExtra,
  className,
  children,
}: MkFieldProps) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {labelExtra}
      </div>
      {children}
      {help ? (
        <p id={mkHelpId(id)} className={cx("m-0", HELP)}>
          {help}
        </p>
      ) : null}
      {error ? <MkFieldError id={id}>{error}</MkFieldError> : null}
    </div>
  );
}

export type MkTextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "prefix"
> & {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** Shown before the input inside the frame, e.g. the calculator's "$". */
  prefix?: string;
  ref?: Ref<HTMLInputElement>;
};

export function MkTextField({
  id,
  label,
  help,
  error,
  prefix,
  type = "text",
  className,
  ref,
  ...rest
}: MkTextFieldProps) {
  const aria = mkFieldAria(id, help, error);
  const input = (
    <input
      ref={ref}
      id={id}
      type={type}
      {...aria}
      {...rest}
      className={cx(
        CONTROL,
        "min-h-11",
        prefix ? "pl-8" : null,
        controlBorder(Boolean(error)),
        className,
      )}
    />
  );
  return (
    <MkField id={id} label={label} help={help} error={error}>
      {prefix ? (
        <span className="relative block">
          <span
            aria-hidden="true"
            className="mk-figures pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[18px] text-mk-ink-muted"
          >
            {prefix}
          </span>
          {input}
        </span>
      ) : (
        input
      )}
    </MkField>
  );
}

export type MkTextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> & {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** Controlled counter "1,240 of 2,000"; announced politely from 90% of max. */
  counter?: { value: number; max: number };
  ref?: Ref<HTMLTextAreaElement>;
};

/** Share of max at which the counter is announced (UI-SPEC Contact). */
export const MK_COUNTER_ANNOUNCE_AT = 0.9;

export function MkTextArea({
  id,
  label,
  help,
  error,
  counter,
  rows = 6,
  className,
  ref,
  ...rest
}: MkTextAreaProps) {
  const aria = mkFieldAria(id, help, error);
  const line = counter ? messageCounterLine(counter.value, counter.max) : "";
  const announce =
    counter && counter.value >= counter.max * MK_COUNTER_ANNOUNCE_AT;
  const over = counter ? counter.value > counter.max : false;
  return (
    <MkField
      id={id}
      label={label}
      help={help}
      error={error}
      labelExtra={
        counter ? (
          <span
            className={cx(
              "mk-figures text-[14px] leading-[1.4]",
              over ? "font-bold text-mk-danger" : "text-mk-muted",
            )}
          >
            <span aria-hidden="true">{line}</span>
            <span aria-live="polite" className="sr-only">
              {announce ? line : ""}
            </span>
          </span>
        ) : undefined
      }
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        {...aria}
        {...rest}
        className={cx(
          CONTROL,
          "py-2 [field-sizing:content] min-h-40",
          controlBorder(Boolean(error)),
          className,
        )}
      />
    </MkField>
  );
}

export type MkRadioOption = { readonly value: string; readonly label: string };

export type MkRadioGroupProps = {
  /** Fieldset id (error-summary target); each radio is `<id>-<value>`. */
  id: string;
  name: string;
  legend: ReactNode;
  options: readonly MkRadioOption[];
  value?: string;
  defaultValue?: string;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function MkRadioGroup({
  id,
  name,
  legend,
  options,
  value,
  defaultValue,
  help,
  error,
  required,
  onValueChange,
  className,
}: MkRadioGroupProps) {
  // A fieldset takes the description, not aria-invalid; the error line names the problem.
  const describedBy = mkFieldAria(id, help, error)["aria-describedby"];
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={describedBy}
      className={cx("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}
    >
      <legend className={cx("mb-2 p-0", LABEL)}>{legend}</legend>
      {help ? (
        <p id={mkHelpId(id)} className={cx("m-0", HELP)}>
          {help}
        </p>
      ) : null}
      <div className="flex flex-col">
        {options.map((opt) => {
          const optId = `${id}-${opt.value}`;
          const controlled = value !== undefined;
          return (
            <label
              key={opt.value}
              htmlFor={optId}
              className="flex min-h-11 cursor-pointer items-center gap-3 px-2 text-[18px] leading-[1.55] hover:bg-mk-stock"
            >
              <input
                id={optId}
                type="radio"
                name={name}
                value={opt.value}
                required={required}
                checked={controlled ? value === opt.value : undefined}
                defaultChecked={
                  controlled ? undefined : defaultValue === opt.value
                }
                onChange={
                  onValueChange
                    ? (e) => onValueChange(e.currentTarget.value)
                    : controlled
                      ? () => {}
                      : undefined
                }
                className="size-5 shrink-0 accent-mk-ink"
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
      {error ? <MkFieldError id={id}>{error}</MkFieldError> : null}
    </fieldset>
  );
}

export type MkCheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> & {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
};

export function MkCheckbox({
  id,
  label,
  help,
  error,
  className,
  ...rest
}: MkCheckboxProps) {
  const aria = mkFieldAria(id, help, error);
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-3 px-2 text-[18px] leading-[1.55] hover:bg-mk-stock"
      >
        <input
          id={id}
          type="checkbox"
          {...aria}
          {...rest}
          className="size-5 shrink-0 accent-mk-ink"
        />
        <span>{label}</span>
      </label>
      {help ? (
        <p id={mkHelpId(id)} className={cx("m-0", HELP)}>
          {help}
        </p>
      ) : null}
      {error ? <MkFieldError id={id}>{error}</MkFieldError> : null}
    </div>
  );
}

export type MkFormError = { readonly id: string; readonly message: string };

export type MkErrorSummaryProps = {
  title: string;
  errors: readonly MkFormError[];
  /** The form focuses this after a failed submit. */
  ref?: Ref<HTMLDivElement>;
  className?: string;
};

/** Top-of-form summary: danger tint, 1px danger border, role=alert, focus target, links to #<id>. */
export function MkErrorSummary({
  title,
  errors,
  ref,
  className,
}: MkErrorSummaryProps) {
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cx(
        "flex flex-col gap-3 border border-mk-danger bg-mk-danger-tint p-4 text-mk-ink",
        className,
      )}
    >
      <p className="m-0 flex items-start gap-2 text-[18px] leading-[1.55] font-bold">
        <CircleAlert
          size={20}
          aria-hidden="true"
          className="mt-1 shrink-0 text-mk-danger"
        />
        <span>{title}</span>
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-7">
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className="inline-block py-1 text-[18px] leading-[1.55] text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type MkFormStatusProps = {
  tone: "success" | "error";
  title?: ReactNode;
  /** Heading level for the title (Contact success is an H2). */
  headingLevel?: 2 | 3;
  /** Focus target (tabIndex -1) for the form to move focus to. */
  ref?: Ref<HTMLDivElement>;
  className?: string;
  children?: ReactNode;
};

/** Success (role=status, leaf) or request-error (role=alert, danger) block. */
export function MkFormStatus({
  tone,
  title,
  headingLevel = 2,
  ref,
  className,
  children,
}: MkFormStatusProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const success = tone === "success";
  return (
    <div
      ref={ref}
      role={success ? "status" : "alert"}
      tabIndex={-1}
      className={cx(
        "flex flex-col gap-3 p-4 text-mk-ink",
        success
          ? "border-t-4 border-mk-leaf bg-mk-leaf-tint"
          : "border border-mk-danger bg-mk-danger-tint",
        className,
      )}
    >
      {title ? (
        <Heading className="m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
          {title}
        </Heading>
      ) : null}
      {children ? (
        <div className="flex items-start gap-2 text-[18px] leading-[1.55]">
          {success ? null : (
            <CircleAlert
              size={20}
              aria-hidden="true"
              className="mt-1 shrink-0 text-mk-danger"
            />
          )}
          <div>{children}</div>
        </div>
      ) : null}
    </div>
  );
}
