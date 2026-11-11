// Pop-ups tab logic (CONT-12, D118, D124; CONTEXT A3-Q4; 03-UI-SPEC "Pop-ups tab",
// "Destructive actions"). Pure and DOM-free: the client list and editor, the server tab and
// the tests share it. The server (validatePopup in @cds/db) re-checks everything; these
// checks only give the owner the same copy before a round trip.
import {
  POPUP_DELAY,
  POPUP_NAME_MAX,
  POPUP_SCROLL,
  type ColumnItem,
  type PopupFrequency,
  type PopupRecord,
  type PopupTrigger,
} from "@cds/core/content";

export const POPUP_SAVED_COPY = "Pop-up saved.";

export const POPUP_HELD_COPY =
  "This pop-up is being reviewed, usually within 2 business days. It stays off until then.";

export const POPUP_CLICK_WHERE_COPY =
  "It opens from any button set to this pop-up.";

export const POPUP_NAME_HELPER =
  "Only you see this. Screen readers hear it if the pop-up has no heading.";

export const POPUP_COPY = {
  name: "Give the pop-up a name.",
  nameLong: `Keep this under ${POPUP_NAME_MAX} characters.`,
  delay: `Pick a delay from ${POPUP_DELAY.min} to ${POPUP_DELAY.max} seconds.`,
  scroll: `Pick a scroll point from ${POPUP_SCROLL.min} to ${POPUP_SCROLL.max} percent.`,
  pages: "Choose at least one page, or show it on every page.",
} as const;

/** "Where" only matters for automatic triggers; a click pop-up opens from its buttons. */
export function showWhereSection(trigger: PopupTrigger): boolean {
  return trigger !== "click";
}

/** "How often" applies to automatic triggers only: every click opens the pop-up. */
export function showFrequencySection(trigger: PopupTrigger): boolean {
  return trigger !== "click";
}

/** Separators for "A", "A and B", "A, B and C": the text before item i (i >= 1). */
export function listSeparator(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? " and " : ", ";
}

export function joinTitles(titles: readonly string[]): string {
  return titles.map((t, i) => listSeparator(i, titles.length) + t).join("");
}

/** Where a pop-up is used (@cds/db PopupUsage, 07-28). */
export type PopupUsageView = {
  pages: readonly { id: string; title: string }[];
  inVersions: boolean;
  inMenu: boolean;
  used: boolean;
};

/**
 * The delete dialog body (UI-SPEC "Destructive actions", CONT-36, D275): a used pop-up is
 * soft-deleted and keeps opening from its buttons; an unused one gets the P3 body.
 */
export function deletePopupBody(usage: PopupUsageView): string {
  if (!usage.used) return DELETE_DIALOG_BODY;
  const titles = usage.pages.map((p) => p.title).filter((t) => t !== "");
  if (titles.length === 0) {
    return "It leaves your pop-ups list. Buttons that use it keep opening it until you change them, so nothing breaks.";
  }
  return `It leaves your pop-ups list. Buttons on ${joinTitles(titles)} keep opening it until you change them, so nothing breaks.`;
}

export function deleteDialogTitle(name: string): string {
  return `Delete the ${name} pop-up?`;
}

export const DELETE_DIALOG_BODY =
  "It stops showing on your site right away. This can't be undone.";

export type PopupWhere = "all-pages" | "selected-pages";

/** The editor's working copy. Numbers stay strings while typed. */
export type PopupDraft = {
  name: string;
  items: ColumnItem[];
  trigger: PopupTrigger;
  delay: string;
  scroll: string;
  frequency: PopupFrequency;
  where: PopupWhere;
  page_ids: string[];
  enabled: boolean;
};

export function newPopupDraft(): PopupDraft {
  return {
    name: "",
    items: [],
    trigger: "delay",
    delay: String(POPUP_DELAY.default),
    scroll: String(POPUP_SCROLL.default),
    frequency: "once-per-visitor",
    where: "all-pages",
    page_ids: [],
    // A new pop-up is on once saved: the owner just built it to be seen. The list's
    // switch turns it off.
    enabled: true,
  };
}

export function draftFromPopup(p: PopupRecord): PopupDraft {
  return {
    name: p.name,
    items: [...p.content.items],
    trigger: p.trigger,
    delay: String(p.delay_seconds),
    scroll: String(p.scroll_percent),
    frequency: p.frequency,
    where: p.show_on === "selected-pages" ? "selected-pages" : "all-pages",
    page_ids: [...p.page_ids],
    enabled: p.enabled,
  };
}

function intIn(
  value: string,
  range: { min: number; max: number },
): number | null {
  const s = value.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= range.min && n <= range.max ? n : null;
}

export type PopupField = "name" | "delay" | "scroll" | "pages";

export function popupFieldErrors(
  d: PopupDraft,
): Partial<Record<PopupField, string>> {
  const errors: Partial<Record<PopupField, string>> = {};
  const name = d.name.trim();
  if (name === "") errors.name = POPUP_COPY.name;
  else if (name.length > POPUP_NAME_MAX) errors.name = POPUP_COPY.nameLong;
  if (d.trigger === "delay" && intIn(d.delay, POPUP_DELAY) === null) {
    errors.delay = POPUP_COPY.delay;
  }
  if (d.trigger === "scroll" && intIn(d.scroll, POPUP_SCROLL) === null) {
    errors.scroll = POPUP_COPY.scroll;
  }
  if (
    showWhereSection(d.trigger) &&
    d.where === "selected-pages" &&
    d.page_ids.length === 0
  ) {
    errors.pages = POPUP_COPY.pages;
  }
  return errors;
}

/** Which field a chokepoint InvalidInput message belongs to (null: form-level). */
export function popupErrorField(message: string): PopupField | null {
  if (message === POPUP_COPY.name || message === POPUP_COPY.nameLong) {
    return "name";
  }
  if (message === POPUP_COPY.delay) return "delay";
  if (message === POPUP_COPY.scroll) return "scroll";
  if (message === POPUP_COPY.pages) return "pages";
  return null;
}

/** The savePopupAction input. Hidden settings keep safe values the server accepts. */
export function draftToInput(d: PopupDraft, id: string | null) {
  const where = showWhereSection(d.trigger);
  return {
    ...(id ? { id } : {}),
    name: d.name.trim(),
    content: { items: d.items },
    trigger: d.trigger,
    delay_seconds: intIn(d.delay, POPUP_DELAY) ?? POPUP_DELAY.default,
    scroll_percent: intIn(d.scroll, POPUP_SCROLL) ?? POPUP_SCROLL.default,
    frequency: d.frequency,
    show_on: where ? d.where : "button-only",
    page_ids: where && d.where === "selected-pages" ? d.page_ids : [],
    enabled: d.enabled,
  };
}

export type PopupInput = ReturnType<typeof draftToInput>;

/** `?tab=popups` links: a selected pop-up, the new pop-up form, or the bare list. */
export function popupsHref(popup?: string | null): string {
  const base = "?tab=popups";
  return popup ? `${base}&popup=${encodeURIComponent(popup)}` : base;
}
