// Deny-by-default content validators (RESEARCH Pattern 1, Pitfall 6; T-03-04, T-03-05).
//
// Every content object arriving from the editor is untrusted. Each validator builds a
// fresh object from known keys only: raw input is never spread or cloned, so unknown keys
// (`onclick`, `style`, `__proto__`) never reach storage, and reads use own properties only.
// Strings are coerced, trimmed and length-capped. Every link runs through safeHref and
// every image URL through safeImageUrl, because those values render into href/src where
// rich-text sanitizing does not reach.
//
// Rich-text html fields pass through as capped strings: sanitizing is the db layer's job,
// via @cds/core/content/sanitize (Node-only, kept out of this Edge-safe module).
import { InvalidInput } from "../errors";
import { normalizeColumns, newId } from "./columns";
import {
  MAX_LIST_ITEMS,
  MAX_RICH_TEXT,
  MAX_TEXT,
  MALFORMED_COPY,
  SAFE_ID,
  asRecord,
  capped,
  imagePair,
  isRecord,
  oneOf,
  own,
  richText,
  safeId,
  stringList,
  text,
} from "./validate-helpers";
import { COLUMN_ITEM_KINDS } from "./types";
import { validateAudioItem } from "./items/audio";
import { validateEmbedItem } from "./items/embed";
import { validateFormItem } from "./items/form";
import { optionalRefId } from "./items/shared";
import { validateVideoItem } from "./items/video";
import type {
  ColumnItem,
  ColumnItemKind,
  ColumnsContent,
  CtaBannerContent,
  HeroContent,
  ImageCredit,
  RowLayout,
  TextImageContent,
  TextOnlyContent,
} from "./types";

export const MAX_ITEMS_PER_COLUMN = 50;
// Moved to validate-helpers.ts (07-02); re-exported so this module keeps its export list.
export { MAX_TEXT, MAX_RICH_TEXT, MAX_LIST_ITEMS };
/** Stored columns accepted before normalizing (the widest layout draws 5). */
export const MAX_STORED_COLUMNS = 20;
/** Items in one columns block after surplus columns merge. */
export const MAX_ITEMS_PER_BLOCK = MAX_ITEMS_PER_COLUMN * 5;

const LINK_COPY =
  "Links must start with https://, http://, mailto: or tel:, or be a page path like /about.";
const IMAGE_URL_COPY = "Image addresses must start with https:// or http://.";
const ZERO_COPY =
  'Write what visitors see when the countdown ends, like "Doors are open."';
const TARGET_COPY = "Choose the date and time the countdown ends.";
const POPUP_COPY = "Choose which pop-up this button opens.";
const NO_POPUP_COPY = "Buttons here can open links only, not pop-ups.";
const DUPLICATE_ITEM_COPY =
  "Two items share the same id. Refresh the page and try again.";

// A site path: "/" then anything without whitespace or backslash, but never "//" or "/\"
// (both are protocol-relative to a browser).
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/;

/**
 * A link for href: "" (no link), a site path like /about (never //x or /\x), or an
 * absolute http:, https:, mailto: or tel: URL. Anything else throws InvalidInput.
 */
export function safeHref(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new InvalidInput(LINK_COPY);
  const s = value.trim();
  if (s === "") return "";
  if (SITE_PATH.test(s)) return capped(s, 2048);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new InvalidInput(LINK_COPY);
  }
  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
    throw new InvalidInput(LINK_COPY);
  }
  return capped(url.href, 2048);
}

/** An image URL for src: "" or an absolute http(s) URL. data:, paths and // throw. */
export function safeImageUrl(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new InvalidInput(IMAGE_URL_COPY);
  const s = value.trim();
  if (s === "") return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new InvalidInput(IMAGE_URL_COPY);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidInput(IMAGE_URL_COPY);
  }
  return capped(url.href, 2048);
}

/**
 * Item ids must be unique across a block (or a pop-up): every edit finds its item by id,
 * so two items sharing one would be edited, keyed and dragged as one (03-REVIEW CR-C02).
 * A missing or unsafe id was already replaced by a fresh one, so only a real clash throws.
 */
export const IMAGE_CREDIT_NAME_MAX = 80;
export const IMAGE_CREDIT_COPY = "This photo credit isn't valid.";

const CREDIT_HOSTS: Readonly<Record<ImageCredit["source"], readonly string[]>> =
  Object.freeze({
    unsplash: ["unsplash.com", "www.unsplash.com"],
    pexels: ["pexels.com", "www.pexels.com"],
  });

/**
 * A stock photo credit (07-30, CONT-28): absent -> undefined; otherwise name <= 80 trimmed,
 * a known source, and a link on that source's own site. Anything else is refused.
 */
