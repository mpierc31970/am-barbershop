"use client";
// Focus trap (CONT-12, D118; 03-UI-SPEC "Pop-up dialog", "Accessibility contract").
//
// Ported from spankmastertees ui/overlay/useFocusTrap.ts (itself lifted from its
// CartDrawer). Same selector and same first<->last wrap, recomputed at keypress so DOM
// changes inside the panel are reflected. Adapted: the wrap logic is a plain function
// (cycleFocus) so the pop-up controller can attach it to server-rendered dialogs, and the
// hook attaches a keydown listener itself instead of returning an onKeyDown prop.
import { useEffect, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusablesIn(panel: ParentNode): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

/** On Tab / Shift+Tab, wrap focus first <-> last within `panel`. */
export function cycleFocus(
  panel: ParentNode,
  e: TabKeyEvent,
  active: Element | null = typeof document === "undefined"
    ? null
    : document.activeElement,
): void {
  if (e.key !== "Tab") return;
  const focusables = focusablesIn(panel);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (e.shiftKey && (active === first || !isInside(focusables, active))) {
    e.preventDefault();
    last.focus();
  } else if (
    !e.shiftKey &&
    (active === last || !isInside(focusables, active))
  ) {
    e.preventDefault();
    first.focus();
  }
}

function isInside(list: HTMLElement[], el: Element | null): boolean {
  return el !== null && list.some((f) => f === el);
}

/** Attach the trap to an element; returns the detach function. */
export function attachFocusTrap(panel: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => cycleFocus(panel, e);
  panel.addEventListener("keydown", onKeyDown);
  return () => panel.removeEventListener("keydown", onKeyDown);
}

export function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;
    return attachFocusTrap(panel);
  }, [panelRef, active]);
}
