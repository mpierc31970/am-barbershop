// @vitest-environment jsdom
// Builder half of core block group A (07-06; 07-UI-SPEC "Block picker"): the real
// BUILDER_BLOCKS_A map puts Gallery, Slider, Logo strip under "Photos and video" and Tabs,
// Stats under "Information", with the UI-SPEC one-line descriptions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGalleryContent, type GalleryContent } from "@cds/core/content";
import { act } from "react";
import { BlockTemplatePicker, type BlockChoice } from "../BlockTemplatePicker";
import { mount, type Mounted } from "../../test-support/dom";
import { BUILDER_BLOCKS_A } from "./group-a";

const TYPES = ["gallery", "slider", "tabs", "logo-strip", "stats"];

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function picker(onPick: (c: BlockChoice) => void = () => {}, hasHero = false) {
  mounted = mount(
    <BlockTemplatePicker onPick={onPick} onExit={() => {}} hasHero={hasHero} />,
  );
  return mounted.container;
}

/** Tile titles and descriptions under the h3 with this text. */
function group(root: HTMLElement, title: string): [string, string][] {
  const h3 = [...root.querySelectorAll("h3")].find(
    (h) => h.textContent === title,
  );
  if (!h3) return [];
  const list = root.querySelector(`ul[aria-labelledby="${h3.id}"]`);
  return [...(list?.querySelectorAll("li button") ?? [])].map((b) => {
    const spans = b.querySelectorAll("span span");
    return [spans[0]?.textContent ?? "", spans[1]?.textContent ?? ""];
  });
}

describe("BUILDER_BLOCKS_A", () => {
  it("holds exactly the five group A types", () => {
    expect(Object.keys(BUILDER_BLOCKS_A).sort()).toEqual([...TYPES].sort());
    expect(Object.isFrozen(BUILDER_BLOCKS_A)).toBe(true);
  });

  it("shows Photos and video and Information with the UI-SPEC tiles in order", () => {
    const root = picker();
    expect(group(root, "Photos and video")).toEqual([
      ["Gallery", "A grid, mosaic or slideshow of photos"],
      ["Slider", "Slides that change, each with its own content"],
      ["Logo strip", "Logos of clients, partners or press"],
    ]);
    const info = group(root, "Information").map(([t]) => t);
    // Group B (07-07) may interleave; group A's relative order is fixed.
    expect(info.filter((t) => t === "Tabs" || t === "Stats")).toEqual([
      "Tabs",
      "Stats",
    ]);
    expect(group(root, "Information")).toContainEqual([
      "Tabs",
      "Content split under a few tabs",
    ]);
    expect(group(root, "Information")).toContainEqual([
      "Stats",
      "A few numbers worth knowing",
    ]);
    const headings = [...root.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.indexOf("Photos and video")).toBe(
      headings.indexOf("Blocks") + 1,
    );
    expect(headings.indexOf("Information")).toBe(
      headings.indexOf("Photos and video") + 1,
    );
  });

  it("clicking Gallery picks a full-width gallery with default content", () => {
    const onPick = vi.fn();
    const root = picker(onPick);
    const btn = [...root.querySelectorAll("li button")].find((b) =>
      b.textContent?.startsWith("Gallery"),
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onPick).toHaveBeenCalledTimes(1);
    const choice = onPick.mock.calls[0]![0] as BlockChoice;
    expect(choice.section_type).toBe("gallery");
    expect(choice.row_layout).toBe("full");
    const content = choice.content as GalleryContent;
    expect(Object.keys(content).sort()).toEqual(
      Object.keys(defaultGalleryContent()).sort(),
    );
    expect(content).toEqual(defaultGalleryContent());
  });

  it("with a Hero on the page only Hero disappears", () => {
    const root = picker(() => {}, true);
    const titles = [
      ...root.querySelectorAll("li button span span:first-child"),
    ].map((el) => el.textContent);
    expect(titles).not.toContain("Hero");
    for (const t of ["Gallery", "Slider", "Logo strip", "Tabs", "Stats"]) {
      expect(titles).toContain(t);
    }
  });
});
