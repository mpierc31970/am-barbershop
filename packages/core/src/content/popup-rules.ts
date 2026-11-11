// Pop-up records and show rules (CONT-12, D118, D124; CONTEXT A3-Q4; T-03-14, T-03-15).
//
// A pop-up is a reusable record: one column of the existing column item kinds, a trigger,
// a frequency and page targeting. Pure and DOM-free: the client host gathers the facts
// (event, storage flags, pointer type, whether an automatic pop-up already opened) and
// asks shouldShowPopup; the server and tests use the same function.
//
// Rules:
// - Frequency and page targeting apply to AUTOMATIC triggers only. A visitor who clicks
//   a button pointed at an enabled pop-up always gets the dialog: they asked for it.
// - Only one automatic pop-up opens per page view.
// - Exit intent is desktop only ((hover: hover) and (pointer: fine)); on touch it is
//   simply not shown.
// - Content never holds a pop-up button (allowPopupButton: false), so pop-ups cannot
//   nest or loop (T-03-14). Delay and scroll are bounded.
// - page_ids are shape-checked here; that they belong to the org is checked in @cds/db
//   (T-03-15, 03-06).
// - Frequency flags live in sessionStorage/localStorage under popupFrequencyKey(id), no
//   cookies, so no consent banner is needed.
import { InvalidInput } from "../errors";
import type { ColumnItem } from "./types";
import {
  MAX_ITEMS_PER_COLUMN,
  assertUniqueItemIds,
  validateColumnItem,
} from "./validate";

export const POPUP_TRIGGERS = [
  "click",
  "delay",
  "scroll",
  "exit-intent",
  "page-load",
] as const;
export const POPUP_FREQUENCIES = [
  "every-visit",
  "once-per-session",
  "once-per-visitor",
] as const;
export const POPUP_SHOW_ON = [
  "button-only",
  "all-pages",
  "selected-pages",
] as const;

export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];
export type PopupFrequency = (typeof POPUP_FREQUENCIES)[number];
export type PopupShowOn = (typeof POPUP_SHOW_ON)[number];

export type PopupRecord = {
  id: string;
  name: string;
  content: { items: ColumnItem[] };
  trigger: PopupTrigger;
  delay_seconds: number;
  scroll_percent: number;
  frequency: PopupFrequency;
  show_on: PopupShowOn;
  page_ids: string[];
  enabled: boolean;
};

export const POPUP_NAME_MAX = 80;
export const POPUP_DELAY = { min: 1, max: 120, default: 5 } as const;
export const POPUP_SCROLL = { min: 10, max: 100, default: 50 } as const;
export const POPUP_MAX_PAGES = 200;

const PAGE_ID = /^[a-z0-9]{15}$/;

const NAME_COPY = "Give the pop-up a name.";
const TRIGGER_COPY = "Choose when the pop-up appears.";
const FREQUENCY_COPY = "Choose how often the pop-up appears.";
const SHOW_ON_COPY = "Choose where the pop-up appears.";
const DELAY_COPY = `Pick a delay from ${POPUP_DELAY.min} to ${POPUP_DELAY.max} seconds.`;
const SCROLL_COPY = `Pick a scroll point from ${POPUP_SCROLL.min} to ${POPUP_SCROLL.max} percent.`;
const PAGES_COPY = "Choose at least one page, or show it on every page.";
const PAGE_ID_COPY = "One of the chosen pages isn't valid.";
const MALFORMED_COPY = "This pop-up's content is malformed.";

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  copy: string,
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new InvalidInput(copy);
  }
  return value as T;
}

/** An integer in [min, max]; null/undefined/"" -> the default. */
function boundedInt(
  value: unknown,
  range: { min: number; max: number; default: number },
  copy: string,
): number {
  if (value === undefined || value === null || value === "") {
    return range.default;
  }
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (
    typeof n !== "number" ||
    !Number.isInteger(n) ||
    n < range.min ||
    n > range.max
  ) {
    throw new InvalidInput(copy);
  }
  return n;
}

function pageIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > POPUP_MAX_PAGES) {
    throw new InvalidInput(PAGE_ID_COPY);
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || !PAGE_ID.test(v)) {
      throw new InvalidInput(PAGE_ID_COPY);
    }
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function items(value: unknown): ColumnItem[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) throw new InvalidInput(MALFORMED_COPY);
  const list = own(value, "items");
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new InvalidInput(MALFORMED_COPY);
  if (list.length > MAX_ITEMS_PER_COLUMN) {
    throw new InvalidInput(
      `A pop-up can hold up to ${MAX_ITEMS_PER_COLUMN} items.`,
    );
  }
  const out = list.map((item) =>
    validateColumnItem(item, { allowPopupButton: false }),
  );
  assertUniqueItemIds(out);
  return out;
}

