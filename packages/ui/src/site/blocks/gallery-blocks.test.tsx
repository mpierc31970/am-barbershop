// Gallery + logo strip public renderers (07-22; CONT-22, CONT-27, CONT-33, CONT-35;
// T-07-22-02, -03, -04).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defaultGalleryContent,
  defaultLogoStripContent,
  type GalleryContent,
  type LogoStripContent,
} from "@cds/core/content";
import type { CoreBoundData, ResolvedMedia } from "../types";
import { GallerySection } from "./GallerySection";
import { LogoStripSection } from "./LogoStripSection";
import {
  galleryPageHref,
  galleryPhotos,
  gallerySizes,
  gridColumnsClass,
} from "./gallery-view";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const NOW = new Date("2026-10-01T12:00:00.000Z");

function asset(id: string, over: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    id,
    kind: "image",
    src: `/_media/${id}/w960.webp`,
    srcSet: `/_media/${id}/w480.webp 480w, /_media/${id}/w960.webp 960w`,
    width: 1200,
    height: 900,
    alt: `Library ${id}`,
    ...over,
  };
}

function mediaFor(n: number): Record<string, ResolvedMedia> {
  const out: Record<string, ResolvedMedia> = {};
  for (let i = 1; i <= n; i++) out[`m${i}`] = asset(`m${i}`);
  return out;
}

function gallery(
  n: number,
  over: Partial<GalleryContent> = {},
): GalleryContent {
  return {
    ...defaultGalleryContent(),
    images: Array.from({ length: n }, (_, i) => ({
      id: `img${i + 1}`,
      asset: `m${i + 1}`,
      alt: i === 2 ? "Loaves cooling" : "",
      alt_reviewed: true,
      caption: i === 0 ? "First caption" : "",
    })),
    ...over,
  };
}

function renderGallery(
  content: GalleryContent,
  coreData: Partial<CoreBoundData> = {},
  extra: { isFirst?: boolean; sectionId?: string } = {},
) {
  return html(
    <GallerySection
      content={content}
      layout="full"
      background="main"
      isH1Owner={false}
      isFirst={extra.isFirst ?? false}
      now={NOW}
      sectionId={extra.sectionId ?? "sec1"}
      coreData={{ media: mediaFor(20), ...coreData }}
    />,
  );
}

describe("gallery-view", () => {
  it("galleryPhotos keeps resolvable images in order, alt falls back to the library", () => {
    const media = mediaFor(3);
    media.m2 = asset("m2", { deleted: true });
    media.m3 = asset("m3", { kind: "video" });
    const photos = galleryPhotos(
      {
        images: [
          { id: "a", asset: "m1", alt: " ", alt_reviewed: true, caption: "" },
          {
            id: "b",
            asset: "m2",
            alt: "Mine",
            alt_reviewed: true,
            caption: "c",
          },
          { id: "c", asset: "m3", alt: "", alt_reviewed: true, caption: "" },
          {
            id: "d",
            asset: "missing",
            alt: "",
            alt_reviewed: true,
            caption: "",
          },
        ],
      },
      media,
    );
    expect(photos.map((p) => [p.id, p.index, p.alt, p.caption])).toEqual([
      ["a", 0, "Library m1", ""],
      ["b", 1, "Mine", "c"],
    ]);
  });

  it("galleryPageHref builds stable links and keeps other galleries' pages", () => {
    expect(galleryPageHref("abc", 2, {})).toBe("?gabc=2#gallery-abc");
    expect(galleryPageHref("abc", 1, { abc: 3 })).toBe("#gallery-abc");
    expect(galleryPageHref("abc", 1, { zed: 2, abc: 3 })).toBe(
      "?gzed=2#gallery-abc",
    );
    expect(galleryPageHref("m", 3, { zed: 2, a: 4 })).toBe(
      "?ga=4&gm=3&gzed=2#gallery-m",
    );
    expect(galleryPageHref("abc", 1, {})).not.toContain("?#");
  });

  it("column classes are static strings; sizes follow the columns", () => {
    expect(gridColumnsClass(2)).toBe("grid-cols-2");
    expect(gridColumnsClass(6)).toBe(
      "grid-cols-2 md:grid-cols-4 lg:grid-cols-6",
    );
    expect(gridColumnsClass(99)).toBe(gridColumnsClass(3));
    expect(gallerySizes(4)).toContain("264px");
  });
});

