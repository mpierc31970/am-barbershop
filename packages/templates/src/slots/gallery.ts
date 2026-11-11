// P8 (08-14) About slot 3 `gallery` (08-UI-SPEC About row 3; TMPL-01, TMPL-02; CONTEXT
// A3-Q5, A4-Q2). The Suggested "Photo gallery" preset (Gallery, Mosaic, "Our work", 12 per
// page, lightbox on) over the intake gallery photos in order. Each item copies `alt` and
// `alt_reviewed` from the intake ref (never defaulted to true), so an undescribed photo stays
// amber in the P7 checklist; its id goes to `unreviewedAlt` and the orchestrator writes the
// one deduped photo polish line (no line here). No gallery photos -> Left out.
import {
  newId,
  type GalleryContent,
  type GalleryImage,
} from "@cds/core/content";
import { SUGGESTED_PRESETS } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { presetContext, unreviewedIds } from "./shared";

const PER_PAGE = 12;

export const gallerySlot: Slot = {
  name: "gallery",
  label: SLOT_LABELS.gallery!,
  fill(intake, env) {
    const f = readFacts(intake);
    const refs = f.galleryAssets;
    if (refs.length === 0) {
      return { blocks: [], source: "omitted", note: "No gallery photos" };
    }
    const preset = SUGGESTED_PRESETS.find((p) => p.id === "photo-gallery")!;
    const built = preset.build(presetContext(f, env))[0]!;
    const images: GalleryImage[] = refs.map((r) => ({
      id: newId(),
      asset: r.id,
      alt: r.alt,
      alt_reviewed: r.alt_reviewed,
      caption: "",
    }));
    const content: GalleryContent = {
      ...(built.content as GalleryContent),
      per_page: PER_PAGE,
      lightbox: true,
      images,
    };
    return {
      blocks: [{ ...built, content }],
      source: "provided",
      note: refs.length === 1 ? "1 photo" : `${refs.length} photos`,
      unreviewedAlt: unreviewedIds(refs),
    };
  },
};
