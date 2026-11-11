// Hub IconButton (03-UI-SPEC "Hub primitives", "Accessibility contract"; D311).
// 40px on fine pointers, 44px on coarse. `label` is required: it becomes the aria-label
// and the visible tooltip on hover/focus, and should name the target ("Delete Hero block").
// Icons are lucide at stroke 2, 20px (nav, toolbar) or 16px (rows); never emoji.
//
// aria-disabled (not `disabled`) is for a button that can become unavailable while it has
// focus, like Move up reaching the top: a `disabled` button drops keyboard focus to
// <body>. It looks disabled, is announced as dimmed, stays focusable, and ignores clicks
// (03-REVIEW WR-C11).
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> {
  /** Accessible name and tooltip text. Required. */
  label: string;
  icon: ReactNode;
  size?: "md" | "sm";
  /** Visually hide the tooltip (the label is still the accessible name). */
  hideTooltip?: boolean;
  /**
   * Which button edge the tooltip lines up with. "start" for a button at a row's left edge
   * (drag handles, Open menu), "end" at its right edge (More actions), so the tooltip never
   * spills past a scrolling pane. Default "center".
   */
  tooltipAlign?: "center" | "start" | "end";
}

const TOOLTIP_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
} as const;

const SIZES = {
  md: "h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11",
  sm: "h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11",
} as const;

export function IconButton({
  label,
  icon,
  size = "md",
  hideTooltip = false,
  tooltipAlign = "center",
  className,
  type = "button",
  onClick,
  ...rest
}: IconButtonProps) {
  const softDisabled =
    rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <span className="group/iconbtn relative inline-flex">
      <button
        {...rest}
        type={type}
        aria-label={label}
        onClick={
          softDisabled
            ? (e: MouseEvent<HTMLButtonElement>) => e.preventDefault()
            : onClick
        }
        className={
          "inline-flex items-center justify-center rounded text-hub-ink-muted " +
          "transition-colors duration-150 hover:bg-hub-surface-2 hover:text-hub-ink " +
          "active:bg-hub-border disabled:cursor-not-allowed disabled:opacity-50 " +
          "disabled:hover:bg-transparent aria-disabled:cursor-not-allowed " +
          "aria-disabled:opacity-50 aria-disabled:hover:bg-transparent " +
          `aria-disabled:active:bg-transparent ${SIZES[size]}${className ? ` ${className}` : ""}`
        }
      >
        {icon}
      </button>
      {hideTooltip ? null : (
        <span
          role="tooltip"
          aria-hidden="true"
          className={
            `pointer-events-none absolute top-full z-20 mt-1 ${TOOLTIP_ALIGN[tooltipAlign]} ` +
            "rounded bg-hub-ink px-2 py-1 font-hub text-sm whitespace-nowrap text-hub-surface " +
            "opacity-0 transition-opacity duration-150 " +
            "group-hover/iconbtn:opacity-100 group-focus-within/iconbtn:opacity-100"
          }
        >
          {label}
        </span>
      )}
    </span>
  );
}
