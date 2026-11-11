// P8 (08-13) Home slot 3 `services` (08-UI-SPEC Home row 3; TMPL-01, TMPL-02; D-UI-P8-15,
// D253). The data-bound Services block (registered defaults + overrides): it shows the live
// published services, so content holds display options only. Top 6; Cards when at least 3
// show and any has a description, else List; heading from the CopyWriter phrase table.
// No published services -> Left out.
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { defaultsOf } from "./shared";

const LIMIT = 6;

export const servicesSlot: Slot = {
  name: "services",
  label: SLOT_LABELS.services!,
  fill(intake, env) {
    const f = readFacts(intake);
    const total = f.services.length;
    if (total === 0) {
      return { blocks: [], source: "omitted", note: "No services yet" };
    }
    const shown = f.services.slice(0, LIMIT);
    const described = shown.some(
      (s) => typeof s.description === "string" && s.description.trim() !== "",
    );
    const display = shown.length >= 3 && described ? "cards" : "list";
    return {
      blocks: [
        {
          section_type: "services",
          row_layout: "full",
          content: {
            ...defaultsOf("services"),
            heading: env.copy.servicesHeading(f),
            display,
            limit: LIMIT,
          },
        },
      ],
      source: "provided",
      note: `${shown.length} of ${total}`,
    };
  },
};
