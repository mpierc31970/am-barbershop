// Core block group A (owner 07-06): gallery, slider, tabs, logo strip, stats.
//
// CORE_SECTIONS spreads P7_SECTIONS_A and SectionTypeMap extends P7SectionContentA, so
// 07-06 registers its blocks here without editing registry.ts. Block files import only
// TYPES from ../registry and runtime helpers from ../items/walk, ../layouts, ../validate
// (never runtime values from registry.ts, which would form an import cycle).
// Do not export from here through blocks/index.ts; that barrel is exports-a.ts's job.
import type { SectionTypeDefinition } from "../registry";
import { gallerySection, type GalleryContent } from "./gallery";
import { logoStripSection, type LogoStripContent } from "./logo-strip";
import { sliderSection, type SliderContent } from "./slider";
import { statsSection, type StatsContent } from "./stats";
import { tabsSection, type TabsContent } from "./tabs";

/** Content types of group A blocks, keyed by section type (merged into SectionTypeMap). */
export type P7SectionContentA = {
  gallery: GalleryContent;
  slider: SliderContent;
  tabs: TabsContent;
  "logo-strip": LogoStripContent;
  stats: StatsContent;
};

/** Group A block definitions (the builder picker groups them; see BUILDER_BLOCKS_A). */
export const P7_SECTIONS_A: readonly SectionTypeDefinition[] = Object.freeze([
  gallerySection,
  sliderSection,
  tabsSection,
  logoStripSection,
  statsSection,
]);
