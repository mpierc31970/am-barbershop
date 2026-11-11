// P8 (08-13) Home slot 7 `closing-cta` (08-UI-SPEC Home row 7; TMPL-01, TMPL-02;
// D-UI-P8-10). The registered Call to action block: heading and line from the CopyWriter
// phrase table, button **Call {phone}** -> tel: (digits only, T-08-13-02). No phone ->
// Left out (booking add-ons contribute their own CTA later via templateSlots).
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { telHref } from "../html";
import { defaultsOf } from "./shared";

export const closingCtaSlot: Slot = {
  name: "closing-cta",
  label: SLOT_LABELS["closing-cta"]!,
  fill(intake, env) {
    const f = readFacts(intake);
    const tel = telHref(f.phone);
    if (tel === "") {
      return { blocks: [], source: "omitted", note: "No phone number" };
    }
    const { heading, line } = env.copy.closingCta(f);
    return {
      blocks: [
        {
          section_type: "cta-banner",
          row_layout: "full",
          content: {
            ...defaultsOf("cta-banner"),
            heading,
            description: line,
            button_text: `Call ${f.phone}`,
            button_link: tel,
          },
        },
      ],
      source: "provided",
    };
  },
};
