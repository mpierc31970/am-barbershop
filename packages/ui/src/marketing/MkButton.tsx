// Owner: 15-09 (P15-P1). MkButton (<button>) and MkLinkButton (Next Link, or <a> for new-tab links).
// Variants (UI-SPEC components, Interaction states): primary = the field's action pair (ink on light
// grounds, white on dark chips), secondary = 1px field-fg border, text = underlined link.
// Sizes md 44px, lg 52px. Colours come from the field scope vars, so a button inverts on dark fields.
// Chips are identity, never action: no chip colour here.
import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type MkButtonVariant = "primary" | "secondary" | "text";
export type MkButtonSize = "md" | "lg";

/** sr-only suffix for links that open a new tab (UI-SPEC Accessibility contract). */
const NEW_TAB = "(opens in a new tab)";

const BASE =
  "inline-flex items-center justify-center gap-2 font-bold no-underline leading-none cursor-pointer active:translate-y-px";

const VARIANT: Record<MkButtonVariant, string> = {
  primary:
    "rounded-mk-round bg-mk-action-bg text-mk-action-fg transition-colors duration-[var(--mk-dur-fast)] ease-linear hover:bg-[color-mix(in_srgb,var(--mk-action-bg)_88%,var(--mk-action-fg))]",
  secondary:
    "rounded-mk-round border border-mk-fg text-mk-fg hover:shadow-[inset_0_0_0_1px_var(--mk-fg)]",
  text: "text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2",
};

const SIZE: Record<MkButtonSize, string> = {
  md: "min-h-11 px-5 text-[18px]",
  lg: "min-h-[52px] px-6 text-[18px]",
};

/** Class list for a marketing button or link-button. */
export function mkButtonClasses(
  variant: MkButtonVariant = "primary",
  size: MkButtonSize = "md",
  className?: string,
): string {
  const sizing = variant === "text" ? "min-h-11 text-[18px]" : SIZE[size];
  return [BASE, VARIANT[variant], sizing, className ?? ""]
    .filter(Boolean)
    .join(" ");
}

function Trailing({ icon }: { icon?: "arrow" | "external" }) {
  if (icon === "arrow") return <ArrowRight size={20} aria-hidden="true" />;
  if (icon === "external") return <ExternalLink size={16} aria-hidden="true" />;
  return null;
}

export type MkButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: MkButtonVariant;
  size?: MkButtonSize;
  /** Trailing ArrowRight 20 (after the words). */
  icon?: "arrow";
};

export function MkButton({
  variant = "primary",
  size = "md",
  icon,
  type = "button",
  className,
  children,
  ...rest
}: MkButtonProps) {
  return (
    <button
      type={type}
      className={mkButtonClasses(variant, size, className)}
      {...rest}
    >
      {children}
      <Trailing icon={icon} />
    </button>
  );
}

export type MkLinkButtonProps = {
  href: string;
  variant?: MkButtonVariant;
  size?: MkButtonSize;
  /** Trailing ArrowRight 20 (primary CTAs). External links always get ExternalLink 16. */
  icon?: "arrow";
  /** Opens in a new tab: target _blank, rel noopener, ExternalLink 16, sr-only note. */
  external?: boolean;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
};

export function MkLinkButton({
  href,
  variant = "primary",
  size = "md",
  icon,
  external = false,
  className,
  children,
  "aria-label": ariaLabel,
}: MkLinkButtonProps) {
  const classes = mkButtonClasses(variant, size, className);
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        aria-label={ariaLabel ? `${ariaLabel} ${NEW_TAB}` : undefined}
        className={classes}
      >
        {children}
        <span className="sr-only"> {NEW_TAB}</span>
        <Trailing icon="external" />
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel} className={classes}>
      {children}
      <Trailing icon={icon} />
    </Link>
  );
}
