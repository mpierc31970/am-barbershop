// Section walkers shared by the JSON-LD builder and the SEO checklist (07-30; CONT-13,
// CONT-14, CONT-35; D188, D280).
//
// Defensive: malformed content yields empty lists, never a throw. Columns, slider slides and
// tab panels all hold column items (07-06 PanelRow), so one walker covers the three.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { columnsItems } from "../../content/items/walk";
import type { ColumnItem } from "../../content/types";

export type SeoSection = {
  id: string;
  section_type: string;
  content: unknown;
  /** Drafts only: a hidden block never counts (published JSON has no hidden blocks). */
  hidden?: boolean;
  settings?: { background_variant?: unknown } | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ownValue(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

export function ownString(value: unknown, key: string): string {
  const v = ownValue(value, key);
  return typeof v === "string" ? v : "";
}

/** Sections that render: arrays only, hidden drafts skipped. */
export function visibleSections(
  sections: readonly unknown[] | unknown,
): SeoSection[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter(
    (s): s is SeoSection =>
      isRecord(s) && typeof s.section_type === "string" && s.hidden !== true,
  );
}

/** Every column item of one block: columns, slider slides and tab panels. */
export function sectionItems(section: SeoSection): ColumnItem[] {
  try {
    const c = section.content;
    switch (section.section_type) {
      case "columns":
        return columnsItems(c);
      case "slider": {
        const slides = ownValue(c, "slides");
        return Array.isArray(slides) ? slides.flatMap(columnsItems) : [];
      }
      case "tabs": {
        const tabs = ownValue(c, "tabs");
        return Array.isArray(tabs) ? tabs.flatMap(columnsItems) : [];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}
