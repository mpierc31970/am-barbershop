// @vitest-environment jsdom
// 07-17 Task 2: MediaPicker (CONT-14, CONT-19, CONT-21, D-UI-P7-5/9/10/11; 07-UI-SPEC "Media
// picker"). A fake MediaSource stands in for the library route; no request leaves the test.
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HubActionResult } from "./addon-types";
import { MediaPicker } from "./MediaPicker";
import {
  MEDIA_COPY,
  type LibraryItemView,
  type MediaKind,
  type PickedMedia,
  type UsageView,
} from "./media/copy";
import type { MediaListResult, MediaSource } from "./media/source";
import type { MediaUploader } from "./useMediaUploads";
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

function item(id: string, p: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id,
    kind: "image",
    rowKind: "library",
    name: `${id}.jpg`,
    alt: `Photo ${id}`,
    needsDescription: false,
    status: "ready",
    width: 800,
    height: 600,
    bytes: 1000,
    durationS: 0,
    createdAt: "2026-09-12T19:14:00.000Z",
    thumbUrl: `/hub/media/${id}/thumb`,
    previewUrl: `/hub/media/${id}/web`,
    posterUrl: null,
    ...p,
  };
}

const OK_USAGE: UsageView = {
  usedBytes: 0,
  allowanceBytes: 1,
  ratio: 0,
  level: "ok",
  label: "0 GB of 2 GB used",
  message: "",
};

function fakeSource(
  items: LibraryItemView[],
  opts: {
    usage?: UsageView;
    total?: number;
    fail?: boolean;
    pages?: LibraryItemView[][];
  } = {},
) {
  const list = vi.fn(
    async (o: { page?: number }): Promise<HubActionResult<MediaListResult>> => {
      if (opts.fail) {
        return { ok: false, code: "network", message: MEDIA_COPY.errLoad };
      }
      const pageNo = o.page ?? 1;
      const pageItems = opts.pages ? (opts.pages[pageNo - 1] ?? []) : items;
      return {
        ok: true,
        data: {
          page: {
            items: pageItems,
            total: opts.total ?? pageItems.length,
            page: pageNo,
            perPage: 60,
            counts: { all: 0, images: 0, videos: 0, audio: 0 },
            needsDescription: 0,
          },
          usage: opts.usage ?? OK_USAGE,
        },
      };
    },
  );
  const source: MediaSource = {
    list,
    items: vi.fn(async (ids: readonly string[]) => ({
      ok: true as const,
      data: ids.map((id) => item(id, { alt: "", needsDescription: true })),
    })),
    states: vi.fn(async () => ({ ok: true as const, data: {} })),
    describe: vi.fn(async () => ({ ok: true as const, data: { count: 1 } })),
  };
  return { source, list };
}

