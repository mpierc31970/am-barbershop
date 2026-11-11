// Pure page-builder logic for the block list, block forms and the builder header (03-13;
// CONT-05, CONT-06, CONT-30; D183, D254, D119; 03-UI-SPEC "Page builder" header state
// table, "SectionsList row", "SectionForm", "Validation").
//
// No React, no DOM, no database client: plain input -> output, unit-tested in
// section-form-logic.test.ts. The builder types below mirror the db package row shapes
// structurally, so @cds/ui never imports the database package (invariant 1).
import {
  htmlToPlainText,
  isRichTextEmpty,
  safeHref,
  safeImageUrl,
  type BackgroundVariant,
} from "@cds/core/content";
import type { BadgeTone } from "../hub/Badge";
import { formatShortInZone } from "./editor-logic";

// ---------------------------------------------------------------------------
// Shapes shared with apps/web (structural twins of the db package SectionRow / PageSummary)
// ---------------------------------------------------------------------------

export interface BuilderSection {
  id: string;
  page: string;
  section_type: string;
  row_layout: string;
  content: unknown;
  settings: { background_variant: BackgroundVariant };
  sort_order: number;
  is_published: boolean;
}

/** What SectionForm sends to the save action. */
export interface BuilderSaveInput {
  id?: string;
  pageId: string;
  section_type: string;
  row_layout: string;
  content: unknown;
  settings: { background_variant: BackgroundVariant };
  afterId?: string | null;
}

/** The same shape as apps/web's ActionResult. */
export type BuilderResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; field?: string };

export interface HeaderPage {
  status: "draft" | "published" | "held";
  published_at: string | null;
  has_unpublished_changes: boolean;
}

/** Minimal registry view (label lookup only). */
export interface LabelRegistry {
  get(type: string): { label: string } | undefined;
}

// ---------------------------------------------------------------------------
// Copy (UI-SPEC Copywriting Contract)
// ---------------------------------------------------------------------------

export const HELD_LINE =
  "This page is being reviewed, usually within 2 business days.";
export const ERR_REORDER_COPY =
  "That move didn't save, so the block went back to where it was. Try again.";
export const ERR_SAVE_COPY =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";
export const ERR_PUBLISH_COPY =
  "Publishing didn't finish. Your draft is safe and your live page hasn't changed. Try again in a minute.";
export const NO_CHANGES_COPY = "No changes to publish";
export const DRAFT_SAVED_LINE = "Draft saved · Unpublished changes";
export const ALT_REQUIRED_COPY =
  "Add a short description of the image for people who can't see it.";

// ---------------------------------------------------------------------------
// Block labels and row preview text
// ---------------------------------------------------------------------------

/** The owner's word for each core block type (UI-SPEC "SectionsList row"). */
export const BLOCK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  hero: "Hero",
  "text-image": "Text & image",
  "text-only": "Text",
  "cta-banner": "Call to action",
  columns: "Columns",
});

/** Picker order for the "Blocks" group (UI-SPEC "BlockTemplatePicker"). */
export const PICKER_ORDER: readonly string[] = Object.freeze([
  "hero",
  "text-image",
  "text-only",
  "cta-banner",
  "columns",
]);

export function blockLabel(type: string, registry?: LabelRegistry): string {
  if (Object.hasOwn(BLOCK_LABELS, type)) return BLOCK_LABELS[type]!;
  const fromRegistry = registry?.get(type)?.label;
  return typeof fromRegistry === "string" && fromRegistry !== ""
    ? fromRegistry
    : type;
}

const PREVIEW_MAX = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonBlank(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function columnItems(
  content: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!Array.isArray(content.columns)) return [];
  return content.columns.flatMap((c) =>
    isRecord(c) && Array.isArray(c.items) ? c.items.filter(isRecord) : [],
  );
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t;
}

/** First heading, else the first 60 characters of plain text (ellipsis when cut). */
export function previewText(section: { content: unknown }): string {
  const c = section.content;
  if (!isRecord(c)) return "";
  if (nonBlank(c.heading)) return clip(c.heading);
  const items = columnItems(c);
  const heading = items.find((i) => i.kind === "heading" && nonBlank(i.text));
  if (heading) return clip(String(heading.text));

  const candidates: string[] = [];
  for (const key of ["subtitle", "text", "description", "quote"]) {
    const v = c[key];
    if (nonBlank(v)) candidates.push(key === "text" ? htmlToPlainText(v) : v);
  }
  for (const i of items) {
    if (i.kind === "text" && nonBlank(i.html)) {
      candidates.push(htmlToPlainText(i.html));
    }
    if (i.kind === "list" && Array.isArray(i.items)) {
      candidates.push(i.items.filter(nonBlank).join(", "));
    }
    if (i.kind === "button" && nonBlank(i.text)) candidates.push(i.text);
  }
  const first = candidates.find(nonBlank);
  return first ? clip(first) : "";
}

// ---------------------------------------------------------------------------
// Builder header (UI-SPEC "Page header" state table)
// ---------------------------------------------------------------------------

export type HeaderStateId =
  "never" | "clean" | "pending" | "publishing" | "held";

