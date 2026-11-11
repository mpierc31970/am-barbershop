// @vitest-environment jsdom
// 07-17 Task 3: MediaField and the Image item's library picking (CONT-14, D-UI-P7-5/10;
// 07-UI-SPEC "Media picker", "Column items" Image row). A fake MediaSource; no request leaves.
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ColumnItem } from "@cds/core/content";
import { ColumnItemForm } from "./ColumnItemForm";
import { MediaField } from "./MediaField";
import type { LibraryItemView, PickedMedia } from "../hub/media/copy";
import type { MediaSource } from "../hub/media/source";
import { ToastRegion } from "../hub/Toast";
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
    createdAt: "",
    thumbUrl: `/hub/media/${id}/thumb`,
    previewUrl: `/hub/media/${id}/web`,
    posterUrl: null,
    ...p,
  };
}

function fakeSource(library: LibraryItemView[]) {
  const byId = new Map(library.map((i) => [i.id, i]));
  const source: MediaSource = {
    list: vi.fn(async () => ({
      ok: true as const,
      data: {
        page: {
          items: library.filter((i) => !i.deleted),
          total: library.length,
          page: 1,
          perPage: 60,
          counts: { all: 0, images: 0, videos: 0, audio: 0 },
          needsDescription: 0,
        },
        usage: {
          usedBytes: 0,
          allowanceBytes: 1,
          ratio: 0,
          level: "ok" as const,
          label: "",
          message: "",
        },
      },
    })),
    items: vi.fn(async (ids: readonly string[]) => ({
      ok: true as const,
      data: ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
    })),
    states: vi.fn(async () => ({ ok: true as const, data: {} })),
    describe: vi.fn(async () => ({ ok: true as const, data: { count: 1 } })),
  };
  return source;
}

const picker = () => document.querySelector("[data-media-picker]")!;
const option = (id: string) =>
  document.querySelector<HTMLElement>(`[data-media-option="${id}"]`);

function Harness({
  source,
  multiple = false,
  kind = "image",
  initial = "",
  onPicked,
}: {
  source: MediaSource;
  multiple?: boolean;
  kind?: "image" | "video" | "audio";
  initial?: string | string[];
  onPicked?: (p: PickedMedia[]) => void;
}) {
  const [value, setValue] = useState<string | string[]>(initial);
  return (
    <MediaField
      id="f"
      label="Photo"
      kind={kind}
      multiple={multiple}
      value={value}
      source={source}
      onChange={(picked) => {
        onPicked?.(picked);
        setValue(multiple ? picked.map((p) => p.id) : (picked[0]?.id ?? ""));
      }}
    />
  );
}

describe("MediaField", () => {
  it("empty: a Choose a photo target that opens the picker", async () => {
    const source = fakeSource([item("a")]);
    mounted = mount(<Harness source={source} />);
    const choose = button(mounted.container, "Choose a photo")!;
    expect(choose).not.toBeNull();
    expect(picker().hasAttribute("open")).toBe(false);
    click(choose);
    await flush();
    expect(picker().hasAttribute("open")).toBe(true);
    expect(source.list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "images" }),
    );
  });

  it("after Use this photo: thumb, name, Replace · Remove and onChange with the alt", async () => {
    const onPicked = vi.fn();
    const source = fakeSource([item("a")]);
    mounted = mount(<Harness source={source} onPicked={onPicked} />);
    click(button(mounted.container, "Choose a photo"));
    await flush();
    click(option("a"));
    click(button(picker(), "Use this photo"));
    await flush();
    expect(onPicked).toHaveBeenCalledWith([
      expect.objectContaining({ id: "a", alt: "Photo a" }),
    ]);
    const row = mounted.container.querySelector('[data-media-field-item="a"]');
    expect(row?.textContent).toContain("a.jpg");
    expect(row?.querySelector("img")?.getAttribute("src")).toBe(
      "/hub/media/a/thumb",
    );
    expect(button(mounted.container, "Replace")).not.toBeNull();
    click(button(mounted.container, "Remove"));
    expect(onPicked).toHaveBeenLastCalledWith([]);
    expect(button(mounted.container, "Choose a photo")).not.toBeNull();
  });

  it("a value id is looked up through source.items on mount", async () => {
    const source = fakeSource([item("a")]);
    mounted = mount(<Harness source={source} initial="a" />);
    await flush();
    expect(source.items).toHaveBeenCalledWith(["a"]);
    expect(mounted.container.textContent).toContain("a.jpg");
  });

  it("a deleted asset says so and offers Choose another", async () => {
    const source = fakeSource([item("a", { deleted: true })]);
    mounted = mount(<Harness source={source} initial="a" />);
    await flush();
    expect(mounted.container.textContent).toContain("Deleted from your media");
    expect(button(mounted.container, "Choose another")).not.toBeNull();
    expect(button(mounted.container, "Replace")).toBeNull();
  });

  it("multiple returns every picked item in order", async () => {
    const onPicked = vi.fn();
    const source = fakeSource([item("a"), item("b"), item("c")]);
    mounted = mount(
      <Harness source={source} multiple onPicked={onPicked} initial={[]} />,
    );
    click(button(mounted.container, "Choose photos"));
    await flush();
    click(option("c"));
    click(option("a"));
    click(button(picker(), "Use 2 photos"));
    expect(onPicked.mock.calls[0]![0].map((p: PickedMedia) => p.id)).toEqual([
      "c",
      "a",
    ]);
  });

  it("video and audio kinds show their own title and icon", async () => {
    const source = fakeSource([
      item("v", {
        kind: "video",
        posterUrl: "/hub/media/v/poster.webp",
        thumbUrl: "/hub/media/v/poster.webp",
      }),
    ]);
    mounted = mount(<Harness source={source} kind="video" initial="v" />);
    await flush();
    expect(
      mounted.container
        .querySelector('[data-media-field-item="v"] img')
        ?.getAttribute("src"),
    ).toBe("/hub/media/v/poster.webp");
    expect(picker().querySelector("h2")).toBeNull();
    mounted.unmount();
    mounted = mount(<Harness source={fakeSource([])} kind="audio" />);
    expect(button(mounted.container, "Choose audio")).not.toBeNull();
  });
});

