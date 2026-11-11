"use client";
// Hub Dialog (03-UI-SPEC "Hub primitives", "Destructive actions", "Accessibility
// contract"; D-UI-1). Native <dialog> opened with showModal(); Esc arrives as the `cancel`
// event and goes through onClose; focus returns to the opener. Labelled by its Heading
// 20/600 title. The footer holds named actions (never bare "Cancel"/"OK"); put autoFocus
// on the safe one for destructive confirms ("Keep pop-up").
import { useId, type ReactNode } from "react";
import { useModalDialog } from "./useModalDialog";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: DialogProps) {
  const ref = useModalDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={
        "m-auto w-[calc(100%-32px)] max-w-lg rounded bg-hub-surface p-0 font-hub " +
        "text-hub-ink shadow-xl backdrop:bg-hub-ink/40"
      }
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          {title}
        </h2>
        <div className="text-base">{children}</div>
        <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div>
      </div>
    </dialog>
  );
}