export interface HeaderState {
  id: HeaderStateId;
  statusLine: string;
  badge: { tone: BadgeTone; label: string } | null;
  publishLabel: "Publish" | "Publish changes";
  publishDisabled: boolean;
  /** Tooltip / aria-describedby text when Publish is disabled for a reason. */
  disabledReason?: string;
  publishing: boolean;
}

export function headerState(
  page: HeaderPage,
  opts: { publishing?: boolean; timeZone?: string } = {},
): HeaderState {
  const everPublished = page.status !== "draft" && Boolean(page.published_at);
  const publishLabel = everPublished ? "Publish changes" : "Publish";
  if (opts.publishing) {
    return {
      id: "publishing",
      statusLine: "Publishing…",
      badge: null,
      publishLabel,
      publishDisabled: true,
      publishing: true,
    };
  }
  if (page.status === "held") {
    return {
      id: "held",
      statusLine: HELD_LINE,
      badge: { tone: "review", label: "In review" },
      publishLabel: "Publish changes",
      publishDisabled: false,
      publishing: false,
    };
  }
  if (!everPublished) {
    return {
      id: "never",
      statusLine: page.has_unpublished_changes
        ? DRAFT_SAVED_LINE
        : "Not published yet",
      badge: { tone: "draft", label: "Draft" },
      publishLabel: "Publish",
      publishDisabled: false,
      publishing: false,
    };
  }
  if (page.has_unpublished_changes) {
    return {
      id: "pending",
      statusLine: DRAFT_SAVED_LINE,
      badge: { tone: "changes", label: "Unpublished changes" },
      publishLabel: "Publish changes",
      publishDisabled: false,
      publishing: false,
    };
  }
  const when = formatShortInZone(page.published_at ?? "", opts.timeZone);
  return {
    id: "clean",
    statusLine: when ? `Published ${when}` : "Published",
    badge: { tone: "published", label: "Published" },
    publishLabel: "Publish",
    publishDisabled: true,
    disabledReason: NO_CHANGES_COPY,
    publishing: false,
  };
}

// ---------------------------------------------------------------------------
// Block form helpers (SectionForm)
// ---------------------------------------------------------------------------

/** Rich-text fields per core block type (donor normaliseRichTextFields). */
const RICH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "text-image": ["text"],
  "text-only": ["text"],
};

/**
 * An emptied TipTap field serializes to "<p></p>" (or "<p><br></p>"), which is truthy;
 * store "" instead so renderers never draw an empty paragraph.
 */
export function normalizeBlockContent(type: string, content: unknown): unknown {
  if (!isRecord(content)) return content;
  const fields = Object.hasOwn(RICH_FIELDS, type)
    ? RICH_FIELDS[type]
    : undefined;
  if (!fields) return content;
  const out: Record<string, unknown> = { ...content };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string" && isRichTextEmpty(v)) out[f] = "";
  }
  return out;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  }
  return value;
}

/** Deep, key-order-insensitive comparison of two block drafts. */
export function sameDraft(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** True when the form differs from what was last saved (content or background). */
export function isDirty(
  saved: { type: string; content: unknown; background: BackgroundVariant },
  draft: { content: unknown; background: BackgroundVariant },
): boolean {
  if (saved.background !== draft.background) return true;
  return !sameDraft(
    normalizeBlockContent(saved.type, saved.content),
    normalizeBlockContent(saved.type, draft.content),
  );
}

/** Link fields and image pairs per core type, for client-side checks. */
const LINK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  hero: ["cta_primary_link", "cta_secondary_link"],
  "text-image": ["cta_link"],
  "cta-banner": ["button_link"],
};
const IMAGE_TYPES = new Set(["hero", "text-image"]);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Client-side field errors for a block (convenience only: the server re-validates and
 * sanitizes, T-03-56). Keys are content field names, in form order.
 */
export function blockFieldErrors(
  type: string,
  content: unknown,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isRecord(content)) return errors;
  if (IMAGE_TYPES.has(type)) {
    const url = content.image_url;
    try {
      safeImageUrl(url ?? "");
    } catch (err) {
      errors.image_url = messageOf(err);
    }
    // P8 (R-3): a hero library photo needs a description too.
    const hasImage = nonBlank(url) || nonBlank(content.image_asset);
    if (hasImage && !nonBlank(content.image_alt)) {
      errors.image_alt = ALT_REQUIRED_COPY;
    }
  }
  for (const f of LINK_FIELDS[type] ?? []) {
    try {
      safeHref(content[f] ?? "");
    } catch (err) {
      errors[f] = messageOf(err);
    }
  }
  return errors;
}

/** "1 field needs attention" / "3 fields need attention"; "" when none. */
export function attentionLine(errors: Record<string, string>): string {
  const n = Object.keys(errors).length;
  if (n === 0) return "";
  return n === 1 ? "1 field needs attention" : `${n} fields need attention`;
}

/** The first invalid field in form order, or null. */
export function firstInvalidField(
  order: readonly string[],
  errors: Record<string, string>,
): string | null {
  return order.find((f) => Object.hasOwn(errors, f)) ?? null;
}
