"use client";
// SliderEditor (07-20; CONT-23, D229; 07-UI-SPEC row "Slider" line 358; replaces the
// 07-06 stub body, name and BUILDER_BLOCKS_A entry kept).
//
// Heading · Slides (SlidesEditor: the shared PanelListEditor with "Duplicate slide",
// each slide edited in ColumnsEditor) · Direction · Controls (Arrows, Dots, Auto-play,
// Change every 3 / 5 / 8 seconds while Auto-play is on) · Transition. Background stays in
// SectionForm. Every change calls onChange(name, value) into the block draft; Save block
// persists it (decision 9). Limits come from SLIDER_LIMITS; the 07-06 validator is the
// authority. Decision 6: with Arrows and Dots both off, visitors still get Previous and
// Next, and the helper says so. Hub tokens and hub primitives only.
import { useId } from "react";
import {
  SLIDER_LIMITS,
  defaultSliderContent,
  duplicateSliderSlide,
  type SliderContent,
  type SliderDirection,
  type SliderSlide,
  type SliderTransition,
} from "@cds/core/content";
import { Select, TextField } from "../../hub/fields";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { Switch } from "../../hub/Switch";
import { PanelListEditor, type PanelListEditorProps } from "./PanelListEditor";
import type { CoreBlockEditorProps } from "./types";

const OVER_COPY = "A slider holds up to 10 slides.";
const MIN_COPY = "A slider needs at least one slide.";
const CONTROLS_HELPER =
  "If both are off, visitors still get Previous and Next buttons.";
const AUTOPLAY_HELPER =
  "Visitors can pause it. It never moves for people who turn off animations.";

const DIRECTIONS: readonly { value: SliderDirection; title: string }[] = [
  { value: "ltr", title: "Left to right" },
  { value: "rtl", title: "Right to left" },
  { value: "ttb", title: "Top to bottom" },
];
const TRANSITIONS: readonly { value: SliderTransition; title: string }[] = [
  { value: "slide", title: "Slide" },
  { value: "fade", title: "Fade" },
];
const INTERVALS = SLIDER_LIMITS.intervals.map((n) => ({
  value: String(n),
  label: `${n} seconds`,
}));

/** The slider fields from the draft, falling back to the defaults per field. */
function read(content: Record<string, unknown>): SliderContent {
  const d = defaultSliderContent();
  const pick = <T,>(v: unknown, ok: (v: unknown) => boolean, fb: T): T =>
    ok(v) ? (v as T) : fb;
  return {
    heading: pick(content.heading, (v) => typeof v === "string", ""),
    slides: pick(content.slides, Array.isArray, d.slides),
    direction: pick(
      content.direction,
      (v) => DIRECTIONS.some((o) => o.value === v),
      d.direction,
    ),
    arrows: pick(content.arrows, (v) => typeof v === "boolean", d.arrows),
    dots: pick(content.dots, (v) => typeof v === "boolean", d.dots),
    autoplay: pick(content.autoplay, (v) => typeof v === "boolean", d.autoplay),
    interval: pick(
      content.interval,
      (v) => (SLIDER_LIMITS.intervals as readonly unknown[]).includes(v),
      d.interval,
    ),
    transition: pick(
      content.transition,
      (v) => TRANSITIONS.some((o) => o.value === v),
      d.transition,
    ),
  };
}

function firstHeading(slide: SliderSlide): string {
  for (const col of slide.columns ?? []) {
    for (const item of col.items ?? []) {
      if (item?.kind === "heading" && item.text.trim() !== "") {
        return item.text.trim();
      }
    }
  }
  return "";
}

const slideName = (_: SliderSlide, i: number) => `Slide ${i + 1}`;
const slideTitle = (s: SliderSlide, i: number) => {
  const h = firstHeading(s);
  return h ? `Slide ${i + 1} · ${h}` : `Slide ${i + 1}`;
};

type SlidesEditorProps = Pick<
  PanelListEditorProps<SliderSlide>,
  "popups" | "timeZone" | "onDirtyChange" | "handleRef"
> & {
  content: SliderContent;
  onSlidesChange: (next: SliderSlide[]) => void;
};

/** The Slides list: one row per slide, each opening in ColumnsEditor (UI-SPEC). */
export function SlidesEditor({
  content,
  onSlidesChange,
  ...rest
}: SlidesEditorProps) {
  return (
    <PanelListEditor<SliderSlide>
      {...rest}
      panels={content.slides}
      noun="slide"
      max={SLIDER_LIMITS.maxSlides}
      min={1}
      overCopy={OVER_COPY}
      minCopy={MIN_COPY}
      rowTitle={slideTitle}
      nameOf={slideName}
      onPanelsChange={onSlidesChange}
      // Duplicate slide: fresh ids for the slide, its columns and items (07-20).
      duplicate={(slides, id) => {
        const next = duplicateSliderSlide(
          { ...content, slides: [...slides] },
          id,
        );
        return next.slides.length > slides.length ? next.slides : null;
      }}
      newPanel={() => defaultSliderContent().slides[0]}
    />
  );
}

export function SliderEditor({
  content,
  onChange,
  errors,
  popups,
  timeZone,
  onDirtyChange,
  handleRef,
}: CoreBlockEditorProps) {
  const uid = useId();
  const c = read(content);

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={c.heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <section
        aria-labelledby={`${uid}-slides`}
        className="flex flex-col gap-2"
      >
        <h3 id={`${uid}-slides`} className="text-sm font-semibold text-hub-ink">
          Slides
        </h3>
        {errors.slides ? (
          <p className="text-sm text-hub-danger">{errors.slides}</p>
        ) : null}
        <SlidesEditor
          content={c}
          onSlidesChange={(next) => onChange("slides", next)}
          popups={popups}
          timeZone={timeZone}
          onDirtyChange={onDirtyChange}
          handleRef={handleRef}
        />
      </section>

      <RadioCardGroup<SliderDirection>
        name={`${uid}-direction`}
        legend="Direction"
        options={DIRECTIONS}
        value={c.direction}
        onChange={(v) => onChange("direction", v)}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-hub-ink">
          Controls
        </legend>
        <Switch
          id={`${uid}-arrows`}
          label="Arrows"
          checked={c.arrows}
          aria-describedby={`${uid}-controls-helper`}
          onChange={(v) => onChange("arrows", v)}
        />
        <Switch
          id={`${uid}-dots`}
          label="Dots"
          checked={c.dots}
          aria-describedby={`${uid}-controls-helper`}
          onChange={(v) => onChange("dots", v)}
        />
        <p id={`${uid}-controls-helper`} className="text-sm text-hub-ink-muted">
          {CONTROLS_HELPER}
        </p>
        <Switch
          id={`${uid}-autoplay`}
          label="Auto-play"
          checked={c.autoplay}
          onChange={(v) => onChange("autoplay", v)}
        />
        {c.autoplay ? (
          <Select
            id={`${uid}-interval`}
            label="Change every"
            helper={AUTOPLAY_HELPER}
            options={INTERVALS}
            value={String(c.interval)}
            onChange={(e) =>
              onChange("interval", Number(e.currentTarget.value))
            }
          />
        ) : null}
      </fieldset>

      <RadioCardGroup<SliderTransition>
        name={`${uid}-transition`}
        legend="Transition"
        options={TRANSITIONS}
        value={c.transition}
        onChange={(v) => onChange("transition", v)}
      />
    </div>
  );
}
