// SiteThemeScope render contract (THEME-02, D-UI-P4-10; T-04-34). node unit project,
// renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteThemeScope } from "./SiteThemeScope";

const css = '[data-site][data-theme="3f9a1c2e"]{--site-primary:#1f3fcc;}';

describe("SiteThemeScope", () => {
  it("carries data-site and data-theme, with the theme <style> first", () => {
    const out = renderToStaticMarkup(
      <SiteThemeScope
        theme={{ hash: "3f9a1c2e", css }}
        lang="en"
        className="min-h-screen"
      >
        <p>child</p>
      </SiteThemeScope>,
    );
    expect(out).toMatch(
      /^<div data-site="" data-theme="3f9a1c2e" class="min-h-screen" lang="en"><style>/,
    );
    expect(out).toContain("--site-primary:#1f3fcc");
    expect(out.indexOf("</style>")).toBeLessThan(out.indexOf("<p>child</p>"));
  });

  it('renders a span with as="span"', () => {
    const out = renderToStaticMarkup(
      <SiteThemeScope theme={{ hash: "3f9a1c2e", css }} as="span" />,
    );
    expect(out).toMatch(/^<span data-site="" data-theme="3f9a1c2e"/);
    expect(out).toMatch(/<\/span>$/);
  });

  it("neutralizes a hash that is not 8 lowercase hex", () => {
    for (const hash of ['x"><script>', "3F9A1C2E", "3f9a1c2", "3f9a1c2e0"]) {
      const out = renderToStaticMarkup(
        <SiteThemeScope theme={{ hash, css: "" }} />,
      );
      expect(out).toContain('data-theme="00000000"');
      expect(out).not.toContain("<script>");
    }
  });

  it("passes inert through", () => {
    const out = renderToStaticMarkup(
      <SiteThemeScope theme={{ hash: "3f9a1c2e", css }} inert />,
    );
    expect(out).toContain("inert");
  });
});
