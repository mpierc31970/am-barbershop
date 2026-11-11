"use client";
// Overlay core for native <dialog> pop-ups (CONT-12, D118; 03-UI-SPEC "Pop-up dialog",
// "Accessibility contract"; T-03-40).
//
// Ported from spankmastertees ui/overlay/useOverlay.ts + useBodyScrollLock.ts, adapted to
// a native modal <dialog>:
// - Focus capture: remember the opener (explicit returnFocus wins, else the element that
//   had focus), and restore it only on a real open -> close transition.
// - Initial focus: the first interactive content element, else the Close button.
// - Esc arrives as the dialog's `cancel` event (the platform closes it); every close path
//   funnels through the `close` event, so cleanup runs exactly once.
// - Backdrop click: the click target is the <dialog> element itself (the inner panel
//   carries all padding, so content clicks never target the dialog).
// - Body scroll lock: overflow hidden with scrollbar-width padding compensation (the
//   donor's position:fixed variant jumps the page under a native top-layer dialog).
// - Focus trap from useFocusTrap.
import { useEffect, useRef, type RefObject } from "react";
import { attachFocusTrap, focusablesIn } from "./useFocusTrap";

export const CLOSE_SELECTOR = "[data-cds-popup-close]";

export interface OpenOverlayOptions {
  /** Where focus goes on close; defaults to whatever was focused on open. */
  returnFocus?: HTMLElement | null;
  /** Called once after the dialog has closed and everything is restored. */
  onClosed?: () => void;
}

export interface OverlayHandle {
  close: () => void;
}

function lockBodyScroll(): () => void {
  const body = document.body;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const prevOverflow = body.style.overflow;
  const prevPadding = body.style.paddingRight;
  body.style.overflow = "hidden";
  if (gap > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + gap}px`;
  }
  return () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPadding;
  };
}

function initialFocusTarget(dialog: HTMLDialogElement): HTMLElement | null {
  const all = focusablesIn(dialog);
  const content = all.find((el) => !el.matches(CLOSE_SELECTOR));
  return content ?? dialog.querySelector<HTMLElement>(CLOSE_SELECTOR) ?? null;
}

/** Open a server-rendered dialog modally and wire close, focus and scroll lock. */
export function openOverlay(
  dialog: HTMLDialogElement,
  options: OpenOverlayOptions = {},
): OverlayHandle {
  const opener =
    options.returnFocus ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);

  const close = () => {
    if (dialog.open) dialog.close();
  };
  const onClick = (e: MouseEvent) => {
    if (e.target === dialog) {
      close();
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(CLOSE_SELECTOR)) close();
  };

  let unlock: (() => void) | null = null;
  let untrap: (() => void) | null = null;
  const onClose = () => {
    dialog.removeEventListener("click", onClick);
    dialog.removeEventListener("close", onClose);
    untrap?.();
    unlock?.();
    if (opener && opener.isConnected) opener.focus();
    options.onClosed?.();
  };

  dialog.addEventListener("click", onClick);
  dialog.addEventListener("close", onClose);
  untrap = attachFocusTrap(dialog);
  unlock = lockBodyScroll();
  if (!dialog.open) dialog.showModal();
  initialFocusTarget(dialog)?.focus();

  return { close };
}

export interface UseOverlayOptions {
  isOpen: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** React-controlled variant (e.g. the hub pop-up preview reusing PopupDialog). */
export function useOverlay(
  dialogRef: RefObject<HTMLDialogElement | null>,
  { isOpen, onClose, returnFocusRef }: UseOverlayOptions,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    let closedByDialog = false;
    const handle = openOverlay(dialog, {
      returnFocus: returnFocusRef?.current ?? null,
      onClosed: () => {
        closedByDialog = true;
        onCloseRef.current();
      },
    });
    return () => {
      if (!closedByDialog) handle.close();
    };
  }, [dialogRef, isOpen, returnFocusRef]);
}
