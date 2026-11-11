// @vitest-environment jsdom
// CountUp island (07-21; CONT-27; UI-SPEC "Stats", "Motion contract"; plan decision 9).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { CountUp } from "./CountUp";

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

let mounted: Mounted | null = null;
let reduced = false;
let observers: { cb: IOCallback; disconnected: boolean }[] = [];
let frames: ((ts: number) => void)[] = [];

class FakeObserver {
  rec: { cb: IOCallback; disconnected: boolean };
  constructor(cb: IOCallback) {
    this.rec = { cb, disconnected: false };
    observers.push(this.rec);
  }
  observe() {}
  disconnect() {
    this.rec.disconnected = true;
  }
}

beforeEach(() => {
  reduced = false;
  observers = [];
  frames = [];
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
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: FakeObserver,
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (cb: (ts: number) => void) => {
      frames.push(cb);
      return frames.length;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const live = () =>
  mounted!.container.querySelectorAll("span span")[1]?.textContent;

function intersect(ratio: number) {
  act(() => {
    observers[0].cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]);
  });
}

/** Run queued animation frames at the given timestamps. */
function runFrames(times: number[]) {
  for (const ts of times) {
    const batch = frames;
    frames = [];
    act(() => {
      for (const f of batch) f(ts);
    });
  }
}

describe("CountUp", () => {
  it("first render shows the final value (matches SSR)", () => {
    mounted = mount(<CountUp value="1,200" />);
    expect(live()).toBe("1,200");
    expect(
      mounted.container.firstElementChild?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("never changes under reduced motion", () => {
    reduced = true;
    mounted = mount(<CountUp value="1,200" />);
    expect(observers).toHaveLength(0);
    expect(live()).toBe("1,200");
  });

  it("stays final without IntersectionObserver", () => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    mounted = mount(<CountUp value="250" />);
    expect(live()).toBe("250");
  });

  it("out of view: zero form, then animates to the exact value once", () => {
    mounted = mount(<CountUp value="1,200" />);
    intersect(0);
    expect(live()).toBe("0");
    intersect(0.3);
    expect(live()).toBe("0");
    intersect(0.6);
    runFrames([1000, 1600]);
    const mid = live()!;
    expect(mid).not.toBe("0");
    expect(mid).not.toBe("1,200");
    runFrames([2200]);
    expect(live()).toBe("1,200");
    expect(observers[0].disconnected).toBe(true);
    intersect(0.9);
    expect(frames).toHaveLength(0);
    expect(live()).toBe("1,200");
  });

  it("already in view: animates from zero at once", () => {
    mounted = mount(<CountUp value="4.9" />);
    intersect(1);
    expect(live()).toBe("0.0");
    runFrames([0, 1200]);
    expect(live()).toBe("4.9");
  });
});
