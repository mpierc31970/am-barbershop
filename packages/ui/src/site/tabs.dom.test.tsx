// @vitest-environment jsdom
// TabsController in a real DOM (07-20 Task 1; CONT-27; APG tabs, automatic activation).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabsController } from "./client/TabsController";
import { click, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function render(n = 3, labelledBy?: string, labelLevel: 2 | 3 = 2) {
  mounted = mount(
    <TabsController
      labelledBy={labelledBy}
      labelLevel={labelLevel}
      tabs={Array.from({ length: n }, (_, i) => ({
        id: `t${i + 1}`,
        label: `Label ${i + 1}`,
        node: <p>Panel body {i + 1}</p>,
      }))}
    />,
  );
  return mounted.container;
}

const tabs = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const panels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

function selected(c: HTMLElement): number {
  return tabs(c).findIndex((t) => t.getAttribute("aria-selected") === "true");
}

describe("tabs markup", () => {
  it("renders an APG tablist with linked tabs and panels", () => {
    const c = render(3, "head-1");
    const list = c.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-labelledby")).toBe("head-1");
    const t = tabs(c);
    const p = panels(c);
    expect(t).toHaveLength(3);
    expect(p).toHaveLength(3);
    t.forEach((tab, i) => {
      expect(tab.id).toBe(`cds-tab-t${i + 1}`);
      expect(tab.getAttribute("aria-controls")).toBe(`cds-tabpanel-t${i + 1}`);
      expect(p[i].id).toBe(`cds-tabpanel-t${i + 1}`);
      expect(p[i].getAttribute("aria-labelledby")).toBe(`cds-tab-t${i + 1}`);
      expect(p[i].getAttribute("tabindex")).toBe("0");
    });
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(t[0].tabIndex).toBe(0);
    expect(t[1].getAttribute("aria-selected")).toBe("false");
    expect(t[1].tabIndex).toBe(-1);
    expect(p[0].classList.contains("hidden")).toBe(false);
    expect(p[1].classList.contains("hidden")).toBe(true);
    expect(p[2].classList.contains("hidden")).toBe(true);
  });

  it("no label on the tablist without a heading", () => {
    const c = render(2);
    expect(
      c.querySelector('[role="tablist"]')!.hasAttribute("aria-labelledby"),
    ).toBe(false);
  });

  it("each panel holds a hidden label heading at the given level", () => {
    const c = render(2, undefined, 3);
    const label = panels(c)[0].querySelector("[data-tab-label]")!;
    expect(label.tagName).toBe("H3");
    expect(label.textContent).toBe("Label 1");
    expect(label.className).toContain("hidden");
    const c2 = render(2, undefined, 2);
    expect(c2.querySelector("[data-tab-label]")!.tagName).toBe("H2");
  });

  it("one tab renders its panel content alone", () => {
    const c = render(1);
    expect(c.querySelector('[role="tablist"]')).toBeNull();
    expect(c.querySelector("[data-tab-label]")).toBeNull();
    expect(c.textContent).toContain("Panel body 1");
  });
});

describe("tabs interaction", () => {
  it("switching away stops audio, video and provider frames in the hidden panel (WR-D03)", () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    mounted = mount(
      <TabsController
        labelLevel={2}
        tabs={[
          {
            id: "a",
            label: "A",
            node: (
              <div>
                <audio data-testid="au" />
                <video data-testid="vi" />
                <div data-cds-consent-frame="video" />
              </div>
            ),
          },
          { id: "b", label: "B", node: <p>B</p> },
        ]}
      />,
    );
    const c = mounted.container;
    const frame = c.querySelector("[data-cds-consent-frame]")!;
    let stops = 0;
    frame.addEventListener("cds:media-stop", () => stops++);
    pause.mockClear();
    click(tabs(c)[1]);
    const paused = pause.mock.instances as unknown as HTMLMediaElement[];
    expect(paused).toContain(c.querySelector("audio"));
    expect(paused).toContain(c.querySelector("video"));
    expect(stops).toBe(1);
    pause.mockRestore();
  });

  it("clicking a tab shows its panel", () => {
    const c = render();
    click(tabs(c)[2]);
    expect(selected(c)).toBe(2);
    expect(panels(c)[2].classList.contains("hidden")).toBe(false);
    expect(panels(c)[0].classList.contains("hidden")).toBe(true);
  });

  it("ArrowRight / ArrowLeft move focus and selection, wrapping", () => {
    const c = render();
    tabs(c)[0].focus();
    key(tabs(c)[0], "ArrowRight");
    expect(selected(c)).toBe(1);
    expect(document.activeElement).toBe(tabs(c)[1]);
    expect(tabs(c)[1].tabIndex).toBe(0);
    expect(tabs(c)[0].tabIndex).toBe(-1);
    key(tabs(c)[1], "ArrowRight");
    key(tabs(c)[2], "ArrowRight");
    expect(selected(c)).toBe(0);
    key(tabs(c)[0], "ArrowLeft");
    expect(selected(c)).toBe(2);
    expect(document.activeElement).toBe(tabs(c)[2]);
    expect(panels(c)[2].classList.contains("hidden")).toBe(false);
  });

  it("Home and End go to the first and last tab", () => {
    const c = render(4);
    key(tabs(c)[0], "End");
    expect(selected(c)).toBe(3);
    expect(document.activeElement).toBe(tabs(c)[3]);
    key(tabs(c)[3], "Home");
    expect(selected(c)).toBe(0);
    expect(document.activeElement).toBe(tabs(c)[0]);
  });

  it("other keys do nothing", () => {
    const c = render();
    key(tabs(c)[0], "ArrowDown");
    expect(selected(c)).toBe(0);
  });
});
