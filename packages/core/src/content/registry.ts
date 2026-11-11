// Section type registry (CONT-02, CONT-32, CONT-35, D32, D280, D281, invariant 5; T-03-06).
//
// In the donor, section_type is a fixed union. Here it is registry-extended, one of the
// two deliberate changes to the inherited builder. Two halves:
// - Type level: SectionTypeMap is an interface, so an add-on package extends it by
//   declaration merging: `declare module "@cds/core/content" { interface SectionTypeMap
//   { "my-type": MyContent } }`. SectionType is its key set.
// - Runtime: composeSectionRegistry(CORE_SECTIONS, contributions) is pure and composed by
//   dependency injection in exactly one place (apps/web/lib/section-registry.ts; RESEARCH
//   Open Question 3). @cds/core never imports add-ons: add-ons depend on core, so the
//   reverse import would be a workspace cycle. @cds/db content writers take the composed
//   registry as a required argument.
//
// Every definition declares two contracts (07-04):
// - headings: { ownsH1, blockHeading }. Only the hero owns the page H1 (CONT-35, D280);
//   compose refuses any other type that claims it, and the repository allows one hero per
//   page. Every other block heading renders as its blockHeading ("h2") or has none ("none").
// - refsOf(content): every pop-up, form and media asset the content references, for
//   ownership checks on save, version_refs on publish and soft-delete. popupIdsOf(def, c)
//   survives only as a thin wrapper. Column items are walked in items/walk.ts, never here.
// Core blocks added in P7 live in blocks/group-a.ts (07-06) and blocks/group-b.ts (07-07):
// spread into CORE_SECTIONS and merged into SectionTypeMap, so neither plan edits this file.
//
// There is no "custom" (raw HTML) section type, and compose refuses one (CONT-32, D281).
// Lookups go through a Map and reject non-strings, so "toString" and friends are never
// a section type.
import { InvalidInput } from "../errors";
import { P7_SECTIONS_A, type P7SectionContentA } from "./blocks/group-a";
import { P7_SECTIONS_B, type P7SectionContentB } from "./blocks/group-b";
import { mediaRefs } from "./blocks/helpers-a";
import { newColumnsBlockContent } from "./columns";
import { isRecord } from "./validate-helpers";
import {
  columnsItems,
  columnsRefs,
  itemTexts,
  itemUrls,
  nonEmpty,
} from "./items/walk";
import { ALL_LAYOUTS, FULL_WIDTH_ONLY, isRowLayout } from "./layouts";
import type {
  ColumnsContent,
  CtaBannerContent,
  HeroContent,
  RowLayout,
  TextImageContent,
  TextOnlyContent,
} from "./types";
import {
  validateColumnsContent,
  validateCtaBanner,
  validateHero,
  validateTextImage,
  validateTextOnly,
} from "./validate";

export interface SectionTypeMap extends P7SectionContentA, P7SectionContentB {
  columns: ColumnsContent;
  hero: HeroContent;
  "text-image": TextImageContent;
  "text-only": TextOnlyContent;
  "cta-banner": CtaBannerContent;
}

export type SectionType = keyof SectionTypeMap & string;

/** Every pop-up, form and media asset id a block's content references. */
export type SectionRefs = {
  popups: string[];
  forms: string[];
  media: string[];
};

/** A block's heading rule (CONT-35). */
export type SectionHeadings = { ownsH1: boolean; blockHeading: "h2" | "none" };

/** Three fresh empty lists. */
export function emptyRefs(): SectionRefs {
  return { popups: [], forms: [], media: [] };
}

const REF_KEYS = ["popups", "forms", "media"] as const;

/** Union of ref lists: per-key de-dup, first-seen order; non-strings and "" ignored. */
export function unionRefs(list: readonly SectionRefs[]): SectionRefs {
  const out = emptyRefs();
  for (const key of REF_KEYS) {
    const seen = new Set<string>();
    for (const refs of list) {
      const ids: unknown = refs?.[key];
      if (!Array.isArray(ids)) continue;
      for (const id of ids as unknown[]) {
        if (typeof id !== "string" || id === "" || seen.has(id)) continue;
        seen.add(id);
        out[key].push(id);
      }
    }
  }
  return out;
}

