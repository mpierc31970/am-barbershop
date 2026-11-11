// Suggested block presets (03-13; D183, invariant 6; 03-UI-SPEC "BlockTemplatePicker"
// group "Suggested"; CONTEXT Area 2 Specific Ideas).
//
// Presets are data: layout belongs to the container, so a "photo left, text right"
// suggestion is simply a columns block with a 40-60 layout and starter items.
// build() mints fresh ids every call (a module-level literal would share ids between blocks).
//
// 07-24 (D183, D-UI-P7-12, choices 8-9): presets may be any section type and may insert
// several blocks. build(ctx) returns PresetBlock[] in insert order. Five presets: Photo left,
// text right · Three features · Photo gallery · Questions and answers (starter questions
// from the business type) · Contact form and map (a Columns 60-40 with the form, then a Map:
// the map is a full-width section, so it is its own block). Section defaults are looked up
// by type in CORE_SECTIONS, never imported by name, so a renamed default cannot break a
// preset. Add-on presets (P9+) are data entries here and must look content up through the
// composed registry, never import an add-on.
//
// 08-01 (CONTEXT A1-Q3, TMPL-01): moved here from @cds/ui so the site template and the
// BlockTemplatePicker share one source; @cds/ui/builder/presets is a re-export shim. Imports
// stay relative inside core. `email` joins PresetContext and the Contact preset lists it
// (D-UI-P8-8).
import { findBusinessType } from "../onboarding";
import { newColumnItem, newColumnsBlockContent, newId } from "./columns";
import { CORE_SECTIONS } from "./registry";
import { telHref } from "./tel";
import type {
  ColumnItem,
  ColumnItemKind,
  ColumnsContent,
  RowLayout,
} from "./types";

export interface PresetBlock {
  section_type: string;
  row_layout: RowLayout;
  content: unknown;
}

/** Business details a preset may fill in (from the builder business context). */
export interface PresetContext {
  addressText?: string;
  phone?: string;
  /** Public business email; the template always passes phone and/or email (D-UI-P8-8). */
  email?: string;
  businessType?: string;
  /**
   * A live form for the Contact preset's Form item. Without one the item keeps form_id ""
   * and the builder creates a contact form from its template before inserting (a form
   * item must name a form to save).
   */
  formId?: string;
  /**
   * The id the Contact preset gives its Form item (the template mints it per page so the
   * hero can link `/#form-<itemId>`, the wrapper id). Absent = a fresh id.
   */
  formItemId?: string;
}

export interface SuggestedPreset {
  id: string;
  title: string;
  description: string;
  /** The layout drawn on the picker tile. */
  thumb: RowLayout;
  build(ctx?: PresetContext): readonly PresetBlock[];
}

function fill(
  layout: RowLayout,
  kinds: readonly (readonly ColumnItemKind[])[],
): ColumnsContent {
  const content = newColumnsBlockContent(layout);
  return {
    columns: content.columns.map((col, i) => ({
      ...col,
      items: (kinds[i] ?? []).map((k) => newColumnItem(k)),
    })),
  };
}

function columns(layout: RowLayout, content: ColumnsContent): PresetBlock {
  return { section_type: "columns", row_layout: layout, content };
}

