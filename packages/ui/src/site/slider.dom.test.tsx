// @vitest-environment jsdom
// SliderController in a real DOM (07-20 Task 1; CONT-23, D229; UI-SPEC a11y + motion).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SliderController,
  type SliderControllerProps,
} from "./client/SliderController";
import { button, click, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
let reduced = false;

beforeEach(() => {
  reduced = false;
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "Date",
    ],
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function slides(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    node: <p>Slide body {i + 1}</p>,
  }));
}

function render(over: Partial<SliderControllerProps> = {}, n = 5): HTMLElement {
  mounted = mount(
    <SliderController
      slides={slides(n)}
      direction="ltr"
      arrows
      dots
      autoplay={false}
      intervalMs={3000}
      transition="slide"
      {...over}
    />,
  );
  tick(1);
  return mounted.container;
}

function slideEls(c: HTMLElement): HTMLElement[] {
  return Array.from(c.querySelectorAll<HTMLElement>("[data-slide]"));
}

function activeIndex(c: HTMLElement): number {
  return slideEls(c).findIndex((s) => s.dataset.state === "active");
}

function live(c: HTMLElement): string {
  return c.querySelector("[aria-live]")?.textContent ?? "";
}

function region(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>("[data-cds-slider]")!;
}

function pointer(
  el: Element,
  type: string,
  x: number,
  y = 0,
  pointerType = "touch",
): void {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe("slider markup", () => {
  it("is an APG carousel region with labelled slide groups", () => {
    const c = render();
    const r = region(c);
    expect(r.getAttribute("role")).toBe("region");
    expect(r.getAttribute("aria-roledescription")).toBe("carousel");
    expect(r.getAttribute("aria-label")).toBe("Slides");
    const s = slideEls(c);
    expect(s).toHaveLength(5);
    expect(s[1].getAttribute("role")).toBe("group");
    expect(s[1].getAttribute("aria-roledescription")).toBe("slide");
    expect(s[1].getAttribute("aria-label")).toBe("2 of 5");
  });

  it("uses aria-labelledby when given", () => {
    const c = render({ labelledBy: "h-1" });
    expect(region(c).getAttribute("aria-labelledby")).toBe("h-1");
    expect(region(c).hasAttribute("aria-label")).toBe(false);
  });

  it("first render: slide 1 active, others not inert; inert after mount", () => {
    mounted = mount(
      <SliderController
        slides={slides(3)}
        direction="ltr"
        arrows
        dots
        autoplay={false}
        intervalMs={3000}
        transition="slide"
      />,
    );
    const c = mounted.container;
    expect(activeIndex(c)).toBe(0);
    expect(slideEls(c)[1].hasAttribute("inert")).toBe(false);
    tick(1);
    expect(slideEls(c)[0].hasAttribute("inert")).toBe(false);
    expect(slideEls(c)[1].hasAttribute("inert")).toBe(true);
    expect(slideEls(c)[2].hasAttribute("inert")).toBe(true);
  });

  it("controls bar sits under the slides, Pause first, exact labels", () => {
    const c = render({ autoplay: true });
    const bar = c.querySelector("[data-slider-controls]")!;
    const viewport = c.querySelector("[data-slider-viewport]")!;
    expect(
      viewport.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const labels = Array.from(bar.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "Pause slides",
      "Previous slide",
      "Go to slide 1 of 5",
      "Go to slide 2 of 5",
      "Go to slide 3 of 5",
      "Go to slide 4 of 5",
      "Go to slide 5 of 5",
      "Next slide",
    ]);
    expect(button(c, "Go to slide 1 of 5")!.getAttribute("aria-current")).toBe(
      "true",
    );
    expect(button(c, "Go to slide 2 of 5")!.hasAttribute("aria-current")).toBe(
      false,
    );
  });

  it("no Pause button without auto-play", () => {
    const c = render();
    expect(button(c, "Pause slides")).toBeNull();
    expect(button(c, "Play slides")).toBeNull();
  });

  it("arrows off and dots off still renders Previous and Next", () => {
    const c = render({ arrows: false, dots: false });
    expect(button(c, "Previous slide")).not.toBeNull();
    expect(button(c, "Next slide")).not.toBeNull();
    expect(button(c, /Go to slide/)).toBeNull();
  });

  it("arrows off with dots on shows only dots", () => {
    const c = render({ arrows: false });
    expect(button(c, "Previous slide")).toBeNull();
    expect(button(c, "Go to slide 3 of 5")).not.toBeNull();
  });

  it("a single slide renders alone with no bar and no carousel role", () => {
    const c = render({}, 1);
    expect(c.textContent).toContain("Slide body 1");
    expect(c.querySelector("[data-slider-controls]")).toBeNull();
    expect(c.querySelector("[aria-roledescription]")).toBeNull();
  });
});

describe("slider navigation", () => {
  it("Next wraps from last to first; Previous from first to last", () => {
    const c = render();
    click(button(c, "Previous slide"));
    expect(activeIndex(c)).toBe(4);
    click(button(c, "Next slide"));
    expect(activeIndex(c)).toBe(0);
  });

  it("a dot shows that slide and becomes current", () => {
    const c = render();
    click(button(c, "Go to slide 3 of 5"));
    expect(activeIndex(c)).toBe(2);
    expect(button(c, "Go to slide 3 of 5")!.getAttribute("aria-current")).toBe(
      "true",
    );
    tick(400);
    expect(slideEls(c)[2].hasAttribute("inert")).toBe(false);
    expect(slideEls(c)[0].hasAttribute("inert")).toBe(true);
  });

  it("announces 'Slide 2 of 5' politely after a user move", () => {
    const c = render();
    const region = c.querySelector("[aria-live]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(live(c)).toBe("");
    click(button(c, "Next slide"));
    expect(live(c)).toBe("Slide 2 of 5");
  });

  it("pauses videos in slides that become inactive", () => {
    const pause = vi.fn();
    mounted = mount(
      <SliderController
        slides={[
          { id: "a", node: <video data-testid="v" /> },
          { id: "b", node: <p>b</p> },
        ]}
        direction="ltr"
        arrows
        dots
        autoplay={false}
        intervalMs={3000}
        transition="slide"
      />,
    );
    tick(1);
    const video = mounted.container.querySelector("video")!;
    Object.defineProperty(video, "pause", { value: pause });
    click(button(mounted.container, "Next slide"));
    tick(1);
    expect(pause).toHaveBeenCalled();
  });

  it("stops audio and provider frames in slides that become inactive (WR-D03)", () => {
    const pause = vi.fn();
    mounted = mount(
      <SliderController
        slides={[
          {
            id: "a",
            node: (
              <div>
                <audio />
                <div data-cds-consent-frame="audio" />
              </div>
            ),
          },
          { id: "b", node: <p>b</p> },
        ]}
        direction="ltr"
        arrows
        dots
        autoplay={false}
        intervalMs={3000}
        transition="slide"
      />,
    );
    tick(1);
    const audio = mounted.container.querySelector("audio")!;
    Object.defineProperty(audio, "pause", { value: pause });
    let stops = 0;
    mounted.container
      .querySelector("[data-cds-consent-frame]")!
      .addEventListener("cds:media-stop", () => stops++);
    click(button(mounted.container, "Next slide"));
    tick(1);
    expect(pause).toHaveBeenCalled();
    expect(stops).toBeGreaterThan(0);
  });
});

describe("slider auto-play", () => {
  it("advances every interval and keeps the live region empty", () => {
    const c = render({ autoplay: true });
    tick(3000);
    expect(activeIndex(c)).toBe(1);
    tick(3000);
    expect(activeIndex(c)).toBe(2);
    expect(live(c)).toBe("");
  });

  it("pauses on hover and resumes on leave", () => {
    const c = render({ autoplay: true });
    act(() => {
      region(c).dispatchEvent(new Event("pointerenter"));
    });
    tick(10000);
    expect(activeIndex(c)).toBe(0);
    act(() => {
      region(c).dispatchEvent(new Event("pointerleave"));
    });
    tick(3000);
    expect(activeIndex(c)).toBe(1);
  });

  it("pauses on focus within and resumes when focus leaves", () => {
    const c = render({ autoplay: true });
    const next = button(c, "Next slide")!;
    act(() => {
      next.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    tick(10000);
    expect(activeIndex(c)).toBe(0);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => {
      next.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
      );
    });
    tick(3000);
    expect(activeIndex(c)).toBe(1);
  });

  it("focus moving inside the region keeps it paused", () => {
    const c = render({ autoplay: true });
    const next = button(c, "Next slide")!;
    const prev = button(c, "Previous slide")!;
    act(() => {
      next.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      next.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: prev }),
      );
    });
    tick(10000);
    expect(activeIndex(c)).toBe(0);
  });

  it("Pause stops it and reads Play slides; Play restarts it", () => {
    const c = render({ autoplay: true });
    click(button(c, "Pause slides"));
    expect(button(c, "Play slides")).not.toBeNull();
    tick(10000);
    expect(activeIndex(c)).toBe(0);
    click(button(c, "Play slides"));
    expect(button(c, "Pause slides")).not.toBeNull();
    tick(3000);
    expect(activeIndex(c)).toBe(1);
  });

  it("using Next stops it for good", () => {
    const c = render({ autoplay: true });
    click(button(c, "Next slide"));
    expect(activeIndex(c)).toBe(1);
    tick(10000);
    expect(activeIndex(c)).toBe(1);
    expect(button(c, "Play slides")).not.toBeNull();
    expect(live(c)).toBe("Slide 2 of 5");
  });

  it("using a dot stops it for good", () => {
    const c = render({ autoplay: true });
    click(button(c, "Go to slide 4 of 5"));
    tick(10000);
    expect(activeIndex(c)).toBe(3);
  });

  it("a swipe stops it for good", () => {
    const c = render({ autoplay: true });
    const vp = c.querySelector("[data-slider-viewport]")!;
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 140);
    expect(activeIndex(c)).toBe(1);
    tick(10000);
    expect(activeIndex(c)).toBe(1);
    expect(button(c, "Play slides")).not.toBeNull();
  });
});

