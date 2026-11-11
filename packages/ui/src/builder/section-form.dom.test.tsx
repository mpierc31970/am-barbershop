// @vitest-environment jsdom
// SectionForm with a columns block, in a real DOM (03-REVIEW WR-C02, WR-C10).
import { afterEach, describe, expect, it } from "vitest";
import type { ColumnsContent } from "@cds/core/content";
import { ToastRegion } from "../hub/Toast";
import { NEUTRAL_DESIGN, resolveTheme } from "@cds/core/theme";
import { SectionForm } from "./SectionForm";
import type {
  BuilderResult,
  BuilderSaveInput,
  BuilderSection,
} from "./section-form-logic";
import { act } from "react";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../test-support/dom";

const NEUTRAL_THEME = resolveTheme(null);

const content: ColumnsContent = {
  columns: [
    {
      id: "c1",
      items: [
        { id: "a", kind: "heading", text: "First", level: 2 },
        { id: "b", kind: "heading", text: "Second", level: 2 },
      ],
    },
  ],
};

const section: BuilderSection = {
  id: "s1",
  page: "p1",
  section_type: "columns",
  row_layout: "full",
  content,
  settings: { background_variant: "main" },
  sort_order: 1,
  is_published: true,
};

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

type Save = (input: BuilderSaveInput) => Promise<BuilderResult<BuilderSection>>;

function okResult(input: BuilderSaveInput): BuilderResult<BuilderSection> {
  return {
    ok: true,
    data: {
      ...section,
      row_layout: input.row_layout,
      content: input.content,
      settings: input.settings as BuilderSection["settings"],
    },
  };
}

function radio(root: ParentNode, value: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  if (!el) throw new Error(`radio ${value} not found`);
  return el;
}

describe("WR-C02: Save block on a columns block", () => {
  it("sends the column change still being saved, not the older baseline", async () => {
    const calls: BuilderSaveInput[] = [];
    let releaseFirst: (() => void) | null = null;
    const onSave: Save = (input) => {
      calls.push(input);
      if (calls.length === 1) {
        return new Promise((res) => {
          releaseFirst = () => res(okResult(input));
        });
      }
      return Promise.resolve(okResult(input));
    };
    mounted = mount(
      <ToastRegion>
        <SectionForm
          theme={NEUTRAL_THEME}
          section={section}
          popups={[]}
          onSave={onSave}
          onDirtyChange={() => {}}
        />
      </ToastRegion>,
    );
    const { container } = mounted;

    // A column commit (move "Second" up) is still in flight...
    click(container.querySelectorAll('[aria-label="Move Heading item up"]')[1]);
    await flush();
    expect(calls).toHaveLength(1);

    // ...when the owner changes Background and saves the block.
    click(radio(container, "alternate"));
    click(button(container, "Save block"));
    await flush();
    expect(calls).toHaveLength(2);
    const sent = calls[1]!.content as ColumnsContent;
    expect(sent.columns[0]!.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(calls[1]!.settings).toEqual({ background_variant: "alternate" });

    releaseFirst!();
    await flush();
  });
});

describe("WR-R01: a column commit during Save block keeps the new Background", () => {
  function held() {
    const calls: BuilderSaveInput[] = [];
    let settleFirst: ((r: BuilderResult<BuilderSection>) => void) | null = null;
    const onSave: Save = (input) => {
      calls.push(input);
      if (calls.length === 1) {
        return new Promise((res) => {
          settleFirst = res;
        });
      }
      return Promise.resolve(okResult(input));
    };
    mounted = mount(
      <ToastRegion>
        <SectionForm
          theme={NEUTRAL_THEME}
          section={section}
          popups={[]}
          onSave={onSave}
          onDirtyChange={() => {}}
        />
      </ToastRegion>,
    );
    return {
      calls,
      container: mounted.container,
      settle: (r: BuilderResult<BuilderSection>) => settleFirst!(r),
    };
  }

  it("the column commit carries the Background sent by the in-flight Save block", async () => {
    const { calls, container, settle } = held();
    click(radio(container, "alternate"));
    click(button(container, "Save block"));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.settings).toEqual({ background_variant: "alternate" });

    // Save block is still in flight when the owner moves an item.
    click(container.querySelectorAll('[aria-label="Move Heading item up"]')[1]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.settings).toEqual({ background_variant: "alternate" });

    settle(okResult(calls[0]!));
    await flush();
  });

  it("after a failed Save block, column commits go back to the saved Background", async () => {
    const { calls, container, settle } = held();
    click(radio(container, "alternate"));
    click(button(container, "Save block"));
    await flush();
    settle({ ok: false, code: "Unavailable", message: "offline" });
    await flush();

    click(container.querySelectorAll('[aria-label="Move Heading item up"]')[1]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.settings).toEqual({ background_variant: "main" });
  });
});

