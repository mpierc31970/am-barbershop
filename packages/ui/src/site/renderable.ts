// Which blocks actually render on the site (03-REVIEW WR-C08; D-UI-11).
//
// SectionRenderer draws a block only when its type is registered AND has a core
// component; a registered add-on type whose renderer is not wired yet renders nothing.
// The h1 owner and the eager first image must be chosen among blocks that render, or a
// silent block can take the page's only h1 and leave the page with none. PageRenderer and
// the builder's H1 badge both use this helper, so they always agree.
//
// A plain module with no component imports, so the client builder can use it without
// pulling the site renderers (and the Node-only sanitizer) into its bundle.
//
// The type list follows @cds/core's CORE_SECTIONS (which spreads the P7 group A/B
// definitions); the parity test guarantees each listed type has a site component.
import { CORE_SECTIONS, type SectionRegistry } from "@cds/core/content";

/** Section types with a core site component (SectionRenderer's CORE_SECTION_COMPONENTS). */
export const CORE_SECTION_TYPES: readonly string[] = Object.freeze(
  CORE_SECTIONS.map((d) => d.type),
);

/** Kept for compatibility: any core section type id. */
export type CoreSectionType = string;

export function isRenderableSectionType(
  type: string,
  registry: Pick<SectionRegistry, "get">,
): boolean {
  return registry.get(type) !== undefined && CORE_SECTION_TYPES.includes(type);
}

export type RenderableOptions<T> = {
  /**
   * Add-on section types with an injected renderer (05-10, RESEARCH Pattern 9). They count
   * as renderable when registered, exactly like a core type.
   */
  extraTypes?: ReadonlySet<string>;
  /**
   * Applied after the type check: an add-on block whose owner is off or whose live data is
   * empty draws nothing, so it must not take the h1 or the eager image (Pitfall 9, WR-C08).
   */
  isDrawn?: (section: T) => boolean;
};

/** The sections SectionRenderer will draw, in order. */
export function renderableSections<T extends { section_type: string }>(
  sections: readonly T[],
  registry: Pick<SectionRegistry, "get">,
  opts: RenderableOptions<T> = {},
): T[] {
  const { extraTypes, isDrawn } = opts;
  return sections.filter((s) => {
    const typeOk =
      isRenderableSectionType(s.section_type, registry) ||
      (extraTypes !== undefined &&
        extraTypes.has(s.section_type) &&
        registry.get(s.section_type) !== undefined);
    if (!typeOk) return false;
    return isDrawn ? isDrawn(s) : true;
  });
}
