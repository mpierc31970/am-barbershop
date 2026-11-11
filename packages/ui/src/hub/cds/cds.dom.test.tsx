// @vitest-environment jsdom
// 12-06 Task 1 (COMM-05, D83, D64; 12-UI-SPEC "CDS identity" lines 211-243, tokens 148-162):
// the CDS mark, the author chip and the tinted surface, plus the three --cds-* tokens.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "@cds/core/theme";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { CdsAuthor, CdsMark, CdsSurface } from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("CdsMark", () => {
  it.each([16, 20, 32] as const)("size %i renders a %i px svg", (size) => {
    mounted = mount(<CdsMark size={size} />);
    const svg = mounted.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe(String(size));
    expect(svg.getAttribute("height")).toBe(String(size));
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.hasAttribute("data-cds-mark")).toBe(true);
  });

  it("is decorative by default", () => {
    mounted = mount(<CdsMark size={20} />);
    const svg = mounted.container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
    expect(svg.hasAttribute("aria-label")).toBe(false);
  });

  it("label=true is an image named CDS", () => {
    mounted = mount(<CdsMark size={20} label />);
    const svg = mounted.container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("CDS");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
  });

  it("fills its tile with the CDS mark token and draws white on it", () => {
    mounted = mount(<CdsMark size={16} />);
    const rect = mounted.container.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("var(--cds-mark)");
    expect(rect.getAttribute("rx")).toBe("4");
    expect(mounted.container.innerHTML).toContain("#FFFFFF");
  });
});

describe("CdsAuthor", () => {
  it('"Mara" reads "Mara from CDS"', () => {
    mounted = mount(<CdsAuthor firstName="Mara" />);
    const chip = mounted.container.firstElementChild as HTMLElement;
    const sr = chip.querySelector(".sr-only")!;
    expect(sr.textContent).toBe("Mara from CDS");
    const visible = chip.querySelector('[aria-hidden="true"]:not(svg)')!;
    expect(visible.textContent).toBe("Mara · CDS");
    expect(chip.querySelector("svg")!.getAttribute("width")).toBe("16");
    // "CDS" carries the mark colour; the name stays ink.
    expect(chip.querySelector(".text-cds-mark")!.textContent).toBe("CDS");
  });

  it("no name reads CDS alone", () => {
    mounted = mount(<CdsAuthor />);
    const chip = mounted.container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe("CDS");
    expect(chip.querySelector(".text-cds-mark")!.textContent).toBe("CDS");
  });

  it("a blank name falls back to CDS", () => {
    mounted = mount(<CdsAuthor firstName="  " />);
    expect(mounted.container.textContent).toBe("CDS");
  });
});

describe("CdsSurface", () => {
  it("renders a tinted, ruled element carrying data-cds-identity", () => {
    mounted = mount(
      <CdsSurface>
        <CdsAuthor firstName="Mara" />
      </CdsSurface>,
    );
    const el = mounted.container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("data-cds-identity")).toBe("");
    for (const c of [
      "bg-cds-tint",
      "border-cds-border",
      "border-l-4",
      "border-l-cds-mark",
      "rounded-lg",
      "p-4",
    ]) {
      expect(el.className).toContain(c);
    }
    expect(
      el.querySelector("[data-cds-mark]")!.closest("[data-cds-identity]"),
    ).toBe(el);
  });

  it("as, padding lg and flush", () => {
    mounted = mount(
      <CdsSurface as="section" padding="lg" flush aria-label="x">
        hi
      </CdsSurface>,
    );
    const el = mounted.container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("SECTION");
    expect(el.getAttribute("aria-label")).toBe("x");
    expect(el.className).toContain("p-6");
    expect(el.className).not.toContain("rounded-lg");
  });
});

describe("--cds-* tokens", () => {
  const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
  const tok = (name: string) => {
    const m = new RegExp(`--cds-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!m?.[1]) throw new Error(`--cds-${name} missing`);
    return m[1].toLowerCase();
  };

  it("are exactly the three UI-SPEC values", () => {
    expect(tok("mark")).toBe("#4a2c6b");
    expect(tok("tint")).toBe("#f3eff7");
    expect(tok("border")).toBe("#dcd2e6");
    expect(css.match(/--cds-[a-z-]+:/g)).toHaveLength(3);
  });

  it("meet the UI-SPEC contrast pairs", () => {
    expect(contrastRatio(tok("mark"), tok("tint"))).toBeGreaterThanOrEqual(9);
    expect(contrastRatio(tok("mark"), "#ffffff")).toBeGreaterThanOrEqual(11);
    expect(contrastRatio("#1b1b19", tok("tint"))).toBeGreaterThanOrEqual(15);
    expect(contrastRatio("#5b5b56", tok("tint"))).toBeGreaterThanOrEqual(6);
  });

  it("are imported by globals.css and exposed as --color-cds-*", () => {
    const globals = readFileSync(
      join(import.meta.dirname, "../../../../../apps/web/app/globals.css"),
      "utf8",
    );
    expect(globals).toMatch(/@import\s+"[^"]*cds\/tokens\.css"/);
    for (const n of ["mark", "tint", "border"]) {
      expect(globals).toContain(`--color-cds-${n}: var(--cds-${n});`);
    }
  });
});
