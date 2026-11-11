// @vitest-environment jsdom
// First-use tours (11-48; DASH-17, D208; 11-UI-SPEC "First-use tours" lines 612-630,
// D-UI-P11-17): the coachmark skips missing and hidden anchors, Esc skips, Done finishes and
// focus returns to the last anchor; every TOURS step names a how-to Use row that exists.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { button, click, mount, type Mounted } from "../../test-support/dom";
import {
  TOURS,
  TOUR_COPY,
  TOUR_FOR_HELP_ENTRY,
  TOUR_IDS,
  TOUR_SCREEN_HREF,
  TourCoachmark,
  isTourId,
  tourSteps,
  visibleTourSteps,
} from "./index";

// jsdom has no layout: every offsetParent is null. Treat an element as laid out unless it
// (or an ancestor) is `hidden`, which is how these tests hide a pane.
const desc = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetParent",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  });
});
afterAll(() => {
  if (desc) Object.defineProperty(HTMLElement.prototype, "offsetParent", desc);
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const STEPS = [
  { anchor: "one", title: "First thing", body: "About the first thing." },
  { anchor: "two", title: "Second thing", body: "About the second thing." },
  { anchor: "three", title: "Third thing", body: "About the third thing." },
];

function page(html: string): void {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
}

const coach = () =>
  document.querySelector<HTMLElement>("[data-tour-coachmark]");

describe("TourCoachmark", () => {
  it("skips a missing anchor: Next goes 1 → 3 and reads step 2 of 2", () => {
    page(
      '<button data-tour="one">One</button><button data-tour="three">Three</button>',
    );
    const onDone = vi.fn();
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={vi.fn()} onDone={onDone} />,
    );
    const panel = coach()!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.textContent).toContain("Step 1 of 2");
    expect(panel.textContent).toContain("First thing");
    expect(button(document.body, "Back")).toBeNull();
    // The title has focus; the anchor carries the accent ring.
    expect(document.activeElement?.textContent).toBe("First thing");
    const one = document.querySelector<HTMLElement>('[data-tour="one"]')!;
    expect(one.style.outline).toContain("2px solid");
    expect(one.style.outlineOffset).toBe("4px");

    click(button(document.body, TOUR_COPY.next));
    expect(coach()!.textContent).toContain("Step 2 of 2");
    expect(coach()!.textContent).toContain("Third thing");
    expect(one.style.outline).toBe("");
    const labelledBy = coach()!.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe(
      "Third thing",
    );
    const describedBy = coach()!.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "Step 2 of 2",
    );
    expect(document.querySelector("[data-tour-live]")?.textContent).toBe(
      "Tour, step 2 of 2: Third thing",
    );
    expect(button(document.body, "Back")).not.toBeNull();
    expect(button(document.body, TOUR_COPY.next)).toBeNull();
  });

  it("skips a hidden anchor (a pane hidden on this screen size)", () => {
    page(
      '<button data-tour="one">One</button><div hidden><button data-tour="two">Two</button></div><button data-tour="three">Three</button>',
    );
    expect(visibleTourSteps(STEPS).map((s) => s.anchor)).toEqual([
      "one",
      "three",
    ]);
  });

  it("renders nothing when no anchor is on screen", () => {
    page("<p>Nothing to point at</p>");
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={vi.fn()} onDone={vi.fn()} />,
    );
    expect(coach()).toBeNull();
  });

  it("Done calls onDone and returns focus to the last anchor", () => {
    page(
      '<button data-tour="one">One</button><button data-tour="three">Three</button>',
    );
    const onDone = vi.fn();
    const onSkip = vi.fn();
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={onSkip} onDone={onDone} />,
    );
    click(button(document.body, TOUR_COPY.next));
    click(button(document.body, TOUR_COPY.done));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      document.querySelector('[data-tour="three"]'),
    );
    expect(
      document.querySelector<HTMLElement>('[data-tour="three"]')!.style.outline,
    ).toBe("");
  });

  it("Esc calls onSkip; so does Skip tour and a press outside", () => {
    page('<button data-tour="one">One</button><p id="away">Elsewhere</p>');
    const onSkip = vi.fn();
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={onSkip} onDone={vi.fn()} />,
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      document.querySelector('[data-tour="one"]'),
    );
    mounted.unmount();

    const onSkip2 = vi.fn();
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={onSkip2} onDone={vi.fn()} />,
    );
    click(button(document.body, TOUR_COPY.skip));
    expect(onSkip2).toHaveBeenCalledTimes(1);
    mounted.unmount();

    const onSkip3 = vi.fn();
    mounted = mount(
      <TourCoachmark steps={STEPS} onSkip={onSkip3} onDone={vi.fn()} />,
    );
    act(() => {
      document
        .getElementById("away")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onSkip3).toHaveBeenCalledTimes(1);
  });
});

// The how-to "Use" rows, read from the markdown (one source for the step copy).
// Vitest runs from the repo root (vitest.config.ts).
const ROOT = process.cwd();
function tableRows(howTo: string, table: "activate" | "use"): string[] {
  const md = readFileSync(resolve(ROOT, howTo), "utf8");
  const heading = table === "use" ? "Use" : "Activate";
  const part = md.split(new RegExp(`^## ${heading}\\s*$`, "m"))[1] ?? "";
  return (part.split(/^## /m)[0] ?? "")
    .split(/\r?\n/)
    .filter((l) => /^\|\s*\d+\s*\|/.test(l));
}

describe("TOURS", () => {
  it("covers the four first-use screens", () => {
    expect([...TOUR_IDS].sort()).toEqual([
      "addons",
      "builder",
      "media",
      "today",
    ]);
    for (const id of TOUR_IDS) expect(isTourId(id)).toBe(true);
    expect(isTourId("nope")).toBe(false);
    expect(isTourId(undefined)).toBe(false);
  });

  it("every step references an existing how-to Use row that names its term", () => {
    for (const id of TOUR_IDS) {
      for (const s of TOURS[id]) {
        const rows = tableRows(s.howTo, s.table ?? "use");
        const row = rows.find((l) =>
          new RegExp(`^\\|\\s*${s.row}\\s*\\|`).test(l),
        );
        expect(row, `${id}/${s.anchor}: ${s.howTo} row ${s.row}`).toBeDefined();
        expect(row!.toLowerCase(), `${id}/${s.anchor} term`).toContain(
          s.term.toLowerCase(),
        );
      }
    }
  });

  it("keeps the coachmark copy short (title + at most two sentences) and anchors unique", () => {
    for (const id of TOUR_IDS) {
      const anchors = TOURS[id].map((s) => s.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
      for (const s of TOURS[id]) {
        expect(s.anchor).toMatch(/^[a-z0-9-]+$/);
        const sentences = s.body
          .split(/[.!?](\s|$)/)
          .filter((x) => x.trim().length > 1);
        expect(sentences.length, `${id}/${s.anchor}`).toBeLessThanOrEqual(2);
      }
      expect(tourSteps(id)).toHaveLength(TOURS[id].length);
    }
  });

  it("maps help entries and screens to tours", () => {
    for (const t of Object.values(TOUR_FOR_HELP_ENTRY))
      expect(isTourId(t)).toBe(true);
    for (const id of TOUR_IDS) {
      const href = TOUR_SCREEN_HREF[id];
      if (href) expect(href).toMatch(new RegExp(`^/hub/.*[?&]tour=${id}$`));
    }
  });
});