describe("slider reduced motion", () => {
  it("never auto-plays, offers Play slides and drops transitions", () => {
    reduced = true;
    const c = render({ autoplay: true });
    tick(10000);
    expect(activeIndex(c)).toBe(0);
    expect(button(c, "Play slides")).not.toBeNull();
    for (const s of slideEls(c)) {
      expect(s.className).toContain("motion-reduce:transition-none");
      expect(s.className).not.toContain("duration-300");
    }
    click(button(c, "Next slide"));
    for (const s of slideEls(c)) {
      expect(s.className).not.toContain("duration-300");
    }
  });

  it("a visitor who presses Play opts in", () => {
    reduced = true;
    const c = render({ autoplay: true });
    click(button(c, "Play slides"));
    tick(3000);
    expect(activeIndex(c)).toBe(1);
  });
});

describe("slider transitions", () => {
  it("slide transition runs 300ms ease-out-expo on the moving slides", () => {
    const c = render();
    click(button(c, "Next slide"));
    tick(40);
    const s = slideEls(c);
    expect(s[1].className).toContain("duration-300");
    expect(s[1].className).toContain("ease-[cubic-bezier(0.16,1,0.3,1)]");
    expect(s[1].className).toContain("transition-transform");
  });

  it("fade transition uses opacity", () => {
    const c = render({ transition: "fade" });
    click(button(c, "Next slide"));
    tick(40);
    expect(slideEls(c)[1].className).toContain("transition-opacity");
  });

  it("top to bottom enters from the right below 768px and from below at md", () => {
    const c = render({ direction: "ttb" });
    click(button(c, "Next slide"));
    // Before the animation frame: the entering slide sits at its start side.
    const cls = slideEls(c)[1].className;
    expect(cls).toContain("translate-x-full");
    expect(cls).toContain("md:translate-y-full");
  });
});

