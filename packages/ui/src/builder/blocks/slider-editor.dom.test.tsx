// @vitest-environment jsdom
// SliderEditor + SlidesEditor in a real DOM (07-20 Task 3; CONT-23, D229; UI-SPEC row
// "Slider", line 587 Duplicate slide, line 664 Undo copy).
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultSliderContent,
  type SliderContent,
  type SliderSlide,
} from "@cds/core/content";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { SliderEditor } from "./SliderEditor";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

type Call = [string, unknown];

function harness(initial: SliderContent) {
  const calls: Call[] = [];
  let current: Record<string, unknown> = { ...initial };
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(current);
    return (
      <SliderEditor
        type="slider"
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
    content: () => current as unknown as SliderContent,
  };
}

const rowTitles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("li[data-panel-row] button[aria-expanded]"))
    .map((b) => b.textContent?.trim())
    .filter((t) => t?.startsWith("Slide"));

function withHeading(): SliderContent {
  const c = defaultSliderContent();
  c.slides[1].columns[0].items = [
    { id: "h", kind: "heading", text: "Spring menu", level: 2 },
  ];
  return c;
}

const slide2 = (root: HTMLElement): HTMLElement =>
  root.querySelector('[role="region"][aria-label="Slide 2 content"]')!;

function labelled(root: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(root.querySelectorAll("label")).find(
    (l) => l.textContent?.trim() === text,
  );
  const el = label ? document.getElementById(label.htmlFor) : null;
  if (!el) throw new Error(`field ${text} not found`);
  return el as HTMLInputElement;
}

describe("SliderEditor fields", () => {
  it("lists slides (with first heading), Add slide and the options", () => {
    const { root } = harness(withHeading());
    expect(rowTitles(root)).toEqual(["Slide 1", "Slide 2 · Spring menu"]);
    expect(button(root, /Add slide/)).not.toBeNull();
    for (const t of ["Left to right", "Right to left", "Top to bottom"]) {
      expect(root.textContent).toContain(t);
    }
    expect(labelled(root, "Arrows").checked).toBe(true);
    expect(labelled(root, "Dots").checked).toBe(true);
    expect(labelled(root, "Auto-play").checked).toBe(false);
    expect(root.textContent).toContain(
      "If both are off, visitors still get Previous and Next buttons.",
    );
    expect(root.textContent).not.toContain("Change every");
    expect(root.textContent).toContain("Slide");
    expect(root.textContent).toContain("Fade");
  });

  it("each option calls onChange with its field name and value", () => {
    const { root, calls } = harness(defaultSliderContent());
    click(root.querySelector('input[type="radio"][value="ttb"]'));
    click(labelled(root, "Arrows"));
    click(labelled(root, "Dots"));
    click(labelled(root, "Auto-play"));
    click(root.querySelector('input[type="radio"][value="fade"]'));
    expect(calls).toContainEqual(["direction", "ttb"]);
    expect(calls).toContainEqual(["arrows", false]);
    expect(calls).toContainEqual(["dots", false]);
    expect(calls).toContainEqual(["autoplay", true]);
    expect(calls).toContainEqual(["transition", "fade"]);
  });

  it("Change every shows only while Auto-play is on, 3/5/8 seconds", () => {
    const { root, calls } = harness({
      ...defaultSliderContent(),
      autoplay: true,
    });
    const select = labelled(
      root,
      "Change every",
    ) as unknown as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "3 seconds",
      "5 seconds",
      "8 seconds",
    ]);
    expect(select.value).toBe("5");
    expect(root.textContent).toContain(
      "Visitors can pause it. It never moves for people who turn off animations.",
    );
    // React listens for "change" on selects.
    select.value = "8";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toContainEqual(["interval", 8]);
  });
});

