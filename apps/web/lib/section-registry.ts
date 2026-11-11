// The one composed section registry (CONT-02, D32, invariant 5; RESEARCH Pattern 3).
//
// Composed here and nowhere else, then injected into @cds/db (ContentDeps.sections) and
// the renderers. Add-on section definitions come from the auto-discovered add-on registry
// (ADDON-01, 05-04). Only its pure entry is imported: the "use client" builder imports this
// file, so it must never reach server code (RESEARCH Pitfall 1).
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  type SectionRegistry,
} from "@cds/core/content";
import { ADDON_SECTIONS } from "@cds/addon-registry";

export const SECTION_REGISTRY: SectionRegistry = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_SECTIONS,
);
