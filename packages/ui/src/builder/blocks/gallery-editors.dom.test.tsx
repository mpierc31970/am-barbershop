// @vitest-environment jsdom
// GalleryEditor and LogoStripEditor (07-22 Task 3; CONT-22, CONT-27; UI-SPEC rows 357/365,
// line 664 Undo copy, line 686 drag-sort a11y). A fake MediaSource and a stub MediaPicker
// stand in for the library route; uploads go through a mocked uploadImageFile.
import { act, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GALLERY_MAX_COPY,
  LOGO_STRIP_MAX_COPY,
  LOGO_STRIP_NAME_COPY,
  defaultGalleryContent,
  defaultLogoStripContent,
  type GalleryImage,
  type LogoStripLogo,
} from "@cds/core/content";
import type { LibraryItemView, PickedMedia } from "../../hub/media/copy";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import type { CoreBlockEditorProps } from "./types";

const h = vi.hoisted(() => ({
  library: new Map<string, unknown>(),
  describeCalls: [] as { id: string; alt: string }[][],
  itemsCalls: [] as string[][],
  picks: [] as unknown[],
  pickerProps: null as null | { kind: string; multiple?: boolean },
  uploadSeq: 0,
}));

vi.mock("../../hub/media/source", () => ({
  MEDIA_LIBRARY_URL: "/hub/api/media/library",
  fetchMediaSource: {
    list: async () => ({ ok: false, code: "x", message: "x" }),
    states: async () => ({ ok: true, data: {} }),
    items: async (ids: readonly string[]) => {
      h.itemsCalls.push([...ids]);
      return {
        ok: true,
        data: ids
          .filter((id) => h.library.has(id))
          .map((id) => h.library.get(id)),
      };
    },
    describe: async (entries: readonly { id: string; alt: string }[]) => {
      h.describeCalls.push([...entries]);
      return { ok: true, data: { count: entries.length } };
    },
  },
}));

vi.mock("../../hub/MediaPicker", () => ({
  MediaPicker: (props: {
    open: boolean;
    kind: string;
    multiple?: boolean;
    onUse: (p: unknown[]) => void;
  }) => {
    if (!props.open) return null;
    h.pickerProps = { kind: props.kind, multiple: props.multiple };
    return (
      <div data-fake-picker="">
        <button type="button" onClick={() => props.onUse(h.picks)}>
          Use fake picks
        </button>
      </div>
    );
  },
}));

vi.mock("../../hub/media/upload", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    uploadImageFile: async (file: File) => {
      const assetId = `up${++h.uploadSeq}`;
      h.library.set(assetId, libItem(assetId, { name: file.name }));
      return { ok: true, assetId };
    },
  };
});

function libItem(
  id: string,
  over: Partial<LibraryItemView> = {},
): LibraryItemView {
  return {
    id,
    kind: "image",
    rowKind: "image",
    name: `${id}.jpg`,
    alt: "",
    needsDescription: true,
    status: "ready",
    width: 800,
    height: 600,
    bytes: 1,
    durationS: 0,
    createdAt: "",
    thumbUrl: `/hub/api/media/image/${id}/thumb`,
    previewUrl: "",
    posterUrl: null,
    ...over,
  };
}

function picked(id: string, over: Partial<PickedMedia> = {}): PickedMedia {
  return {
    id,
    kind: "image",
    name: `${id}.jpg`,
    alt: "",
    thumbUrl: `/t/${id}`,
    width: 800,
    height: 600,
    needsDescription: true,
    ...over,
  };
}

const { GalleryEditor } = await import("./GalleryEditor");
const { LogoStripEditor } = await import("./LogoStripEditor");

