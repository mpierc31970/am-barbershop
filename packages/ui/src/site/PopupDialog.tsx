// Pop-up dialog markup (CONT-12, D118, D124; 03-UI-SPEC "Pop-up dialog", "Motion
// contract", "Accessibility contract"; T-03-39).
//
// Server-rendered native <dialog>, closed until the client controller calls showModal().
// - Labelled by its first heading item (that heading gets the id), else aria-label = the
//   pop-up's name.
// - Items render through ColumnItemRenderer, so rich text is sanitized on this render path
//   (T-03-39). validatePopup already forbids pop-up buttons inside pop-ups: no nesting.
// - The dialog itself has no padding; the inner panel carries it, so a click whose target
//   is the <dialog> element can only be a backdrop click.
// - Close sits last in DOM order (visually top-right, 44x44) so initial focus lands on the
//   first interactive content element, falling back to Close.
// - Enter: opacity 0->1 and scale 0.98->1 over 200ms ease-out-expo; instant under
//   reduced motion.
// - A pop-up taller than the viewport scrolls (WCAG 1.4.10; body scroll is locked while
//   it is open). The dialog is capped at the viewport height and the inner panel scrolls;
//   Close is positioned against the dialog, outside the scrolling panel, so it stays in
//   view however far the owner's content runs (WR-C05).
import type { PopupRecord } from "@cds/core/content";
import { X } from "lucide-react";
import { ColumnItemRenderer } from "./ColumnItemRenderer";
import type { CoreBoundData } from "./types";
import { text as clean } from "./urls";

export interface PopupDialogProps {
  popup: PopupRecord;
  /** Request time, for countdown items. */
  now: Date;
  /** The page's media and forms, so video, audio and form items render (07-14). */
  coreData?: CoreBoundData;
}

const DIALOG =
  "m-auto w-[calc(100%-32px)] max-w-[480px] max-h-[calc(100dvh-32px)] " +
  "overflow-visible border-0 p-0 " +
  "bg-site-surface text-site-text rounded-site-media shadow-site-overlay " +
  "backdrop:bg-[var(--site-backdrop)] " +
  "transition-[opacity,scale] duration-200 ease-out-expo " +
  "starting:opacity-0 starting:scale-98 " +
  "motion-reduce:transition-none motion-reduce:starting:scale-100";

// The scrolling panel: as tall as its content, up to the dialog's cap. rounded-[inherit]
// keeps scrolled content inside the dialog's corners.
const PANEL =
  "max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain rounded-[inherit] p-8";

const CLOSE =
  "absolute top-2 right-2 inline-flex size-11 items-center justify-center " +
  "rounded-site-button bg-transparent text-site-text cursor-pointer " +
  "hover:bg-[color-mix(in_oklch,var(--site-text)_6%,transparent)]";

export function popupDialogId(id: string): string {
  return `cds-popup-${id}`;
}

export function PopupDialog({ popup, now, coreData }: PopupDialogProps) {
  const items = Array.isArray(popup.content?.items) ? popup.content.items : [];
  const dialogId = popupDialogId(popup.id);
  const titleId = `${dialogId}-title`;
  const first = items.find(
    (item) => item.kind === "heading" && clean(item.text) !== "",
  );
  const label = first
    ? { "aria-labelledby": titleId }
    : { "aria-label": clean(popup.name) || "Pop-up" };

  return (
    <dialog
      id={dialogId}
      data-cds-popup={popup.id}
      {...label}
      className={DIALOG}
    >
      <div className={PANEL}>
        <div className="flex flex-col gap-4 pe-6">
          {items.map((item, i) => (
            <ColumnItemRenderer
              key={`${dialogId}-${item.id ?? i}`}
              item={item}
              headingId={item === first ? titleId : undefined}
              now={now}
              media={coreData?.media}
              forms={coreData?.forms}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="Close"
        data-cds-popup-close=""
        className={CLOSE}
      >
        <X aria-hidden="true" size={20} strokeWidth={2} />
      </button>
    </dialog>
  );
}