describe("SlidesEditor", () => {
  it("opening Slide 2 mounts one ColumnsEditor; adding an item changes only slide 2", async () => {
    const start = defaultSliderContent();
    const { root, calls, content } = harness(start);
    click(button(root, "Slide 2"));
    expect(root.querySelectorAll('[aria-label="Item types"]').length).toBe(0);
    const add = button(root, /^Add item/);
    expect(add).not.toBeNull();
    click(add);
    click(button(root, "Divider"));
    await flush();
    const save = button(root, "Save item");
    if (save) {
      click(save);
      await flush();
    }
    const slideCalls = calls.filter(([n]) => n === "slides");
    expect(slideCalls.length).toBeGreaterThan(0);
    const slides = content().slides;
    expect(slides[0]).toEqual(start.slides[0]);
    expect(slides[1].columns[0].items.map((i) => i.kind)).toEqual(["divider"]);
    expect(root.textContent).not.toContain("Saved");
  });

  it("Duplicate slide inserts a fresh-id copy after the source", () => {
    const { root, content } = harness(withHeading());
    click(button(root, "More actions for Slide 2 · Spring menu"));
    click(button(root, "Duplicate slide"));
    const slides = content().slides;
    expect(slides).toHaveLength(3);
    expect(slides[2].id).not.toBe(slides[1].id);
    expect(slides[2].columns[0].items[0]).toMatchObject({
      kind: "heading",
      text: "Spring menu",
    });
    expect(slides[2].columns[0].items[0].id).not.toBe("h");
    expect(rowTitles(root)).toEqual([
      "Slide 1",
      "Slide 2 · Spring menu",
      "Slide 3 · Spring menu",
    ]);
  });

  it("Delete slide removes it with an Undo toast that restores it in place", async () => {
    const start = withHeading();
    start.slides.push(defaultSliderContent().slides[0]);
    const { root, content } = harness(start);
    const removedId = start.slides[1].id;
    click(button(root, "More actions for Slide 2 · Spring menu"));
    click(button(root, "Delete slide"));
    await flush();
    expect(content().slides.map((s: SliderSlide) => s.id)).not.toContain(
      removedId,
    );
    expect(document.body.textContent).toContain("Slide 2 removed.");
    click(button(document.body, "Undo"));
    await flush();
    expect(content().slides[1].id).toBe(removedId);
    expect(content().slides).toHaveLength(3);
  });

  it("Delete is disabled with one slide, with the reason", () => {
    const c = defaultSliderContent();
    c.slides = [c.slides[0]];
    const { root } = harness(c);
    click(button(root, "More actions for Slide 1"));
    expect(button(root, "Delete slide")!.disabled).toBe(true);
    expect(root.textContent).toContain("A slider needs at least one slide.");
  });

  it("Add slide appends, opens it, and is disabled at 10 with the cap copy", async () => {
    const { root, content } = harness(defaultSliderContent());
    click(button(root, /Add slide/));
    await flush();
    expect(button(root, "Slide 3")!.getAttribute("aria-expanded")).toBe("true");
    expect(content().slides).toHaveLength(3);
    const full = defaultSliderContent();
    while (full.slides.length < 10) {
      full.slides.push(defaultSliderContent().slides[0]);
    }
    mounted?.unmount();
    const h = harness(full);
    expect(button(h.root, /Add slide/)!.disabled).toBe(true);
    expect(h.root.textContent).toContain("A slider holds up to 10 slides.");
  });

  it("Add slide keeps the open slide's unsaved item edit (CR-E01)", async () => {
    const { root, content } = harness(withHeading());
    click(button(root, "Slide 2 · Spring menu"));
    click(button(slide2(root), /Spring menu/));
    typeInto(labelled(slide2(root), "Heading"), "Summer menu");
    await flush();
    // The item form is left unsaved; Add slide flushes it first.
    click(button(root, /Add slide/));
    await flush();
    await flush();
    const slides = content().slides;
    expect(slides).toHaveLength(3);
    expect(slides[1].columns[0].items[0]).toMatchObject({
      text: "Summer menu",
    });
  });

  it("Duplicate slide copies the open slide's unsaved item edit (WR-E03)", async () => {
    const { root, content } = harness(withHeading());
    click(button(root, "Slide 2 · Spring menu"));
    click(button(slide2(root), /Spring menu/));
    typeInto(labelled(slide2(root), "Heading"), "Summer menu");
    await flush();
    click(button(root, "More actions for Slide 2 · Spring menu"));
    click(button(root, "Duplicate slide"));
    await flush();
    await flush();
    const slides = content().slides;
    expect(slides).toHaveLength(3);
    expect(slides[2].columns[0].items[0]).toMatchObject({
      text: "Summer menu",
    });
  });

  it("Move up / Move down reorder slides and announce the new position", () => {
    const start = withHeading();
    const { root, content } = harness(start);
    click(button(root, "Move Slide 2 · Spring menu up"));
    expect(content().slides[0].id).toBe(start.slides[1].id);
    expect(root.querySelector('p[role="status"].sr-only')!.textContent).toBe(
      "Slide 2 moved to position 1.",
    );
    click(button(root, "Move Slide 2 down"));
    expect(content().slides[1].id).toBe(start.slides[0].id);
    expect(button(root, "Move Slide 1 · Spring menu up")!.disabled).toBe(true);
  });

  it("drag handles carry the dnd-kit keyboard sensor attributes", () => {
    const { root } = harness(defaultSliderContent());
    const grip = button(root, "Reorder Slide 1")!;
    expect(grip.getAttribute("aria-roledescription")).toBe("sortable");
    expect(grip.getAttribute("aria-describedby")).toBeTruthy();
  });
});