describe("GallerySection", () => {
  it("renders nothing without usable photos (defaults, missing media)", () => {
    expect(renderGallery(defaultGalleryContent())).toBe("");
    expect(renderGallery(gallery(2), { media: {} })).toBe("");
  });

  it("grid: pages from galleryPages, labelled pagination, image attributes", () => {
    const out = renderGallery(gallery(14, { per_page: 12, lightbox: false }), {
      galleryPages: { sec1: 2 },
    });
    expect(out.match(/<img /g)).toHaveLength(2);
    expect(out).toContain('id="gallery-sec1"');
    expect(out).toContain('<nav aria-label="Gallery pages"');
    expect(out).toContain('href="#gallery-sec1"');
    expect(out).toMatch(/<span aria-current="page"[^>]*>.*2<\/span>/);
    expect(out).toContain('width="1200"');
    expect(out).toContain('height="900"');
    expect(out).toContain("srcSet=");
    expect(out).toContain('sizes="');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain('loading="eager"');
    expect(out).toContain("aspect-[4/3]");
    expect(out).toContain("object-cover");
    expect(out).toContain('alt="Library m13"');
  });

  it("grid: first photo eager only when the block is first, page 1", () => {
    const out = renderGallery(
      gallery(3, { lightbox: false }),
      {},
      { isFirst: true },
    );
    expect(out.match(/loading="eager"/g)).toHaveLength(1);
    expect(out).toContain('fetchPriority="high"');
  });

  it("junk page numbers fall back safely", () => {
    const out = renderGallery(gallery(14, { lightbox: false }), {
      galleryPages: { sec1: 999 },
    });
    expect(out.match(/<img /g)).toHaveLength(2);
    expect(out).toContain('href="#gallery-sec1"');
  });

  it("captions only when on, as text", () => {
    const hostile = gallery(2, { lightbox: false });
    hostile.images[0].caption = '<img src=x onerror="alert(1)">';
    expect(renderGallery(hostile)).not.toContain("<figcaption");
    const on = renderGallery({ ...hostile, show_captions: true });
    expect(on).toContain("<figcaption");
    expect(on).toContain("text-site-text-muted");
    expect(on).toContain("&lt;img src=x onerror=");
    expect(on).not.toContain("<img src=x");
  });

  it("lightbox on: named photo buttons counted across the gallery", () => {
    const out = renderGallery(gallery(14), { galleryPages: { sec1: 1 } });
    expect(out).toContain('aria-label="Open photo 3 of 14: Loaves cooling"');
    expect(
      out.match(/<button type="button" data-gallery-photo=""/g),
    ).toHaveLength(12);
    expect(out).toContain('aria-label="Photo viewer"');
    expect(out).toContain('alt=""');
    const p2 = renderGallery(gallery(14), { galleryPages: { sec1: 2 } });
    expect(p2).toContain('aria-label="Open photo 13 of 14: Library m13"');
    expect(p2).toContain('data-index="0"');
  });

  it("lightbox off: plain figures, no buttons, no island", () => {
    const out = renderGallery(gallery(3, { lightbox: false }));
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Photo viewer");
    expect(out).toContain("<figure>");
  });

  it("mosaic: justified rows with flex-grow and aspect ratio, a spacer, no 4:3 crop", () => {
    const out = renderGallery(
      gallery(5, { display: "mosaic", lightbox: false }),
    );
    expect(out).toContain("data-gallery-mosaic");
    expect(out).toMatch(
      /style="flex-grow:1\.333\d*;--gallery-aspect:1\.333\d*;--gallery-ratio:1200 \/ 900"/,
    );
    expect(out).toContain("[aspect-ratio:var(--gallery-ratio)]");
    expect(out).toContain("data-gallery-spacer");
    expect(out).toContain("max-md:contents");
    expect(out).toContain("max-md:h-40");
    expect(out).not.toContain("aspect-[4/3]");
  });

  it("slider: every photo a slide, no pagination, contain frame, noscript view", () => {
    const out = renderGallery(
      gallery(14, { display: "slider", lightbox: false }),
    );
    expect(out).toContain("data-cds-slider");
    expect(out.match(/data-slide=/g)).toHaveLength(14);
    expect(out).not.toContain("Gallery pages");
    expect(out).toContain("aspect-[3/2]");
    expect(out).toContain("object-contain");
    expect(out).toContain("bg-site-surface-raised");
    expect(out).toContain(
      "<noscript><style>[data-gallery-slider] [data-cds-slider]",
    );
  });

  it("heading is an h2 named by the section; never an h1 in any mode", () => {
    for (const display of ["grid", "mosaic", "slider"] as const) {
      const out = renderGallery(gallery(3, { display, heading: "Our work" }));
      expect(out).toContain('<h2 id="gallery-heading-sec1"');
      expect(out).not.toContain("<h1");
    }
  });

  it("soft-deleted media keeps showing (D275)", () => {
    const out = renderGallery(gallery(1, { lightbox: false }), {
      media: { m1: asset("m1", { deleted: true }) },
    });
    expect(out).toContain("/_media/m1/w960.webp");
  });
});