/** A section's fresh default content, by type (CORE_SECTIONS lookup). */
function defaultsOf(type: string): Record<string, unknown> {
  const def = CORE_SECTIONS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown section type: ${type}`);
  return { ...(def.defaultContent() as Record<string, unknown>) };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STUDIO_STARTERS = [
  "How do I book?",
  "Do you take walk-ins?",
  "What is your cancellation policy?",
] as const;
const PRACTICE_STARTERS = [
  "How do I make an appointment?",
  "What happens at the first visit?",
  "What does a session cost?",
] as const;
const DEFAULT_STARTERS = [
  "How do I book?",
  "Where are you?",
  "What does it cost?",
] as const;

/** Three starter FAQ questions for a business type (choice 9). */
export function faqStartersFor(businessType?: string): readonly string[] {
  const t = findBusinessType(businessType);
  if (t) {
    if (t.paths.includes("studio") && !t.paths.includes("standard")) {
      return STUDIO_STARTERS;
    }
    if (t.recommended.includes("appointments")) return PRACTICE_STARTERS;
  }
  return DEFAULT_STARTERS;
}

const CONTACT_FALLBACK =
  "Add your address and phone in Settings › Business info.";

function textItem(html: string): ColumnItem {
  return { ...newColumnItem("text"), html } as ColumnItem;
}

function linkButton(text: string, link: string): ColumnItem {
  return {
    ...newColumnItem("button"),
    text,
    link,
    style: "secondary",
  } as ColumnItem;
}

// The right column (D-UI-P8-8; 08-UI-SPEC Home row 6; T-08-01-01/02): the address as an
// escaped text line, then the phone (tel:) and public email (mailto:) as secondary Button
// items. The rich-text sanitizer allows no anchors, so links inside the text item would be
// unwrapped on save; Button links go through safeHref and survive (08-REVIEW WR-B01). The
// owner helper line appears only when all three are empty.
function contactItems(ctx?: PresetContext): ColumnItem[] {
  const address = (ctx?.addressText ?? "").trim();
  const phone = (ctx?.phone ?? "").trim();
  const email = (ctx?.email ?? "").trim();
  if (address === "" && phone === "" && email === "") {
    return [textItem(`<p>${escapeHtml(CONTACT_FALLBACK)}</p>`)];
  }
  const items: ColumnItem[] = [];
  if (address !== "") items.push(textItem(`<p>${escapeHtml(address)}</p>`));
  if (phone !== "") {
    const tel = telHref(phone);
    items.push(
      tel === ""
        ? textItem(`<p>${escapeHtml(phone)}</p>`)
        : linkButton(phone, tel),
    );
  }
  // encodeURI leaves a normal address as typed and percent-encodes anything markup-like.
  if (email !== "") items.push(linkButton(email, `mailto:${encodeURI(email)}`));
  return items;
}

function contactColumns(ctx?: PresetContext): ColumnsContent {
  const base = newColumnsBlockContent("60-40");
  const heading = { ...newColumnItem("heading"), text: "Get in touch" };
  const intro = {
    ...newColumnItem("text"),
    html: "<p>Send us a message and we'll get back to you.</p>",
  };
  const form = {
    ...newColumnItem("form"),
    ...(ctx?.formItemId ? { id: ctx.formItemId } : {}),
    form_id: ctx?.formId ?? "",
  };
  const contact = contactItems(ctx);
  return {
    columns: base.columns.map((col, i) => ({
      ...col,
      items: i === 0 ? [heading, intro, form] : contact,
    })),
  } as ColumnsContent;
}

export const SUGGESTED_PRESETS: readonly SuggestedPreset[] = Object.freeze([
  {
    id: "photo-left-text-right",
    title: "Photo left, text right",
    description: "A picture beside a heading and a few lines of text.",
    thumb: "40-60",
    build: () => [
      columns("40-60", fill("40-60", [["image"], ["heading", "text"]])),
    ],
  },
  {
    id: "three-features",
    title: "Three features",
    description: "Three short points side by side, each with a heading.",
    thumb: "33-33-33",
    build: () => [
      columns(
        "33-33-33",
        fill("33-33-33", [
          ["heading", "text"],
          ["heading", "text"],
          ["heading", "text"],
        ]),
      ),
    ],
  },
  {
    id: "photo-gallery",
    title: "Photo gallery",
    description: "A mosaic of your photos under 'Our work'.",
    thumb: "full",
    build: () => [
      {
        section_type: "gallery",
        row_layout: "full",
        content: {
          ...defaultsOf("gallery"),
          display: "mosaic",
          heading: "Our work",
        },
      },
    ],
  },
  {
    id: "faq",
    title: "Questions and answers",
    description: "Three starter questions to answer in your own words.",
    thumb: "full",
    build: (ctx?: PresetContext) => [
      {
        section_type: "faq",
        row_layout: "full",
        content: {
          ...defaultsOf("faq"),
          heading: "Questions and answers",
          items: faqStartersFor(ctx?.businessType).map((question) => ({
            id: newId(),
            question,
            answer: "",
          })),
        },
      },
    ],
  },
  {
    id: "contact-form-map",
    title: "Contact form and map",
    description: "A contact form beside your address, then a map.",
    thumb: "60-40",
    build: (ctx?: PresetContext) => [
      columns("60-40", contactColumns(ctx)),
      { section_type: "map", row_layout: "full", content: defaultsOf("map") },
    ],
  },
  // 11-49 (DASH-06, D257, UI-SPEC "DASH-03…06", choice 1): "photo left, bio right" as a
  // preset of the existing Text & image block, which renders the photo first (left on
  // desktop) from the theme. No new block type and no style fields; the owner adds the
  // photo and writes the bio. Appended last so templates indexing earlier presets keep
  // their positions.
  {
    id: "bio-with-photo",
    title: "Bio with photo",
    description: "Your photo on the left, a few lines about you on the right.",
    thumb: "50-50",
    build: () => [
      {
        section_type: "text-image",
        row_layout: "full",
        content: { ...defaultsOf("text-image"), heading: "About me" },
      },
    ],
  },
] satisfies SuggestedPreset[]);
