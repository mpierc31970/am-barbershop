// Page h1 ownership (D-UI-11; CONT-13, CONT-35, D280; UI-SPEC "Heading-level rule").
//
// Only a type whose definition has `headings.ownsH1` owns the page H1, and compose lets
// only the hero set it. A page without one (or whose hero heading is blank) renders the
// page title as its H1: the renderer half is 07-05's PageTitleHeader; until then
// PageRenderer already renders an sr-only title <h1> when the owner is null, so exactly one
// H1 holds in between. Every other block heading renders as its definition's
// `blockHeading` (h2); heading items with level 3 render <h3>. One hero per page is
// enforced by saveSection. This replaces P3's "first heading-bearing block" rule.
//
// The builder shows an "H1" badge on the owner. Unregistered types never own it.
import type { SectionRegistry } from "./registry";
import type { PublishedSection } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function columnsHaveHeading(columns: unknown): boolean {
  if (!Array.isArray(columns)) return false;
  return columns.some(
    (col) =>
      isRecord(col) &&
      Array.isArray(col.items) &&
      col.items.some(
        (item) =>
          isRecord(item) && item.kind === "heading" && nonBlank(item.text),
      ),
  );
}

/** True when this section's content carries a visible heading. */
export function sectionHasHeading(content: unknown): boolean {
  if (!isRecord(content)) return false;
  return nonBlank(content.heading) || columnsHaveHeading(content.columns);
}

/** True when `type` is registered and its definition owns the page H1 (the hero). */
export function sectionOwnsH1(
  registry: SectionRegistry,
  type: unknown,
): boolean {
  if (typeof type !== "string") return false;
  return registry.get(type)?.headings.ownsH1 === true;
}

/**
 * The tag a block's own heading renders as: "h1" for the page's H1 owner, else the
 * definition's blockHeading ("h2"), or null for "none" and unregistered types.
 */
export function blockHeadingTag(
  registry: SectionRegistry,
  type: unknown,
  isOwner: boolean,
): "h1" | "h2" | null {
  if (typeof type !== "string") return null;
  const def = registry.get(type);
  if (!def) return null;
  if (isOwner) return "h1";
  return def.headings.blockHeading === "h2" ? "h2" : null;
}

/**
 * The id of the H1-owning section (the first hero with a non-blank heading), or null when
 * the page title is the H1. Never falls through to other blocks.
 */
export function headingOwnerId(
  sections: readonly PublishedSection[],
  registry: SectionRegistry,
): string | null {
  for (const s of sections) {
    if (!sectionOwnsH1(registry, s.section_type)) continue;
    return sectionHasHeading(s.content) ? s.id : null;
  }
  return null;
}
