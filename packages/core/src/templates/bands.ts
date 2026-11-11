// Band rhythm (D-UI-P8-5; RESEARCH "Band assignment"). The hero is always `alternate`; every
// other PLACED slot alternates, starting `main` after a hero and `alternate` without one
// (About follows its `main` page-title band). Omitted slots (no blocks) are skipped and do
// not advance the rhythm; all blocks of one slot share its band. Pure: returns new objects.
import type { PresetBlock } from "../content/presets";
import type { Band } from "./types";

export function assignBands(
  results: readonly { slot: string; blocks: readonly PresetBlock[] }[],
  opts: { hasHero: boolean },
): { slot: string; band: Band; blocks: readonly PresetBlock[] }[] {
  let next: Band = opts.hasHero ? "main" : "alternate";
  const out: { slot: string; band: Band; blocks: readonly PresetBlock[] }[] =
    [];
  for (const r of results) {
    if (r.blocks.length === 0) continue;
    if (r.slot === "hero") {
      out.push({ slot: r.slot, band: "alternate", blocks: [...r.blocks] });
      continue;
    }
    out.push({ slot: r.slot, band: next, blocks: [...r.blocks] });
    next = next === "main" ? "alternate" : "main";
  }
  return out;
}