export function imageCredit(value: unknown): ImageCredit | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInput(IMAGE_CREDIT_COPY);
  }
  const raw = value as Record<string, unknown>;
  const source = own(raw, "source");
  if (source !== "unsplash" && source !== "pexels") {
    throw new InvalidInput(IMAGE_CREDIT_COPY);
  }
  const rawName = own(raw, "name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "" || name.length > IMAGE_CREDIT_NAME_MAX) {
    throw new InvalidInput(IMAGE_CREDIT_COPY);
  }
  let url: string;
  try {
    url = safeImageUrl(own(raw, "url"));
  } catch {
    throw new InvalidInput(IMAGE_CREDIT_COPY);
  }
  if (url === "") throw new InvalidInput(IMAGE_CREDIT_COPY);
  const host = new URL(url).hostname.toLowerCase();
  if (!CREDIT_HOSTS[source].includes(host)) {
    throw new InvalidInput(IMAGE_CREDIT_COPY);
  }
  return { name, url, source };
}

export function assertUniqueItemIds(items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new InvalidInput(DUPLICATE_ITEM_COPY);
    seen.add(item.id);
  }
}

/** Raw item list with every repeat of an id given a fresh one; the same array when clean. */
function repairItemList(items: unknown[], seen: Set<string>): unknown[] {
  let out: unknown[] | null = null;
  items.forEach((item, i) => {
    if (!isRecord(item)) return;
    const id = own(item, "id");
    if (typeof id !== "string") return;
    if (!seen.has(id)) {
      seen.add(id);
      return;
    }
    out ??= items.slice();
    out[i] = { ...item, id: newId() };
  });
  return out ?? items;
}

/**
 * READ PATH ONLY. Stored content (a columns block's `{ columns }` or a pop-up's `{ items }`)
 * whose items repeat an id gets a fresh id on every repeat, so it validates again. Such rows
 * came from the pre-CR-C02 bug or a restore bundle; a refresh cannot fix them, and throwing
 * on read blocked every publish and restore of the page and emptied the pop-up (IN-R02).
 * Writes keep assertUniqueItemIds. Returns the input untouched when nothing repeats; the
 * result is still raw and goes through the validators as before.
 */
export function repairDuplicateItemIds(content: unknown): unknown {
  if (!isRecord(content)) return content;
  const seen = new Set<string>();
  const columns = own(content, "columns");
  if (Array.isArray(columns)) {
    let changed = false;
    const next = columns.map((col) => {
      if (!isRecord(col)) return col;
      const items = own(col, "items");
      if (!Array.isArray(items)) return col;
      const repaired = repairItemList(items, seen);
      if (repaired === items) return col;
      changed = true;
      return { ...col, items: repaired };
    });
    return changed ? { ...content, columns: next } : content;
  }
  const items = own(content, "items");
  if (Array.isArray(items)) {
    const repaired = repairItemList(items, seen);
    return repaired === items ? content : { ...content, items: repaired };
  }
  return content;
}

export interface ColumnItemOptions {
  /** False where a button may not open a pop-up (e.g. inside a pop-up). */
  allowPopupButton: boolean;
}

export function validateColumnItem(
  value: unknown,
  opts: ColumnItemOptions,
): ColumnItem {
  if (!isRecord(value)) throw new InvalidInput(MALFORMED_COPY);
  const kindRaw = own(value, "kind");
  if (
    typeof kindRaw !== "string" ||
    !(COLUMN_ITEM_KINDS as readonly string[]).includes(kindRaw)
  ) {
    throw new InvalidInput("Unknown item type.");
  }
  const kind = kindRaw as ColumnItemKind;
  const id = safeId(own(value, "id"));

  switch (kind) {
    case "heading":
      return {
        id,
        kind,
        text: text(value, "text"),
        level: own(value, "level") === 3 ? 3 : 2,
      };
    case "text":
      return { id, kind, html: richText(value, "html") };
    case "list":
      return { id, kind, items: stringList(value, "items") };
    case "image": {
      // A library asset (07-17) wins over a URL; `asset` is emitted only when set, so
      // URL-only image items stay byte-identical.
      const asset = optionalRefId(own(value, "asset"));
      const alt = text(value, "alt");
      if (asset !== "") {
        imagePair(asset, alt);
        return { id, kind, url: "", alt, asset };
      }
      const url = safeImageUrl(own(value, "url"));
      imagePair(url, alt);
      // 07-30: a stock credit is kept only with a URL photo (a library pick drops it).
      const credit = imageCredit(own(value, "credit"));
      return credit ? { id, kind, url, alt, credit } : { id, kind, url, alt };
    }
    case "button": {
      const action = oneOf(own(value, "action"), ["link", "popup"], "link");
      let popup_id = "";
      if (action === "popup") {
        if (!opts.allowPopupButton) throw new InvalidInput(NO_POPUP_COPY);
        const p = own(value, "popup_id");
        const trimmed = typeof p === "string" ? p.trim() : "";
        if (trimmed === "") throw new InvalidInput(POPUP_COPY);
        if (!SAFE_ID.test(trimmed)) throw new InvalidInput(POPUP_COPY);
        popup_id = trimmed;
      }
      return {
        id,
        kind,
        text: text(value, "text"),
        link: safeHref(own(value, "link")),
        style: oneOf(own(value, "style"), ["primary", "secondary"], "primary"),
        action,
        popup_id,
      };
    }
    case "spacer":
      return {
        id,
        kind,
        height: oneOf(own(value, "height"), ["sm", "md", "lg"], "md"),
      };
    case "divider":
      return { id, kind };
    case "countdown": {
      const zero_message = text(value, "zero_message");
      if (zero_message === "") throw new InvalidInput(ZERO_COPY);
      const t = own(value, "target_at");
      const ms = typeof t === "string" ? Date.parse(t.trim()) : NaN;
      if (!Number.isFinite(ms)) throw new InvalidInput(TARGET_COPY);
      return {
        id,
        kind,
        target_at: new Date(ms).toISOString(),
        zero_message,
      };
    }
    // P7 kinds (07-08): each validator lives in items/<kind>.ts.
    case "video":
      return validateVideoItem(value, id);
    case "audio":
      return validateAudioItem(value, id);
    case "form":
      return validateFormItem(value, id);
    case "embed":
      return validateEmbedItem(value, id);
  }
}

