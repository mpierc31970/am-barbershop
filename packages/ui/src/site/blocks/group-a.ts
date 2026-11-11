// Site components for core block group A (owner 07-06): gallery, slider, tabs, logo-strip,
// stats.
//
// SectionRenderer's CORE_SECTION_COMPONENTS spreads this map (before the five base types,
// so a group entry can never replace one). Add the core definition in `@cds/core`
// `content/blocks/group-a.ts` and the component here in the same commit: the parity test
// (page-title.test.tsx) fails when a CORE_SECTIONS type has no component.
import type { ComponentType } from "react";
import type { SectionComponentProps } from "../types";
import { GallerySection } from "./GallerySection";
import { LogoStripSection } from "./LogoStripSection";
import { SliderSection } from "./SliderSection";
import { StatsSection } from "./StatsSection";
import { TabsSection } from "./TabsSection";

export const SITE_BLOCKS_A: Readonly<
  Record<string, ComponentType<SectionComponentProps<never>>>
> = Object.freeze({
  gallery: GallerySection,
  slider: SliderSection,
  tabs: TabsSection,
  "logo-strip": LogoStripSection,
  stats: StatsSection,
});
