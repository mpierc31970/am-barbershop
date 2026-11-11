// Pagination (07-22; CONT-22, CONT-37; 07-UI-SPEC "Pagination").
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pagination, paginationWindow } from "./Pagination";

const href = (n: number) => `?p=${n}`;

describe("paginationWindow", () => {
  it("shows nothing for one page and every page up to 7", () => {
    expect(paginationWindow(1, 1)).toEqual([]);
    expect(paginationWindow(1, 0)).toEqual([]);
    expect(paginationWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps at most 7 entries with gaps", () => {
    expect(paginationWindow(5, 12)).toEqual([1, "…", 4, 5, 6, "…", 12]);
    expect(paginationWindow(1, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]);
    expect(paginationWindow(12, 12)).toEqual([1, "…", 8, 9, 10, 11, 12]);
    for (let c = 1; c <= 40; c++) {
      expect(paginationWindow(c, 40).length).toBeLessThanOrEqual(7);
      expect(paginationWindow(c, 40)).toContain(c);
    }
  });
});

describe("Pagination markup", () => {
  it("renders nothing for a single page", () => {
    expect(
      renderToStaticMarkup(
        <Pagination
          label="Gallery pages"
          current={1}
          total={1}
          hrefFor={href}
        />,
      ),
    ).toBe("");
  });

  it("labels the nav, marks the current page and links the others", () => {
    const out = renderToStaticMarkup(
      <Pagination label="Gallery pages" current={2} total={3} hrefFor={href} />,
    );
    expect(out).toContain('<nav aria-label="Gallery pages"');
    expect(out).toContain("tabular-nums");
    expect(out).toMatch(
      /<span aria-current="page"[^>]*font-semibold[^>]*decoration-2/,
    );
    expect(out).not.toMatch(/<a[^>]*aria-current/);
    expect(out).toContain('<a href="?p=1" aria-label="Page 1"');
    expect(out).toContain('<a href="?p=3" aria-label="Page 3"');
    expect(out).toContain("Page 2 of 3");
    expect(out).toContain("min-h-11 min-w-11");
    expect(out).toContain("text-site-primary");
  });

  it("disables Previous on page 1 and Next on the last page", () => {
    const first = renderToStaticMarkup(
      <Pagination label="Gallery pages" current={1} total={3} hrefFor={href} />,
    );
    expect(first).toMatch(/<span aria-disabled="true"[^>]*>.*Previous/);
    expect(first).toMatch(/<a href="\?p=2"[^>]*>Next/);
    const last = renderToStaticMarkup(
      <Pagination
        label="Search results pages"
        current={3}
        total={3}
        hrefFor={href}
      />,
    );
    expect(last).toContain('aria-label="Search results pages"');
    expect(last).toMatch(/<span aria-disabled="true"[^>]*>Next/);
    expect(last).toMatch(/<a href="\?p=2"[^>]*>.*Previous/);
  });

  it("hides the ellipsis from assistive tech", () => {
    const out = renderToStaticMarkup(
      <Pagination
        label="Gallery pages"
        current={6}
        total={12}
        hrefFor={href}
      />,
    );
    expect(out).toMatch(
      /<li aria-hidden="true"[^>]*text-site-text-muted[^>]*>…<\/li>/,
    );
  });
});
