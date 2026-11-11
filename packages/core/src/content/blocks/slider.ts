// Slider block (owner 07-06; CONT-23, D229; CONTEXT decisions 1, 2 and 5).
//
// Each slide is a columns row (invariant 6: the slide's row_layout is the one place its
// split is chosen) validated by validatePanels with pop-up buttons allowed. Up to 10
// slides, one block-wide item cap across all slides. Heading items inside slides keep
// their stored level; demotion is the renderer's job. Background stays in section
// settings, not content. Renderer, controller and SlidesEditor: 07-20.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, oneOf, own, text } from "../validate-helpers";
import {
  bool,
  clonePanelFreshIds,
  mapPanelsRichText,
  newPanel,
  panelsRefs,
  panelsTexts,
  panelsUrls,
  validatePanels,
  type PanelRow,
} from "./helpers-a";

export type SliderDirection = "ltr" | "rtl" | "ttb";
export type SliderTransition = "slide" | "fade";
export type SliderSlide = PanelRow;

export type SliderContent = {
  heading: string;
  slides: SliderSlide[];
  direction: SliderDirection;
  arrows: boolean;
  dots: boolean;
  autoplay: boolean;
  /** Seconds between slides when autoplay is on. */
  interval: 3 | 5 | 8;
  transition: SliderTransition;
};

export const SLIDER_LIMITS = Object.freeze({
  maxSlides: 10,
  startSlides: 2,
  intervals: Object.freeze([3, 5, 8] as const),
  intervalDefault: 5,
} as const);

const DIRECTIONS: readonly SliderDirection[] = ["ltr", "rtl", "ttb"];
const TRANSITIONS: readonly SliderTransition[] = ["slide", "fade"];
const OVER_COPY = "A slider holds up to 10 slides.";

export function defaultSliderContent(): SliderContent {
  return {
    heading: "",
    slides: Array.from({ length: SLIDER_LIMITS.startSlides }, newPanel),
    direction: "ltr",
    arrows: true,
    dots: true,
    autoplay: false,
    interval: SLIDER_LIMITS.intervalDefault,
    transition: "slide",
  };
}

export function validateSliderContent(value: unknown): SliderContent {
  const raw = asRecord(value);
  const interval = own(raw, "interval");
  return {
    heading: text(raw, "heading"),
    slides: validatePanels(raw, "slides", SLIDER_LIMITS.maxSlides, OVER_COPY),
    direction: oneOf(own(raw, "direction"), DIRECTIONS, "ltr"),
    arrows: bool(raw, "arrows", true),
    dots: bool(raw, "dots", true),
    autoplay: bool(raw, "autoplay", false),
    interval: (SLIDER_LIMITS.intervals as readonly unknown[]).includes(interval)
      ? (interval as 3 | 5 | 8)
      : SLIDER_LIMITS.intervalDefault,
    transition: oneOf(own(raw, "transition"), TRANSITIONS, "slide"),
  };
}

// ---- Render and editor helpers (07-20) ----

/** A panel shows publicly when any of its columns holds at least one item. */
function hasItems(panel: unknown): boolean {
  if (!isRecord(panel) || !Array.isArray(panel.columns)) return false;
  return panel.columns.some(
    (col: unknown) =>
      isRecord(col) && Array.isArray(col.items) && col.items.length > 0,
  );
}

/** The slides a visitor sees: empty slides skipped; defensive on any input. */
export function sliderVisibleSlides(content: unknown): SliderSlide[] {
  const slides = isRecord(content) ? content.slides : undefined;
  return Array.isArray(slides)
    ? (slides.filter(hasItems) as SliderSlide[])
    : [];
}

/** Auto-play interval in ms: 3000 / 5000 / 8000; anything else -> 5000. */
export function sliderIntervalMs(content: unknown): number {
  const interval = isRecord(content) ? content.interval : undefined;
  return (SLIDER_LIMITS.intervals as readonly unknown[]).includes(interval)
    ? (interval as number) * 1000
    : SLIDER_LIMITS.intervalDefault * 1000;
}

/** Duplicate slide: a fresh-id copy right after the source; unchanged at the cap. */
export function duplicateSliderSlide(
  content: SliderContent,
  slideId: string,
): SliderContent {
  const slides = Array.isArray(content.slides) ? content.slides : [];
  const at = slides.findIndex((s) => s.id === slideId);
  if (at < 0 || slides.length >= SLIDER_LIMITS.maxSlides) return content;
  const next = [...slides];
  next.splice(at + 1, 0, clonePanelFreshIds(slides[at]));
  return { ...content, slides: next };
}

function slidesOf(content: unknown): unknown {
  return isRecord(content) ? content.slides : [];
}

export const sliderSection: SectionTypeDefinition = {
  type: "slider",
  label: "Slider",
  description: "Slides that change, each with its own content",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultSliderContent(),
  validate: (raw) => validateSliderContent(raw),
  mapRichText: (content, fn) => {
    const c = content as SliderContent;
    return { ...c, slides: mapPanelsRichText<SliderSlide>(c?.slides, fn) };
  },
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? (content.heading as string) : "",
      ...panelsTexts(slidesOf(content)),
    ]),
  urlsOf: (content) => panelsUrls(slidesOf(content)),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: (content) => panelsRefs(slidesOf(content)),
};
