"use client";
// Shared native <dialog> wiring for Dialog and Drawer (03-UI-SPEC "Accessibility
// contract": native dialog, Esc, focus return). showModal() gives the platform's focus
// trap, inert background and top layer. Esc arrives as the `cancel` event, which is
// routed through onClose so the parent's `open` state stays the single source of truth.
import { useEffect, useRef, type RefObject } from "react";

export function useModalDialog(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Open/close follows the prop; focus returns to whatever opened it.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  // Esc (cancel) and backdrop clicks both ask the parent to close.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const onClick = (e: MouseEvent) => {
      // A click whose target is the <dialog> itself landed on the backdrop, because
      // the content fills the dialog box with its own element.
      if (e.target === dialog) onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
    };
  }, []);

  return ref;
}