function strip(over: Partial<LogoStripContent> = {}): LogoStripContent {
  return {
    ...defaultLogoStripContent(),
    logos: [
      { id: "l1", asset: "m1", name: "Acme", link: "https://acme.example/" },
      { id: "l2", asset: "m2", name: "Beta", link: "" },
      { id: "l3", asset: "gone", name: "Gone", link: "" },
      { id: "l4", asset: "m3", name: "Evil", link: "javascript:alert(1)" },
    ],
    ...over,
  };
}

function renderStrip(content: LogoStripContent, media = mediaFor(3)) {
  return html(
    <LogoStripSection
      content={content}
      layout="full"
      background="main"
      isH1Owner={false}
      isFirst={false}
      now={NOW}
      sectionId="sec9"
      coreData={{ media }}
    />,
  );
}

describe("LogoStripSection", () => {
  it("renders nothing without usable logos", () => {
    expect(renderStrip(defaultLogoStripContent())).toBe("");
    expect(renderStrip(strip(), {})).toBe("");
  });

  it("a centered wrapping list of named, size-capped logos", () => {
    const out = renderStrip(strip());
    expect(out).toContain(
      "flex flex-wrap items-center justify-center gap-8 md:gap-12",
    );
    expect(out).toContain('alt="Acme"');
    expect(out).toContain('alt="Beta"');
    expect(out).not.toContain("Gone");
    expect(out).toContain("max-h-12");
    expect(out).toContain("max-w-[160px]");
    expect(out).toContain("object-contain");
    expect(out).toContain('sizes="160px"');
    expect(out).not.toContain("grayscale");
    expect(out).not.toContain("<h2");
    expect(out).not.toContain("<h1");
  });

  it("links only safe addresses, with rel=noopener", () => {
    const out = renderStrip(strip());
    expect(out).toContain('<a href="https://acme.example/" rel="noopener"');
    expect(out).not.toContain("javascript:");
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("greyscale and a heading when chosen", () => {
    const out = renderStrip(strip({ grayscale: true, heading: "As seen in" }));
    expect(out).toContain(" grayscale");
    expect(out).toContain('<h2 id="logo-strip-heading-sec9"');
    expect(out).toContain('aria-labelledby="logo-strip-heading-sec9"');
  });
});
