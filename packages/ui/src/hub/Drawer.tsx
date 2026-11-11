"use client";
// Hub Drawer (03-UI-SPEC "Hub shell" below 1024px; D311). The sidebar inside a left-edge
// native <dialog>, 288px wide, sliding in over 200ms ease-out-expo (instant under
// prefers-reduced-motion). Esc, backdrop click and the parent's nav-click handler all
// close it through onClose; focus returns to the menu button that opened it.
import type { ReactNode } from "react";
import { useModalDialog } from "./useModalDialog";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, e.g. "Menu". */
  label: string;
  children: ReactNode;
  /**
   * "left" (default): the P3 nav drawer, 288px on hub-surface-2. "right": the P5 panel
   * drawer (record edit, training, backups; 05-UI-SPEC), 480px at 768px and up, full
   * width below, on hub-surface. "bottom": the P6 phone sheet (the /start receipt), full
   * width, at most 85vh, 16px top radius, on hub-surface-2.
   */
  side?: "left" | "right" | "bottom";
}

const EDGE = "inset-y-0 h-full max-h-none open:translate-x-0 ";

const SIDES = {
  left:
    EDGE +
    "left-0 w-72 max-w-[calc(100%-48px)] bg-hub-surface-2 " +
    "-translate-x-full starting:open:-translate-x-full",
  right:
    EDGE +
    "right-0 left-auto w-full md:w-[480px] bg-hub-surface " +
    "translate-x-full starting:open:translate-x-full",
  bottom:
    "inset-x-0 top-auto bottom-0 w-full max-w-none max-h-[85vh] rounded-t-2xl " +
    "bg-hub-surface-2 translate-y-full starting:open:translate-y-full open:translate-y-0",
} as const;

export function Drawer({
  open,
  onClose,
  label,
  children,
  side = "left",
}: DrawerProps) {
  const ref = useModalDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={
        "fixed m-0 p-0 font-hub text-hub-ink " +
        `backdrop:bg-hub-ink/40 ${SIDES[side]} ` +
        "transition-transform duration-200 ease-out-expo " +
        "motion-reduce:transition-none"
      }
    >
      <div
        className={
          side === "bottom"
            ? "flex max-h-[85vh] flex-col overflow-y-auto"
            : "flex h-full flex-col overflow-y-auto"
        }
      >
        {children}
      </div>
    </dialog>
  );
}
