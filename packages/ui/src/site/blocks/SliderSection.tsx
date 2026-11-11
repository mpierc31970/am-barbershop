// SliderSection: the published slider block (07-20; CONT-23, D229; 07-UI-SPEC row
// "Slider" line 358; replaces the 07-06 stub body, name and SITE_BLOCKS_A entry kept).
//
// Each visible slide (empty slides skipped; none left renders nothing) is one columns row
// rendered here on the server by PanelColumns and handed to the SliderController island
// as a node (07-20 decision 1), so no item renderer ships as client code. The heading is
// an <h2> that names the carousel; slide headings demote to <h3> under it (decision 8).
// No-JS view (decision 2): one constant <noscript><style> stacks every slide and hides the
// controls bar; with JS nothing shifts. The CSS is a constant: no owner input reaches it.
// Server component.
import {
  sliderIntervalMs,
  sliderVisibleSlides,
  type SliderContent,
} from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import { SliderController } from "../client/SliderController";
import { HEADING_CLASSES, type SectionComponentProps } from "../types";
import { PanelColumns } from "./PanelColumns";

/** No-JS fallback: every slide shows, stacked in order; the controls bar is hidden. */
export const SLIDER_NOSCRIPT_CSS =
  "[data-cds-slider] [data-slider-viewport]{display:flex;flex-direction:column;gap:2rem}" +
  "[data-cds-slider] [data-slide]{visibility:visible;transform:none;translate:none;opacity:1;grid-area:auto}" +
  "[data-cds-slider] [data-slider-controls]{display:none}";

export function SliderSection({
  content,
  background,
  isFirst,
  now,
  openablePopups,
  coreData,
}: SectionComponentProps<SliderContent>) {
  const slides = sliderVisibleSlides(content);
  if (slides.length === 0) return null;

  const heading =
    typeof content?.heading === "string" ? content.heading.trim() : "";
  const headingId = heading ? `cds-slider-${slides[0].id}` : undefined;
  const direction = content.direction ?? "ltr";

  return (
    <RowRenderer layout="full" background={background}>
      {heading ? (
        <h2 id={headingId} className={`${HEADING_CLASSES[2]} mb-8`}>
          {heading}
        </h2>
      ) : null}
      <SliderController
        slides={slides.map((slide, i) => ({
          id: slide.id,
          node: (
            <PanelColumns
              panel={slide}
              demote={heading !== ""}
              isFirstPanel={i === 0}
              isFirstBlock={isFirst}
              now={now}
              openablePopups={openablePopups}
              coreData={coreData}
            />
          ),
        }))}
        labelledBy={headingId}
        direction={direction}
        arrows={content.arrows !== false}
        dots={content.dots !== false}
        autoplay={content.autoplay === true}
        intervalMs={sliderIntervalMs(content)}
        transition={content.transition === "fade" ? "fade" : "slide"}
      />
      {slides.length > 1 ? (
        <noscript>
          <style>{SLIDER_NOSCRIPT_CSS}</style>
        </noscript>
      ) : null}
    </RowRenderer>
  );
}
