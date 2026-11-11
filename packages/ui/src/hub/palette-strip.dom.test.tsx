// @vitest-environment jsdom
// 06-21 Task 1: PaletteStrip (06-UI-SPEC "Mood board" item 2, Accessibility "PaletteStrip";
// ONB-05, D-UI-P6-28).
import { afterEach, describe, expect, it } from "vitest";
import { PaletteStrip, stripSwatches } from "./PaletteStrip";
import { mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const SW = [
  { hex: "#1f4d36", weight: 600 },
  { hex: "#f3ecd8", weight: 300 },
  { hex: "#b7410e", weight: 100 },
];

describe("PaletteStrip", () => {
  it("one image to assistive tech, labelled by the caller", () => {
    mounted = mount(
      <PaletteStrip
        swatches={SW}
        label="Colours from your mood board: deep green, cream, rust"
      />,
    );
    const img = mounted.container.querySelector('[role="img"]');
    expect(img?.getAttribute("aria-label")).toBe(
      "Colours from your mood board: deep green, cream, rust",
    );
  });

  it("one segment per swatch, width proportional to weight, min 24px, fill from data", () => {
    mounted = mount(<PaletteStrip swatches={SW} label="x" />);
    const segs = Array.from(
      mounted.container.querySelectorAll<HTMLElement>("[data-swatch]"),
    );
    expect(segs.map((s) => s.dataset.swatch)).toEqual([
      "#1f4d36",
      "#f3ecd8",
      "#b7410e",
    ]);
    expect(segs.map((s) => s.style.flexGrow)).toEqual(["600", "300", "100"]);
    for (const s of segs) {
      expect(s.className).toContain("min-w-6");
      expect(s.title).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.style.backgroundColor).not.toBe("");
    }
  });

  it("hex labels sit under the swatches, hidden below 480px and from assistive tech", () => {
    mounted = mount(<PaletteStrip swatches={SW} label="x" />);
    const row = mounted.container.querySelector('[aria-hidden="true"]');
    expect(row?.className).toContain("hidden");
    expect(row?.className).toContain("min-[480px]:flex");
    expect(row?.textContent).toBe("#1f4d36#f3ecd8#b7410e");
  });

  it("outline on hub tokens, width transition off under reduced motion", () => {
    mounted = mount(<PaletteStrip swatches={SW} label="x" />);
    const c = mounted.container;
    expect(c.innerHTML).toContain("outline-hub-border-strong");
    const seg = c.querySelector<HTMLElement>("[data-swatch]")!;
    expect(seg.className).toContain("duration-200");
    expect(seg.className).toContain("motion-reduce:transition-none");
  });

  it("drops anything that isn't #rrggbb, keeps at most 6, never renders empty", () => {
    expect(
      stripSwatches([
        { hex: "red;background:url(x)", weight: 5 },
        { hex: "#ABCDEF", weight: 0 },
      ]),
    ).toEqual([{ hex: "#abcdef", weight: 1 }]);
    expect(
      stripSwatches(
        Array.from({ length: 9 }, (_, i) => ({ hex: `#00000${i}`, weight: 1 })),
      ),
    ).toHaveLength(6);
    mounted = mount(<PaletteStrip swatches={[]} label="x" />);
    expect(mounted.container.innerHTML).toBe("");
  });
});
