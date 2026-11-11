// @vitest-environment jsdom
// 07-14: video in pop-ups plays muted on open and stops on close (CONT-21; choice 8).
import { act } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ConsentFrameIsland } from "./client/ConsentFrameIsland";
import {
  PopupController,
  type PopupControllerConfig,
} from "./client/PopupController";
import {
  POPUP_CLOSE_EVENT,
  POPUP_OPEN_EVENT,
  POPUP_PLAY_ATTR,
} from "./client/popup-media";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";
import { VideoItem } from "./items/VideoItem";
import { playPopupMedia, stopPopupMedia } from "./client/popup-media";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

const played: { el: HTMLMediaElement; muted: boolean }[] = [];
const paused: HTMLMediaElement[] = [];
let playResult: () => Promise<void> = () => Promise.resolve();

beforeEach(() => {
  played.length = 0;
  paused.length = 0;
  playResult = () => Promise.resolve();
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

let mounted: Mounted | null = null;
let restoreMatchMedia: (() => void) | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

let seq = 0;
function config(id: string): PopupControllerConfig {
  return {
    id,
    trigger: "click",
    delay_seconds: 5,
    scroll_percent: 50,
    frequency: "every-visit",
    show_on: "button-only",
    page_ids: [],
    enabled: true,
  };
}

function setup() {
  const id = `vid${(seq += 1)}`;
  const dialog = document.createElement("dialog");
  dialog.dataset.cdsPopup = id;
  dialog.innerHTML =
    `<video ${POPUP_PLAY_ATTR}="" src="/_media/a.mp4"></video>` +
    '<video src="/_media/b.mp4"></video>' +
    '<audio src="/_media/c.mp3"></audio>' +
    '<button type="button" data-cds-popup-close="">Close</button>';
  document.body.appendChild(dialog);
  const outside = document.createElement("video");
  outside.setAttribute(POPUP_PLAY_ATTR, "");
  document.body.appendChild(outside);
  const open = document.createElement("button");
  open.type = "button";
  open.dataset.cdsPopupOpen = id;
  document.body.appendChild(open);
  const events: string[] = [];
  dialog.addEventListener(POPUP_OPEN_EVENT, () => events.push("open"));
  dialog.addEventListener(POPUP_CLOSE_EVENT, () => events.push("close"));
  mounted = mount(<PopupController config={[config(id)]} pageId={id} />);
  const [autoplay, plain] = Array.from(dialog.querySelectorAll("video"));
  const audio = dialog.querySelector("audio")!;
  return { dialog, outside, open, events, autoplay, plain, audio };
}

function reduceMotion(): void {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce") || q.includes("min-width"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = original;
  };
}

describe("pop-up media (CONT-21)", () => {
  it("opening plays marked videos muted and announces cds:popup-open", async () => {
    const { open, events, autoplay, outside } = setup();
    await flush();
    click(open);
    expect(events).toEqual(["open"]);
    expect(played).toEqual([{ el: autoplay, muted: true }]);
    expect(autoplay!.playsInline).toBe(true);
    expect(played.some((p) => p.el === outside)).toBe(false);
  });

  it("closing pauses every video and audio inside, and announces cds:popup-close", async () => {
    const { dialog, open, events, autoplay, plain, audio, outside } = setup();
    await flush();
    click(open);
    click(button(dialog, "Close"));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(events).toEqual(["open", "close"]);
    expect(paused).toEqual(expect.arrayContaining([autoplay, plain, audio]));
    expect(paused).not.toContain(outside);
  });

  it("Esc (dialog close) and a backdrop click stop media too", async () => {
    const { dialog, open, audio } = setup();
    await flush();
    click(open);
    act(() => dialog.close());
    expect(paused).toContain(audio);
    paused.length = 0;
    click(open);
    act(() => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(paused).toContain(audio);
  });

  it("does not autoplay under reduced motion", async () => {
    reduceMotion();
    const { open, dialog } = setup();
    await flush();
    click(open);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(played).toEqual([]);
  });

  it("swallows a rejected play()", async () => {
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    const { open } = setup();
    await flush();
    click(open);
    await flush();
    expect(played).toHaveLength(1);
  });
});

describe("a loaded provider frame in a pop-up", () => {
  it("reloads (a new iframe) on cds:popup-close, which stops playback", async () => {
    mounted = mount(
      <dialog data-cds-popup="p1" open>
        <ConsentFrameIsland
          source={{ kind: "link", provider: "youtube", id: "dQw4w9WgXcQ" }}
          kind="video"
          title="Tour"
          providerLabel="YouTube"
          fallbackHref="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          line="Plays from YouTube, which may set cookies."
        />
      </dialog>,
    );
    await flush();
    click(button(mounted.container, "Play video: Tour, from YouTube"));
    await flush();
    const before = mounted.container.querySelector("iframe");
    expect(before).not.toBeNull();
    const dialog = mounted.container.querySelector("dialog")!;
    act(() => {
      dialog.dispatchEvent(new CustomEvent(POPUP_CLOSE_EVENT));
    });
    await flush();
    const after = mounted.container.querySelector("iframe");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});

describe("07-23: VideoItem in a pop-up (CONT-21)", () => {
  it("an MP4 item plays muted on open and pauses on close; a link item is never played", async () => {
    const NOW = new Date("2026-10-01T12:00:00.000Z");
    const media = {
      v1: {
        id: "v1",
        kind: "video" as const,
        src: "/_media/v1/video.mp4",
        poster: "/_media/v1/poster.webp",
        alt: "",
      },
    };
    mounted = mount(
      <dialog data-cds-popup="p9" open>
        <VideoItem
          now={NOW}
          media={media}
          item={{
            id: "v",
            kind: "video",
            title: "Upload",
            source: "media",
            asset: "v1",
            provider: "",
            provider_id: "",
            cover: "",
            shape: "16:9",
            controls: true,
            loop: false,
            autoplay: false,
          }}
        />
        <VideoItem
          now={NOW}
          media={media}
          item={{
            id: "l",
            kind: "video",
            title: "Link",
            source: "link",
            asset: "",
            provider: "youtube",
            provider_id: "dQw4w9WgXcQ",
            cover: "",
            shape: "16:9",
            controls: true,
            loop: false,
            autoplay: false,
          }}
        />
      </dialog>,
    );
    await flush();
    const dialog = mounted.container.querySelector("dialog")!;
    const videos = dialog.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const mp4 = videos[0]!;
    expect(mp4.hasAttribute(POPUP_PLAY_ATTR)).toBe(true);
    act(() => playPopupMedia(dialog, { reducedMotion: false }));
    expect(played).toEqual([{ el: mp4, muted: true }]);
    expect(dialog.querySelector("iframe")).toBeNull();
    act(() => stopPopupMedia(dialog));
    expect(paused).toContain(mp4);
  });
});
