// Moved to @cds/core/content/presets in 08-01 (CONTEXT A1-Q3); this shim keeps builder
// imports stable (BlockTemplatePicker, builder/index.ts and their tests import "./presets").
export { SUGGESTED_PRESETS, faqStartersFor } from "@cds/core/content/presets";
export type {
  PresetBlock,
  PresetContext,
  SuggestedPreset,
} from "@cds/core/content/presets";
