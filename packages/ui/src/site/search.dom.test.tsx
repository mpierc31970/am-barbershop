// @vitest-environment jsdom
// 07-31 (CONT-28; 07-UI-SPEC lines 187, 535-542, 643; T-07-31-03): the search form, results
// and Popular pages, rendered server-side and checked in the DOM.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Pagination,
  PopularPages,
  SearchResults,
  SiteSearchForm,
  paginationWindow,
  searchCountCopy,
  type SearchResultView,
} from "./p7/search";

function dom(el: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(el);
  return host;
}

const results: SearchResultView[] = [
  {
    title: "Sourdough",
    path: "/sourdough",
    kind: null,
    snippet: [
      { text: "Our ", match: false },
      { text: "sourdough", match: true },
      { text: " loaf", match: false },
    ],
  },
  {
    title: "Sourdough workshop",
    path: "/",
    kind: "Service",
    snippet: [{ text: "Three hours", match: false }],
  },
];

describe("SiteSearchForm", () => {
  it("is a labelled role=search GET form to /search", () => {
    const root = dom(<SiteSearchForm defaultValue="rye" />);
    const form = root.querySelector("form")!;
    expect(form.getAttribute("role")).toBe("search");
    expect(form.getAttribute("action")).toBe("/search");
    expect(form.getAttribute("method")).toBe("get");
    const input = form.querySelector<HTMLInputElement>("input")!;
    expect(input.type).toBe("search");
    expect(input.name).toBe("q");
    expect(input.maxLength).toBe(100);
    expect(input.value).toBe("rye");
    expect(input.className).toContain("min-h-12");
    const label = form.querySelector("label")!;
    expect(label.textContent).toBe("Search this site");
    expect(label.getAttribute("for")).toBe(input.id);
    const button = form.querySelector("button")!;
    expect(button.textContent).toBe("Search");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("bg-site-primary");
  });
});

describe("SearchResults", () => {
  it("renders the count, linked titles, URL, kind and marked snippets", () => {
    const root = dom(
      <SearchResults
        query="sourdough"
        total={2}
        results={results}
        hostLabel="crumb.example"
        page={1}
        pages={1}
      />,
    );
    const status = root.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("2 results for “sourdough”");
    const links = [...root.querySelectorAll("li h2 a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual(["/sourdough", "/"]);
    expect(root.textContent).toContain("crumb.example/sourdough");
    expect(root.textContent).toContain("· Service");
    const marks = [...root.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["sourdough"]);
    expect(root.querySelector("mark")!.className).toContain("bg-transparent");
    expect(
      root.querySelector('nav[aria-label="Search results pages"]'),
    ).toBeNull();
  });

  it("uses singular copy and the shared Pagination", () => {
    expect(searchCountCopy(1, "rye")).toBe("1 result for “rye”");
    const root = dom(
      <SearchResults
        query="muffin & co"
        total={23}
        results={results}
        hostLabel="x"
        page={2}
        pages={3}
      />,
    );
    const nav = root.querySelector('nav[aria-label="Search results pages"]')!;
    expect(nav).not.toBeNull();
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toContain(
      "2",
    );
    expect(
      nav.querySelector('a[aria-label="Page 3"]')!.getAttribute("href"),
    ).toBe("/search?q=muffin%20%26%20co&page=3");
    expect(Pagination).toBeTypeOf("function");
    expect(paginationWindow(2, 3)).toEqual([1, 2, 3]);
  });

  it("renders a hostile query and snippet as text", () => {
    const html = renderToStaticMarkup(
      <SearchResults
        query="<script>alert(1)</script>"
        total={1}
        results={[
          {
            title: "<img src=x onerror=alert(1)>",
            path: "/",
            kind: null,
            snippet: [{ text: "<b>x</b>", match: true }],
          },
        ]}
        hostLabel="x"
        page={1}
        pages={1}
      />,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("PopularPages", () => {
  it("lists safe links; nothing when empty", () => {
    const root = dom(
      <PopularPages
        links={[
          { label: "About", href: "/about" },
          { label: "Bad", href: "javascript:alert(1)" },
          { label: "", href: "/x" },
        ]}
      />,
    );
    const as = [...root.querySelectorAll("ul a")];
    expect(as.map((a) => a.getAttribute("href"))).toEqual(["/about"]);
    expect(as[0]!.className).toContain("min-h-11");
    expect(renderToStaticMarkup(<PopularPages links={[]} />)).toBe("");
  });
});
