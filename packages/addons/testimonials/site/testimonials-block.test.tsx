// Testimonials block renderer and the pure blockData transform (ADDON-08; D253,
// D-UI-P5-10..12, D-UI-P5-18; T-05-31; 05-UI-SPEC "Site blocks > Testimonials block").
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blockData, selectTestimonials, type TestimonialView } from "../server";
import type { TestimonialsBlockContent } from "../sections/definition";
import { TestimonialsBlock, gridClasses } from "./TestimonialsBlock";

const NOW = new Date("2026-09-28T12:00:00Z");

function view(
  i: number,
  extra: Partial<TestimonialView> = {},
): TestimonialView {
  return {
    id: `t${i}`,
    quote: `Quote ${i}`,
    author_name: `Name ${i}`,
    author_detail: "",
    rating: null,
    photo_url: "",
    photo_alt: "",
    ...extra,
  };
}

const content = (
  c: Partial<TestimonialsBlockContent> = {},
): TestimonialsBlockContent => ({
  heading: "What people say",
  layout: "grid",
  show: "all",
  limit: 6,
  ...c,
});

function html(
  data: TestimonialView[],
  c: Partial<TestimonialsBlockContent> = {},
  isH1Owner = false,
): string {
  return renderToStaticMarkup(
    <TestimonialsBlock
      content={content(c)}
      layout="full"
      background="main"
      isH1Owner={isH1Owner}
      isFirst={false}
      now={NOW}
      data={data}
    />,
  );
}

describe("TestimonialsBlock", () => {
  it("renders nothing, not even the heading, with no items", () => {
    expect(html([])).toBe("");
    expect(
      renderToStaticMarkup(
        <TestimonialsBlock
          content={content()}
          layout="full"
          background="main"
          isH1Owner={false}
          isFirst={false}
          now={NOW}
          data={undefined as unknown as TestimonialView[]}
        />,
      ),
    ).toBe("");
  });

  it("renders one item as the One quote layout", () => {
    const out = html([view(1)]);
    expect(out).toContain("max-w-[56ch]");
    expect(out).not.toContain("grid-cols");
    expect(out).toContain("<figure");
    expect(out).toContain("<blockquote");
    expect(out).toContain("<figcaption");
  });

  it("uses 2 columns for 2 items and 3 columns at 1024px for 3 or more", () => {
    expect(gridClasses(2)).toContain("md:grid-cols-2");
    expect(gridClasses(2)).not.toContain("lg:grid-cols-3");
    expect(gridClasses(3)).toContain("lg:grid-cols-3");
    const two = html([view(1), view(2)]);
    expect(two).toContain("md:grid-cols-2");
    expect(two).not.toContain("lg:grid-cols-3");
    const three = html([view(1), view(2), view(3)]);
    expect(three).toContain("lg:grid-cols-3");
    expect(three.match(/<figure/g)).toHaveLength(3);
    expect(three).toContain("border-t border-site-border");
  });

  it("renders the single layout for a configured One quote", () => {
    const out = html([view(1), view(2)], { layout: "single" });
    expect(out).toContain("max-w-[56ch]");
    expect(out.match(/<figure/g)).toHaveLength(1);
    expect(out).toContain("--site-text-h3");
  });

  it("labels the rating as an image with its value and hides the stars", () => {
    const out = html([view(1, { rating: 4 })]);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Rated 4 out of 5"');
    expect(out.match(/<svg/g)).toHaveLength(5);
    expect(out.match(/fill-current/g)).toHaveLength(4);
    expect(out).not.toContain("site-accent");
  });

  it("makes the heading the page h1 only when it owns it", () => {
    expect(html([view(1)], {}, true)).toContain("<h1");
    const h2 = html([view(1)]);
    expect(h2).toContain("<h2");
    expect(h2).not.toContain("<h1");
    expect(html([view(1)], { heading: "" })).not.toContain("<h2");
  });

  it("drops an unsafe photo src and needs a description for a photo", () => {
    const bad = html([
      view(1, { photo_url: "javascript:alert(1)", photo_alt: "x" }),
    ]);
    expect(bad).not.toContain("<img");
    expect(bad).not.toContain("javascript:");
    const noAlt = html([view(1, { photo_url: "https://img.test/a.jpg" })]);
    expect(noAlt).not.toContain("<img");
    const ok = html([
      view(1, { photo_url: "https://img.test/a.jpg", photo_alt: "Maria" }),
    ]);
    expect(ok).toContain('src="https://img.test/a.jpg"');
    expect(ok).toContain('alt="Maria"');
    expect(ok).toContain('loading="lazy"');
  });
});

type Rec = { id: string } & Record<string, unknown>;
const rec = (id: string, sort: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    quote: `Q ${id}`,
    author_name: `N ${id}`,
    author_detail: "",
    rating: 0,
    photo_url: "",
    photo_alt: "",
    featured: false,
    sort_order: sort,
    ...extra,
  }) as Rec;

describe("blockData (pure)", () => {
  const records = [
    rec("a", 1),
    rec("b", 2, { featured: true }),
    rec("c", 3),
    rec("d", 4, { featured: true, rating: 5 }),
  ];

  it("orders featured first, then sort_order", () => {
    expect(selectTestimonials(content(), records).map((v) => v.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("filters to featured and applies the limit last", () => {
    expect(
      selectTestimonials(content({ show: "featured" }), records).map(
        (v) => v.id,
      ),
    ).toEqual(["b", "d"]);
    expect(
      selectTestimonials(content({ limit: 3 }), records).map((v) => v.id),
    ).toEqual(["b", "d", "a"]);
  });

  it("single layout shows the first featured, or the first one", () => {
    expect(
      selectTestimonials(content({ layout: "single" }), records).map(
        (v) => v.id,
      ),
    ).toEqual(["b"]);
    expect(
      selectTestimonials(content({ layout: "single" }), [
        rec("x", 2),
        rec("y", 1),
      ]).map((v) => v.id),
    ).toEqual(["y"]);
  });

  it("returns view fields only, keyed by testimonials sections", () => {
    const out = blockData(
      [
        { id: "s1", section_type: "testimonials", content: content() },
        { id: "s2", section_type: "hero", content: {} },
        {
          id: "s3",
          section_type: "testimonials",
          content: { layout: "bogus", limit: 1 },
        },
      ],
      { testimonials: [...records, rec("z", 9, { organization: "orgA" })] },
    );
    expect(Object.keys(out)).toEqual(["s1", "s3"]);
    expect(out.s3!.map((v) => v.id)).toEqual(["b"]);
    const d = out.s1!.find((v) => v.id === "d")!;
    expect(d).toEqual({
      id: "d",
      quote: "Q d",
      author_name: "N d",
      author_detail: "",
      rating: 5,
      photo_url: "",
      photo_alt: "",
    });
    expect(out.s1!.find((v) => v.id === "a")!.rating).toBeNull();
    expect(Object.keys(out.s1![0]!)).not.toContain("organization");
  });

  it("is empty for a missing collection", () => {
    expect(
      blockData(
        [{ id: "s1", section_type: "testimonials", content: content() }],
        {},
      ),
    ).toEqual({ s1: [] });
  });
});
