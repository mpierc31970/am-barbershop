// P8 (08-13) slot `contact`, Home row 6 and About row 5 (08-UI-SPEC; TMPL-01, TMPL-02;
// D-UI-P8-7, -8). The Suggested "Contact form and map" preset: a Columns 60-40 (heading
// "Get in touch", the line, the contact form; right column the address line, then the phone
// (tel:) and email (mailto:) as Button links, which survive the rich-text sanitizer; WR-B01)
// then a Map. Page-agnostic: the Map is dropped when `env.placed` says hours-location already
// ran with an address (one map per page) or when there is no address. The preset's owner
// helper line never reaches visitors: with no address, phone or email the right column's
// items are dropped and the slot reports Default used. Never left out.
import type { ColumnsContent } from "@cds/core/content";
import { SUGGESTED_PRESETS, type PresetBlock } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { addressText, presetContext } from "./shared";

export const contactSlot: Slot = {
  name: "contact",
  label: SLOT_LABELS.contact!,
  fill(intake, env) {
    const f = readFacts(intake);
    const preset = SUGGESTED_PRESETS.find((p) => p.id === "contact-form-map")!;
    const built = preset.build(presetContext(f, env));
    const hasDetails =
      addressText(f) !== "" || f.phone !== "" || f.email !== "";
    // One map per page: only an hours-location map on this page counts (08-14).
    // Absent pagePlaced = nothing placed on this page yet, never the site-wide set: Home's
    // map must not drop About's (IN-B01).
    const onPage = env.pagePlaced ?? new Set<string>();
    const mapAlreadyPlaced = onPage.has("hours-location") && f.hasAddress;
    const blocks: PresetBlock[] = [];
    for (const b of built) {
      if (b.section_type === "map") {
        if (f.hasAddress && !mapAlreadyPlaced) blocks.push(b);
        continue;
      }
      if (b.section_type === "columns" && !hasDetails) {
        const c = b.content as ColumnsContent;
        blocks.push({
          ...b,
          content: {
            columns: c.columns.map((col, i) =>
              i === 0 ? col : { ...col, items: [] },
            ),
          },
        });
        continue;
      }
      blocks.push(b);
    }
    return hasDetails
      ? { blocks, source: "provided" }
      : { blocks, source: "fallback", note: "No contact details: form only" };
  },
};