/** Deny-by-default validation of an owner-submitted pop-up; returns a fresh object. */
export function validatePopup(raw: unknown): Omit<PopupRecord, "id"> {
  if (!isRecord(raw)) throw new InvalidInput(MALFORMED_COPY);

  const nameRaw = own(raw, "name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (name === "") throw new InvalidInput(NAME_COPY);
  if (name.length > POPUP_NAME_MAX) {
    throw new InvalidInput(`Keep this under ${POPUP_NAME_MAX} characters.`);
  }

  const trigger = pick(own(raw, "trigger"), POPUP_TRIGGERS, TRIGGER_COPY);
  const frequency = pick(
    own(raw, "frequency") ?? "once-per-visitor",
    POPUP_FREQUENCIES,
    FREQUENCY_COPY,
  );
  let show_on = pick(
    own(raw, "show_on") ?? (trigger === "click" ? "button-only" : "all-pages"),
    POPUP_SHOW_ON,
    SHOW_ON_COPY,
  );
  // A click-trigger pop-up opens from its buttons only; the editor hides "Where".
  if (trigger === "click") show_on = "button-only";

  const page_ids = pageIds(own(raw, "page_ids"));
  if (show_on === "selected-pages" && page_ids.length === 0) {
    throw new InvalidInput(PAGES_COPY);
  }

  return {
    name,
    content: { items: items(own(raw, "content")) },
    trigger,
    delay_seconds: boundedInt(
      own(raw, "delay_seconds"),
      POPUP_DELAY,
      DELAY_COPY,
    ),
    scroll_percent: boundedInt(
      own(raw, "scroll_percent"),
      POPUP_SCROLL,
      SCROLL_COPY,
    ),
    frequency,
    show_on,
    page_ids,
    enabled: own(raw, "enabled") === true,
  };
}

/** sessionStorage / localStorage key for a pop-up's frequency flag. */
export function popupFrequencyKey(id: string): string {
  return `cds-popup:${id}`;
}

export type ShowPopupInput = {
  popup: PopupRecord;
  pageId: string;
  /** "click": a visitor pressed a button pointed at this pop-up. "auto": its trigger fired. */
  event: "click" | "auto";
  /** Whether the frequency flag is set in sessionStorage / localStorage. */
  seen: { session: boolean; local: boolean };
  /** Another automatic pop-up already opened in this page view. */
  autoAlreadyShown: boolean;
  /** (hover: hover) and (pointer: fine) matches. */
  finePointer: boolean;
};

export function shouldShowPopup(input: ShowPopupInput): boolean {
  const { popup } = input;
  if (!popup.enabled) return false;
  // Frequency and targeting apply to automatic triggers only.
  if (input.event === "click") return true;

  if (popup.trigger === "click") return false;
  if (popup.show_on === "button-only") return false;
  if (
    popup.show_on === "selected-pages" &&
    !popup.page_ids.includes(input.pageId)
  ) {
    return false;
  }
  if (popup.trigger === "exit-intent" && !input.finePointer) return false;
  if (input.autoAlreadyShown) return false;
  if (popup.frequency === "once-per-session" && input.seen.session) {
    return false;
  }
  if (popup.frequency === "once-per-visitor" && input.seen.local) return false;
  return true;
}

const FREQUENCY_LABEL: Record<PopupFrequency, string> = {
  "every-visit": "Every visit",
  "once-per-session": "Once per session",
  "once-per-visitor": "Once per visitor",
};

function triggerLabel(p: Omit<PopupRecord, "id">): string {
  switch (p.trigger) {
    case "click":
      return "Opens from a button";
    case "delay":
      return `After ${p.delay_seconds} ${p.delay_seconds === 1 ? "second" : "seconds"}`;
    case "scroll":
      return `At ${p.scroll_percent}% scrolled`;
    case "exit-intent":
      return "When leaving";
    case "page-load":
      return "When the page opens";
  }
}

function whereLabel(p: Omit<PopupRecord, "id">): string {
  if (p.show_on === "selected-pages") {
    const n = p.page_ids.length;
    return `${n} ${n === 1 ? "page" : "pages"}`;
  }
  return p.show_on === "all-pages" ? "Every page" : "From a button";
}

/** List-row summary (UI-SPEC): "After 5 seconds · Once per visitor · Every page". */
export function popupSummary(p: Omit<PopupRecord, "id">): string {
  if (p.trigger === "click") return triggerLabel(p);
  return [triggerLabel(p), FREQUENCY_LABEL[p.frequency], whereLabel(p)].join(
    " · ",
  );
}
