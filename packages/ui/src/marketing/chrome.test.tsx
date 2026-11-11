// Marketing chrome render contract (15-09; 15-UI-SPEC "Header and footer", "Accessibility contract").
// Rendered with react-dom/server in the node unit project: this pins the markup, links and
// landmarks. The mobile menu's behaviour lives in mobile-menu.dom.test.tsx.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MK_COPY } from "@cds/core/marketing";
import { ChipField } from "./ChipField";
import { ComingSoonTag } from "./ComingSoonTag";
import { DraftBadge } from "./DraftBadge";
import { MkButton, MkLinkButton } from "./MkButton";
import { MkFooter } from "./MkFooter";
import { MkHeader } from "./MkHeader";
import { ProseBlock } from "./ProseBlock";
import { RivetMark } from "./RivetMark";
import { Wordmark } from "./Wordmark";

const html = (node: ReactElement) => renderToStaticMarkup(node);

/** Every <a ...> opening tag, in document order. */
const anchors = (markup: string) => markup.match(/<a\b[^>]*>/g) ?? [];

describe("MkHeader", () => {
  const out = html(<MkHeader current={null} />);

  it("renders the skip link as the first link, pointing at #main", () => {
    const first = anchors(out)[0] ?? "";
    expect(first).toContain('href="#main"');
    expect(out).toContain(MK_COPY.HEADER.SKIP);
    expect(out.indexOf("Skip to content")).toBeLessThan(
      out.indexOf("Connections Design Studios home"),
    );
  });

  it("renders the wordmark home link with its accessible name", () => {
    expect(out).toMatch(
      /<a[^>]*aria-label="Connections Design Studios home"[^>]*href="\/"|<a[^>]*href="\/"[^>]*aria-label="Connections Design Studios home"/,
    );
  });

  it("labels the main nav and lists Standard, Studio, Add-ons, Pricing, Work in order", () => {
    expect(out).toContain('aria-label="Main"');
    const hrefs = ["/standard", "/studio", "/add-ons", "/pricing", "/work"];
    const at = hrefs.map((h) => out.indexOf(`href="${h}"`));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("links Sign in to /sign-in and Start your site to /start", () => {
    expect(out).toMatch(/href="\/sign-in"[^>]*>Sign in</);
    expect(out).toContain('href="/start"');
    expect(out).toContain("Start your site");
    // < 1024px: the short Start keeps the full accessible name
    expect(out).toMatch(
      /aria-label="Start your site"[^>]*>|href="\/start"[^>]*aria-label="Start your site"/,
    );
  });

  it("renders the no-JS menu fallback to #footer-nav", () => {
    expect(out).toContain('href="#footer-nav"');
  });

  it("marks no nav item current when current is null", () => {
    expect(out).not.toContain('aria-current="page"');
  });

  it.each([
    ["standard", "/standard"],
    ["studio", "/studio"],
    ["add-ons", "/add-ons"],
    ["pricing", "/pricing"],
    ["work", "/work"],
  ] as const)("sets aria-current on %s only", (current, href) => {
    const m = html(<MkHeader current={current} />);
    const currentLinks = anchors(m).filter((a) =>
      a.includes('aria-current="page"'),
    );
    expect(currentLinks.length).toBeGreaterThanOrEqual(1);
    for (const a of currentLinks) expect(a).toContain(`href="${href}"`);
  });

  it("uses the path chip for the current underline on /standard and /studio, ink elsewhere", () => {
    expect(html(<MkHeader current="standard" />)).toContain(
      "decoration-mk-cobalt",
    );
    expect(html(<MkHeader current="studio" />)).toContain(
      "decoration-mk-berry",
    );
    const pricing = html(<MkHeader current="pricing" />);
    expect(pricing).toContain("decoration-mk-ink");
    expect(pricing).not.toContain("decoration-mk-cobalt");
  });
});

describe("MkFooter", () => {
  const out = html(<MkFooter year={2031} />);

  it("is the ink back cover with the footer nav id", () => {
    expect(out).toMatch(/<footer[^>]*data-mk-field="ink"/);
    expect(out).toMatch(
      /<nav[^>]*id="footer-nav"[^>]*aria-label="Footer"|<nav[^>]*aria-label="Footer"[^>]*id="footer-nav"/,
    );
  });

  it("renders the Platform, CDS and Rules columns with every link", () => {
    for (const col of MK_COPY.FOOTER.COLUMNS) {
      expect(out).toContain(`>${col.title}<`);
      for (const l of col.links) expect(out).toContain(`href="${l.href}"`);
    }
    expect(out).toContain('href="/legal/terms-of-service"');
    expect(out).toContain('href="/report"');
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/independent-pros"');
  });

  it("renders the pitch line, the year prop and Sign in", () => {
    expect(out).toContain("No platform cut on your own gateway.");
    expect(out).toContain("© 2031 Connections Design Studios");
    expect(out).toMatch(/href="\/sign-in"[^>]*>Sign in</);
  });
});

describe("primitives", () => {
  it("DraftBadge renders nothing unless show is true", () => {
    expect(html(<DraftBadge show={false} />)).toBe("");
    expect(html(<DraftBadge show />)).toContain(">DRAFT<");
  });

  it("ComingSoonTag reads Coming soon", () => {
    expect(html(<ComingSoonTag />)).toContain(">Coming soon<");
  });

  it("ChipField sets data-mk-field and the element", () => {
    const out = html(
      <ChipField field="cobalt" as="div" id="x">
        hi
      </ChipField>,
    );
    expect(out).toMatch(/^<div[^>]*data-mk-field="cobalt"/);
    expect(out).toContain('id="x"');
    expect(html(<ChipField field="marigold">x</ChipField>)).toMatch(
      /^<section[^>]*data-mk-field="marigold"/,
    );
  });

  it("ProseBlock is a 68ch column", () => {
    expect(html(<ProseBlock>text</ProseBlock>)).toContain("max-w-[68ch]");
  });

  it("RivetMark is decorative, with a leaf fill option", () => {
    expect(html(<RivetMark />)).toContain('aria-hidden="true"');
    expect(html(<RivetMark fill="leaf" />)).toContain("bg-mk-leaf");
  });

  it("Wordmark renders CDS, the full name for >= 640px and both tones", () => {
    const ink = html(<Wordmark tone="ink" />);
    expect(ink).toContain(">CDS<");
    expect(ink).toContain("Connections Design Studios</span>");
    expect(ink).toContain("[font-stretch:125%]");
    expect(html(<Wordmark tone="white" />)).toContain("text-mk-card");
  });

  it("MkButton variants and sizes use field action vars", () => {
    const p = html(<MkButton>Send</MkButton>);
    expect(p).toMatch(/^<button[^>]*type="button"/);
    expect(p).toContain("bg-mk-action-bg");
    expect(p).toContain("text-mk-action-fg");
    expect(p).toContain("min-h-11");
    expect(html(<MkButton size="lg">Go</MkButton>)).toContain("min-h-[52px]");
    expect(html(<MkButton variant="secondary">Go</MkButton>)).toContain(
      "border-mk-fg",
    );
    expect(html(<MkButton variant="text">Go</MkButton>)).toContain("underline");
  });

  it("MkLinkButton links, adds the arrow after the words, and new-tab links say so", () => {
    const a = html(
      <MkLinkButton href="/start" icon="arrow">
        Start your site
      </MkLinkButton>,
    );
    expect(a).toContain('href="/start"');
    expect(a.indexOf("Start your site")).toBeLessThan(a.indexOf("<svg"));
    const ext = html(
      <MkLinkButton href="https://example.com" external variant="secondary">
        See the demo
      </MkLinkButton>,
    );
    expect(ext).toContain('target="_blank"');
    expect(ext).toContain('rel="noopener"');
    expect(ext).toContain("(opens in a new tab)");
  });
});