let mounted: Mounted | null = null;
beforeEach(() => {
  h.library.clear();
  h.describeCalls.length = 0;
  h.itemsCalls.length = 0;
  h.picks = [];
  h.pickerProps = null;
  h.uploadSeq = 0;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function harness(Editor: ComponentType<CoreBlockEditorProps>, initial: object) {
  let current: Record<string, unknown> = { ...initial };
  const changes: string[] = [];
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(current);
    return (
      <Editor
        type="x"
        content={content}
        errors={{}}
        popups={[]}
        onChange={(name, value) => {
          changes.push(name);
          current = { ...current, [name]: value };
          setContent(current);
        }}
      />
    );
  }
  mounted = mount(
    <ToastRegion>
      <Host />
    </ToastRegion>,
  );
  return { root: mounted.container, content: () => current, changes };
}

const images = (c: Record<string, unknown>) => c.images as GalleryImage[];
const thumbs = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-gallery-thumb] > button"),
  );
const labelled = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll("label")).find((l) =>
    l.textContent?.startsWith(text),
  );
const fieldFor = (root: HTMLElement, text: string) =>
  document.getElementById(labelled(root, text)!.htmlFor) as
    HTMLInputElement | HTMLTextAreaElement;

function drop(root: HTMLElement, files: File[]) {
  const zone = root.querySelector("[data-media-drop]")!;
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { files } });
  act(() => {
    zone.dispatchEvent(e);
  });
}

function blur(el: Element) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function addThree() {
  const t = harness(GalleryEditor, defaultGalleryContent());
  h.picks = [
    picked("m1", { needsDescription: false, alt: "Shop front" }),
    picked("m2", { name: "IMG_2041.jpg" }),
    picked("m3", { name: "loaves.jpg" }),
  ];
  click(button(t.root, "Add photos"));
  expect(h.pickerProps).toEqual({ kind: "image", multiple: true });
  click(button(t.root, "Use fake picks"));
  await flush();
  return t;
}

