// Column item render contract (CONT-09, CONT-11 markup side, CONT-32; D188; T-03-25,
// T-03-26; 03-UI-SPEC "Buttons", "Image item", "List item", "Spacer", "Divider").
// Ported from donor column-item-renderer.test.ts, rewritten as render tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COLUMN_ITEM_KINDS, type ColumnItem } from "@cds/core/content";
import { ColumnItemRenderer, columnImageSizes } from "./ColumnItemRenderer";
import { SiteButton } from "./SiteButton";
import * as site from "./index";
import * as siteClient from "./client/index";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SOURCE = readFileSync(
  join(import.meta.dirname, "ColumnItemRenderer.tsx"),
  "utf8",
);
const render = (item: ColumnItem, extra: { eagerImage?: boolean } = {}) =>
  renderToStaticMarkup(<ColumnItemRenderer item={item} now={NOW} {...extra} />);

describe("rich text (CONT-09: server-sanitized HTML, not plain text)", () => {
  it("strips a script and keeps the paragraph inside .site-prose", () => {
    const out = render({
      id: "t",
      kind: "text",
      html: "<p>hi<script>x()</script></p>",
    });
    expect(out).toBe('<div class="site-prose"><p>hi</p></div>');
  });

  it("drops event handlers, styles and links even when stored content bypassed validation", () => {
    const out = render({
      id: "t",
      kind: "text",
      html: '<p onclick="x()" style="color:red"><a href="javascript:alert(1)">go</a><img src=x onerror=alert(1)></p>',
    });
    expect(out).not.toMatch(/onclick|onerror|style=|javascript|<a|<img/i);
    expect(out).toContain("go");
  });

  it("renders nothing for empty rich text", () => {
    expect(render({ id: "t", kind: "text", html: "" })).toBe("");
  });

  it("sanitizes in the renderer source (defence in depth)", () => {
    expect(SOURCE).toContain("sanitizeRichText(");
  });
});

describe("headings", () => {
  it("renders level 2 as h2 and level 3 as h3", () => {
    expect(render({ id: "h", kind: "heading", text: "A", level: 2 })).toMatch(
      /^<h2[^>]*>A<\/h2>$/,
    );
    expect(render({ id: "h", kind: "heading", text: "B", level: 3 })).toMatch(
      /^<h3[^>]*>B<\/h3>$/,
    );
  });

  it("promotes to h1 only through headingLevelOverride", () => {
    const out = renderToStaticMarkup(
      <ColumnItemRenderer
        item={{ id: "h", kind: "heading", text: "Top", level: 3 }}
        headingLevelOverride={1}
        now={NOW}
      />,
    );
    expect(out).toMatch(/^<h1[^>]*>Top<\/h1>$/);
  });

  it("renders nothing for a blank heading", () => {
    expect(render({ id: "h", kind: "heading", text: "  ", level: 2 })).toBe("");
  });
});

