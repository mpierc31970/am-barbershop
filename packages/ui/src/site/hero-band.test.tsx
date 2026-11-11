// @vitest-environment jsdom
// 08-03 (R-3, D-UI-P8-6, D-UI-P8-9): the hero renders a media-library photo as the eager
// LCP image, its H1 is balanced, and same-band neighbours are adjacent `data-band`
// siblings so the globals.css rule gives them one shared gap.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  type BackgroundVariant,
  type HeroContent,
  type PublishedPage,
  type PublishedSection,
} from "@cds/core/content";
import { HeroSection } from "./HeroSection";
import { PageRenderer } from "./PageRenderer";
import type { CoreBoundData, ResolvedMedia } from "./types";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NOW = new Date("2026-10-01T12:00:00.000Z");

function dom(node: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}

const ASSET: ResolvedMedia = {
  id: "a1",
  kind: "image",
  src: "/_media/a1/1280",
  srcSet: "/_media/a1/640 640w, /_media/a1/1280 1280w",
  width: 1280,
  height: 853,
  alt: "",
};

function hero(
  content: HeroContent,
  media: Record<string, ResolvedMedia>,
  isFirst = true,
): HTMLElement {
  const coreData: CoreBoundData = { media };
  return dom(
    <HeroSection
      content={content}
      layout="full"
      background="main"
      isH1Owner
      isFirst={isFirst}
      now={NOW}
      coreData={coreData}
    />,
  );
}

describe("hero image_asset (R-3)", () => {
  it("renders the resolved asset as the eager LCP image", () => {
    const host = hero(
      { heading: "Rivera Bakery", image_asset: "a1", image_alt: "Fresh bread" },
      { a1: ASSET },
    );
    const imgs = host.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    const img = imgs[0]!;
    expect(img.getAttribute("src")).toBe("/_media/a1/1280");
    expect(img.getAttribute("srcset")).toBe(ASSET.srcSet);
    expect(img.getAttribute("alt")).toBe("Fresh bread");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.getAttribute("width")).toBe("1280");
    expect(img.getAttribute("height")).toBe("853");
  });

  it("is lazy when not the first block", () => {
    const img = hero(
      { heading: "H", image_asset: "a1", image_alt: "x" },
      { a1: ASSET },
      false,
    ).querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.hasAttribute("fetchpriority")).toBe(false);
  });

  it("falls back to image_url when the asset is deleted or missing", () => {
    const content: HeroContent = {
      heading: "H",
      image_asset: "a1",
      image_url: "https://example.com/x.jpg",
      image_alt: "x",
    };
    const deleted = hero(content, { a1: { ...ASSET, deleted: true } });
    expect(deleted.querySelector("img")!.getAttribute("src")).toBe(
      "https://example.com/x.jpg",
    );
    const missing = hero(content, {});
    expect(missing.querySelector("img")!.getAttribute("src")).toBe(
      "https://example.com/x.jpg",
    );
  });

  it("renders no image when the asset is gone and there is no address", () => {
    const host = hero(
      { heading: "H", image_asset: "a1", image_alt: "x" },
      { a1: { ...ASSET, deleted: true } },
    );
    expect(host.querySelector("img")).toBeNull();
  });

  it("falls back to the media-library alt when the stored alt is blank (WR-C05)", () => {
    const described = { ...ASSET, alt: "Loaves on the counter" };
    const fallback = hero(
      { heading: "H", image_asset: "a1", image_alt: "" },
      { a1: described },
    ).querySelector("img")!;
    expect(fallback.getAttribute("alt")).toBe("Loaves on the counter");
    const stored = hero(
      { heading: "H", image_asset: "a1", image_alt: "Fresh bread" },
      { a1: described },
    ).querySelector("img")!;
    expect(stored.getAttribute("alt")).toBe("Fresh bread");
    // A plain image_url hero has no library description to borrow.
    const plain = hero(
      { heading: "H", image_url: "https://example.com/x.jpg", image_alt: "" },
      { a1: described },
    ).querySelector("img")!;
    expect(plain.getAttribute("alt")).toBe("");
  });

  it("balances the hero heading (D-UI-P8-9)", () => {
    const h1 = hero({ heading: "Rivera Bakery" }, {}).querySelector("h1")!;
    expect(h1.className.split(/\s+/)).toContain("text-balance");
  });
});

describe("band rhythm (D-UI-P8-6)", () => {
  it("band sections are adjacent siblings carrying data-band", () => {
    const bands: BackgroundVariant[] = [
      "main",
      "main",
      "alternate",
      "alternate",
      "main",
    ];
    const sections: PublishedSection[] = bands.map((b, i) => ({
      id: `s${i}`,
      // A Hero first, so no PageTitleHeader band sits above the five.
      section_type: i === 0 ? "hero" : "text-only",
      row_layout: "full",
      content:
        i === 0
          ? { heading: "Welcome" }
          : { heading: `Block ${i}`, text: "<p>t</p>" },
      settings: { background_variant: b },
    }));
    const page: PublishedPage = {
      version: 1,
      page: {
        id: "p1",
        slug: "home",
        title: "Home",
        seo: {},
        password_protected: false,
      },
      sections,
      published_at: NOW.toISOString(),
    };
    const host = dom(
      <PageRenderer
        page={page}
        registry={registry}
        now={NOW}
        coreData={{ media: {} }}
      />,
    );
    const banded = [...host.querySelectorAll("[data-band]")];
    expect(banded.map((el) => el.getAttribute("data-band"))).toEqual(bands);
    for (let i = 0; i < banded.length - 1; i++) {
      expect(banded[i]!.nextElementSibling).toBe(banded[i + 1]);
    }
    // The CSS rule applies exactly to the 2nd and 4th (same band as the previous one).
    const sameAsPrev = banded.filter((el) => {
      const prev = el.previousElementSibling;
      return (
        prev !== null &&
        prev.getAttribute("data-band") === el.getAttribute("data-band")
      );
    });
    expect(sameAsPrev).toEqual([banded[1], banded[3]]);
  });
});