describe("slider swipe", () => {
  it("dx -60 advances, +60 goes back, 20 does nothing (ltr)", () => {
    const c = render();
    const vp = c.querySelector("[data-slider-viewport]")!;
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 140);
    expect(activeIndex(c)).toBe(1);
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 260);
    expect(activeIndex(c)).toBe(0);
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 180);
    expect(activeIndex(c)).toBe(0);
  });

  it("ignores mouse pointers and mostly-vertical moves", () => {
    const c = render();
    const vp = c.querySelector("[data-slider-viewport]")!;
    pointer(vp, "pointerdown", 200, 0, "mouse");
    pointer(vp, "pointerup", 100, 0, "mouse");
    expect(activeIndex(c)).toBe(0);
    pointer(vp, "pointerdown", 200, 0);
    pointer(vp, "pointerup", 140, 200);
    expect(activeIndex(c)).toBe(0);
  });

  it("inverts for rtl", () => {
    const c = render({ direction: "rtl" });
    const vp = c.querySelector("[data-slider-viewport]")!;
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 140);
    expect(activeIndex(c)).toBe(4);
    pointer(vp, "pointerdown", 200);
    pointer(vp, "pointerup", 260);
    expect(activeIndex(c)).toBe(0);
  });

  it("rtl reverses the arrows and dots group", () => {
    const c = render({ direction: "rtl" });
    const group = c.querySelector("[data-slider-nav]")!;
    expect(group.className).toContain("flex-row-reverse");
  });
});
