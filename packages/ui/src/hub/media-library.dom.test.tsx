// @vitest-environment jsdom
// 07-17 Task 2: Media library components (CONT-14, CONT-19, CONT-21, CONT-35, D280,
// D-UI-P7-4/5/7/9; 07-UI-SPEC "Media", "Upload states", "Media detail drawer", "Describe
// photos", "Accessibility contract"; T-07-17-04).
import { act, useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DescribeList } from "./DescribeList";
import { MediaDetailDrawer } from "./MediaDetailDrawer";
import { MediaDropZone, MediaUploadButton } from "./MediaDropZone";
import { MediaFilters } from "./MediaFilters";
import { MediaGrid } from "./MediaGrid";
import { MediaTile } from "./MediaTile";
import { UsageMeter } from "./UsageMeter";
import {
  MEDIA_ACCEPT,
  MEDIA_COPY,
  type LibraryItemView,
  type UsageView,
  type UsedOnView,
} from "./media/copy";
import type { UploadResult } from "./media/upload";
import {
  useMediaUploads,
  type MediaUploader,
  type MediaUploads,
  type UploadTileView,
} from "./useMediaUploads";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../test-support/dom";

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
    };
  }
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const MB = 1024 * 1024;
const GB = 1024 ** 3;

function usage(level: UsageView["level"], ratio: number): UsageView {
  return {
    usedBytes: ratio * 2 * GB,
    allowanceBytes: 2 * GB,
    ratio,
    level,
    label: "1.2 GB of 2 GB used",
    message:
      level === "warn"
        ? "You've used 1.7 GB of your 2 GB of media. Delete files you no longer use to keep room for new ones."
        : level === "full"
          ? MEDIA_COPY.usageFull
          : "",
  };
}

function item(p: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id: "i1",
    kind: "image",
    rowKind: "library",
    name: "IMG_2041.jpg",
    alt: "",
    needsDescription: true,
    status: "ready",
    width: 2560,
    height: 1707,
    bytes: Math.round(1.8 * MB),
    durationS: 0,
    createdAt: "2026-09-12T19:14:00.000Z",
    thumbUrl: "/hub/media/i1/thumb",
    previewUrl: "/hub/media/i1/w960",
    posterUrl: null,
    ...p,
  };
}

const video = (p: Partial<LibraryItemView> = {}) =>
  item({
    id: "v1",
    kind: "video",
    rowKind: "video",
    name: "Tour.mp4",
    needsDescription: false,
    width: 0,
    height: 0,
    bytes: 18 * MB,
    durationS: 42,
    thumbUrl: "/hub/media/v1/poster.webp",
    previewUrl: "/hub/media/v1/video.mp4",
    posterUrl: "/hub/media/v1/poster.webp",
    ...p,
  });

