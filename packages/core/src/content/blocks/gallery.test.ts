// Gallery block (07-06; CONT-22, D228; T-07-06-01, -03, -04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  GALLERY_LIMITS,
  GALLERY_MAX_COPY,
  defaultGalleryContent,
  parseGalleryPages,
  sliceGalleryPage,
  gallerySection,
  validateGalleryContent,
} from "./gallery";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

const img = (over: Record<string, unknown> = {}) => ({
  asset: "abc",
  alt: "",
  ...over,
});

describe("gallery content", () => {
  it("default validates and has the decided shape", () => {
    const d = defaultGalleryContent();
    expect(d).toEqual({
      heading: "",
      display: "grid",
      columns: 3,
      per_page: 12,
      show_captions: false,
      lightbox: true,
      images: [],
    });
    expect(validateGalleryContent(d)).toEqual(d);
  });

  it("limits are frozen", () => {
    expect(Object.isFrozen(GALLERY_LIMITS)).toBe(true);
    expect(Object.isFrozen(GALLERY_LIMITS.perPageChoices)).toBe(true);
  });

  it("clamps display, columns and per_page", () => {
    expect(validateGalleryContent({ display: "carousel" }).display).toBe(
      "grid",
    );
    expect(validateGalleryContent({ display: "mosaic" }).display).toBe(
      "mosaic",
    );
    expect(validateGalleryContent({ columns: 9 }).columns).toBe(6);
    expect(validateGalleryContent({ columns: 1 }).columns).toBe(2);
    expect(validateGalleryContent({ per_page: 13 }).per_page).toBe(12);
    expect(validateGalleryContent({ per_page: 24 }).per_page).toBe(24);
    expect(validateGalleryContent({ per_page: "24" }).per_page).toBe(12);
  });

  it("builds fresh images and drops unknown keys", () => {
    const out = validateGalleryContent({
      images: [{ asset: "abc", alt: " Loaves ", caption: "x", evil: 1 }],
    });
    expect(out.images).toHaveLength(1);
    const [i] = out.images;
    expect(i).toEqual({
      id: i!.id,
      asset: "abc",
      alt: "Loaves",
      alt_reviewed: false,
      caption: "x",
    });
    expect(i!.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(i).not.toHaveProperty("evil");
  });

  it("refuses a malformed or missing asset id", () => {
    for (const asset of ["../x", undefined, "", 5]) {
      expect(
        msg(() => validateGalleryContent({ images: [img({ asset })] })),
      ).toBe("Pick each photo from your media.");
    }
  });

  it("refuses more than 200 photos, before per-item work", () => {
    const over = Array.from({ length: 201 }, () => img());
    expect(msg(() => validateGalleryContent({ images: over }))).toBe(
      "A gallery holds up to 200 photos. Start a second gallery for more.",
    );
    const huge = Array.from({ length: 10_000 }, () => "not an object");
    expect(msg(() => validateGalleryContent({ images: huge }))).toMatch(
      /up to 200/,
    );
  });

  it("caps alt and caption", () => {
    expect(() =>
      validateGalleryContent({ images: [img({ alt: "a".repeat(251) })] }),
    ).toThrow("Keep this under 250 characters.");
    expect(() =>
      validateGalleryContent({ images: [img({ caption: "a".repeat(201) })] }),
    ).toThrow("Keep this under 200 characters.");
  });

  it("refuses duplicate image ids and non-array images", () => {
    expect(() =>
      validateGalleryContent({ images: [img({ id: "a" }), img({ id: "a" })] }),
    ).toThrow(InvalidInput);
    expect(() => validateGalleryContent({ images: "x" })).toThrow(InvalidInput);
  });

  it("ignores __proto__ and inherited keys", () => {
    const raw = JSON.parse('{"__proto__": {"heading": "evil"}, "columns": 4}');
    const out = validateGalleryContent(raw);
    expect(out.heading).toBe("");
    expect(out.columns).toBe(4);
    expect(({} as Record<string, unknown>).heading).toBeUndefined();
    expect(
      validateGalleryContent(Object.create({ heading: "x" })).heading,
    ).toBe("");
  });
});

describe("gallerySection", () => {
  it("is full width, never owns the H1, and returns fresh content", () => {
    expect(gallerySection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(gallerySection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(() =>
      gallerySection.validate(gallerySection.defaultContent(), "full"),
    ).not.toThrow();
    const input = { heading: "Hi", images: [img({ id: "a" })] };
    const out = gallerySection.validate(input, "full") as {
      heading: string;
      images: unknown[];
    };
    input.heading = "changed";
    input.images.push(img({ id: "b" }));
    expect(out.heading).toBe("Hi");
    expect(out.images).toHaveLength(1);
  });

  it("refs, texts, urls, mapRichText", () => {
    const c = validateGalleryContent({
      heading: "Our work",
      images: [
        img({ id: "a", asset: "m1", alt: "One", caption: "Cap" }),
        img({ id: "b", asset: "m2" }),
        img({ id: "c", asset: "m1" }),
      ],
    });
    expect(gallerySection.refsOf(c)).toEqual({
      popups: [],
      forms: [],
      media: ["m1", "m2"],
    });
    expect(gallerySection.textsOf(c)).toEqual(["Our work", "One", "Cap"]);
    expect(gallerySection.urlsOf(c)).toEqual([]);
    expect(gallerySection.mapRichText(c, () => "X")).toEqual(c);
    expect(gallerySection.refsOf({ images: "x" })).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
  });
});

describe("gallery copy const (07-22)", () => {
  it("is the string the validator throws", () => {
    expect(GALLERY_MAX_COPY).toBe(
      "A gallery holds up to 200 photos. Start a second gallery for more.",
    );
    const images = Array.from({ length: 201 }, (_, i) => ({
      id: `i${i}`,
      asset: "abc",
    }));
    expect(msg(() => validateGalleryContent({ images }))).toBe(
      GALLERY_MAX_COPY,
    );
  });
});

describe("parseGalleryPages (07-22; T-07-22-01)", () => {
  it("keeps valid g<id> integers and drops the rest", () => {
    expect(
      parseGalleryPages({
        gabc123: "2",
        gx: ["3", "4"],
        q: "1",
        "g../x": "2",
        gdef: "0",
        gghi: "abc",
        gjkl: "99999",
      }),
    ).toEqual({ abc123: 2, x: 3 });
  });

  it("keeps only the first 20 g* keys", () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < 30; i++) params[`gk${i}`] = "2";
    const out = parseGalleryPages(params);
    expect(Object.keys(out)).toHaveLength(20);
    expect(out.gk0).toBeUndefined();
    expect(out.k0).toBe(2);
    expect(out.k19).toBe(2);
    expect(out.k20).toBeUndefined();
  });

  it("never throws on junk and returns a frozen object", () => {
    for (const v of [null, undefined, 3, "g1=2", [], true]) {
      expect(parseGalleryPages(v)).toEqual({});
    }
    expect(Object.isFrozen(parseGalleryPages({ ga: "2" }))).toBe(true);
    const proto = Object.create({ ginherited: "2" }) as object;
    expect(parseGalleryPages(proto)).toEqual({});
  });

  it("accepts the maximum 999 and refuses 1000", () => {
    expect(parseGalleryPages({ ga: "999", gb: "1000" })).toEqual({ a: 999 });
  });
});

describe("sliceGalleryPage (07-22)", () => {
  const ten = Array.from({ length: 10 }, (_, i) => i);
  it("slices the requested page", () => {
    expect(sliceGalleryPage(ten, 4, 3)).toEqual({
      items: [8, 9],
      page: 3,
      pages: 3,
    });
  });
  it("clamps out-of-range pages and defaults to page 1", () => {
    expect(sliceGalleryPage(ten, 4, 9).page).toBe(3);
    expect(sliceGalleryPage(ten, 4, 0).page).toBe(1);
    expect(sliceGalleryPage(ten, 4)).toEqual({
      items: [0, 1, 2, 3],
      page: 1,
      pages: 3,
    });
  });
  it("handles no items", () => {
    expect(sliceGalleryPage([], 12, 4)).toEqual({
      items: [],
      page: 1,
      pages: 1,
    });
  });
});