describe("image item", () => {
  const img: ColumnItem = {
    id: "i",
    kind: "image",
    url: "https://img.example/a.jpg",
    alt: "A room",
  };

  it("renders a plain <img> with alt, async decoding and lazy loading", () => {
    const out = render(img);
    expect(out).toMatch(/^<img /);
    expect(out).toContain('alt="A room"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain("rounded-site-media");
  });

  it("loads eagerly with high priority when eagerImage", () => {
    const out = render(img, { eagerImage: true });
    expect(out).toContain('loading="eager"');
    expect(out).toMatch(/fetchpriority="high"/i);
  });

  it("drops an unsafe src rather than rendering it", () => {
    expect(render({ ...img, url: "javascript:alert(1)" } as ColumnItem)).toBe(
      "",
    );
    expect(
      render({ ...img, url: "data:image/png;base64,AAAA" } as ColumnItem),
    ).toBe("");
  });

  it("never uses the Next image component", () => {
    expect(SOURCE).not.toMatch(/from ["']next\//);
  });
});

describe("buttons (CONT-11 markup side, T-03-26)", () => {
  it("a link button renders <a href> with the stored link", () => {
    const out = render({
      id: "b",
      kind: "button",
      text: "Book",
      link: "/book",
      style: "primary",
      action: "link",
      popup_id: "",
    });
    expect(out).toContain('<a href="/book"');
    expect(out).toContain("bg-site-primary");
    expect(out).toContain("min-h-12");
  });

  it("a pop-up button renders <button type=button aria-haspopup=dialog data-cds-popup-open>", () => {
    const out = render({
      id: "b",
      kind: "button",
      text: "Join",
      link: "",
      style: "secondary",
      action: "popup",
      popup_id: "pop_123",
    });
    expect(out).toMatch(/<button [^>]*type="button"/);
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('data-cds-popup-open="pop_123"');
    expect(out).toContain("border-site-text");
    expect(out).not.toContain("href");
  });

  it("a button for a pop-up that can't open here renders nothing (WR-C07)", () => {
    const popupButton: ColumnItem = {
      id: "b",
      kind: "button",
      text: "Join",
      link: "",
      style: "primary",
      action: "popup",
      popup_id: "pop_gone",
    };
    const none = renderToStaticMarkup(
      <ColumnItemRenderer
        item={popupButton}
        now={NOW}
        openablePopups={new Set(["pop_live"])}
      />,
    );
    expect(none).toBe("");
    const live = renderToStaticMarkup(
      <ColumnItemRenderer
        item={{ ...popupButton, popup_id: "pop_live" }}
        now={NOW}
        openablePopups={new Set(["pop_live"])}
      />,
    );
    expect(live).toContain('data-cds-popup-open="pop_live"');
    // Link buttons are never filtered by the pop-up set.
    const link = renderToStaticMarkup(
      <ColumnItemRenderer
        item={{ ...popupButton, action: "link", link: "/about", popup_id: "" }}
        now={NOW}
        openablePopups={new Set()}
      />,
    );
    expect(link).toContain('href="/about"');
  });

  it("a stored javascript: link (bypassing validation) renders no href", () => {
    const out = render({
      id: "b",
      kind: "button",
      text: "Click",
      link: "javascript:alert(1)",
      style: "primary",
      action: "link",
      popup_id: "",
    });
    expect(out).not.toContain("href");
    expect(out).not.toContain("javascript");
  });

  it("SiteButton refuses a malformed pop-up id", () => {
    const out = renderToStaticMarkup(
      <SiteButton text="x" style="primary" popupId={'"><script>'} />,
    );
    expect(out).toBe("");
  });

  it("SiteButton keeps http(s), mailto and tel links", () => {
    for (const href of [
      "https://a.example/",
      "mailto:a@b.example",
      "tel:+15550100",
    ]) {
      const out = renderToStaticMarkup(
        <SiteButton text="x" style="primary" href={href} />,
      );
      expect(out).toContain(`href="${href}"`);
    }
  });
});

describe("list, spacer, divider", () => {
  it("renders a list as <ul> with one <li> per entry", () => {
    const out = render({ id: "l", kind: "list", items: ["One", "Two", ""] });
    expect(out).toMatch(/^<ul/);
    expect(out.match(/<li>/g)?.length).toBe(2);
  });

  it.each([
    ["sm", "h-6"],
    ["md", "h-12"],
    ["lg", "h-16"],
  ] as const)("spacer %s is %s (24/48/64px)", (height, cls) => {
    const out = render({ id: "s", kind: "spacer", height });
    expect(out).toContain(cls);
    expect(out).toContain('aria-hidden="true"');
  });

  it("renders a divider as <hr> on the rule token", () => {
    const out = render({ id: "d", kind: "divider" });
    expect(out).toMatch(/^<hr /);
    expect(out).toContain("border-site-border");
  });

  it("an unknown kind renders nothing and never throws", () => {
    const out = render({ id: "x", kind: "html" } as unknown as ColumnItem);
    expect(out).toBe("");
  });

  it("handles every ColumnItem kind in the source", () => {
    for (const kind of COLUMN_ITEM_KINDS) {
      expect(SOURCE).toContain(`case "${kind}":`);
    }
  });
});

describe("barrels", () => {
  it("@cds/ui/site exports every server renderer and the core map", () => {
    for (const name of [
      "RowRenderer",
      "ColumnsSection",
      "ColumnItemRenderer",
      "SiteButton",
      "HeroSection",
      "TextImageSection",
      "TextOnlySection",
      "CtaBannerSection",
      "SectionRenderer",
      "PageRenderer",
      "Banner",
      "Countdown",
      "CORE_SECTION_COMPONENTS",
    ]) {
      expect(site, name).toHaveProperty(name);
    }
  });

  it("@cds/ui/site/client exports the countdown island", () => {
    expect(siteClient).toHaveProperty("CountdownIsland");
  });
});

describe("image stock credit (07-30, CONT-28)", () => {
  const base = {
    id: "i1",
    kind: "image" as const,
    url: "https://images.unsplash.com/photo-1",
    alt: "Loaves",
  };

  it("renders a figure with both names linked", () => {
    const out = render({
      ...base,
      credit: {
        name: "Ana Silva",
        url: "https://unsplash.com/@ana?utm_source=cds_platform&utm_medium=referral",
        source: "unsplash",
      },
    });
    expect(out).toMatch(/^<figure><img[^>]*><figcaption/);
    expect(out).toContain('rel="noopener"');
    expect(out).toContain(">Ana Silva</a>");
    expect(out).toContain(">Unsplash</a>");
    expect(out).toContain("text-site-text-muted");
    expect(out).toContain(
      'href="https://unsplash.com/?utm_source=cds_platform&amp;utm_medium=referral"',
    );
  });

  it("is unchanged without a credit, and drops a foreign credit link", () => {
    expect(render(base)).toMatch(/^<img /);
    expect(
      render({
        ...base,
        credit: {
          name: "X",
          url: "https://evil.example/x",
          source: "unsplash",
        },
      }),
    ).toMatch(/^<img /);
  });
});

describe("columnImageSizes", () => {
  it("sizes an image to its column's share of the row", () => {
    expect(columnImageSizes("40-60", 0)).toBe(
      "(min-width: 1120px) 423px, (min-width: 768px) 40vw, 100vw",
    );
    expect(columnImageSizes("full", 0)).toBe(
      "(min-width: 1120px) 1056px, 100vw",
    );
    expect(columnImageSizes("50-50", 5)).toBe(
      "(min-width: 1120px) 1056px, 100vw",
    );
  });
});
