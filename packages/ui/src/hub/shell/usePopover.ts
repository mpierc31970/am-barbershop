"use client";
// Shared popover wiring for the org switcher and the profile menu (11-15; 11-UI-SPEC
// "Profile menu", "Org switcher": Esc closes and returns focus). A click outside closes
// without moving focus; `close()` returns focus to the trigger button inside `anchorRef`.
// State-driven rather than the popover API, so it behaves the same in every browser and
// in jsdom (choice recorded in 11-15-SUMMARY).
import { useCallback, useEffect, useRef, useState } from "react";

export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const trigger = useCallback(
    (): HTMLButtonElement | null =>
      anchorRef.current?.querySelector<HTMLButtonElement>(
        "button[aria-haspopup]",
      ) ?? null,
    [],
  );

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) trigger()?.focus();
    },
    [trigger],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return { open, setOpen, close, anchorRef };
}
