// Notice, lock and held-changes words (12-14; 12-UI-SPEC lines 564-608, copy 784-788). The
// contract IDs come from SUPPORT_UI_COPY (12-06), never retyped; the rest are screen words
// that are not contract IDs. Plain, browser-safe.
import { SUPPORT_UI_COPY } from "../copy";

export const NOTICES_COPY = Object.freeze({
  LOCKED_BODY: SUPPORT_UI_COPY.LOCKED_BODY,
  HELD_KEPT: SUPPORT_UI_COPY.HELD_KEPT,
  HELD_APPLY_NOTE: SUPPORT_UI_COPY.HELD_APPLY_NOTE,
  applyChanges: SUPPORT_UI_COPY.BUTTONS.applyChanges,
  discardChanges: SUPPORT_UI_COPY.BUTTONS.discardChanges,
  whatHappened: SUPPORT_UI_COPY.BUTTONS.whatHappened,
  applying: "Applying…",
  discarding: "Discarding…",
  close: "Close",
  /**
   * The strip's Dismiss label. It names the notice through aria-describedby pointing at the
   * strip's text (UI-SPEC line 846; 12-REVIEW WR-D07).
   */
  dismissLabel: "Dismiss this notice",
  /** The expander under two strips. */
  more: (n: number) => (n === 1 ? "1 more notice" : `${n} more notices`),
  /** The region name the strips sit in. */
  regionLabel: "Notices from Support",
  /** The What happened dialog title. */
  incidentTitle: "What happened",
  lockedHeading: (target: string) =>
    `Editing is paused while Support works on this ${target}`,
  until: (end: string) => `Until ${end}`,
  /** "Saved at 2:14 pm" today; "Saved yesterday at 2:14 pm" / "Saved Thu 9 Oct at 2:14 pm" before. */
  savedAt: (time: string, day = "") =>
    day ? `Saved ${day} at ${time}` : `Saved at ${time}`,
  heldFinished: (time: string) =>
    time
      ? `Support has finished. Your changes from ${time} are waiting.`
      : "Support has finished. Your changes are waiting.",
});