/**
 * A columns block: every item validated, then normalized to exactly
 * columnCountFor(layout) columns (CONT-07). Popup buttons are allowed by default
 * (page sections, CONT-11); pass allowPopupButton: false for content inside a pop-up.
 */
export function validateColumnsContent(
  value: unknown,
  layout: RowLayout,
  opts: ColumnItemOptions = { allowPopupButton: true },
): ColumnsContent {
  const raw = asRecord(value);
  const stored = own(raw, "columns");
  if (stored !== undefined && !Array.isArray(stored)) {
    throw new InvalidInput(MALFORMED_COPY);
  }
  const list = stored ?? [];
  if (list.length > MAX_STORED_COLUMNS) throw new InvalidInput(MALFORMED_COPY);

  let total = 0;
  const columns = list.map((col) => {
    const c = asRecord(col);
    const items = own(c, "items");
    if (items !== undefined && !Array.isArray(items)) {
      throw new InvalidInput(MALFORMED_COPY);
    }
    const arr = items ?? [];
    if (arr.length > MAX_ITEMS_PER_COLUMN) {
      throw new InvalidInput(
        `A column can hold up to ${MAX_ITEMS_PER_COLUMN} items.`,
      );
    }
    total += arr.length;
    if (total > MAX_ITEMS_PER_BLOCK) {
      throw new InvalidInput(
        `A block can hold up to ${MAX_ITEMS_PER_BLOCK} items.`,
      );
    }
    return {
      id: safeId(own(c, "id")),
      items: arr.map((item) => validateColumnItem(item, opts)),
    };
  });

  assertUniqueItemIds(columns.flatMap((c) => c.items));
  return normalizeColumns({ columns }, layout);
}

export function validateHero(value: unknown): Required<HeroContent> {
  const raw = asRecord(value);
  const out: Required<HeroContent> = {
    tagline: text(raw, "tagline"),
    heading: text(raw, "heading"),
    heading_accent: text(raw, "heading_accent"),
    subtitle: text(raw, "subtitle"),
    cta_primary_text: text(raw, "cta_primary_text"),
    cta_primary_link: safeHref(own(raw, "cta_primary_link")),
    cta_secondary_text: text(raw, "cta_secondary_text"),
    cta_secondary_link: safeHref(own(raw, "cta_secondary_link")),
    trust_text: text(raw, "trust_text"),
    image_url: safeImageUrl(own(raw, "image_url")),
    image_alt: text(raw, "image_alt"),
    // P8 (R-3): a media-library photo. Lenient: a malformed id becomes "" (T-08-03-02);
    // ownership is checked by the db layer's ref validation on save (T-08-03-01).
    image_asset: lenientRefId(own(raw, "image_asset")),
  };
  // A library photo needs a description too, as for column image items (WR-B03).
  imagePair(out.image_asset || out.image_url, out.image_alt);
  return out;
}

/** A record id when it is a SAFE_ID string, else "" (never throws). */
function lenientRefId(value: unknown): string {
  if (typeof value !== "string") return "";
  const s = value.trim();
  return SAFE_ID.test(s) ? s : "";
}

export function validateTextImage(value: unknown): Required<TextImageContent> {
  const raw = asRecord(value);
  const out: Required<TextImageContent> = {
    heading: text(raw, "heading"),
    text: richText(raw, "text"),
    image_url: safeImageUrl(own(raw, "image_url")),
    image_alt: text(raw, "image_alt"),
    quote: text(raw, "quote"),
    list_items: stringList(raw, "list_items"),
    cta_text: text(raw, "cta_text"),
    cta_link: safeHref(own(raw, "cta_link")),
    phone: text(raw, "phone", 40),
  };
  imagePair(out.image_url, out.image_alt);
  return out;
}

export function validateTextOnly(value: unknown): Required<TextOnlyContent> {
  const raw = asRecord(value);
  return { heading: text(raw, "heading"), text: richText(raw, "text") };
}

export function validateCtaBanner(value: unknown): Required<CtaBannerContent> {
  const raw = asRecord(value);
  return {
    heading: text(raw, "heading"),
    description: text(raw, "description"),
    button_text: text(raw, "button_text"),
    button_link: safeHref(own(raw, "button_link")),
  };
}
