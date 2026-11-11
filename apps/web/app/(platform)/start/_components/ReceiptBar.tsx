"use client";
// The phone receipt (06-UI-SPEC "Phone (<1024px)"; D-UI-P6-35). A fixed 64 px bottom bar
// (plus the safe area) with the monthly figure over the build figure and a secondary
// View quote. View quote opens a bottom sheet (native <dialog> through the hub Drawer,
// max 85vh, own scroll) holding the full Receipt; Esc, the backdrop and Close quote close
// it, and focus returns to View quote. /start's main already has 96 px bottom padding
// below 1024 px, so the bar never covers the last control.
import { formatCents, formatMonthly } from "@cds/core/pricing";
import { Button, Drawer, IconButton } from "@cds/ui/hub";
import { ChevronDown, X } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

export const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * True at 1024 px and up. The server (and a browser without matchMedia) renders the wide
 * layout; phones switch to the bar on hydration.
 */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(WIDE_QUERY).matches
        : true,
    () => true,
  );
}

export interface ReceiptBarProps {
  /** Monthly figure in cents, or null when unpriced / unknown. */
  monthlyCents: number | null;
  buildCents: number | null;
  /** The full Receipt, shown in the sheet. */
  children: ReactNode;
}

export function ReceiptBar({
  monthlyCents,
  buildCents,
  children,
}: ReceiptBarProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={
          "fixed inset-x-0 bottom-0 z-40 border-t border-hub-border bg-hub-surface-2 font-hub " +
          "pb-[env(safe-area-inset-bottom)]"
        }
      >
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex flex-col leading-tight tabular-nums">
            <span className="text-base font-semibold text-hub-ink">
              {monthlyCents === null ? "" : formatMonthly(monthlyCents)}
            </span>
            <span className="text-sm text-hub-ink-muted">
              {buildCents === null ? "" : `${formatCents(buildCents)} build`}
            </span>
          </div>
          <Button
            variant="secondary"
            aria-haspopup="dialog"
            aria-expanded={open}
            icon={
              <ChevronDown
                aria-hidden
                size={16}
                strokeWidth={2}
                className="rotate-180"
              />
            }
            onClick={() => setOpen(true)}
          >
            View quote
          </Button>
        </div>
      </div>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label="Your quote"
        side="bottom"
      >
        <div className="flex justify-end px-2 pt-2">
          <IconButton
            label="Close quote"
            icon={<X aria-hidden size={20} strokeWidth={2} />}
            onClick={() => setOpen(false)}
          />
        </div>
        <div className="px-2 pb-4">{children}</div>
      </Drawer>
    </>
  );
}
