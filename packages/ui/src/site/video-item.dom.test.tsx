// @vitest-environment jsdom
// 07-23: the VideoPlayer island (CONT-17, WCAG 2.2.2; choices 5-6): first render equals SSR,
// the play cover, controls after play, muted in-view autoplay, reduced motion, hidden
// ancestors, the Pause toggle, swallowed play() rejections and observer cleanup.
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer, type VideoPlayerProps } from "./client/VideoPlayer";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";

const BASE: VideoPlayerProps = {
  src: "/_media/v1/video.mp4",
  poster: "/_media/v1/poster.webp",
  captions: "",
  mime: "video/mp4",
  title: "Spring tour",
  aspect: "16 / 9",
  controls: true,
  loop: false,
  autoplay: false,
};

type IoCallback = (entries: { intersectionRatio: number }[]) => void;
const observers: { cb: IoCallback; disconnected: boolean }[] = [];
let played: { el: HTMLMediaElement; muted: boolean }[] = [];
let paused: HTMLMediaElement[] = [];
let playResult: () => Promise<void> = () => Promise.resolve();
let reduced = false;
let mounted: Mounted | null = null;

beforeEach(() => {
  observers.length = 0;
  played = [];
  paused = [];
  playResult = () => Promise.resolve();
  reduced = false;
  class FakeIo {
    entry: { cb: IoCallback; disconnected: boolean };
    constructor(cb: IoCallback) {
      this.entry = { cb, disconnected: false };
      observers.push(this.entry);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.entry.disconnected = true;
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIo);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduced && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push({ el: this, muted: this.muted });
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused.push(this);
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function seen(ratio: number) {
  act(() => {
    for (const o of observers) o.cb([{ intersectionRatio: ratio }]);
  });
}

function videoOf(m: Mounted): HTMLVideoElement {
  return m.container.querySelector("video")!;
}

describe("VideoPlayer island", () => {
  it("first render equals the server markup (native controls, no overlay)", () => {
    const ssr = renderToStaticMarkup(<VideoPlayer {...BASE} />);
    expect(ssr).not.toContain("<button");
    expect(ssr).toContain('controls=""');
    mounted = mount(<VideoPlayer {...BASE} />);
    // Before the deferred enhancement runs, the DOM matches SSR.
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(videoOf(mounted).controls).toBe(true);
  });

  it("after mount a play button overlays the frame; clicking plays and applies controls", async () => {
    mounted = mount(<VideoPlayer {...BASE} controls={false} />);
    await flush();
    const play = button(mounted.container, "Play video: Spring tour");
    expect(play).not.toBeNull();
    expect(videoOf(mounted).controls).toBe(false);
    click(play);
    expect(played).toHaveLength(1);
    expect(button(mounted.container, "Play video: Spring tour")).toBeNull();
    expect(videoOf(mounted).controls).toBe(false);
  });

  it("controls on stay on after play", async () => {
    mounted = mount(<VideoPlayer {...BASE} />);
    await flush();
    click(button(mounted.container, "Play video: Spring tour"));
    expect(videoOf(mounted).controls).toBe(true);
  });

  it("a play event from other code (a pop-up opening) hides the overlay", async () => {
    mounted = mount(<VideoPlayer {...BASE} />);
    await flush();
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    expect(button(mounted.container, "Play video: Spring tour")).toBeNull();
  });

  it("autoplay plays muted at half in view and pauses when it leaves", async () => {
    mounted = mount(<VideoPlayer {...BASE} autoplay />);
    await flush();
    seen(0.5);
    expect(played).toEqual([{ el: videoOf(mounted), muted: true }]);
    seen(0);
    expect(paused).toContain(videoOf(mounted));
  });

  it("no autoplay under reduced motion", async () => {
    reduced = true;
    mounted = mount(<VideoPlayer {...BASE} autoplay />);
    await flush();
    seen(1);
    expect(played).toEqual([]);
    expect(button(mounted.container, "Play video: Spring tour")).not.toBeNull();
  });

  it.each(["hidden", "inert", "aria-hidden"])(
    "no autoplay inside a %s ancestor",
    async (attr) => {
      mounted = mount(
        <div {...{ [attr]: attr === "aria-hidden" ? "true" : true }}>
          <VideoPlayer {...BASE} autoplay />
        </div>,
      );
      await flush();
      seen(1);
      expect(played).toEqual([]);
    },
  );

  it("autoplay starts when its slide becomes active, with no new intersection (WR-D04)", async () => {
    mounted = mount(
      <div data-slide="" {...{ inert: true }}>
        <VideoPlayer {...BASE} autoplay />
      </div>,
    );
    await flush();
    seen(1);
    expect(played).toEqual([]);
    act(() => {
      mounted!.container
        .querySelector("[data-slide]")!
        .removeAttribute("inert");
    });
    await flush();
    expect(played).toEqual([{ el: videoOf(mounted), muted: true }]);
  });

  it("controls off + autoplay shows a Pause / Play toggle", async () => {
    mounted = mount(<VideoPlayer {...BASE} controls={false} autoplay />);
    await flush();
    seen(0.6);
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    const pause = button(mounted.container, "Pause video");
    expect(pause).not.toBeNull();
    click(pause);
    expect(paused).toContain(videoOf(mounted));
    const resume = button(mounted.container, "Play video");
    expect(resume).not.toBeNull();
    const before = played.length;
    click(resume);
    expect(played.length).toBe(before + 1);
    expect(button(mounted.container, "Pause video")).not.toBeNull();
  });

  it("a visitor's pause is not undone by scrolling back into view", async () => {
    mounted = mount(<VideoPlayer {...BASE} controls={false} autoplay />);
    await flush();
    seen(0.6);
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    click(button(mounted.container, "Pause video"));
    const before = played.length;
    seen(1);
    expect(played.length).toBe(before);
  });

  it("controls off, no autoplay: a click-to-play video can be paused (CR-D01)", async () => {
    mounted = mount(<VideoPlayer {...BASE} controls={false} loop />);
    await flush();
    expect(button(mounted.container, "Pause video")).toBeNull();
    click(button(mounted.container, "Play video: Spring tour"));
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    const pause = button(mounted.container, "Pause video");
    expect(pause).not.toBeNull();
    click(pause);
    expect(paused).toContain(videoOf(mounted));
  });

  it("controls off, no autoplay: a video a pop-up started can be paused (CR-D01)", async () => {
    mounted = mount(<VideoPlayer {...BASE} controls={false} />);
    await flush();
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    expect(button(mounted.container, "Pause video")).not.toBeNull();
  });

  it("no toggle when controls are on", async () => {
    mounted = mount(<VideoPlayer {...BASE} autoplay />);
    await flush();
    act(() => {
      videoOf(mounted!).dispatchEvent(new Event("play"));
    });
    expect(button(mounted.container, "Pause video")).toBeNull();
  });

  it("swallows a rejected play()", async () => {
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    mounted = mount(<VideoPlayer {...BASE} autoplay />);
    await flush();
    seen(1);
    await flush();
    expect(played).toHaveLength(1);
  });

  it("unmount disconnects the observer", async () => {
    mounted = mount(<VideoPlayer {...BASE} autoplay />);
    await flush();
    expect(observers).toHaveLength(1);
    mounted.unmount();
    mounted = null;
    expect(observers[0]!.disconnected).toBe(true);
  });
});