function Harness({
  kind = "image",
  multiple = false,
  source,
  uploader,
  onUse,
}: {
  kind?: MediaKind;
  multiple?: boolean;
  source: MediaSource;
  uploader?: MediaUploader;
  onUse: (p: PickedMedia[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
      <MediaPicker
        open={open}
        kind={kind}
        multiple={multiple}
        source={source}
        {...(uploader ? { uploader } : {})}
        onUse={onUse}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

async function openPicker(props: Parameters<typeof Harness>[0]) {
  mounted = mount(<Harness {...props} />);
  const opener = button(mounted.container, "Open picker")!;
  act(() => opener.focus());
  click(opener);
  await flush();
  return opener;
}

const picker = () => document.querySelector("[data-media-picker]")!;
const option = (id: string) =>
  document.querySelector<HTMLElement>(`[data-media-option="${id}"]`);

describe("MediaPicker", () => {
  it("opens on Your media with the kind's filter; no Free photos tab", async () => {
    const { source, list } = fakeSource([item("a")]);
    await openPicker({ source, onUse: vi.fn() });
    expect(picker().querySelector("h2")?.textContent).toBe("Choose a photo");
    const tabs = Array.from(picker().querySelectorAll('[role="tab"]')).map(
      (t) => t.textContent,
    );
    expect(tabs).toEqual(["Your media", "Upload"]);
    expect(picker().textContent).not.toContain("Free photos");
    expect(list).toHaveBeenCalledWith({
      filter: "images",
      q: "",
      page: 1,
      perPage: 60,
    });
    expect(picker().querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("titles follow kind and multiple", async () => {
    const { source } = fakeSource([]);
    await openPicker({ source, kind: "audio", onUse: vi.fn() });
    expect(picker().querySelector("h2")?.textContent).toBe("Choose audio");
    mounted?.unmount();
    await openPicker({ source, multiple: true, onUse: vi.fn() });
    expect(picker().querySelector("h2")?.textContent).toBe("Choose photos");
  });

  it("a described photo can be used at once", async () => {
    const onUse = vi.fn();
    const { source } = fakeSource([item("a"), item("b")]);
    await openPicker({ source, onUse });
    const use = button(picker(), "Use this photo")!;
    expect(use.disabled).toBe(true);
    click(option("b"));
    expect(option("b")?.getAttribute("aria-selected")).toBe("true");
    expect(use.disabled).toBe(false);
    click(use);
    expect(onUse).toHaveBeenCalledWith([
      expect.objectContaining({ id: "b", alt: "Photo b", kind: "image" }),
    ]);
    expect(picker().hasAttribute("open")).toBe(false);
  });

  it("a single photo without a description is blocked until it is described", async () => {
    const onUse = vi.fn();
    const { source } = fakeSource([
      item("a", { alt: "", needsDescription: true }),
    ]);
    await openPicker({ source, onUse });
    click(option("a"));
    const use = button(picker(), "Use this photo")!;
    expect(use.disabled).toBe(true);
    const strip = picker().querySelector("[data-describe-strip]")!;
    expect(strip).not.toBeNull();
    click(button(strip, "Save description"));
    expect(picker().textContent).toContain(MEDIA_COPY.altMissing);
    expect(source.describe).not.toHaveBeenCalled();
    typeInto(strip.querySelector("input"), "Loaves cooling");
    click(button(strip, "Save description"));
    await flush();
    expect(source.describe).toHaveBeenCalledWith([
      { id: "a", alt: "Loaves cooling" },
    ]);
    expect(picker().querySelector("[data-describe-strip]")).toBeNull();
    expect(use.disabled).toBe(false);
    click(use);
    expect(onUse).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "a",
        alt: "Loaves cooling",
        needsDescription: false,
      }),
    ]);
  });

  it("a failed describe keeps the strip with the server copy", async () => {
    const { source } = fakeSource([
      item("a", { alt: "", needsDescription: true }),
    ]);
    source.describe = vi.fn(async () => ({
      ok: false as const,
      code: "invalid_input",
      message: "Keep the description under 250 characters.",
    }));
    await openPicker({ source, onUse: vi.fn() });
    click(option("a"));
    const strip = picker().querySelector("[data-describe-strip]")!;
    typeInto(strip.querySelector("input"), "x");
    click(button(strip, "Save description"));
    await flush();
    expect(picker().textContent).toContain(
      "Keep the description under 250 characters.",
    );
    expect(button(picker(), "Use this photo")!.disabled).toBe(true);
  });

  it("multi-select counts, never blocks on descriptions and keeps pick order", async () => {
    const onUse = vi.fn();
    const { source } = fakeSource([
      item("a"),
      item("b", { alt: "", needsDescription: true }),
      item("c"),
    ]);
    await openPicker({ source, multiple: true, onUse });
    click(option("c"));
    click(option("a"));
    click(option("b"));
    expect(picker().textContent).toContain("3 selected");
    const use = button(picker(), "Use 3 photos")!;
    expect(use.disabled).toBe(false);
    expect(picker().querySelector("[data-describe-strip]")).toBeNull();
    click(use);
    expect(onUse.mock.calls[0]![0].map((p: PickedMedia) => p.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(onUse.mock.calls[0]![0][2].needsDescription).toBe(true);
  });

  it("an empty kind shows its own line", async () => {
    const { source } = fakeSource([]);
    await openPicker({ source, kind: "video", onUse: vi.fn() });
    expect(picker().textContent).toContain(
      "No videos yet. Upload an MP4 here, or paste a YouTube link in the video settings instead.",
    );
  });

  it("a failed load shows ERR-LOAD", async () => {
    const { source } = fakeSource([], { fail: true });
    await openPicker({ source, onUse: vi.fn() });
    expect(picker().querySelector('[role="alert"]')?.textContent).toContain(
      MEDIA_COPY.errLoad,
    );
  });

  it("search reloads after 300ms; Load more appends the next page", async () => {
    const { source, list } = fakeSource([], {
      pages: [[item("a")], [item("b")]],
      total: 120,
    });
    await openPicker({ source, onUse: vi.fn() });
    click(button(picker(), "Load more"));
    await flush();
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, perPage: 60 }),
    );
    expect(option("a")).not.toBeNull();
    expect(option("b")).not.toBeNull();
    typeInto(picker().querySelector('input[type="search"]'), "bread");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    await flush();
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "bread", page: 1 }),
    );
  });

  it("a Load more answer that lands after a new search is dropped (WR-E05)", async () => {
    let releasePage2: (() => void) | null = null;
    const page = (items: LibraryItemView[], pageNo: number) => ({
      ok: true as const,
      data: {
        page: {
          items,
          total: 120,
          page: pageNo,
          perPage: 60,
          counts: { all: 0, images: 0, videos: 0, audio: 0 },
          needsDescription: 0,
        },
        usage: OK_USAGE,
      },
    });
    const { source } = fakeSource([]);
    source.list = vi.fn(async (o: { q?: string; page?: number }) =>
      o.page === 2
        ? new Promise<ReturnType<typeof page>>((resolve) => {
            releasePage2 = () => resolve(page([item("old2")], 2));
          })
        : page([item(o.q === "bread" ? "loaf" : "a")], 1),
    ) as MediaSource["list"];
    await openPicker({ source, onUse: vi.fn() });
    click(button(picker(), "Load more"));
    await flush();
    typeInto(picker().querySelector('input[type="search"]'), "bread");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    await flush();
    expect(option("loaf")).not.toBeNull();
    await act(async () => {
      releasePage2!();
    });
    await flush();
    expect(option("old2")).toBeNull();
    expect(option("loaf")).not.toBeNull();
  });

  it("the Upload tab shows USAGE-FULL instead of the drop zone at 100%", async () => {
    const { source } = fakeSource([item("a")], {
      usage: { ...OK_USAGE, level: "full", ratio: 1 },
    });
    await openPicker({ source, onUse: vi.fn() });
    click(button(picker(), "Upload"));
    expect(picker().querySelector("[data-usage-full]")?.textContent).toBe(
      MEDIA_COPY.usageFull,
    );
    expect(picker().querySelector("[data-media-drop]")).toBeNull();
  });

  it("at 100% an owner gets the Add storage link and never a purchase (10-43)", async () => {
    const full =
      "You've used all 2 GB of your media storage. Add more, or delete something to make room.";
    const { source } = fakeSource([item("a")], {
      usage: {
        ...OK_USAGE,
        level: "full",
        ratio: 1,
        message: full,
        canBuy: true,
        storageHref: "/hub/settings?tab=billing#storage",
        offers: [{ size: "5gb", label: "Add 5 GB for $5/mo" }],
      },
    });
    await openPicker({ source, onUse: vi.fn() });
    click(button(picker(), "Upload"));
    expect(picker().querySelector("[data-usage-full]")?.textContent).toBe(full);
    const link =
      picker().querySelector<HTMLAnchorElement>("[data-add-storage]");
    expect(link?.textContent).toBe("Add storage");
    expect(link?.getAttribute("href")).toBe(
      "/hub/settings?tab=billing#storage",
    );
    expect(button(picker(), /Add 5 GB/)).toBeNull();
  });

  it("an uploaded photo is fetched, selected and asks for its description", async () => {
    const uploader: MediaUploader = {
      image: async () => ({ ok: true, assetId: "new1" }),
      chunked: async () => ({ ok: false, message: "x" }),
    };
    const { source } = fakeSource([]);
    await openPicker({ source, uploader, onUse: vi.fn() });
    click(button(picker(), "Upload"));
    const input = picker().querySelector(
      '[data-media-drop] input[type="file"]',
    )!;
    expect(input.getAttribute("accept")).toBe(
      "image/jpeg,image/png,image/webp",
    );
    const f = new File(["x"], "new1.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(source.items).toHaveBeenCalledWith(["new1"]);
    expect(option("new1")?.getAttribute("aria-selected")).toBe("true");
    expect(picker().querySelector("[data-describe-strip]")).not.toBeNull();
    expect(button(picker(), "Use this photo")!.disabled).toBe(true);
  });

  it("a file of another kind is refused on the Upload tab", async () => {
    const uploader: MediaUploader = {
      image: vi.fn(async () => ({ ok: true as const, assetId: "x" })),
      chunked: vi.fn(async () => ({ ok: true as const, assetId: "x" })),
    };
    const { source } = fakeSource([]);
    await openPicker({ source, kind: "video", uploader, onUse: vi.fn() });
    click(button(picker(), "Upload"));
    const input = picker().querySelector(
      '[data-media-drop] input[type="file"]',
    )!;
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(picker().textContent).toContain(MEDIA_COPY.videoType);
    expect(uploader.image).not.toHaveBeenCalled();
  });

  it("the X closes without a selection and focus returns to the opener", async () => {
    const onUse = vi.fn();
    const { source } = fakeSource([item("a")]);
    const opener = await openPicker({ source, onUse });
    click(option("a"));
    click(button(picker(), "Close"));
    expect(onUse).not.toHaveBeenCalled();
    expect(picker().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

// 07-30 (CONT-28, D-UI-P7-11; choices 9, 10): the Free photos tab.
describe("MediaPicker Free photos (07-30)", () => {
  const PHOTO = {
    id: "abc_1",
    source: "unsplash" as const,
    url: "https://images.unsplash.com/photo-1?w=1080",
    thumbUrl: "https://images.unsplash.com/photo-1?w=400",
    width: 4000,
    height: 3000,
    alt: "Loaves of bread",
    creditName: "Ana Silva",
    creditUrl:
      "https://unsplash.com/@ana?utm_source=cds_platform&utm_medium=referral",
  };

  function fakeStock(available = true) {
    return {
      available: vi.fn(async () => available),
      search: vi.fn(async () => ({
        ok: true as const,
        data: { photos: [PHOTO], hasMore: false },
      })),
      use: vi.fn(async () => undefined),
    };
  }

  function StockHarness(props: {
    kind?: MediaKind;
    multiple?: boolean;
    allowStock?: boolean;
    stock: ReturnType<typeof fakeStock>;
    onUse: (p: PickedMedia[]) => void;
  }) {
    const [open, setOpen] = useState(false);
    const { source } = fakeSource([item("a")]);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open picker
        </button>
        <MediaPicker
          open={open}
          kind={props.kind ?? "image"}
          multiple={props.multiple ?? false}
          source={source}
          allowStock={props.allowStock ?? true}
          stock={props.stock}
          onUse={props.onUse}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  async function openStock(props: Parameters<typeof StockHarness>[0]) {
    mounted = mount(<StockHarness {...props} />);
    click(button(mounted.container, "Open picker"));
    await flush();
  }

  const tabNames = () =>
    Array.from(picker().querySelectorAll('[role="tab"]')).map(
      (t) => t.textContent,
    );

  it("is absent when unavailable, multiple, not an image or not allowed", async () => {
    for (const p of [
      { stock: fakeStock(false) },
      { stock: fakeStock(), multiple: true },
      { stock: fakeStock(), kind: "video" as MediaKind },
      { stock: fakeStock(), allowStock: false },
    ]) {
      await openStock({ ...p, onUse: vi.fn() });
      expect(tabNames()).toEqual(["Your media", "Upload"]);
      mounted?.unmount();
      mounted = null;
      document.body.innerHTML = "";
    }
  });

  it("searches, shows the credit, requires a description and returns a stock pick", async () => {
    const stock = fakeStock();
    const onUse = vi.fn();
    await openStock({ stock, onUse });
    expect(tabNames()).toEqual(["Your media", "Upload", "Free photos"]);
    click(button(picker(), "Free photos"));
    await flush();
    const search = picker().querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    expect(picker().textContent).toContain("Search free photos, like 'bakery'");
    typeInto(search, "bakery");
    act(() => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();
    expect(stock.search).toHaveBeenCalledWith("bakery", 1);
    const tile = picker().querySelector<HTMLElement>(
      '[data-stock-tile="abc_1"]',
    )!;
    expect(tile.textContent).toContain("Photo by Ana Silva");
    click(tile);
    await flush();
    const strip = picker().querySelector('[data-describe-strip="stock"]')!;
    const alt = strip.querySelector<HTMLInputElement>("input")!;
    expect(alt.value).toBe("Loaves of bread");
    typeInto(alt, "");
    const use = button(picker(), "Use this photo")!;
    click(use);
    await flush();
    expect(onUse).not.toHaveBeenCalled();
    expect(strip.textContent).toContain(MEDIA_COPY.altMissing);
    typeInto(alt, "Fresh sourdough");
    click(button(picker(), "Use this photo"));
    await flush();
    expect(stock.use).toHaveBeenCalledWith("abc_1");
    expect(onUse).toHaveBeenCalledWith([
      {
        id: "",
        kind: "image",
        name: "Photo by Ana Silva",
        alt: "Fresh sourdough",
        thumbUrl: PHOTO.thumbUrl,
        width: 4000,
        height: 3000,
        needsDescription: false,
        stock: {
          url: PHOTO.url,
          width: 4000,
          height: 3000,
          creditName: "Ana Silva",
          creditUrl: PHOTO.creditUrl,
          source: "unsplash",
          photoId: "abc_1",
        },
      },
    ]);
  });

  it("clearing the search mid-request stops the spinner (WR-E06)", async () => {
    const stock = fakeStock();
    stock.search.mockImplementation(() => new Promise(() => {}));
    await openStock({ stock, onUse: vi.fn() });
    click(button(picker(), "Free photos"));
    await flush();
    const search = picker().querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    const enter = () =>
      act(() => {
        search.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
    typeInto(search, "bakery");
    enter();
    await flush();
    const listbox = () =>
      picker().querySelector('[role="listbox"][aria-label="Free photos"]');
    expect(listbox()?.getAttribute("aria-busy")).toBe("true");
    typeInto(search, "");
    enter();
    await flush();
    expect(listbox()?.hasAttribute("aria-busy")).toBe(false);
  });

  it("a failed search shows ERR-LOAD", async () => {
    const stock = fakeStock();
    stock.search.mockResolvedValue({
      ok: false,
      code: "network",
      message: MEDIA_COPY.errLoad,
    } as never);
    await openStock({ stock, onUse: vi.fn() });
    click(button(picker(), "Free photos"));
    await flush();
    const search = picker().querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    typeInto(search, "cake");
    act(() => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();
    expect(picker().textContent).toContain(MEDIA_COPY.errLoad);
  });
});