describe("GalleryEditor", () => {
  it("adds picks in order with the description pre-fill and amber badges", async () => {
    const t = await addThree();
    const list = images(t.content());
    expect(list.map((i) => [i.asset, i.alt, i.alt_reviewed])).toEqual([
      ["m1", "", true],
      ["m2", "Photo 2", false],
      ["m3", "Loaves", false],
    ]);
    expect(thumbs(t.root)).toHaveLength(3);
    const badges = t.root.querySelectorAll("[data-gallery-thumb]");
    expect(badges[0]!.textContent).not.toContain("Needs description");
    expect(badges[1]!.textContent).toContain("Needs description");
    expect(badges[2]!.textContent).toContain("Needs description");
    expect(thumbs(t.root)[1]!.getAttribute("aria-label")).toBe(
      "Photo 2: Photo 2, needs description",
    );
    expect(t.root.textContent).toContain("2 photos need a description.");
    expect(t.root.querySelector("[data-fake-picker]")).toBeNull();
  });

  it("the panel edits Description and Caption; editing clears the badge and backfills the library once", async () => {
    const t = await addThree();
    click(thumbs(t.root)[1]);
    const desc = fieldFor(t.root, "Description");
    expect(desc.tagName).toBe("TEXTAREA");
    expect(desc.value).toBe("Photo 2");
    expect(t.root.textContent).toContain("7 / 250");
    typeInto(desc, "Baker at the oven");
    expect(images(t.content())[1]).toMatchObject({
      alt: "Baker at the oven",
      alt_reviewed: true,
    });
    expect(
      t.root.querySelectorAll("[data-gallery-thumb]")[1]!.textContent,
    ).not.toContain("Needs description");
    blur(fieldFor(t.root, "Description"));
    blur(fieldFor(t.root, "Description"));
    await flush();
    expect(h.describeCalls).toEqual([[{ id: "m2", alt: "Baker at the oven" }]]);
    typeInto(fieldFor(t.root, "Caption"), "Fresh at 6am");
    expect(images(t.content())[1]!.caption).toBe("Fresh at 6am");
  });

  it("never backfills a photo the library already describes", async () => {
    const t = await addThree();
    click(thumbs(t.root)[0]);
    expect(fieldFor(t.root, "Description").value).toBe("Shop front");
    typeInto(fieldFor(t.root, "Description"), "Our shop front");
    blur(fieldFor(t.root, "Description"));
    await flush();
    expect(h.describeCalls).toEqual([]);
  });

  it("Next photo that needs a description and Describe them walk the amber photos", async () => {
    const t = await addThree();
    click(button(t.root, "Describe them"));
    await flush();
    expect(fieldFor(t.root, "Description").value).toBe("Photo 2");
    click(button(t.root, "Next photo that needs a description"));
    expect(fieldFor(t.root, "Description").value).toBe("Loaves");
  });

  it("Move photo 2 earlier reorders", async () => {
    const t = await addThree();
    click(button(t.root, "Move photo 2 earlier"));
    expect(images(t.content()).map((i) => i.asset)).toEqual(["m2", "m1", "m3"]);
    expect(t.root.textContent).toContain("Photo 2 moved to position 1.");
  });

  it("Remove from gallery toasts with Undo, which restores the photo at its index", async () => {
    const t = await addThree();
    click(thumbs(t.root)[1]);
    click(button(t.root, "Remove from gallery"));
    expect(images(t.content()).map((i) => i.asset)).toEqual(["m1", "m3"]);
    expect(document.body.textContent).toContain(
      "Photo removed from the gallery.",
    );
    click(button(document.body, "Undo"));
    expect(images(t.content()).map((i) => i.asset)).toEqual(["m1", "m2", "m3"]);
  });

  it("Mosaic hides Columns; Slider hides Columns and Photos per page", () => {
    const t = harness(GalleryEditor, defaultGalleryContent());
    expect(labelled(t.root, "Columns")).toBeTruthy();
    expect(labelled(t.root, "Photos per page")).toBeTruthy();
    const radio = (v: string) =>
      t.root.querySelector<HTMLInputElement>(
        `input[type="radio"][value="${v}"]`,
      )!;
    click(radio("mosaic"));
    expect(t.content().display).toBe("mosaic");
    expect(labelled(t.root, "Columns")).toBeUndefined();
    expect(labelled(t.root, "Photos per page")).toBeTruthy();
    click(radio("slider"));
    expect(labelled(t.root, "Columns")).toBeUndefined();
    expect(labelled(t.root, "Photos per page")).toBeUndefined();
    expect(t.root.textContent).toContain("Open photos larger when clicked");
    expect(t.root.textContent).toContain("Show captions");
  });

  it("dropping files uploads them and appends each with the pre-fill rule", async () => {
    const t = harness(GalleryEditor, defaultGalleryContent());
    expect(t.root.querySelector("[data-media-drop]")!.textContent).toContain(
      "Drop photos here, or choose from your media",
    );
    drop(t.root, [
      new File(["a"], "IMG_0001.jpg", { type: "image/jpeg" }),
      new File(["b"], "sourdough-loaf.jpg", { type: "image/jpeg" }),
    ]);
    await flush(15);
    expect(
      images(t.content()).map((i) => [i.asset, i.alt, i.alt_reviewed]),
    ).toEqual([
      ["up1", "Photo 1", false],
      ["up2", "Sourdough loaf", false],
    ]);
  });

  it("choose from your media opens the picker", () => {
    const t = harness(GalleryEditor, defaultGalleryContent());
    click(button(t.root, "choose from your media"));
    expect(t.root.querySelector("[data-fake-picker]")).not.toBeNull();
  });

  it("at 200 photos Add photos is disabled with the limit copy", () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `i${i}`,
      asset: `a${i}`,
      alt: "x",
      alt_reviewed: true,
      caption: "",
    }));
    const t = harness(GalleryEditor, {
      ...defaultGalleryContent(),
      images: full,
    });
    expect(button(t.root, "Add photos")!.disabled).toBe(true);
    expect(t.root.textContent).toContain(GALLERY_MAX_COPY);
  });

  it("loads stored thumbs in chunks of 60 and marks a deleted library item", async () => {
    for (let i = 0; i < 70; i++) h.library.set(`a${i}`, libItem(`a${i}`));
    h.library.set("a3", libItem("a3", { deleted: true }));
    const list = Array.from({ length: 70 }, (_, i) => ({
      id: `i${i}`,
      asset: `a${i}`,
      alt: "x",
      alt_reviewed: true,
      caption: "",
    }));
    const t = harness(GalleryEditor, {
      ...defaultGalleryContent(),
      images: list,
    });
    await flush();
    expect(h.itemsCalls.map((c) => c.length)).toEqual([60, 10]);
    const thumb = t.root.querySelectorAll("[data-gallery-thumb]")[3]!;
    expect(thumb.textContent).toContain("Deleted from your media");
  });
});