export type SectionTypeDefinition = {
  type: string;
  /** Block picker name (UI-SPEC). */
  label: string;
  /** One line of what the block is for. */
  description: string;
  /** Layouts this type can honour; the first is the clamp fallback (invariant 6). */
  layouts: readonly RowLayout[];
  /** Fresh starting content; call per insertion (ids must not be shared). */
  defaultContent(): unknown;
  /** Deny-by-default validation; returns a fresh object or throws InvalidInput. */
  validate(raw: unknown, layout: RowLayout): unknown;
  /** Apply `fn` to every rich-text html field of validated content (sanitize hook). */
  mapRichText(content: unknown, fn: (html: string) => string): unknown;
  /** Every human-written string, plain and rich, for the content scanner. */
  textsOf(content: unknown): string[];
  /** Every link and image URL. */
  urlsOf(content: unknown): string[];
  /**
   * Only the hero owns the page H1 (CONT-35, D280). blockHeading: the tag the block's own
   * heading renders as when it does not own the H1; "none" for blocks without a heading.
   */
  headings: SectionHeadings;
  /**
   * Every pop-up, form and media asset this content references: ownership checks on save,
   * version_refs on publish, soft-delete.
   */
  refsOf(content: unknown): SectionRefs;
};

/** Every pop-up a button in this content opens (CONT-11): `def.refsOf(content).popups`. */
export function popupIdsOf(
  def: SectionTypeDefinition,
  content: unknown,
): string[] {
  return def.refsOf(content).popups;
}

export type SectionRegistry = {
  get(type: string): SectionTypeDefinition | undefined;
  /** Registered types in composition order (core first). */
  types(): string[];
};

const TYPE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const FORBIDDEN_TYPES = new Set(["custom"]);
const H1_OWNER_TYPE = "hero";
const BLOCK_HEADINGS: ReadonlySet<unknown> = new Set(["h2", "none"]);

const columnsSection: SectionTypeDefinition = {
  type: "columns",
  label: "Columns",
  description:
    "Your own layout: up to five columns of text, images and buttons.",
  layouts: ALL_LAYOUTS,
  defaultContent: () => newColumnsBlockContent("full"),
  validate: (raw, layout) => validateColumnsContent(raw, layout),
  mapRichText: (content, fn) => {
    const c = content as ColumnsContent | undefined;
    const columns = Array.isArray(c?.columns) ? c.columns : [];
    return {
      columns: columns.map((col) => ({
        id: col.id,
        items: col.items.map((item) =>
          item.kind === "text" ? { ...item, html: fn(item.html) } : item,
        ),
      })),
    };
  },
  textsOf: (content) => nonEmpty(columnsItems(content).flatMap(itemTexts)),
  urlsOf: (content) => nonEmpty(columnsItems(content).flatMap(itemUrls)),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: (content) => columnsRefs(content),
};

const heroSection: SectionTypeDefinition = {
  type: "hero",
  label: "Hero",
  description:
    "The big opening banner: heading, a line of text and up to two buttons.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => validateHero({}),
  validate: (raw) => validateHero(raw),
  mapRichText: (content) => ({ ...(content as HeroContent) }),
  textsOf: (content) => {
    const c = content as HeroContent;
    return nonEmpty([
      c.tagline,
      c.heading,
      c.heading_accent,
      c.subtitle,
      c.cta_primary_text,
      c.cta_secondary_text,
      c.trust_text,
      c.image_alt,
    ]);
  },
  urlsOf: (content) => {
    const c = content as HeroContent;
    return nonEmpty([c.cta_primary_link, c.cta_secondary_link, c.image_url]);
  },
  // The only H1 owner. blockHeading is unused for the owner but required.
  headings: { ownsH1: true, blockHeading: "h2" },
  // P8 (R-3): the media-library hero photo is a media ref (publish promotes it,
  // versions keep it, the loader resolves it).
  refsOf: (content) => {
    const asset = isRecord(content) ? content.image_asset : undefined;
    return mediaRefs(nonEmpty([typeof asset === "string" ? asset : ""]));
  },
};

const textImageSection: SectionTypeDefinition = {
  type: "text-image",
  label: "Text & image",
  description:
    "Text beside a picture, with an optional quote, list and button.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => validateTextImage({}),
  validate: (raw) => validateTextImage(raw),
  mapRichText: (content, fn) => {
    const c = content as TextImageContent;
    return { ...c, text: fn(c.text ?? "") };
  },
  textsOf: (content) => {
    const c = content as TextImageContent;
    return nonEmpty([
      c.heading,
      c.text,
      c.image_alt,
      c.quote,
      ...(c.list_items ?? []),
      c.cta_text,
      c.phone,
    ]);
  },
  urlsOf: (content) => {
    const c = content as TextImageContent;
    return nonEmpty([c.cta_link, c.image_url]);
  },
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};

