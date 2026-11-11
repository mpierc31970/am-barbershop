// 07-30 Task 1: canonical, robots and page metadata (CONT-13, CONT-14, D170, Pitfall 9).
import { describe, expect, it } from "vitest";
import {
  NOINDEX_PAGE_KINDS,
  absoluteUrl,
  canonicalUrl,
  pageMeta,
  robotsFor,
  slugPathFor,
  type PageMetaInput,
} from "./meta";

describe("canonicalUrl", () => {
  it("uses the primary host; home is /", () => {
    expect(
      canonicalUrl({
        primaryHost: "rivera.com",
        fallbackHost: "rivera.sites.x.com",
        slug: "home",
      }),
    ).toBe("https://rivera.com/");
    expect(
      canonicalUrl({
        primaryHost: "rivera.com",
        fallbackHost: "rivera.sites.x.com",
        slug: "about-us",
      }),
    ).toBe("https://rivera.com/about-us");
  });

  it("falls back to the resolved host without a primary", () => {
    expect(
      canonicalUrl({
        primaryHost: null,
        fallbackHost: "rivera.sites.x.com",
        slug: "about-us",
      }),
    ).toBe("https://rivera.sites.x.com/about-us");
  });

  it("encodes like the tenant route", () => {
    expect(slugPathFor("home")).toBe("/");
    expect(slugPathFor("Café")).toBe(`/${encodeURIComponent("Café")}`);
    expect(slugPathFor("a%2Fb")).toBe("/a%252Fb");
  });
});

describe("robotsFor (D170)", () => {
  it("redirect hosts are noindex, nofollow (14-14, P14-P5)", () => {
    expect(robotsFor({ hostKind: "redirect" })).toEqual({
      index: false,
      follow: false,
    });
  });

  it("preview hosts are noindex, nofollow", () => {
    expect(robotsFor({ hostKind: "preview" })).toEqual({
      index: false,
      follow: false,
    });
  });
  it("custom hosts index builder pages", () => {
    expect(robotsFor({ hostKind: "custom", pageKind: "builder" })).toEqual({
      index: true,
      follow: true,
    });
  });
  it("system pages and protected pages are noindex, follow", () => {
    expect(NOINDEX_PAGE_KINDS).toContain("system-404");
    expect(robotsFor({ hostKind: "custom", pageKind: "system-404" })).toEqual({
      index: false,
      follow: true,
    });
    expect(robotsFor({ hostKind: "custom", protectedPage: true })).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("absoluteUrl", () => {
  it("accepts / paths and http(s) only", () => {
    expect(absoluteUrl("https://a.com", "/x.png")).toBe("https://a.com/x.png");
    expect(absoluteUrl("https://a.com", "https://b.com/y.png")).toBe(
      "https://b.com/y.png",
    );
    expect(absoluteUrl("https://a.com", "javascript:alert(1)")).toBeNull();
    expect(absoluteUrl("https://a.com", "//evil.com/x")).toBeNull();
    expect(absoluteUrl("https://a.com", "/\\evil.com/x")).toBeNull();
    expect(absoluteUrl("https://a.com", " /\\evil.com/x")).toBeNull();
    expect(absoluteUrl("https://a.com", "data:image/png;base64,xx")).toBeNull();
    expect(absoluteUrl("https://a.com", 5)).toBeNull();
  });
});

function input(over: Partial<PageMetaInput> = {}): PageMetaInput {
  return {
    primaryHost: "rivera.com",
    fallbackHost: "rivera.sites.x.com",
    hostKind: "custom",
    slug: "about-us",
    isHome: false,
    pageTitle: "About us",
    seo: {},
    businessName: "Rivera Bakery",
    sections: [
      {
        id: "s",
        section_type: "text-only",
        content: { heading: "", text: "<p>We bake bread daily.</p>" },
      },
    ],
    pageImage: null,
    siteImage: null,
    generatedImage: "/_site/share.png?v=abc",
    ...over,
  };
}

describe("pageMeta (CONT-14)", () => {
  it("falls back to suggestions", () => {
    const m = pageMeta(input());
    expect(m.title).toBe("About us | Rivera Bakery");
    expect(m.description).toBe("We bake bread daily.");
    expect(m.canonical).toBe("https://rivera.com/about-us");
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("prefers the owner's title and description", () => {
    const m = pageMeta(
      input({ seo: { meta_title: "Mine", meta_description: "Desc" } }),
    );
    expect(m.title).toBe("Mine");
    expect(m.description).toBe("Desc");
  });

  it("walks the share image chain", () => {
    const page = {
      src: "/_media/p/w1200.webp",
      width: 1200,
      height: 630,
      alt: "Bread",
    };
    const site = { src: "/_media/s/w1200.webp" };
    expect(
      pageMeta(
        input({
          pageImage: page,
          siteImage: site,
          seo: { og_image: "https://images.unsplash.com/a" },
        }),
      ).image?.url,
    ).toBe("https://rivera.com/_media/p/w1200.webp");
    expect(
      pageMeta(
        input({
          siteImage: site,
          seo: { og_image: "https://images.unsplash.com/a" },
        }),
      ).image?.url,
    ).toBe("https://images.unsplash.com/a");
    expect(pageMeta(input({ siteImage: site })).image?.url).toBe(
      "https://rivera.com/_media/s/w1200.webp",
    );
    const gen = pageMeta(input());
    expect(gen.image).toMatchObject({
      url: "https://rivera.com/_site/share.png?v=abc",
      width: 1200,
      height: 630,
    });
    expect(gen.twitter.card).toBe("summary_large_image");
    expect(gen.openGraph.images).toHaveLength(1);
  });

  it("has no image and a summary card when nothing is available", () => {
    const m = pageMeta(input({ generatedImage: null }));
    expect(m.image).toBeNull();
    expect(m.twitter.card).toBe("summary");
  });

  it("a protected page gets no description or share image (WR-B01)", () => {
    const m = pageMeta(
      input({
        protectedPage: true,
        seo: {
          meta_title: "Members",
          meta_description: "Secret",
          og_image: "https://images.unsplash.com/a",
        },
        pageImage: { src: "/_media/p/w1200.webp" },
        siteImage: { src: "/_media/s/w1200.webp" },
      }),
    );
    expect(m.title).toBe("Members");
    expect(m.description).toBe("");
    expect(m.image).toBeNull();
    expect(m.openGraph.description).toBe("");
    expect(m.openGraph.images).toEqual([]);
    expect(m.twitter).toMatchObject({
      card: "summary",
      description: "",
      images: [],
    });
    expect(m.robots).toEqual({ index: false, follow: true });
    // No owner description: the section text is not suggested either.
    expect(pageMeta(input({ protectedPage: true })).description).toBe("");
  });

  it("preview hosts stay noindex", () => {
    expect(pageMeta(input({ hostKind: "preview" })).robots).toEqual({
      index: false,
      follow: false,
    });
  });
});
