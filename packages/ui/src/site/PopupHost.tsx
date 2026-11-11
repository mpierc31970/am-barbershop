// Pop-up host (CONT-12, D118, D124; CONTEXT A3-Q4; 03-UI-SPEC "Pop-up dialog").
//
// Server component the tenant layout mounts once per page (03-12). It renders a closed
// <dialog> for every eligible pop-up and one client PopupController that wires triggers,
// frequency and accessibility.
// Eligible = enabled AND (button-only OR all-pages OR selected-pages including this page).
// Button-only pop-ups are rendered on every page because any button may point at them.
// The controller gets a minimal config: ids and trigger settings, never content or names
// (the dialog markup already carries what a visitor sees).
import type { PopupRecord } from "@cds/core/content";
import {
  PopupController,
  type PopupControllerConfig,
} from "./client/PopupController";
import { PopupDialog } from "./PopupDialog";
import type { CoreBoundData } from "./types";

export interface PopupHostProps {
  popups: PopupRecord[];
  pageId: string;
  now: Date;
  /**
   * The page's core bound data (07-14, CONT-21): 07-12's loader already includes live
   * pop-ups' media; 07-19 adds their forms. Rendered into the dialogs only, never into the
   * controller config.
   */
  coreData?: CoreBoundData;
}

export function isPopupOnPage(popup: PopupRecord, pageId: string): boolean {
  if (popup.enabled !== true) return false;
  switch (popup.show_on) {
    case "button-only":
    case "all-pages":
      return true;
    case "selected-pages":
      return Array.isArray(popup.page_ids) && popup.page_ids.includes(pageId);
    default:
      return false;
  }
}

/** Ids of the pop-ups PopupHost renders on this page: the only ones a button can open. */
export function openablePopupIds(
  popups: readonly PopupRecord[],
  pageId: string,
): Set<string> {
  return new Set(
    (Array.isArray(popups) ? popups : [])
      .filter((p) => isPopupOnPage(p, pageId))
      .map((p) => p.id),
  );
}

export function popupControllerConfig(
  popup: PopupRecord,
): PopupControllerConfig {
  return {
    id: popup.id,
    trigger: popup.trigger,
    delay_seconds: popup.delay_seconds,
    scroll_percent: popup.scroll_percent,
    frequency: popup.frequency,
    show_on: popup.show_on,
    page_ids: [...popup.page_ids],
    enabled: popup.enabled,
  };
}

export function PopupHost({ popups, pageId, now, coreData }: PopupHostProps) {
  const eligible = (Array.isArray(popups) ? popups : []).filter((p) =>
    isPopupOnPage(p, pageId),
  );
  if (eligible.length === 0) return null;
  return (
    <>
      {eligible.map((p) => (
        <PopupDialog key={p.id} popup={p} now={now} coreData={coreData} />
      ))}
      <PopupController
        config={eligible.map(popupControllerConfig)}
        pageId={pageId}
      />
    </>
  );
}
