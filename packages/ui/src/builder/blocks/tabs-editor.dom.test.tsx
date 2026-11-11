// @vitest-environment jsdom
// TabsEditor in a real DOM (07-20 Task 3; CONT-27; UI-SPEC row "Tabs", line 664 Undo).
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTabsContent, type TabsContent } from "@cds/core/content";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { TabsEditor } from "./TabsEditor";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function harness(initial: TabsContent) {
  const calls: [string, unknown][] = [];
  let current: Record<string, unknown> = { ...initial };
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(current);
    return (
      <TabsEditor
        type="tabs"
        content={content}
        errors={{}}
        popups={[]}
        onChange={(name, value) => {
          calls.push([name, value]);
          current = { ...current, [name]: value };
          setContent(current);
        }}
      />
    );
  }
  mounted = mount(
    <ToastRegion>
      <Host />
    </ToastRegion>,
  );
  return {
    calls,
    root: mounted.container,
    content: () => current as unknown as TabsContent,
  };
}

const labelInputs = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("label"))
    .filter((l) => l.textContent?.trim() === "Tab label")
    .map((l) => document.getElementById(l.htmlFor) as HTMLInputElement);

function withTabs(n: number): TabsContent {
  const c = defaultTabsContent();
  while (c.tabs.length < n) {
    c.tabs.push({
      ...defaultTabsContent().tabs[0],
      label: `Tab ${c.tabs.length + 1}`,
    });
  }
  return c;
}

describe("TabsEditor", () => {
  it("shows a Tab label field per tab with a 30-character limit", () => {
    const { root } = harness(defaultTabsContent());
    const inputs = labelInputs(root);
    expect(inputs.map((i) => i.value)).toEqual(["First tab", "Second tab"]);
    expect(inputs[0].maxLength).toBe(30);
    expect(root.textContent).toContain("9 / 30");
  });

  it("renaming calls onChange('tabs', …) with the new label", () => {
    const { root, calls, content } = harness(defaultTabsContent());
    typeInto(labelInputs(root)[1], "Prices");
    expect(calls.at(-1)?.[0]).toBe("tabs");
    expect(content().tabs.map((t) => t.label)).toEqual(["First tab", "Prices"]);
    expect(button(root, "Prices")).not.toBeNull();
  });

  it("Add tab appends 'Tab N' and is disabled at 6 with the cap copy", async () => {
    const { root, content } = harness(defaultTabsContent());
    click(button(root, /Add tab/));
    await flush();
    expect(content().tabs.map((t) => t.label)).toEqual([
      "First tab",
      "Second tab",
      "Tab 3",
    ]);
    mounted?.unmount();
    const h = harness(withTabs(6));
    expect(button(h.root, /Add tab/)!.disabled).toBe(true);
    expect(h.root.textContent).toContain("Tabs hold up to 6 tabs.");
  });

  it("Delete tab is disabled at 2 tabs, with the reason", () => {
    const { root } = harness(defaultTabsContent());
    click(button(root, "More actions for First tab"));
    expect(button(root, "Delete tab")!.disabled).toBe(true);
    expect(root.textContent).toContain("Tabs need at least 2 tabs.");
    expect(button(root, "Duplicate tab")).toBeNull();
  });

  it("delete shows '<label> removed.' with Undo that restores it", async () => {
    const start = withTabs(3);
    const { root, content } = harness(start);
    click(button(root, "More actions for Second tab"));
    click(button(root, "Delete tab"));
    await flush();
    expect(content().tabs.map((t) => t.label)).toEqual(["First tab", "Tab 3"]);
    expect(document.body.textContent).toContain("Second tab removed.");
    click(button(document.body, "Undo"));
    await flush();
    expect(content().tabs.map((t) => t.label)).toEqual([
      "First tab",
      "Second tab",
      "Tab 3",
    ]);
  });

  it("opens one panel at a time in the Columns editor", async () => {
    const { root } = harness(defaultTabsContent());
    click(button(root, "First tab"));
    await flush();
    expect(button(root, "First tab")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      root.querySelectorAll("[data-panel-row] button[aria-label^='Add item']")
        .length,
    ).toBe(1);
    click(button(root, "Second tab"));
    await flush();
    expect(button(root, "First tab")!.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(button(root, "Second tab")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      root.querySelectorAll("[data-panel-row] button[aria-label^='Add item']")
        .length,
    ).toBe(1);
  });

  it("Move down reorders tabs", () => {
    const { root, content } = harness(defaultTabsContent());
    click(button(root, "Move First tab down"));
    expect(content().tabs.map((t) => t.label)).toEqual([
      "Second tab",
      "First tab",
    ]);
  });
});
