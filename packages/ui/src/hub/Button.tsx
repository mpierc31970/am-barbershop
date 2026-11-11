// Hub Button (03-UI-SPEC "Hub primitives", D-UI-1; D311 owner-hub pattern).
// Variants: primary (the one accent fill per view), secondary, ghost, destructive.
// Sizes: md 40px, sm 32px (rows); 44px hit area on coarse pointers. Weights 400/600 only,
// 150ms colour transitions, focus ring from globals.css (2px hub-accent, 2px offset).
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and the loading label; the button is disabled and aria-busy. */
  loading?: boolean;
  /** What the button says while busy ("Saving…", "Publishing…"). Defaults to children. */
  loadingLabel?: string;
  /** Optional leading icon (lucide, 16px). */
  icon?: ReactNode;
  /** React 19 ref-as-prop (10-13: focus the charge primary once figures load). */
  ref?: Ref<HTMLButtonElement>;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded font-hub font-semibold " +
  "whitespace-nowrap transition-colors duration-150 select-none " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "pointer-coarse:min-h-11";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-hub-accent text-hub-surface hover:bg-hub-accent-hover active:bg-hub-accent-hover " +
    "disabled:hover:bg-hub-accent",
  secondary:
    "border border-hub-border-strong bg-hub-surface text-hub-ink " +
    "hover:bg-hub-surface-2 active:bg-hub-border disabled:hover:bg-hub-surface",
  ghost:
    "bg-transparent text-hub-ink hover:bg-hub-surface-2 active:bg-hub-border " +
    "disabled:hover:bg-transparent",
  destructive:
    "bg-hub-danger text-hub-surface hover:opacity-90 active:opacity-80 " +
    "disabled:hover:opacity-50",
};

const SIZES: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-base",
  sm: "h-8 px-3 text-sm",
};

export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  icon,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const busy = loading;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonClasses(variant, size)}${className ? ` ${className}` : ""}`}
    >
      {busy ? (
        <Loader2
          aria-hidden
          size={16}
          strokeWidth={2}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        icon
      )}
      <span>{busy && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