function file(name: string, type: string, size = 1000): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function pick(input: Element | null, files: File[]) {
  if (!input) throw new Error("no input");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function key(el: Element | null, k: string) {
  act(() => {
    el?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

describe("UsageMeter", () => {
  it("ok: label, meter aria and an ink fill, no alert", () => {
    mounted = mount(<UsageMeter usage={usage("ok", 0.6)} />);
    const meter = mounted.container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("60");
    expect(meter?.getAttribute("aria-valuemin")).toBe("0");
    expect(meter?.getAttribute("aria-valuemax")).toBe("100");
    expect(meter?.getAttribute("aria-valuetext")).toBe("1.2 GB of 2 GB used");
    expect(
      mounted.container.querySelector("[data-usage-fill]")?.className,
    ).toContain("bg-hub-ink");
    expect(mounted.container.textContent).toContain("1.2 GB of 2 GB used");
    expect(mounted.container.textContent).not.toContain("You've used");
  });

  it("warn: warning fill and the USAGE-80 alert", () => {
    mounted = mount(<UsageMeter usage={usage("warn", 0.85)} />);
    expect(
      mounted.container.querySelector("[data-usage-fill]")?.className,
    ).toContain("bg-hub-warning");
    expect(mounted.container.textContent).toContain("You've used 1.7 GB");
  });

  it("full: danger fill and nothing extra", () => {
    mounted = mount(<UsageMeter usage={usage("full", 1)} />);
    expect(
      mounted.container.querySelector("[data-usage-fill]")?.className,
    ).toContain("bg-hub-danger");
    expect(mounted.container.textContent).not.toContain(MEDIA_COPY.usageFull);
  });
});

describe("MediaUploadButton", () => {
  it("is a multi-file input with the media accept list", () => {
    const onFiles = vi.fn();
    mounted = mount(
      <MediaUploadButton usage={usage("ok", 0.1)} onFiles={onFiles} />,
    );
    const input =
      mounted.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toBe(MEDIA_ACCEPT);
    expect(mounted.container.textContent).toContain("Upload files");
    expect(mounted.container.textContent).toContain("Choose files");
    const f = file("a.jpg", "image/jpeg");
    pick(input, [f]);
    expect(onFiles).toHaveBeenCalledWith([f]);
  });

  it("at 100% the button is replaced by USAGE-FULL", () => {
    mounted = mount(
      <MediaUploadButton usage={usage("full", 1)} onFiles={vi.fn()} />,
    );
    expect(mounted.container.querySelector('input[type="file"]')).toBeNull();
    expect(mounted.container.textContent).toBe(MEDIA_COPY.usageFull);
  });
});

describe("MediaTile", () => {
  it("a photo tile is one named button with a lazy thumb and the badge", () => {
    const onOpen = vi.fn();
    mounted = mount(<MediaTile item={item()} onOpen={onOpen} />);
    const b = button(
      mounted.container,
      "IMG_2041.jpg, photo, needs description",
    );
    expect(b).not.toBeNull();
    const img = mounted.container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(mounted.container.textContent).toContain("2560 × 1707 · 1.8 MB");
    expect(mounted.container.textContent).toContain("Needs description");
    click(b);
    expect(onOpen).toHaveBeenCalledWith("i1");
  });

  it("an optimizing video shows the badge, the bar and VIDEO-PROCESSING", () => {
    mounted = mount(<MediaTile item={video({ videoState: "optimizing" })} />);
    expect(
      button(mounted.container, "Tour.mp4, video, optimizing"),
    ).not.toBeNull();
    expect(mounted.container.textContent).toContain("Optimizing");
    expect(mounted.container.textContent).toContain(MEDIA_COPY.videoProcessing);
    expect(
      mounted.container.querySelector('[role="progressbar"]'),
    ).not.toBeNull();
  });

  it("a waiting video says another is being optimized first", () => {
    mounted = mount(<MediaTile item={video({ videoState: "waiting" })} />);
    expect(mounted.container.textContent).toContain("Waiting to optimize");
    expect(mounted.container.textContent).toContain(
      "Another video is being optimized first.",
    );
  });

  it("a failed video offers Try again to writers only", () => {
    const onRetry = vi.fn();
    mounted = mount(
      <MediaTile
        item={video({ videoState: "failed" })}
        canWrite
        onRetry={onRetry}
      />,
    );
    expect(mounted.container.textContent).toContain("Couldn't optimize");
    expect(mounted.container.textContent).toContain(MEDIA_COPY.videoFailed);
    click(button(mounted.container, "Try again"));
    expect(onRetry).toHaveBeenCalledWith("v1");
    mounted.unmount();
    mounted = mount(
      <MediaTile item={video({ videoState: "failed" })} onRetry={onRetry} />,
    );
    expect(button(mounted.container, "Try again")).toBeNull();
  });

  it("a finally failed video shows the final copy and Remove", () => {
    const onRemove = vi.fn();
    mounted = mount(
      <MediaTile
        item={video({ videoState: "failed-final" })}
        canWrite
        onRemove={onRemove}
      />,
    );
    expect(mounted.container.textContent).toContain(
      MEDIA_COPY.videoFailedFinal,
    );
    click(button(mounted.container, "Remove"));
    expect(onRemove).toHaveBeenCalledWith("v1");
  });

  it("an audio tile shows its length and size", () => {
    mounted = mount(
      <MediaTile
        item={item({
          id: "a1",
          kind: "audio",
          name: "Song.mp3",
          needsDescription: false,
          durationS: 192,
          bytes: Math.round(4.4 * MB),
          thumbUrl: null,
        })}
      />,
    );
    expect(button(mounted.container, "Song.mp3, audio")).not.toBeNull();
    expect(mounted.container.textContent).toContain("3:12 · 4.4 MB");
  });

  it("a hostile name renders as text", () => {
    const evil = "<img src=x onerror=alert(1)>.jpg";
    mounted = mount(<MediaTile item={item({ name: evil })} />);
    expect(mounted.container.textContent).toContain(evil);
    expect(mounted.container.querySelectorAll("img")).toHaveLength(1);
    expect(mounted.container.querySelector('img[src="x"]')).toBeNull();
  });
});

describe("upload tiles", () => {
  const tile = (p: Partial<UploadTileView>): UploadTileView => ({
    key: "u1",
    name: "IMG_2041.jpg",
    kind: "image",
    preview: null,
    status: "uploading",
    pct: 42,
    ...p,
  });

  it("uploading: determinate bar, percentage and a named Stop", () => {
    const onStop = vi.fn();
    mounted = mount(<MediaTile upload={tile({})} onStop={onStop} />);
    const bar = mounted.container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
    expect(mounted.container.textContent).toContain("Uploading… 42%");
    click(button(mounted.container, "Stop uploading IMG_2041.jpg"));
    expect(onStop).toHaveBeenCalledWith("u1");
  });

  it("processing shows the web-ready line; a video asks to keep the page open", () => {
    mounted = mount(
      <MediaTile upload={tile({ status: "processing", pct: 100 })} />,
    );
    expect(mounted.container.textContent).toContain("Making web-ready copies…");
    mounted.unmount();
    mounted = mount(
      <MediaTile upload={tile({ kind: "video", name: "Tour.mp4" })} />,
    );
    expect(mounted.container.textContent).toContain(MEDIA_COPY.keepOpen);
  });

  it("error: the message in an alert and Remove", () => {
    const onRemove = vi.fn();
    mounted = mount(
      <MediaTile
        upload={tile({ status: "error", message: MEDIA_COPY.videoType })}
        onRemove={onRemove}
      />,
    );
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain(MEDIA_COPY.videoType);
    click(button(mounted.container, "Remove"));
    expect(onRemove).toHaveBeenCalledWith("u1");
  });
});

describe("MediaGrid", () => {
  it("shows 12 skeleton tiles while loading", () => {
    mounted = mount(<MediaGrid items={[]} loading />);
    expect(
      mounted.container.querySelectorAll("[data-skeleton-tile]"),
    ).toHaveLength(12);
  });

  it("empty and not filtered: EMPTY-MEDIA with a drop zone for writers", () => {
    mounted = mount(<MediaGrid items={[]} canWrite onFiles={vi.fn()} />);
    expect(mounted.container.textContent).toContain("No media yet");
    expect(mounted.container.textContent).toContain(MEDIA_COPY.emptyBody);
    expect(mounted.container.querySelector("[data-media-drop]")).not.toBeNull();
  });

  it("filtered empty: the clear line and Clear filters", () => {
    const onClear = vi.fn();
    mounted = mount(<MediaGrid items={[]} filtered onClearFilters={onClear} />);
    expect(mounted.container.textContent).toContain(MEDIA_COPY.filteredEmpty);
    expect(mounted.container.textContent).not.toContain("No media yet");
    click(button(mounted.container, "Clear filters"));
    expect(onClear).toHaveBeenCalled();
  });

  it("upload tiles come first, then items; Load more at the end", () => {
    const onMore = vi.fn();
    mounted = mount(
      <MediaGrid
        items={[item()]}
        uploads={[
          {
            key: "u1",
            name: "new.jpg",
            kind: "image",
            preview: null,
            status: "queued",
            pct: 0,
          },
        ]}
        hasMore
        onLoadMore={onMore}
      />,
    );
    const lis = mounted.container.querySelectorAll("li");
    expect(lis[0]?.getAttribute("data-upload-tile")).toBe("queued");
    expect(lis[1]?.getAttribute("data-media-tile")).toBe("i1");
    click(button(mounted.container, "Load more"));
    expect(onMore).toHaveBeenCalled();
  });

  it("picker mode is a listbox with arrow keys, Home/End and Space", () => {
    const onToggle = vi.fn();
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    mounted = mount(
      <MediaGrid
        items={items}
        selectable="multi"
        selectedIds={["b"]}
        onToggle={onToggle}
      />,
    );
    const list = mounted.container.querySelector('[role="listbox"]');
    expect(list?.getAttribute("aria-multiselectable")).toBe("true");
    const opts =
      mounted.container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(opts).toHaveLength(3);
    expect(opts[1]!.getAttribute("aria-selected")).toBe("true");
    expect(opts[0]!.getAttribute("tabindex")).toBe("0");
    expect(opts[1]!.getAttribute("tabindex")).toBe("-1");
    act(() => opts[0]!.focus());
    key(opts[0]!, "ArrowRight");
    expect(document.activeElement).toBe(opts[1]);
    key(opts[1]!, "End");
    expect(document.activeElement).toBe(opts[2]);
    key(opts[2]!, "Home");
    expect(document.activeElement).toBe(opts[0]);
    key(opts[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(opts[0]);
    key(opts[0]!, " ");
    expect(onToggle).toHaveBeenCalledWith("a");
    key(opts[0]!, "Enter");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("single picker mode has no aria-multiselectable", () => {
    mounted = mount(<MediaGrid items={[item()]} selectable="single" />);
    expect(
      mounted.container
        .querySelector('[role="listbox"]')
        ?.hasAttribute("aria-multiselectable"),
    ).toBe(false);
  });
});

describe("MediaFilters", () => {
  const counts = { all: 150, images: 142, videos: 8, audio: 0 };

  it("All · Images · Videos with counts; Audio only when audio exists", () => {
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={counts}
        needsDescription={0}
        describeHref="/d"
        onChange={vi.fn()}
      />,
    );
    const labels = Array.from(mounted.container.querySelectorAll("label"))
      .map((l) => l.textContent)
      .filter((t) => /\d/.test(t ?? ""));
    expect(labels).toEqual(["All150", "Images142", "Videos8"]);
    mounted.unmount();
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={{ ...counts, audio: 2 }}
        needsDescription={0}
        describeHref="/d"
        onChange={vi.fn()}
      />,
    );
    expect(mounted.container.textContent).toContain("Audio2");
  });

  it("choosing a filter calls onChange", () => {
    const onChange = vi.fn();
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={counts}
        needsDescription={0}
        describeHref="/d"
        onChange={onChange}
      />,
    );
    click(mounted.container.querySelector('input[value="videos"]'));
    expect(onChange).toHaveBeenCalledWith({ filter: "videos" });
  });

  it("search waits 300ms, Enter searches at once", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={counts}
        needsDescription={0}
        describeHref="/d"
        onChange={onChange}
      />,
    );
    const input = mounted.container.querySelector('input[type="search"]');
    typeInto(input, "tour");
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledWith({ q: "tour" });
    typeInto(input, "bread");
    key(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith({ q: "bread" });
  });

  it("the describe notice shows only when photos need a description", () => {
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={counts}
        needsDescription={12}
        describeHref="/hub/website?tab=media&view=describe"
        onChange={vi.fn()}
      />,
    );
    const link = mounted.container.querySelector("[data-describe-link]");
    expect(link?.getAttribute("href")).toBe(
      "/hub/website?tab=media&view=describe",
    );
    expect(link?.textContent).toBe(
      "12 photos need a description · Describe them",
    );
    mounted.unmount();
    mounted = mount(
      <MediaFilters
        filter="all"
        q=""
        counts={counts}
        needsDescription={0}
        describeHref="/d"
        onChange={vi.fn()}
      />,
    );
    expect(mounted.container.querySelector("[data-describe-link]")).toBeNull();
  });
});

describe("MediaDropZone", () => {
  it("dropping files hands them over; disabled ignores drops", () => {
    const onFiles = vi.fn();
    mounted = mount(<MediaDropZone onFiles={onFiles} />);
    const zone = mounted.container.querySelector("[data-media-drop]")!;
    const f = file("a.jpg", "image/jpeg");
    const drop = () => {
      const e = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { files: [f] } });
      act(() => {
        zone.dispatchEvent(e);
      });
    };
    drop();
    expect(onFiles).toHaveBeenCalledWith([f]);
    mounted.unmount();
    onFiles.mockClear();
    mounted = mount(<MediaDropZone onFiles={onFiles} disabled />);
    const zone2 = mounted.container.querySelector("[data-media-drop]")!;
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { files: [f] } });
    act(() => {
      zone2.dispatchEvent(e);
    });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe("useMediaUploads", () => {
  type Pending = {
    name: string;
    resolve(r: UploadResult): void;
    signal?: AbortSignal;
    progress?: (f: number) => void;
  };

  function fakeUploader() {
    const pending: Pending[] = [];
    const uploader: MediaUploader = {
      image: (f, opts) =>
        new Promise((resolve) => {
          pending.push({
            name: f.name,
            resolve,
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(opts.onProgress ? { progress: opts.onProgress } : {}),
          });
          opts.signal?.addEventListener("abort", () =>
            resolve({ ok: false, message: "", aborted: true }),
          );
        }),
      chunked: (f, _k, opts) =>
        new Promise((resolve) => {
          pending.push({ name: f.name, resolve });
          opts.signal?.addEventListener("abort", () =>
            resolve({ ok: false, message: "", aborted: true }),
          );
        }),
    };
    return { pending, uploader };
  }

  function Harness(props: {
    uploader: MediaUploader;
    kinds?: ("image" | "video" | "audio")[];
    onUploaded?: (id: string, kind: string) => void;
    onBatchDone?: (s: unknown) => void;
    expose: (u: MediaUploads) => void;
  }) {
    const u = useMediaUploads({
      uploader: props.uploader,
      ...(props.kinds ? { kinds: props.kinds } : {}),
      ...(props.onUploaded ? { onUploaded: props.onUploaded } : {}),
      ...(props.onBatchDone ? { onBatchDone: props.onBatchDone } : {}),
    });
    const { expose } = props;
    useEffect(() => {
      expose(u);
    });
    return (
      <ul>
        {u.tiles.map((t) => (
          <li key={t.key} data-tile={t.status}>
            {t.name}|{t.message ?? ""}|{t.pct}
          </li>
        ))}
      </ul>
    );
  }

  it("refused files become error tiles and are never uploaded", () => {
    const { pending, uploader } = fakeUploader();
    let api: MediaUploads | null = null;
    mounted = mount(<Harness uploader={uploader} expose={(u) => (api = u)} />);
    act(() => api!.add([file("doc.pdf", "application/pdf")]));
    expect(pending).toHaveLength(0);
    expect(
      mounted.container.querySelector('[data-tile="error"]')?.textContent,
    ).toContain("This file isn't a photo we can use");
  });

  it("uploads one at a time in order and reports the batch", async () => {
    const { pending, uploader } = fakeUploader();
    const onUploaded = vi.fn();
    const onBatchDone = vi.fn();
    let api: MediaUploads | null = null;
    mounted = mount(
      <Harness
        uploader={uploader}
        onUploaded={onUploaded}
        onBatchDone={onBatchDone}
        expose={(u) => (api = u)}
      />,
    );
    act(() =>
      api!.add([
        file("a.jpg", "image/jpeg"),
        file("b.mp4", "video/mp4"),
        file("c.txt", "text/plain"),
      ]),
    );
    expect(pending.map((p) => p.name)).toEqual(["a.jpg"]);
    act(() => pending[0]!.progress?.(0.42));
    expect(mounted.container.textContent).toContain("a.jpg||42");
    act(() => pending[0]!.resolve({ ok: true, assetId: "m1" }));
    await flush();
    expect(pending.map((p) => p.name)).toEqual(["a.jpg", "b.mp4"]);
    expect(onUploaded).toHaveBeenCalledWith("m1", "image");
    expect(onBatchDone).not.toHaveBeenCalled();
    act(() => pending[1]!.resolve({ ok: true, assetId: "v1" }));
    await flush();
    expect(onUploaded).toHaveBeenLastCalledWith("v1", "video");
    expect(onBatchDone).toHaveBeenCalledWith({
      images: 1,
      videos: 1,
      audio: 0,
      failed: 1,
    });
    // Only the refused file's tile is left.
    expect(mounted.container.querySelectorAll("li")).toHaveLength(1);
  });

  it("stop aborts the running file and drops a queued one", async () => {
    const { pending, uploader } = fakeUploader();
    const onUploaded = vi.fn();
    let api: MediaUploads | null = null;
    mounted = mount(
      <Harness
        uploader={uploader}
        onUploaded={onUploaded}
        expose={(u) => (api = u)}
      />,
    );
    act(() =>
      api!.add([file("a.jpg", "image/jpeg"), file("b.jpg", "image/jpeg")]),
    );
    const keys = api!.tiles.map((t) => t.key);
    act(() => api!.stop(keys[1]!));
    expect(api!.tiles).toHaveLength(1);
    act(() => api!.stop(keys[0]!));
    expect(pending[0]!.signal?.aborted).toBe(true);
    await flush();
    expect(api!.tiles).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("a failure keeps an error tile that Remove clears; kinds restrict the picker", async () => {
    const { pending, uploader } = fakeUploader();
    let api: MediaUploads | null = null;
    mounted = mount(
      <Harness
        uploader={uploader}
        kinds={["video"]}
        expose={(u) => (api = u)}
      />,
    );
    act(() =>
      api!.add([file("a.jpg", "image/jpeg"), file("t.mp4", "video/mp4")]),
    );
    expect(api!.tiles[0]!.message).toBe(MEDIA_COPY.videoType);
    act(() => pending[0]!.resolve({ ok: false, message: MEDIA_COPY.failed }));
    await flush();
    expect(api!.tiles.map((t) => t.status)).toEqual(["error", "error"]);
    act(() => api!.remove(api!.tiles[1]!.key));
    expect(api!.tiles).toHaveLength(1);
  });
});

describe("MediaDetailDrawer", () => {
  const notUsed: UsedOnView = {
    pages: [],
    inVersions: false,
    inPopups: false,
  };
  const used: UsedOnView = {
    pages: [
      { id: "p1", title: "Home" },
      { id: "p2", title: "About" },
    ],
    inVersions: false,
    inPopups: false,
  };

  function open(p: Partial<Parameters<typeof MediaDetailDrawer>[0]> = {}) {
    const props = {
      open: true,
      item: item(),
      usedOn: notUsed,
      canWrite: true,
      timeZone: "America/Chicago",
      onClose: vi.fn(),
      onDescribe: vi.fn(async () => ({ ok: true as const, data: null })),
      onDelete: vi.fn(),
      onCaptions: vi.fn(),
      onChooseCover: vi.fn(),
      onResetCover: vi.fn(),
      pageHref: (id: string) => `/hub/website/pages/${id}`,
      ...p,
    };
    mounted = mount(<MediaDetailDrawer {...props} />);
    return props;
  }

  it("shows the meta, Used on links and the used delete body with Keep focused", () => {
    const props = open({ usedOn: used });
    const text = document.body.textContent ?? "";
    expect(text).toContain("1.8 MB");
    expect(text).toContain("2560 × 1707");
    expect(text).toContain("12 Sep, 2:14 pm");
    const links = Array.from(document.querySelectorAll("[data-used-on] a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/hub/website/pages/p1",
      "/hub/website/pages/p2",
    ]);
    click(button(document.body, "Delete photo"));
    expect(document.querySelector("[data-delete-body]")?.textContent).toBe(
      MEDIA_COPY.deleteUsedBody,
    );
    expect(document.activeElement?.textContent).toBe("Keep photo");
    const dialogs = document.querySelectorAll("dialog");
    const del = Array.from(
      dialogs[dialogs.length - 1]!.querySelectorAll("button"),
    ).find((b) => b.textContent === "Delete photo");
    click(del);
    expect(props.onDelete).toHaveBeenCalledWith("i1");
  });

  it("an unused file gets the deleted-for-good body", () => {
    open({ usedOn: notUsed });
    expect(document.body.textContent).toContain(MEDIA_COPY.notUsed);
    click(button(document.body, "Delete photo"));
    expect(document.querySelector("[data-delete-body]")?.textContent).toBe(
      MEDIA_COPY.deleteUnusedBody,
    );
  });

  it("a file in a kept version counts as used", () => {
    open({ usedOn: { ...notUsed, inVersions: true } });
    click(button(document.body, "Delete photo"));
    expect(document.querySelector("[data-delete-body]")?.textContent).toBe(
      MEDIA_COPY.deleteUsedBody,
    );
  });

  it("Save description is disabled until changed; blank is refused locally", async () => {
    const props = open({ item: item({ alt: "Old", needsDescription: false }) });
    const save = button(document.body, "Save description")!;
    expect(save.disabled).toBe(true);
    const area = document.querySelector("textarea");
    typeInto(area, "   ");
    expect(save.disabled).toBe(false);
    click(save);
    expect(document.body.textContent).toContain(MEDIA_COPY.altMissing);
    expect(props.onDescribe).not.toHaveBeenCalled();
    typeInto(area, "Loaves cooling on a rack");
    click(save);
    await flush();
    expect(props.onDescribe).toHaveBeenCalledWith(
      "i1",
      "Loaves cooling on a rack",
    );
  });

  it("a photo without a description shows the badge and the alt-text helper", () => {
    open();
    expect(document.body.textContent).toContain("Needs description");
    expect(document.body.textContent).toContain("(also called alt text)");
  });

  it("captions: a non-.vtt or large file is refused; a .vtt is handed over", () => {
    const props = open({ item: video({ videoState: "ready" }) });
    const input = document.querySelector('input[type="file"]');
    pick(input, [file("subs.srt", "application/x-subrip", 1000)]);
    expect(document.body.textContent).toContain(MEDIA_COPY.captions);
    expect(props.onCaptions).not.toHaveBeenCalled();
    pick(input, [file("subs.vtt", "text/vtt", 600 * 1024)]);
    expect(props.onCaptions).not.toHaveBeenCalled();
    const good = file("subs.vtt", "text/vtt", 1000);
    pick(input, [good]);
    expect(props.onCaptions).toHaveBeenCalledWith(good);
  });

  it("captions set: Replace and Remove; cover: choose and reset", () => {
    const props = open({
      item: video({
        videoState: "ready",
        hasCaptions: true,
        customCover: true,
      }),
    });
    expect(document.body.textContent).toContain("captions.vtt");
    click(button(document.body, "Remove"));
    expect(props.onCaptions).toHaveBeenCalledWith(null);
    click(button(document.body, "Choose a different cover"));
    expect(props.onChooseCover).toHaveBeenCalled();
    click(button(document.body, "Use the generated cover"));
    expect(props.onResetCover).toHaveBeenCalled();
    expect(button(document.body, "Save description")).toBeNull();
    expect(button(document.body, "Delete video")).not.toBeNull();
  });

  it("read-only roles see no write controls", () => {
    open({ canWrite: false, item: video({ videoState: "ready" }) });
    for (const name of [
      "Save description",
      "Delete video",
      "Choose a different cover",
    ]) {
      expect(button(document.body, name)).toBeNull();
    }
    expect(document.querySelector('input[type="file"]')).toBeNull();
    mounted?.unmount();
    open({ canWrite: false });
    expect(document.querySelector("textarea")).toBeNull();
    expect(button(document.body, "Delete photo")).toBeNull();
  });

  it("MOVE-TO-YOUTUBE only when asked; a deleted file says so", () => {
    open({ item: video({ videoState: "ready" }), moveToYouTube: true });
    expect(document.body.textContent).toContain(MEDIA_COPY.moveToYouTube);
    mounted?.unmount();
    open({ item: item({ deleted: true }) });
    expect(document.body.textContent).toContain(MEDIA_COPY.deletedLabel);
    expect(button(document.body, "Delete photo")).toBeNull();
  });
});

describe("DescribeList", () => {
  const rows = [
    {
      id: "a",
      name: "IMG_1.jpg",
      thumbUrl: "/hub/media/a/thumb",
      suggestion: "IMG 1",
    },
    {
      id: "b",
      name: "IMG_2.jpg",
      thumbUrl: "/hub/media/b/thumb",
      suggestion: "IMG 2",
    },
  ];

  function blur(el: Element | null) {
    act(() => {
      (el as HTMLElement).focus();
      (el as HTMLElement).blur();
    });
  }

  it("saves on blur, collapses the row and the polite count drops", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, data: null }));
    mounted = mount(
      <DescribeList rows={rows} onSave={onSave} backHref="/back" />,
    );
    const count = mounted.container.querySelector('[aria-live="polite"]');
    expect(count?.textContent).toBe("2 left");
    expect(mounted.container.textContent).toContain("Describe your photos");
    const input = mounted.container.querySelector(
      "input[id]",
    ) as HTMLInputElement;
    expect(input.value).toBe("IMG 1");
    expect(
      mounted.container.querySelector(`label[for="${input.id}"]`)?.textContent,
    ).toBe("Description of IMG_1.jpg");
    typeInto(input, "Loaves cooling on a rack");
    blur(input);
    await flush();
    expect(onSave).toHaveBeenCalledWith([
      { id: "a", alt: "Loaves cooling on a rack" },
    ]);
    expect(mounted.container.textContent).toContain(
      "Saved: Loaves cooling on a rack",
    );
    expect(count?.textContent).toBe("1 left");
  });

  it("a blank or untouched value never saves", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, data: null }));
    mounted = mount(
      <DescribeList rows={rows} onSave={onSave} backHref="/back" />,
    );
    const input = mounted.container.querySelector("input") as HTMLInputElement;
    blur(input);
    typeInto(input, "  ");
    blur(input);
    await flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Use this saves a right suggestion without editing it (WR-E07)", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, data: null }));
    mounted = mount(
      <DescribeList rows={rows} onSave={onSave} backHref="/back" />,
    );
    click(button(mounted.container, "Use this: IMG 1"));
    await flush();
    expect(onSave).toHaveBeenCalledWith([{ id: "a", alt: "IMG 1" }]);
    expect(mounted.container.textContent).toContain("Saved: IMG 1");
    expect(
      mounted.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe("1 left");
    // An edited value saves on blur instead; no Use this.
    const input = mounted.container.querySelector("input") as HTMLInputElement;
    typeInto(input, "Bread rack");
    expect(button(mounted.container, /^Use this/)).toBeNull();
  });

  it("a failed save says Not saved and keeps the value", async () => {
    const onSave = vi.fn(async () => ({
      ok: false as const,
      code: "failed",
      message: "x",
    }));
    mounted = mount(
      <DescribeList rows={rows} onSave={onSave} backHref="/back" />,
    );
    const input = mounted.container.querySelector("input") as HTMLInputElement;
    typeInto(input, "Rack");
    blur(input);
    await flush();
    expect(mounted.container.textContent).toContain("Not saved.");
    expect(button(mounted.container, "Try again")).not.toBeNull();
    expect(input.value).toBe("Rack");
    expect(
      mounted.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe("2 left");
  });

  it("nothing left: the done state and the way back", () => {
    mounted = mount(
      <DescribeList rows={[]} onSave={vi.fn()} backHref="/back" />,
    );
    expect(mounted.container.textContent).toContain(
      MEDIA_COPY.describeDoneHeading,
    );
    expect(mounted.container.textContent).toContain(
      MEDIA_COPY.describeDoneBody,
    );
    const back = Array.from(mounted.container.querySelectorAll("a")).find(
      (a) => a.textContent === "Back to all media",
    );
    expect(back?.getAttribute("href")).toBe("/back");
  });
});
