// Slider block (07-06; CONT-23, D229; T-07-06-02, -04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  SLIDER_LIMITS,
  defaultSliderContent,
  duplicateSliderSlide,
  sliderIntervalMs,
  sliderSection,
  sliderVisibleSlides,
  validateSliderContent,
} from "./slider";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("slider content", () => {
  it("default: 2 empty slides with distinct ids and the decided options", () => {
    const d = defaultSliderContent();
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0]!.id).not.toBe(d.slides[1]!.id);
    expect(d.slides.every((s) => s.row_layout === "full")).toBe(true);
    expect(d).toMatchObject({
      heading: "",
      direction: "ltr",
      arrows: true,
      dots: true,
      autoplay: false,
      interval: 5,
      transition: "slide",
    });
    expect(validateSliderContent(d)).toEqual(d);
    expect(Object.isFrozen(SLIDER_LIMITS)).toBe(true);
  });

  it("refuses more than 10 slides", () => {
    const slides = Array.from({ length: 11 }, () => ({}));
    expect(msg(() => validateSliderContent({ slides }))).toBe(
      "A slider holds up to 10 slides.",
    );
  });

  it("options fall back deny-by-default", () => {
    expect(validateSliderContent({ interval: 4 }).interval).toBe(5);
    expect(validateSliderContent({ interval: 8 }).interval).toBe(8);
    expect(validateSliderContent({ direction: "ttb" }).direction).toBe("ttb");
    expect(validateSliderContent({ direction: "diagonal" }).direction).toBe(
      "ltr",
    );
    expect(validateSliderContent({ transition: "fade" }).transition).toBe(
      "fade",
    );
    expect(validateSliderContent({ autoplay: "yes" }).autoplay).toBe(false);
  });

  it("keeps a level-3 heading inside a slide (demotion is the renderer's job)", () => {
    const out = validateSliderContent({
      slides: [
        {
          id: "s",
          columns: [
            {
              id: "c",
              items: [{ id: "h", kind: "heading", text: "A", level: 3 }],
            },
          ],
        },
      ],
    });
    expect(out.slides[0]!.columns[0]!.items[0]).toMatchObject({ level: 3 });
  });
});

describe("sliderSection", () => {
  const content = validateSliderContent({
    heading: "Highlights",
    slides: [
      {
        id: "s1",
        columns: [
          {
            id: "c1",
            items: [{ id: "t", kind: "text", html: "<p>One</p>" }],
          },
        ],
      },
      {
        id: "s2",
        columns: [
          {
            id: "c2",
            items: [
              {
                id: "b",
                kind: "button",
                text: "Open",
                action: "popup",
                popup_id: "pop9",
              },
            ],
          },
        ],
      },
    ],
  });

  it("contract", () => {
    expect(sliderSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(sliderSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(() =>
      sliderSection.validate(sliderSection.defaultContent(), "full"),
    ).not.toThrow();
  });

  it("refs, texts, urls and rich text walk every slide", () => {
    expect(sliderSection.refsOf(content).popups).toEqual(["pop9"]);
    expect(sliderSection.textsOf(content)).toEqual([
      "Highlights",
      "<p>One</p>",
      "Open",
    ]);
    expect(sliderSection.urlsOf(content)).toEqual([]);
    expect(sliderSection.mapRichText(content, (h) => h)).toEqual(content);
    const mapped = sliderSection.mapRichText(
      content,
      () => "<p>S</p>",
    ) as typeof content;
    expect(mapped.slides[0]!.columns[0]!.items[0]).toMatchObject({
      html: "<p>S</p>",
    });
    expect(mapped.interval).toBe(content.interval);
  });

  it("returns a fresh object", () => {
    const input = { heading: "A", slides: [{ id: "s" }] };
    const out = validateSliderContent(input);
    input.heading = "B";
    input.slides.push({ id: "t" });
    expect(out.heading).toBe("A");
    expect(out.slides).toHaveLength(1);
  });
});

describe("slider render and editor helpers (07-20)", () => {
  function withItem(c = defaultSliderContent(), index = 0) {
    c.slides[index].columns[0].items = [
      { id: `t-${index}`, kind: "text", html: "<p>x</p>" },
    ];
    return c;
  }

  it("sliderVisibleSlides drops empty slides and is defensive", () => {
    expect(sliderVisibleSlides(defaultSliderContent())).toEqual([]);
    const c = withItem(defaultSliderContent(), 1);
    expect(sliderVisibleSlides(c).map((s) => s.id)).toEqual([c.slides[1].id]);
    expect(sliderVisibleSlides(null)).toEqual([]);
    expect(sliderVisibleSlides({ slides: "nope" })).toEqual([]);
    expect(sliderVisibleSlides({ slides: [null, { columns: 3 }] })).toEqual([]);
  });

  it("sliderIntervalMs maps 3/5/8 and falls back to 5000", () => {
    expect(sliderIntervalMs({ interval: 3 })).toBe(3000);
    expect(sliderIntervalMs({ interval: 5 })).toBe(5000);
    expect(sliderIntervalMs({ interval: 8 })).toBe(8000);
    expect(sliderIntervalMs({ interval: 4 })).toBe(5000);
    expect(sliderIntervalMs({ interval: "8" })).toBe(5000);
    expect(sliderIntervalMs(undefined)).toBe(5000);
  });

  it("duplicateSliderSlide inserts a fresh-id copy right after the source", () => {
    const c = withItem();
    c.slides.push({ ...c.slides[1], id: "third" });
    const out = duplicateSliderSlide(c, c.slides[0].id);
    expect(out.slides).toHaveLength(4);
    expect(out.slides[0]).toBe(c.slides[0]);
    expect(out.slides[1].id).not.toBe(c.slides[0].id);
    expect(out.slides[1].columns[0].items[0].id).not.toBe("t-0");
    expect(out.slides[2]).toBe(c.slides[1]);
    expect(() => validateSliderContent(out)).not.toThrow();
  });

  it("duplicateSliderSlide is a no-op at 10 slides or for an unknown id", () => {
    const c = defaultSliderContent();
    expect(duplicateSliderSlide(c, "missing")).toBe(c);
    const full = defaultSliderContent();
    while (full.slides.length < SLIDER_LIMITS.maxSlides) {
      full.slides.push(duplicateSliderSlide(full, full.slides[0].id).slides[1]);
    }
    expect(duplicateSliderSlide(full, full.slides[0].id)).toBe(full);
  });
});