describe("WR-C10: open column item forms count as unsaved edits", () => {
  function setup(onSave: Save, sec: BuilderSection = section) {
    const dirty: boolean[] = [];
    const saveRef: { current: (() => Promise<boolean>) | null } = {
      current: null,
    };
    mounted = mount(
      <ToastRegion>
        <SectionForm
          theme={NEUTRAL_THEME}
          section={sec}
          popups={[]}
          onSave={onSave}
          onDirtyChange={(d) => dirty.push(d)}
          saveRef={saveRef}
        />
      </ToastRegion>,
    );
    return { dirty, saveRef, container: mounted.container };
  }

  function field(root: ParentNode, name: string): HTMLInputElement {
    const label = Array.from(root.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === name,
    );
    const input = label
      ? (document.getElementById(label.htmlFor) as HTMLInputElement | null)
      : null;
    if (!input) throw new Error(`${name} input not found`);
    return input;
  }
  const headingInput = (root: ParentNode) => field(root, "Heading");

  it("typing in an item form makes the block dirty; discarding it clears that", async () => {
    const { dirty, container } = setup((input) =>
      Promise.resolve(okResult(input)),
    );
    click(button(container, /First/));
    expect(dirty.at(-1)).toBe(false);
    typeInto(headingInput(container), "First, edited");
    await flush();
    expect(dirty.at(-1)).toBe(true);
    expect(button(container, "Save block")?.disabled).toBe(false);

    click(button(container, "Discard changes"));
    await flush();
    expect(dirty.at(-1)).toBe(false);
  });

  it("the leave dialog's save path saves the open item form", async () => {
    const calls: BuilderSaveInput[] = [];
    const { dirty, saveRef, container } = setup((input) => {
      calls.push(input);
      return Promise.resolve(okResult(input));
    });
    click(button(container, /First/));
    typeInto(headingInput(container), "First, edited");
    await flush();
    expect(dirty.at(-1)).toBe(true);

    let ok = false;
    await act(async () => {
      ok = (await saveRef.current?.()) ?? false;
    });
    await flush();
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const sent = calls[0]!.content as ColumnsContent;
    expect(sent.columns[0]!.items[0]).toMatchObject({ text: "First, edited" });
    expect(dirty.at(-1)).toBe(false);
  });

  it("an invalid open item keeps the owner on the page", async () => {
    const calls: BuilderSaveInput[] = [];
    const withImage: BuilderSection = {
      ...section,
      content: {
        columns: [
          {
            id: "c1",
            items: [
              {
                id: "img",
                kind: "image",
                url: "https://img.example/a.jpg",
                alt: "A photo",
              },
            ],
          },
        ],
      },
    };
    const { saveRef, container } = setup((input) => {
      calls.push(input);
      return Promise.resolve(okResult(input));
    }, withImage);
    click(container.querySelector('button[aria-controls="item-panel-img"]'));
    typeInto(field(container, "Description"), "");
    await flush();
    let ok = true;
    await act(async () => {
      ok = (await saveRef.current?.()) ?? true;
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(document.activeElement).toBe(field(container, "Description"));
  });
});

describe("04-12: Background swatches paint the org theme (THEME-02, D-UI-P4-11)", () => {
  const ALMANAC_THEME = resolveTheme({
    ...NEUTRAL_DESIGN,
    name: "Almanac",
    roles: {
      ...NEUTRAL_DESIGN.roles,
      surface: "#faf6ee",
      "surface-raised": "#f1e9d8",
    },
    sourceHash: "a1b2c3d4".repeat(8),
  });

  function render(theme: { hash: string; css: string }) {
    mounted = mount(
      <ToastRegion>
        <SectionForm
          theme={theme}
          section={section}
          popups={[]}
          onSave={(input) => Promise.resolve(okResult(input))}
          onDirtyChange={() => {}}
        />
      </ToastRegion>,
    );
    return mounted.container;
  }

  it("each swatch sits in the org's themed scope and paints surface / surface-raised", () => {
    const root = render(ALMANAC_THEME);
    for (const variant of ["main", "alternate"]) {
      const swatch = root.querySelector<HTMLElement>(
        `[data-swatch="${variant}"]`,
      );
      if (!swatch) throw new Error(`swatch ${variant} not found`);
      const scope = swatch.parentElement!;
      expect(scope.tagName).toBe("SPAN");
      expect(scope.getAttribute("data-site")).toBe("");
      expect(scope.getAttribute("data-theme")).toBe("a1b2c3d4");
      expect(scope.className).toBe("contents");
      expect(scope.querySelector("style")?.textContent).toContain(
        '[data-site][data-theme="a1b2c3d4"]{',
      );
      expect(scope.querySelector("style")?.textContent).toContain(
        "--site-surface:#faf6ee",
      );
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
      expect(swatch.className).toContain("border-hub-border-strong");
      expect(swatch.className).toContain("h-6 w-6");
      expect(swatch.className).toContain(
        variant === "main" ? "bg-site-surface" : "bg-site-surface-raised",
      );
    }
  });

  it("the neutral preset scopes the swatches to 00000000", () => {
    const root = render(NEUTRAL_THEME);
    const scopes = root.querySelectorAll('[data-theme="00000000"]');
    expect(scopes).toHaveLength(2);
  });

  it("the theme never reaches the hub chrome around the swatches", () => {
    const root = render(ALMANAC_THEME);
    const legend = Array.from(root.querySelectorAll("legend")).find(
      (l) => l.textContent?.trim() === "Background",
    );
    expect(legend?.closest("[data-site]")).toBeNull();
    expect(root.querySelectorAll("[data-site]")).toHaveLength(2);
  });
});

describe("07-20: Save block on a slider keeps an open item form's edits", () => {
  const sliderSection: BuilderSection = {
    ...section,
    id: "s2",
    section_type: "slider",
    content: {
      heading: "",
      slides: [
        {
          id: "sl1",
          row_layout: "full",
          columns: [
            {
              id: "c1",
              items: [{ id: "h", kind: "heading", text: "Old", level: 2 }],
            },
          ],
        },
        {
          id: "sl2",
          row_layout: "full",
          columns: [{ id: "c2", items: [] }],
        },
      ],
      direction: "ltr",
      arrows: true,
      dots: true,
      autoplay: false,
      interval: 5,
      transition: "slide",
    },
  };

  function setup(calls: BuilderSaveInput[]) {
    const dirty: boolean[] = [];
    mounted = mount(
      <ToastRegion>
        <SectionForm
          theme={NEUTRAL_THEME}
          section={sliderSection}
          popups={[]}
          onSave={(input) => {
            calls.push(input);
            return Promise.resolve(okResult(input));
          }}
          onDirtyChange={(d) => dirty.push(d)}
        />
      </ToastRegion>,
    );
    return { dirty, container: mounted.container };
  }

  function openItemHeading(container: HTMLElement): HTMLInputElement {
    click(button(container, "Slide 1 · Old"));
    click(container.querySelector('button[aria-controls="item-panel-h"]'));
    const panel = container.querySelector("#item-panel-h")!;
    const label = Array.from(panel.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === "Heading",
    )!;
    return document.getElementById(label.htmlFor) as HTMLInputElement;
  }

  type Slides = { id: string; columns: { items: { text?: string }[] }[] }[];

  it("an open item edit counts as dirty and Save block persists it", async () => {
    const calls: BuilderSaveInput[] = [];
    const { dirty, container } = setup(calls);
    typeInto(openItemHeading(container), "New");
    await flush();
    expect(dirty.at(-1)).toBe(true);
    expect(button(container, "Save block")?.disabled).toBe(false);
    click(button(container, "Save block"));
    await flush();
    expect(calls).toHaveLength(1);
    const slides = (calls[0]!.content as { slides: Slides }).slides;
    expect(slides[0]!.columns[0]!.items[0]).toMatchObject({ text: "New" });
    expect(slides[1]!.id).toBe("sl2");
    expect(dirty.at(-1)).toBe(false);
  });

  it("Discard changes closes the open item form and restores the saved slides", async () => {
    const calls: BuilderSaveInput[] = [];
    const { dirty, container } = setup(calls);
    typeInto(openItemHeading(container), "New");
    await flush();
    click(button(container, "Discard changes"));
    await flush();
    expect(dirty.at(-1)).toBe(false);
    expect(container.querySelector("#item-panel-h input")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a slide reorder in the draft is saved by Save block", async () => {
    const calls: BuilderSaveInput[] = [];
    const { container } = setup(calls);
    click(button(container, "Move Slide 2 up"));
    await flush();
    click(button(container, "Save block"));
    await flush();
    const slides = (calls[0]!.content as { slides: Slides }).slides;
    expect(slides.map((s) => s.id)).toEqual(["sl2", "sl1"]);
  });
});
