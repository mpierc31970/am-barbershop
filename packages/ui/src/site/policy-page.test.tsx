// 09-22: the themed tenant policy page body (AGR-08; D217, D-UI-P9-8; invariant 7).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyPage } from "./PolicyPage";

const HTML =
  '<h2>Who we are</h2><p>We are Rivera.</p><h3>Testimonials</h3><ul><li>Name</li></ul><p><a href="mailto:hi@rivera.test">hi@rivera.test</a></p>';

describe("PolicyPage", () => {
  const html = renderToStaticMarkup(
    <PolicyPage
      title="Privacy policy"
      lastUpdatedLabel="8 Oct 2026"
      html={HTML}
      draft
    />,
  );

  it("renders exactly one h1 with the title", () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Privacy policy<\/h1>/);
  });

  it("shows the Last updated line and the Draft box", () => {
    expect(html).toContain("Last updated 8 Oct 2026");
    expect(html).toContain(
      "Draft: this page is a starting template and has not been reviewed by a lawyer.",
    );
    expect(html).toContain('role="note"');
  });

  it("keeps the body's h2/h3 and the mailto link", () => {
    expect(html).toContain("<h2>Who we are</h2>");
    expect(html).toContain("<h3>Testimonials</h3>");
    expect(html).toContain('href="mailto:hi@rivera.test"');
  });

  it("omits the Draft box once the template is final", () => {
    const out = renderToStaticMarkup(
      <PolicyPage
        title="Terms"
        lastUpdatedLabel="8 Oct 2026"
        html="<p>x</p>"
        draft={false}
      />,
    );
    expect(out).not.toContain("Draft:");
    expect(out).toMatch(/<h1[^>]*>Terms<\/h1>/);
  });

  it("is a server component painted only from --site-* roles", () => {
    const src = readFileSync(
      join(import.meta.dirname, "PolicyPage.tsx"),
      "utf8",
    );
    expect(src).not.toContain('"use client"');
    expect(src).not.toMatch(/hub-|#[0-9A-Fa-f]{6}/);
  });
});
