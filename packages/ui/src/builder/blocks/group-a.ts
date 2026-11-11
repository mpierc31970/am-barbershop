// Builder editors for core block group A (owner 07-06). Picker groups (07-UI-SPEC):
// Photos and video: gallery, slider, logo-strip. Information: tabs, stats.
//
// Keys must equal SITE_BLOCKS_A's (block-contract.dom.test.tsx). SectionForm and the
// block picker read this map; no shared builder file needs editing to add a block.
//
// order uses slots of ten, agreed with 07-07: Photos and video gallery 10, slider 20,
// logo-strip 30; Information faq 10, tabs 20, table 30, icon-list 40, stats 50, hours 60,
// map 70, social 80 (07-UI-SPEC "Block picker" order).
import { GalleryEditor } from "./GalleryEditor";
import { LogoStripEditor } from "./LogoStripEditor";
import { SliderEditor } from "./SliderEditor";
import { StatsEditor } from "./StatsEditor";
import { TabsEditor } from "./TabsEditor";
import type { BuilderBlockEntry } from "./types";

export const BUILDER_BLOCKS_A: Readonly<Record<string, BuilderBlockEntry>> =
  Object.freeze({
    gallery: { Editor: GalleryEditor, picker: "photos-video", order: 10 },
    slider: { Editor: SliderEditor, picker: "photos-video", order: 20 },
    "logo-strip": {
      Editor: LogoStripEditor,
      picker: "photos-video",
      order: 30,
    },
    tabs: { Editor: TabsEditor, picker: "information", order: 20 },
    stats: { Editor: StatsEditor, picker: "information", order: 50 },
  });
