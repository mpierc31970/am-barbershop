// @vitest-environment jsdom
// 07-30 Task 3: ChecklistPanel + SearchResultPreview (CONT-14, CONT-35, D188, D280).
import type { ChecklistItem } from "@cds/core/seo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecklistPanel } from "./ChecklistPanel";
import { SearchResultPreview, ellipsize } from "./SearchResultPreview";
import { button, click, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const ITEMS: ChecklistItem[] = [
  {
    id: "description",
    group: "search",
    status: "check",
    text: "Add a description so search results say what this page is about.",
    fix: { kind: "field", field: "description" },
  },
  {
    id: "title-length",
    group: "search",
    status: "fine",
    text: "Title fits in search results",
  },
  {
    id: "links",
    group: "accessibility",
    status: "check",
    text: 'A link says "<img src=x onerror=alert(1)>". Say where it goes, like "See our prices".',
    fix: { kind: "block", sectionId: "s1", itemId: "b1" },
  },
  {
    id: "photos",
    group: "accessibility",
    status: "fine",
    text: "Every photo has a description",
  },
  {
    id: "headings",
    group: "accessibility",
    status: "fine",
    text: "Headings are in order",
  },
];

describe("ChecklistPanel", () => {
  it("groups Search then Accessibility, with the header and a fine disclosure", () => {
    mounted = mount(<ChecklistPanel items={ITEMS} onFix={vi.fn()} />);
    const root = mounted.container;
    expect(root.textContent).toContain(
      "These are suggestions. You can publish anytime.",
    );
    const groups = Array.from(
      root.querySelectorAll("[data-checklist-group]"),
    ).map((g) => g.getAttribute("data-checklist-group"));
    expect(groups).toEqual(["search", "accessibility"]);
    const fine = root.querySelector("[data-checklist-fine] summary");
    expect(fine?.textContent).toBe("3 checks look good");
    expect(root.querySelectorAll("[data-checklist-fine] li")).toHaveLength(3);
  });

  it("Fix hands back the item's target", () => {
    const onFix = vi.fn();
    mounted = mount(<ChecklistPanel items={ITEMS} onFix={onFix} />);
    const fixes = Array.from(
      mounted.container.querySelectorAll("button"),
    ).filter((b) => b.textContent === "Fix");
    expect(fixes).toHaveLength(2);
    click(fixes[1]);
    expect(onFix).toHaveBeenCalledWith({
      kind: "block",
      sectionId: "s1",
      itemId: "b1",
    });
    click(
      button(
        mounted.container,
        "Fix: Add a description so search results say what this page is about.",
      ),
    );
    expect(onFix).toHaveBeenLastCalledWith({
      kind: "field",
      field: "description",
    });
  });

  it("renders hostile text as text", () => {
    mounted = mount(<ChecklistPanel items={ITEMS} onFix={vi.fn()} />);
    expect(mounted.container.querySelector("img")).toBeNull();
    expect(mounted.container.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });
});

describe("SearchResultPreview", () => {
  it("ellipsizes the title at 60 and shows host › path", () => {
    const long = "A".repeat(72);
    mounted = mount(
      <SearchResultPreview
        title={long}
        host="riverabakery.com"
        path="about"
        description="Fresh bread."
      />,
    );
    const root = mounted.container.querySelector("[data-search-preview]")!;
    expect(root.textContent).toContain("riverabakery.com › about");
    expect(root.textContent).toContain(`${"A".repeat(59)}…`);
    expect(ellipsize("short", 60)).toBe("short");
  });

  it("home shows the host alone; hostile strings stay text", () => {
    mounted = mount(
      <SearchResultPreview
        title="<script>x()</script>"
        host="riverabakery.com"
        path=""
        description="<b>bold</b>"
      />,
    );
    expect(mounted.container.querySelector("script, b")).toBeNull();
    expect(mounted.container.textContent).toContain("riverabakery.com");
    expect(mounted.container.textContent).not.toContain("›");
  });
});
