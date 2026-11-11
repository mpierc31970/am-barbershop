// P8 (08-14) About slot 1 `about` (08-UI-SPEC About row 1; TMPL-01, TMPL-02; D-UI-P8-22).
// A registered Text block with no heading (the page title H1 sits right above) holding the
// full About answer; when a mission exists, a second Text block headed with the mission title on the
// same band; then active add-on contributions for slot `about` (Credentials), read through
// the registry like `proof`. About only from the business-type sentence -> Default used;
// no About text at all (unknown type, no answer) -> Left out: a page of nothing but a
// heading would be a hole. Intake text is escaped through html.ts.
import type { PresetBlock } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { paragraphs } from "../html";
import { contributionsFor } from "./contributions";
import { defaultsOf } from "./shared";

function textBlock(heading: string, body: string): PresetBlock {
  return {
    section_type: "text-only",
    row_layout: "full",
    content: { ...defaultsOf("text-only"), heading, text: paragraphs(body) },
  };
}

export const aboutSlot: Slot = {
  name: "about",
  label: SLOT_LABELS.about!,
  fill(intake, env) {
    const f = readFacts(intake);
    const extra = contributionsFor(intake, env, "about");
    // WR-B05: a dropped add-on contribution is reported, never fatal.
    const polish = extra.polish.length > 0 ? { polish: extra.polish } : {};
    const blocks: PresetBlock[] = [];
    if (f.about !== "") blocks.push(textBlock("", f.about));
    if (f.mission !== "") blocks.push(textBlock("Our mission", f.mission));
    blocks.push(...extra.blocks);
    if (f.about === "") {
      if (blocks.length === 0) {
        return {
          blocks: [],
          source: "omitted",
          note: "No about text",
          ...polish,
        };
      }
      return { blocks, source: "provided", ...polish };
    }
    if (f.fieldSources.about !== "provided") {
      return {
        blocks,
        source: "fallback",
        note: "No About answer: sentence from the business type",
        ...polish,
      };
    }
    return { blocks, source: "provided", ...polish };
  },
};
