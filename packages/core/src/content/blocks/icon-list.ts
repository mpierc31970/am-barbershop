// Icon list block (owner 07-07; CONT-27, CONTEXT decision 5; T-07-07-07).
//
// Icons come only from a curated 60-id subset of the icon library (kebab-case ids; the PascalCase
// form is the icon component export, proven by ui builder/blocks/icon-list-ids.test.ts). Unknown
// ids fall back to "check"; the renderer maps ids through a static table, never an import
// path built from content. Renderer, editor and IconPicker: 07-21.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* and no icon-library imports.
import { InvalidInput } from "../../errors";
import { newId } from "../columns";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { assertUniqueItemIds } from "../validate";
import {
  asRecord,
  isRecord,
  oneOf,
  own,
  safeId,
  text,
} from "../validate-helpers";

export const ICON_LIST_ICON_IDS = Object.freeze([
  "check",
  "circle-check",
  "badge-check",
  "star",
  "heart",
  "sparkles",
  "award",
  "trophy",
  "thumbs-up",
  "smile",
  "clock",
  "timer",
  "calendar",
  "map-pin",
  "phone",
  "mail",
  "globe",
  "house",
  "store",
  "truck",
  "package",
  "gift",
  "tag",
  "percent",
  "credit-card",
  "wallet",
  "lock",
  "shield-check",
  "users",
  "user",
  "handshake",
  "hand-heart",
  "leaf",
  "flower-2",
  "sun",
  "moon",
  "droplet",
  "zap",
  "rocket",
  "target",
  "lightbulb",
  "palette",
  "camera",
  "music",
  "book-open",
  "graduation-cap",
  "stethoscope",
  "dumbbell",
  "utensils",
  "coffee",
  "wine",
  "bike",
  "car",
  "wifi",
  "accessibility",
  "baby",
  "dog",
  "paw-print",
  "scissors",
  "gem",
] as const);

export type IconListIconId = (typeof ICON_LIST_ICON_IDS)[number];

export type IconListItem = {
  id: string;
  icon: IconListIconId;
  title: string;
  text: string;
};

export type IconListBlockContent = {
  heading: string;
  items: IconListItem[];
};

export const ICON_LIST_HEADING_MAX = 120;
export const ICON_LIST_MAX_ITEMS = 12;
export const ICON_LIST_TITLE_MAX = 120;
export const ICON_LIST_TEXT_MAX = 200;
export const ICON_LIST_LIMIT_COPY = "Keep this to 12 items or fewer.";

function newItem(): IconListItem {
  return { id: newId(), icon: "check", title: "", text: "" };
}

export function defaultIconListBlock(): IconListBlockContent {
  return { heading: "", items: [newItem(), newItem(), newItem()] };
}

export function validateIconListBlock(value: unknown): IconListBlockContent {
  const raw = asRecord(value);
  const rawItems = own(raw, "items");
  const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  if (list.length > ICON_LIST_MAX_ITEMS) {
    throw new InvalidInput(ICON_LIST_LIMIT_COPY);
  }
  const items = list.filter(isRecord).map((item): IconListItem => ({
    id: safeId(own(item, "id")),
    icon: oneOf(own(item, "icon"), ICON_LIST_ICON_IDS, "check"),
    title: text(item, "title", ICON_LIST_TITLE_MAX),
    text: text(item, "text", ICON_LIST_TEXT_MAX),
  }));
  assertUniqueItemIds(items);
  return { heading: text(raw, "heading", ICON_LIST_HEADING_MAX), items };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function itemsOf(content: unknown): Record<string, unknown>[] {
  return isRecord(content) && Array.isArray(content.items)
    ? content.items.filter(isRecord)
    : [];
}

export const iconListSection: SectionTypeDefinition = {
  type: "icon-list",
  label: "Icon list",
  description: "Short points, each with an icon",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultIconListBlock(),
  validate: (raw) => validateIconListBlock(raw),
  mapRichText: (content) =>
    isRecord(content)
      ? { ...content, items: itemsOf(content).map((i) => ({ ...i })) }
      : content,
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? str(content.heading) : "",
      ...itemsOf(content).flatMap((i) => [str(i.title), str(i.text)]),
    ]),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
