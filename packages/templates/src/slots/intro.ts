// P8 (08-13) Home slot 2 `intro` (08-UI-SPEC Home row 2; TMPL-01, TMPL-02; D-UI-P8-20,
// CONTEXT A3-Q5, A4-Q2). The Suggested "Photo left, text right" preset (Columns 40-60):
// image = first gallery photo that has a description (a column image cannot save without
// alt, and alt is never invented), heading from the CopyWriter, the About excerpt
// (<= 320 chars, sentence end) and a secondary **More about us** -> /about button.
// No usable photo -> one full-width Columns block (heading, text, button): the registered
// Text block has no button field, so a full-width Columns block carries the same three
// items. About only from its fallback -> Default used; no About text at all -> Left out.
import {
  newColumnItem,
  type ColumnItem,
  type ColumnsContent,
} from "@cds/core/content";
import { SUGGESTED_PRESETS, type PresetBlock } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { excerpt, paragraphs } from "../html";
import { defaultsOf, presetContext, unreviewedIds } from "./shared";

const EXCERPT_MAX = 320;

function textItems(heading: string, text: string): ColumnItem[] {
  return [
    { ...newColumnItem("heading"), text: heading } as ColumnItem,
    { ...newColumnItem("text"), html: paragraphs(text) } as ColumnItem,
    {
      ...newColumnItem("button"),
      text: "More about us",
      link: "/about",
      style: "secondary",
    } as ColumnItem,
  ];
}

export const introSlot: Slot = {
  name: "intro",
  label: SLOT_LABELS.intro!,
  fill(intake, env) {
    const f = readFacts(intake);
    const text = excerpt(f.about, EXCERPT_MAX);
    if (text === "") {
      return { blocks: [], source: "omitted", note: "No about text" };
    }
    const source =
      f.fieldSources.about === "provided" ? "provided" : "fallback";
    const heading = env.copy.introHeading(f);
    const photo = f.galleryAssets.find((g) => g.alt.trim() !== "") ?? null;

    let block: PresetBlock;
    if (photo) {
      const preset = SUGGESTED_PRESETS.find(
        (p) => p.id === "photo-left-text-right",
      )!;
      const built = preset.build(presetContext(f, env))[0]!;
      const content = built.content as ColumnsContent;
      block = {
        ...built,
        content: {
          columns: content.columns.map((col, i) => ({
            ...col,
            items:
              i === 0
                ? col.items.map((item) =>
                    item.kind === "image"
                      ? { ...item, url: "", asset: photo.id, alt: photo.alt }
                      : item,
                  )
                : textItems(heading, text),
          })),
        },
      };
    } else {
      const content = defaultsOf("columns") as unknown as ColumnsContent;
      block = {
        section_type: "columns",
        row_layout: "full",
        content: {
          columns: content.columns.map((col, i) => ({
            ...col,
            items: i === 0 ? textItems(heading, text) : col.items,
          })),
        },
      };
    }
    return {
      blocks: [block],
      source,
      ...(source === "fallback"
        ? { note: "About text from business type" }
        : {}),
      unreviewedAlt: unreviewedIds([photo]),
    };
  },
};
