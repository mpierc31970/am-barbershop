// Group A block public exports (owner 07-06): gallery, slider, tabs, logo strip, stats.
// Every name carries its block prefix (blocks/index.ts does `export *` from this file and
// exports-b.ts, so an unprefixed name could clash; agreed with 07-07). The definitions and
// helpers-a.ts (PanelRow, validatePanels, ...) stay out: registration goes through
// CORE_SECTIONS, and consumers use SliderSlide / TabsPanel.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports. Named exports only.
export {
  GALLERY_LIMITS,
  defaultGalleryContent,
  validateGalleryContent,
} from "./gallery";
export type { GalleryContent, GalleryDisplay, GalleryImage } from "./gallery";
export {
  // 07-22 render and editor helpers
  GALLERY_MAX_COPY,
  GALLERY_PAGE_PARAM_PREFIX,
  parseGalleryPages,
  sliceGalleryPage,
} from "./gallery";
export {
  justifyGalleryRows,
  GALLERY_JUSTIFY_DEFAULTS,
} from "./gallery-justify";
export type { GalleryJustifyRow } from "./gallery-justify";
export {
  SLIDER_LIMITS,
  defaultSliderContent,
  validateSliderContent,
  // 07-20 render and editor helpers
  sliderVisibleSlides,
  sliderIntervalMs,
  duplicateSliderSlide,
} from "./slider";
export type {
  SliderContent,
  SliderDirection,
  SliderSlide,
  SliderTransition,
} from "./slider";
export {
  TABS_LIMITS,
  defaultTabsContent,
  validateTabsContent,
  // 07-20 render and editor helpers
  tabsVisiblePanels,
  duplicateTabsPanel,
} from "./tabs";
export type { TabsContent, TabsPanel } from "./tabs";
export {
  LOGO_STRIP_LIMITS,
  defaultLogoStripContent,
  validateLogoStripContent,
} from "./logo-strip";
export type { LogoStripContent, LogoStripLogo } from "./logo-strip";
// 07-22: copy shared by the validator and the editor
export { LOGO_STRIP_MAX_COPY, LOGO_STRIP_NAME_COPY } from "./logo-strip";
export {
  STATS_LIMITS,
  STATS_VALUE,
  defaultStatsContent,
  validateStatsContent,
} from "./stats";
export type { StatsContent, StatsItem } from "./stats";