describe("LogoStripEditor", () => {
  async function withLogos() {
    const t = harness(LogoStripEditor, defaultLogoStripContent());
    h.picks = [
      picked("m1", { needsDescription: false, alt: "Acme" }),
      picked("m2", { name: "IMG_0002.png" }),
    ];
    click(button(t.root, "Add logos"));
    expect(h.pickerProps).toEqual({ kind: "image", multiple: true });
    click(button(t.root, "Use fake picks"));
    await flush();
    return t;
  }

  it("adds picks as sortable rows with Name and Link", async () => {
    const t = await withLogos();
    const logos = t.content().logos as LogoStripLogo[];
    expect(logos.map((l) => [l.asset, l.name, l.link])).toEqual([
      ["m1", "Acme", ""],
      ["m2", "", ""],
    ]);
    expect(t.root.querySelectorAll("[data-sortable-row]")).toHaveLength(2);
    expect(t.root.textContent).toContain(
      "Read out to people who can't see it.",
    );
    expect(t.root.textContent).toContain(
      "A web address, like https://acme.com",
    );
  });

  it("a blank name shows the name copy after the owner leaves it", async () => {
    const t = await withLogos();
    expect(t.root.textContent).not.toContain(LOGO_STRIP_NAME_COPY);
    const names = Array.from(t.root.querySelectorAll("label"))
      .filter((l) => l.textContent?.startsWith("Name"))
      .map((l) => document.getElementById(l.htmlFor)!);
    blur(names[1]!);
    expect(t.root.textContent).toContain(LOGO_STRIP_NAME_COPY);
    typeInto(names[1]!, "Beta Co");
    expect((t.content().logos as LogoStripLogo[])[1]!.name).toBe("Beta Co");
    expect(t.root.textContent).not.toContain(LOGO_STRIP_NAME_COPY);
  });

  it("Delete toasts Logo removed with Undo; Show in grey writes grayscale", async () => {
    const t = await withLogos();
    click(button(t.root, "Delete Acme"));
    expect((t.content().logos as LogoStripLogo[]).map((l) => l.asset)).toEqual([
      "m2",
    ]);
    expect(document.body.textContent).toContain("Logo removed.");
    click(button(document.body, "Undo"));
    expect((t.content().logos as LogoStripLogo[]).map((l) => l.asset)).toEqual([
      "m1",
      "m2",
    ]);
    const grey = Array.from(t.root.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("Show in grey"),
    )!;
    click(document.getElementById(grey.htmlFor));
    expect(t.content().grayscale).toBe(true);
  });

  it("at 16 logos adding is disabled with the limit copy; drop zone copy", () => {
    const logos = Array.from({ length: 16 }, (_, i) => ({
      id: `l${i}`,
      asset: `a${i}`,
      name: `L${i}`,
      link: "",
    }));
    const t = harness(LogoStripEditor, { ...defaultLogoStripContent(), logos });
    expect(button(t.root, "Add logos")!.disabled).toBe(true);
    expect(t.root.textContent).toContain(LOGO_STRIP_MAX_COPY);
    expect(t.root.querySelector("[data-media-drop]")!.textContent).toContain(
      "Drop logos here, or choose from your media",
    );
  });
});
