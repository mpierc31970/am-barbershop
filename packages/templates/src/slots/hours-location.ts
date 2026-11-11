// P8 (08-13) Home slot 5 `hours-location` (08-UI-SPEC Home row 5; TMPL-01, TMPL-02; D253,
// D257, CONTEXT A3-Q4). The registered Business hours block (heading "Opening hours", Open
// now on) and Map block (heading "Find us", directions on, `location` left empty so it binds
// to the live business address). Both blocks share one band (D-UI-P8-5).
// Address without hours -> Hours still placed (renders "Contact us for hours."), Default used.
// Hours without address -> Hours only. Neither -> Left out.
import type { PresetBlock } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { defaultsOf } from "./shared";

export const hoursLocationSlot: Slot = {
  name: "hours-location",
  label: SLOT_LABELS["hours-location"]!,
  fill(intake) {
    const f = readFacts(intake);
    if (!f.hasHours && !f.hasAddress) {
      return { blocks: [], source: "omitted", note: "No hours or address" };
    }
    const blocks: PresetBlock[] = [
      {
        section_type: "hours",
        row_layout: "full",
        content: {
          ...defaultsOf("hours"),
          heading: "Opening hours",
          show_open_now: true,
        },
      },
    ];
    if (f.hasAddress) {
      blocks.push({
        section_type: "map",
        row_layout: "full",
        content: {
          ...defaultsOf("map"),
          heading: "Find us",
          location: "",
          show_directions: true,
        },
      });
    }
    if (!f.hasHours) {
      return {
        blocks,
        source: "fallback",
        note: "No hours: shows 'Contact us for hours.'",
      };
    }
    return {
      blocks,
      source: "provided",
      ...(f.hasAddress ? {} : { note: "No address: no map" }),
    };
  },
};