const textOnlySection: SectionTypeDefinition = {
  type: "text-only",
  label: "Text",
  description: "A heading and a few paragraphs.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => validateTextOnly({}),
  validate: (raw) => validateTextOnly(raw),
  mapRichText: (content, fn) => {
    const c = content as TextOnlyContent;
    return { ...c, text: fn(c.text ?? "") };
  },
  textsOf: (content) => {
    const c = content as TextOnlyContent;
    return nonEmpty([c.heading, c.text]);
  },
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};

const ctaBannerSection: SectionTypeDefinition = {
  type: "cta-banner",
  label: "Call to action",
  description:
    "A short message with one button, to move visitors to the next step.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => validateCtaBanner({}),
  validate: (raw) => validateCtaBanner(raw),
  mapRichText: (content) => ({ ...(content as CtaBannerContent) }),
  textsOf: (content) => {
    const c = content as CtaBannerContent;
    return nonEmpty([c.heading, c.description, c.button_text]);
  },
  urlsOf: (content) => nonEmpty([(content as CtaBannerContent).button_link]),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};

/**
 * The core section types. 07-06 fills group A, 07-07 group B; block-picker order.
 */
export const CORE_SECTIONS: readonly SectionTypeDefinition[] = Object.freeze([
  columnsSection,
  heroSection,
  textImageSection,
  textOnlySection,
  ctaBannerSection,
  ...P7_SECTIONS_A,
  ...P7_SECTIONS_B,
]);

/** Every function of the section contract; a missing one fails at compose, not on save. */
const CONTRACT_FNS = [
  "defaultContent",
  "validate",
  "mapRichText",
  "textsOf",
  "urlsOf",
  "refsOf",
] as const;

function assertDefinition(def: SectionTypeDefinition): void {
  const type = def?.type;
  if (typeof type !== "string" || !TYPE_ID.test(type)) {
    throw new InvalidInput(
      `invalid section type id: ${String(type).slice(0, 64)}`,
    );
  }
  if (FORBIDDEN_TYPES.has(type)) {
    throw new InvalidInput(`section type "${type}" is not allowed (CONT-32)`);
  }
  if (
    !Array.isArray(def.layouts) ||
    def.layouts.length === 0 ||
    !def.layouts.every(isRowLayout)
  ) {
    throw new InvalidInput(
      `section type "${type}" needs at least one valid layout`,
    );
  }
  const headings: unknown = def.headings;
  if (
    typeof headings !== "object" ||
    headings === null ||
    typeof (headings as { ownsH1?: unknown }).ownsH1 !== "boolean" ||
    !BLOCK_HEADINGS.has((headings as { blockHeading?: unknown }).blockHeading)
  ) {
    throw new InvalidInput(
      `section type "${type}" needs headings { ownsH1, blockHeading: "h2" | "none" }`,
    );
  }
  for (const fn of CONTRACT_FNS) {
    if (typeof (def as Record<string, unknown>)[fn] !== "function") {
      throw new InvalidInput(`section type "${type}" needs a ${fn} function`);
    }
  }
  if ((headings as SectionHeadings).ownsH1 && type !== H1_OWNER_TYPE) {
    throw new InvalidInput(
      `section type "${type}" cannot own the page H1; only the hero can (CONT-35)`,
    );
  }
}

/**
 * Compose core types with add-on contributions. Throws InvalidInput on a malformed id,
 * a duplicate type, a "custom" type, an empty/invalid layout list, missing or malformed
 * headings, a missing contract function (defaultContent, validate, mapRichText, textsOf,
 * urlsOf, refsOf), or a non-hero type claiming the page H1 (CONT-35).
 */
export function composeSectionRegistry(
  core: readonly SectionTypeDefinition[],
  contributions: readonly SectionTypeDefinition[],
): SectionRegistry {
  const map = new Map<string, SectionTypeDefinition>();
  for (const def of [...core, ...contributions]) {
    assertDefinition(def);
    if (map.has(def.type)) {
      throw new InvalidInput(`duplicate section type: ${def.type}`);
    }
    map.set(def.type, def);
  }
  return {
    get: (type) => (typeof type === "string" ? map.get(type) : undefined),
    types: () => [...map.keys()],
  };
}

/** The definition for `type`, or InvalidInput when it is not registered. */
export function assertSectionType(
  registry: SectionRegistry,
  type: string,
): SectionTypeDefinition {
  const def = registry.get(type);
  if (!def) throw new InvalidInput("Unknown block type.");
  return def;
}