describe("ColumnItemForm image item (07-17)", () => {
  function form(it: ColumnItem, onSave = vi.fn(async () => {})) {
    mounted = mount(
      <ToastRegion>
        <ColumnItemForm
          item={it}
          popups={[]}
          allowPopupButton={false}
          onSave={onSave}
          onCancel={() => {}}
        />
      </ToastRegion>,
    );
    return onSave;
  }

  const label = (text: string) =>
    Array.from(document.querySelectorAll("label")).find(
      (l) => l.textContent === text,
    );
  const input = (text: string) =>
    document.getElementById(label(text)!.htmlFor) as HTMLInputElement;

  it("shows Photo, a required Description and a closed link disclosure", () => {
    form({ id: "i", kind: "image", url: "", alt: "" });
    expect(document.body.textContent).toContain("Photo");
    expect(button(document.body, "Choose a photo")).not.toBeNull();
    expect(input("Description").required).toBe(true);
    expect(document.body.textContent).toContain(
      "Describe the photo for people who can't see it.",
    );
    const details = document.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe(
      "Paste a link instead",
    );
    expect(details.open).toBe(false);
  });

  it("an item that already uses an address opens the disclosure", () => {
    form({ id: "i", kind: "image", url: "https://x.test/a.jpg", alt: "A" });
    expect(document.querySelector("details")!.open).toBe(true);
    expect(input("Image address").value).toBe("https://x.test/a.jpg");
  });

  it("picking a library photo sets asset, clears url and fills the description", async () => {
    // The default fetchMediaSource is replaced by stubbing fetch for this form.
    const lib = [item("a1", { alt: "Loaves cooling" })];
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url, "https://h");
      if (u.searchParams.has("ids")) {
        return new Response(JSON.stringify({ items: lib }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          page: {
            items: lib,
            total: 1,
            page: 1,
            perPage: 60,
            counts: { all: 1, images: 1, videos: 0, audio: 0 },
            needsDescription: 0,
          },
          usage: { level: "ok" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onSave = form({
        id: "i",
        kind: "image",
        url: "https://x.test/old.jpg",
        alt: "",
      });
      click(button(document.body, "Choose a photo"));
      await flush();
      click(option("a1"));
      click(button(document.body, "Use this photo"));
      await flush();
      expect(input("Description").value).toBe("Loaves cooling");
      expect(input("Image address").value).toBe("");
      click(button(document.body, "Save item"));
      await flush();
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "image",
          asset: "a1",
          url: "",
          alt: "Loaves cooling",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("replacing a photo takes the new photo's description (WR-E04)", async () => {
    const lib = [
      item("a0", { alt: "Old storefront" }),
      item("a1", { alt: "Loaves cooling" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url, "https://h");
        const body = u.searchParams.has("ids")
          ? { items: lib }
          : {
              page: {
                items: lib,
                total: 2,
                page: 1,
                perPage: 60,
                counts: { all: 2, images: 2, videos: 0, audio: 0 },
                needsDescription: 0,
              },
              usage: { level: "ok" },
            };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    try {
      form({
        id: "i",
        kind: "image",
        url: "",
        asset: "a0",
        alt: "Old storefront",
      });
      await flush();
      click(button(document.body, /Replace/));
      await flush();
      click(option("a1"));
      click(button(document.body, "Use this photo"));
      await flush();
      expect(input("Description").value).toBe("Loaves cooling");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("typing an address clears the library photo", async () => {
    const onSave = form({
      id: "i",
      kind: "image",
      url: "",
      alt: "A",
      asset: "a1",
    });
    act(() => {
      document.querySelector("details")!.open = true;
    });
    typeInto(input("Image address"), "https://x.test/b.jpg");
    click(button(document.body, "Save item"));
    await flush();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://x.test/b.jpg", asset: "" }),
    );
  });
});
