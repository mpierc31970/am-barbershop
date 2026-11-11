// Tabs block (07-06; CONT-27; T-07-06-02, -04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  TABS_LIMITS,
  defaultTabsContent,
  duplicateTabsPanel,
  tabsSection,
  tabsVisiblePanels,
  validateTabsContent,
} from "./tabs";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("tabs content", () => {
  it("default: First tab / Second tab, empty full-width panels, validates", () => {
    const d = defaultTabsContent();
    expect(d.tabs.map((t) => t.label)).toEqual(["First tab", "Second tab"]);
    expect(d.tabs.every((t) => t.row_layout === "full")).toBe(true);
    expect(d.tabs[0]!.columns[0]!.items).toEqual([]);
    expect(validateTabsContent(d)).toEqual(d);
    expect(Object.isFrozen(TABS_LIMITS)).toBe(true);
  });

  it("blank label -> Tab N; label capped at 30", () => {
    const out = validateTabsContent({
      tabs: [
        { id: "a", label: "Menu" },
        { id: "b", label: "  " },
      ],
    });
    expect(out.tabs.map((t) => t.label)).toEqual(["Menu", "Tab 2"]);
    expect(() =>
      validateTabsContent({ tabs: [{ id: "a", label: "x".repeat(31) }] }),
    ).toThrow("Keep this under 30 characters.");
  });

  it("refuses more than 6 tabs", () => {
    const tabs = Array.from({ length: 7 }, () => ({}));
    expect(msg(() => validateTabsContent({ tabs }))).toBe(
      "Tabs hold up to 6 tabs.",
    );
  });
});

describe("tabsSection", () => {
  it("contract and walkers", () => {
    expect(tabsSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(tabsSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(() =>
      tabsSection.validate(tabsSection.defaultContent(), "full"),
    ).not.toThrow();
    const c = validateTabsContent({
      heading: "Menu",
      tabs: [
        {
          id: "a",
          label: "Lunch",
          columns: [
            {
              id: "c",
              items: [
                { id: "b", kind: "button", text: "See", link: "/lunch" },
                {
                  id: "p",
                  kind: "button",
                  text: "Book",
                  action: "popup",
                  popup_id: "pop2",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(tabsSection.textsOf(c)).toEqual(["Menu", "Lunch", "See", "Book"]);
    expect(tabsSection.urlsOf(c)).toEqual(["/lunch"]);
    expect(tabsSection.refsOf(c)).toEqual({
      popups: ["pop2"],
      forms: [],
      media: [],
    });
    expect(tabsSection.mapRichText(c, (h) => h)).toEqual(c);
  });
});

describe("tabs render and editor helpers (07-20)", () => {
  it("tabsVisiblePanels drops tabs with empty panels and is defensive", () => {
    const c = defaultTabsContent();
    expect(tabsVisiblePanels(c)).toEqual([]);
    c.tabs[1].columns[0].items = [{ id: "t1", kind: "divider" }];
    expect(tabsVisiblePanels(c).map((t) => t.label)).toEqual(["Second tab"]);
    expect(tabsVisiblePanels(42)).toEqual([]);
    expect(tabsVisiblePanels({ tabs: [1, "x"] })).toEqual([]);
  });

  it("duplicateTabsPanel keeps the label, mints fresh ids, inserts after", () => {
    const c = defaultTabsContent();
    const out = duplicateTabsPanel(c, c.tabs[0].id);
    expect(out.tabs.map((t) => t.label)).toEqual([
      "First tab",
      "First tab",
      "Second tab",
    ]);
    expect(out.tabs[1].id).not.toBe(c.tabs[0].id);
    expect(() => validateTabsContent(out)).not.toThrow();
  });

  it("duplicateTabsPanel is a no-op at 6 tabs", () => {
    let c = defaultTabsContent();
    while (c.tabs.length < TABS_LIMITS.maxTabs) {
      c = duplicateTabsPanel(c, c.tabs[0].id);
    }
    expect(duplicateTabsPanel(c, c.tabs[0].id)).toBe(c);
  });
});
