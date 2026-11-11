// @vitest-environment jsdom
// P7 item editors and the grouped Add item menu (07-08; CONT-17, CONT-25, CONT-27, D281;
// 07-UI-SPEC "Column item menu", "Column items", LINK/AUDIO/EMBED-NOT-ALLOWED copy).
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AUDIO_NOT_ALLOWED_COPY,
  EMBED_NOT_ALLOWED_COPY,
  LINK_NOT_ALLOWED_COPY,
  VIDEO_TITLE_COPY,
  newColumnItem,
  type ColumnItem,
} from "@cds/core/content";
import { ToastRegion } from "../../hub/Toast";
import { ColumnItemForm } from "../ColumnItemForm";
import { ItemListEditor } from "../ItemListEditor";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { FormOptionsProvider } from "./form-options";
import type { FormOption } from "./types";
import type { AudioColumnItem, VideoColumnItem } from "@cds/core/content";
import {
  MEDIA_COPY,
  type LibraryItemView,
  type VideoStateView,
} from "../../hub/media/copy";
import type { MediaSource } from "../../hub/media/source";
import type { LinkCoverCapture } from "../../hub/media/link-cover";
import type { XhrOptions } from "../../hub/media/xhr";
import { AudioItemEditor } from "./AudioItemEditor";
import { EmbedItemEditor } from "./EmbedItemEditor";
import { VideoCaptionsRow } from "./VideoCaptionsRow";
import { VideoItemEditor } from "./VideoItemEditor";
import {
  COVER_HELPER,
  LINK_COVER_FAILED_COPY,
  PASTE_INSTEAD,
} from "./media-item-copy";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function field(root: ParentNode, label: string): HTMLElement {
  const el = Array.from(root.querySelectorAll("label")).find((l) =>
    (l.textContent ?? "").trim().startsWith(label),
  );
  const id = el?.getAttribute("for");
  const target = id ? document.getElementById(id) : null;
  if (!target) throw new Error(`no field labelled ${label}`);
  return target;
}

function openForm(
  item: ColumnItem,
  onSave = vi.fn<(item: ColumnItem) => Promise<void>>(async () => {}),
  forms?: readonly FormOption[],
) {
  mounted = mount(
    <ColumnItemForm
      item={item}
      popups={[]}
      forms={forms}
      allowPopupButton
      onSave={onSave}
      onCancel={() => {}}
      timeZone="America/Chicago"
    />,
  );
  return { root: mounted.container, onSave };
}

const errorText = (el: HTMLElement) => {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/);
  return ids
    .map((id) => (id ? document.getElementById(id)?.textContent : ""))
    .join(" ");
};

/** 07-23: video and audio open on "From your media"; switch to Paste a link. */
function pasteMode(root: ParentNode): void {
  click(root.querySelector('input[type="radio"][value="link"]'));
}

describe("Add item menu (grouped)", () => {
  it("shows Text, Photos and media, Actions, Other with the new kinds", () => {
    mounted = mount(
      <ToastRegion>
        <ItemListEditor
          items={[]}
          popups={[]}
          allowPopupButton={false}
          onChange={async () => {}}
        />
      </ToastRegion>,
    );
    const root = mounted.container;
    click(button(root, /Add item/));
    const menu = root.querySelector('[aria-label="Item types"]');
    expect(menu).not.toBeNull();
    const groups = Array.from(
      menu!.querySelectorAll<HTMLElement>("[aria-labelledby]"),
    );
    const heading = (g: HTMLElement) =>
      document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent;
    expect(groups.map(heading)).toEqual([
      "Text",
      "Photos and media",
      "Actions",
      "Other",
    ]);
    const names = (g: HTMLElement) =>
      Array.from(g.querySelectorAll("button")).map((b) => b.textContent);
    expect(names(groups[1]!)).toEqual(["Image", "Video", "Audio"]);
    expect(names(groups[2]!)).toEqual(["Button", "Form", "Booking calendar"]);
  });

  it("picking Booking calendar opens its editor", () => {
    mounted = mount(
      <ToastRegion>
        <ItemListEditor
          items={[]}
          popups={[]}
          allowPopupButton={false}
          onChange={async () => {}}
        />
      </ToastRegion>,
    );
    const root = mounted.container;
    click(button(root, /Add item/));
    click(button(root, "Booking calendar"));
    expect(root.textContent).toContain("New booking calendar item");
    expect(
      field(root, "Paste your Calendly or public Google Calendar link"),
    ).toBeTruthy();
  });
});

describe("Video item editor", () => {
  it("a YouTube link is found and saved as provider + id only", async () => {
    const { root, onSave } = openForm(newColumnItem("video"));
    typeInto(field(root, "Title"), "Studio tour");
    pasteMode(root);
    typeInto(
      field(root, "Paste a link or embed"),
      "https://youtu.be/dQw4w9WgXcQ",
    );
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "YouTube video found",
    );
    submit(root.querySelector("form"));
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      kind: "video",
      title: "Studio tour",
      source: "link",
      provider: "youtube",
      provider_id: "dQw4w9WgXcQ",
      autoplay: false,
    });
    expect(JSON.stringify(saved)).not.toContain("youtu.be");
  });

  it("a lookalike host shows the LINK-NOT-ALLOWED copy on the link field", () => {
    const { root } = openForm(newColumnItem("video"));
    pasteMode(root);
    const link = field(root, "Paste a link or embed");
    typeInto(link, "https://youtube.com.evil.net/watch?v=x");
    expect(errorText(link)).toContain(LINK_NOT_ALLOWED_COPY);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("saving with a blank title focuses Title with the title copy", async () => {
    const { root, onSave } = openForm(newColumnItem("video"));
    pasteMode(root);
    typeInto(
      field(root, "Paste a link or embed"),
      "https://youtu.be/dQw4w9WgXcQ",
    );
    submit(root.querySelector("form"));
    await flush();
    const title = field(root, "Title");
    expect(document.activeElement).toBe(title);
    expect(errorText(title)).toContain(VIDEO_TITLE_COPY);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens with a stored link shown as its page URL", () => {
    const item = {
      ...newColumnItem("video"),
      title: "T",
      source: "link",
      provider: "vimeo",
      provider_id: "76979871",
    } as ColumnItem;
    const { root } = openForm(item);
    expect(
      (field(root, "Paste a link or embed") as HTMLInputElement).value,
    ).toBe("https://vimeo.com/76979871");
  });
});

describe("Audio and booking calendar editors", () => {
  it("audio refuses a YouTube link", () => {
    const { root } = openForm(newColumnItem("audio"));
    pasteMode(root);
    const link = field(root, "Paste a link from");
    typeInto(link, "https://youtu.be/dQw4w9WgXcQ");
    expect(errorText(link)).toContain(AUDIO_NOT_ALLOWED_COPY);
  });

  it("audio accepts Spotify", () => {
    const { root } = openForm(newColumnItem("audio"));
    pasteMode(root);
    typeInto(
      field(root, "Paste a link from"),
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    );
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Spotify found",
    );
  });

  it("embed refuses YouTube and accepts Calendly", () => {
    const { root } = openForm(newColumnItem("embed"));
    const link = field(root, "Paste your Calendly");
    typeInto(link, "https://youtu.be/dQw4w9WgXcQ");
    expect(errorText(link)).toContain(EMBED_NOT_ALLOWED_COPY);
    typeInto(link, "https://calendly.com/acme-studio/30min");
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Calendly found",
    );
    expect(errorText(link)).not.toContain(EMBED_NOT_ALLOWED_COPY);
  });
});

describe("Form item editor", () => {
  it("with forms: a Select of them, deleted ones marked, and an edit link", () => {
    const item = { ...newColumnItem("form"), form_id: "f1" } as ColumnItem;
    const { root } = openForm(item, undefined, [
      { id: "f1", name: "Contact" },
      { id: "f2", name: "Old", deleted: true },
    ]);
    const select = field(root, "Form") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Choose a form",
      "Contact",
      "Old (deleted)",
    ]);
    const edit = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Edit this form",
    );
    expect(edit?.getAttribute("href")).toBe("/hub/website?tab=forms&form=f1");
    expect(edit?.getAttribute("target")).toBe("_blank");
  });

  it.each([undefined, []])(
    "with no forms (%s): the info alert and build it in Forms link",
    (forms) => {
      const { root } = openForm(newColumnItem("form"), undefined, forms);
      expect(root.textContent).toContain(
        "You don't have a form yet. Start one from a template here, or build it in Forms (opens in a new tab).",
      );
      const create = Array.from(root.querySelectorAll("a")).find(
        (a) => a.textContent === "build it in Forms",
      );
      expect(create?.getAttribute("href")).toBe(
        "/hub/website?tab=forms&form=new",
      );
      expect(create?.getAttribute("target")).toBe("_blank");
      expect(create?.getAttribute("rel")).toBe("noopener");
    },
  );

  function withProvider(
    item: ColumnItem,
    forms: readonly FormOption[],
    createForm = vi.fn(async () => ({
      ok: true as const,
      data: { id: "fnew", name: "Contact" },
    })),
  ) {
    const onSave = vi.fn<(item: ColumnItem) => Promise<void>>(async () => {});
    mounted = mount(
      <ToastRegion>
        <FormOptionsProvider forms={forms} createForm={createForm}>
          <ColumnItemForm
            item={item}
            popups={[]}
            allowPopupButton
            onSave={onSave}
            onCancel={() => {}}
            timeZone="America/Chicago"
          />
        </FormOptionsProvider>
      </ToastRegion>,
    );
    return { root: mounted.container, createForm, onSave };
  }

  it("falls back to the provider's forms when no prop is given", () => {
    const { root } = withProvider(newColumnItem("form"), [
      { id: "f1", name: "Contact" },
    ]);
    const select = field(root, "Form") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Choose a form",
      "Contact",
    ]);
    const tpl = field(root, "New form from a template") as HTMLSelectElement;
    expect(tpl.options).toHaveLength(6);
    expect(tpl.value).toBe("contact");
  });

  it("Create and use makes a form from a template and selects it", async () => {
    const { root, createForm, onSave } = withProvider(
      newColumnItem("form"),
      [],
    );
    const tpl = field(root, "New form from a template") as HTMLSelectElement;
    act(() => {
      tpl.value = "feedback";
      tpl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button(root, "Create and use"));
    await flush();
    expect(createForm).toHaveBeenCalledWith({ template: "feedback" });
    const select = field(root, "Form") as HTMLSelectElement;
    expect(select.value).toBe("fnew");
    expect(root.textContent).toContain(
      "Form created. Edit its fields in Forms.",
    );
    const edit = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Edit this form",
    );
    expect(edit?.getAttribute("href")).toBe("/hub/website?tab=forms&form=fnew");
    expect(edit?.getAttribute("rel")).toBe("noopener");
    submit(root.querySelector("form"));
    await flush();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "form", form_id: "fnew" }),
    );
  });

  it("a failed create shows the copy inline", async () => {
    const { root } = withProvider(
      newColumnItem("form"),
      [{ id: "f1", name: "Contact" }],
      vi.fn(async () => ({
        ok: false as const,
        code: "invalid_input",
        message: "You can have up to 100 forms.",
      })) as never,
    );
    click(button(root, "Create and use"));
    await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "You can have up to 100 forms.",
    );
  });

  it("a deleted form shows DELETED-REF and Choose another focuses the Select", () => {
    const item = { ...newColumnItem("form"), form_id: "f2" } as ColumnItem;
    const { root } = withProvider(item, [
      { id: "f1", name: "Contact" },
      { id: "f2", name: "Old", deleted: true },
    ]);
    expect(root.textContent).toContain(
      "This form was deleted. It still shows here so nothing breaks; choose another form or remove this item.",
    );
    click(button(root, "Choose another"));
    expect(document.activeElement).toBe(field(root, "Form"));
  });
});

// ---- 07-23: full video, audio and booking calendar editors ----------------------------------

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

const YT = "dQw4w9WgXcQ";
const YT2 = "9bZkp7q19f0";

function lib(id: string, p: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id,
    kind: "video",
    rowKind: "video",
    name: `${id}.mp4`,
    alt: "",
    needsDescription: false,
    status: "ready",
    width: 1280,
    height: 720,
    bytes: 1000,
    durationS: 30,
    createdAt: "",
    thumbUrl: `/hub/media/${id}/poster.webp`,
    previewUrl: `/hub/media/${id}/video.mp4`,
    posterUrl: `/hub/media/${id}/poster.webp`,
    ...p,
  };
}

function fakeSource(
  library: LibraryItemView[],
  states: Record<string, VideoStateView> = {},
): MediaSource {
  const byId = new Map(library.map((i) => [i.id, i]));
  return {
    list: vi.fn(async () => ({
      ok: true as const,
      data: {
        page: {
          items: library,
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
    states: vi.fn(async (ids: readonly string[]) => ({
      ok: true as const,
      data: Object.fromEntries(
        ids.filter((id) => states[id]).map((id) => [id, states[id]!]),
      ),
    })),
    describe: vi.fn(async () => ({ ok: true as const, data: { count: 1 } })),
  };
}

const VIDEO: VideoColumnItem = {
  id: "v",
  kind: "video",
  title: "Tour",
  source: "media",
  asset: "",
  provider: "",
  provider_id: "",
  cover: "",
  shape: "16:9",
  controls: true,
  loop: false,
  autoplay: false,
};

let lastVideo: VideoColumnItem = VIDEO;

function VideoHarness(props: {
  initial?: Partial<VideoColumnItem>;
  source: MediaSource;
  capture?: LinkCoverCapture;
  moveToYouTube?: boolean;
}) {
  const [draft, setDraft] = useState<VideoColumnItem>({
    ...VIDEO,
    ...props.initial,
  });
  lastVideo = draft;
  return (
    <VideoItemEditor
      draft={draft}
      patch={(f) => setDraft((d) => ({ ...d, ...f }))}
      errors={{}}
      fid={(f) => `v-${f}`}
      source={props.source}
      captureCover={
        props.capture ?? (async () => ({ asset: null, reason: "none" }))
      }
      moveToYouTube={props.moveToYouTube}
    />
  );
}

const pickerEl = () => document.querySelector("[data-media-picker]")!;
const optionEl = (id: string) =>
  document.querySelector<HTMLElement>(`[data-media-option="${id}"]`);

async function pickVideo(root: HTMLElement, id: string) {
  click(button(root, "Choose a video"));
  await flush();
  click(optionEl(id));
  click(button(pickerEl(), "Use this video"));
  await flush();
}

describe("Video item editor: source, states and fields (07-23)", () => {
  it("From your media picks an MP4 and clears the link fields", async () => {
    const source = fakeSource([lib("m1")]);
    mounted = mount(
      <VideoHarness
        source={source}
        initial={{ provider: "vimeo", provider_id: "76979871" }}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain("Where's the video?");
    await pickVideo(root, "m1");
    expect(lastVideo).toMatchObject({
      source: "media",
      asset: "m1",
      provider: "",
      provider_id: "",
    });
  });

  it.each([
    ["optimizing", MEDIA_COPY.videoProcessing],
    ["waiting", MEDIA_COPY.videoProcessing],
    ["failed", MEDIA_COPY.videoFailed],
  ] as const)(
    "a picked video that is %s shows its notice",
    async (state, copy) => {
      const source = fakeSource([lib("m1")], { m1: state });
      mounted = mount(<VideoHarness source={source} />);
      await pickVideo(mounted.container, "m1");
      await flush();
      expect(source.states).toHaveBeenCalledWith(["m1"]);
      expect(mounted.container.textContent).toContain(copy);
    },
  );

  it("Paste a link patches provider + id, clears the asset and autoplay", () => {
    mounted = mount(
      <VideoHarness
        source={fakeSource([])}
        initial={{ asset: "m1", autoplay: true }}
      />,
    );
    const root = mounted.container;
    pasteMode(root);
    typeInto(
      field(root, "Paste a link or embed"),
      "https://vimeo.com/76979871",
    );
    expect(lastVideo).toMatchObject({
      source: "link",
      provider: "vimeo",
      provider_id: "76979871",
      asset: "",
      autoplay: false,
    });
    expect(root.textContent).not.toContain("Play silently when it appears");
  });

  it("shows Title, Cover with its helper, Shape thumbs and Playback with the autoplay helper", () => {
    mounted = mount(<VideoHarness source={fakeSource([])} />);
    const root = mounted.container;
    expect(field(root, "Title")).toBeTruthy();
    expect(root.textContent).toContain(
      "Used by screen readers and search engines",
    );
    expect(root.textContent).toContain(COVER_HELPER);
    for (const t of ["Wide", "Tall", "Square"]) {
      expect(root.textContent).toContain(t);
    }
    expect(root.querySelectorAll('input[name="v-shape"]')).toHaveLength(3);
    expect(root.textContent).toContain("Show controls");
    expect(root.textContent).toContain("Loop");
    expect(root.textContent).toContain("Play silently when it appears");
    expect(root.textContent).toContain(
      "Starts muted. Visitors can turn the sound on.",
    );
    expect(
      (document.getElementById("v-controls") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("v-loop") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("MOVE-TO-YOUTUBE shows only when asked, and Paste a link instead switches the source", () => {
    mounted = mount(
      <VideoHarness
        source={fakeSource([lib("m1")])}
        initial={{ asset: "m1" }}
      />,
    );
    expect(mounted.container.textContent).not.toContain(
      MEDIA_COPY.moveToYouTube,
    );
    mounted.unmount();
    mounted = mount(
      <VideoHarness
        source={fakeSource([lib("m1")])}
        initial={{ asset: "m1" }}
        moveToYouTube
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(MEDIA_COPY.moveToYouTube);
    click(button(root, PASTE_INSTEAD));
    expect(field(root, "Paste a link or embed")).toBeTruthy();
  });

  it("the captions row shows for an MP4 with an asset only", async () => {
    mounted = mount(<VideoHarness source={fakeSource([lib("m1")])} />);
    expect(mounted.container.querySelector("[data-captions-row]")).toBeNull();
    mounted.unmount();
    mounted = mount(
      <VideoHarness
        source={fakeSource([lib("m1")])}
        initial={{ asset: "m1" }}
      />,
    );
    await flush();
    expect(
      mounted.container.querySelector("[data-captions-row]"),
    ).not.toBeNull();
  });
});

describe("Video item editor: cover capture (07-23 choice 2, D119)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(ms = 400) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("a YouTube link with no cover captures once (debounced) and uses the stored copy", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<LinkCoverCapture>(async ({ providerId }) => ({
      asset: `c${providerId}`,
      thumbUrl: `/hub/media/c${providerId}/thumb`,
    }));
    mounted = mount(
      <VideoHarness
        source={fakeSource([])}
        capture={capture}
        initial={{ title: "Spring" }}
      />,
    );
    const root = mounted.container;
    pasteMode(root);
    const input = field(root, "Paste a link or embed");
    typeInto(input, `https://youtu.be/${YT2}`);
    typeInto(input, `https://youtu.be/${YT}`);
    await settle(399);
    expect(capture).not.toHaveBeenCalled();
    await settle(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      provider: "youtube",
      providerId: YT,
      title: "Spring",
    });
    expect(lastVideo.cover).toBe(`c${YT}`);
    const card = root.querySelector("[data-link-result]")!;
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      `/hub/media/c${YT}/thumb`,
    );
    // A second YouTube link replaces the auto cover.
    typeInto(input, `https://youtu.be/${YT2}`);
    await settle();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(lastVideo.cover).toBe(`c${YT2}`);
  });

  it("an owner-chosen cover is never replaced", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<LinkCoverCapture>(async () => ({
      asset: "auto",
      thumbUrl: "/hub/media/auto/thumb",
    }));
    mounted = mount(
      <VideoHarness
        source={fakeSource([])}
        capture={capture}
        initial={{ cover: "mine" }}
      />,
    );
    const root = mounted.container;
    pasteMode(root);
    typeInto(field(root, "Paste a link or embed"), `https://youtu.be/${YT}`);
    await settle();
    expect(capture).not.toHaveBeenCalled();
    expect(lastVideo.cover).toBe("mine");
  });

  it("a Vimeo link never captures", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<LinkCoverCapture>();
    mounted = mount(<VideoHarness source={fakeSource([])} capture={capture} />);
    const root = mounted.container;
    pasteMode(root);
    typeInto(
      field(root, "Paste a link or embed"),
      "https://vimeo.com/76979871",
    );
    await settle();
    expect(capture).not.toHaveBeenCalled();
  });

  it("a failed capture shows the helper and leaves the cover empty", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<LinkCoverCapture>(async () => ({
      asset: null,
      reason: "unavailable",
    }));
    mounted = mount(<VideoHarness source={fakeSource([])} capture={capture} />);
    const root = mounted.container;
    pasteMode(root);
    typeInto(field(root, "Paste a link or embed"), `https://youtu.be/${YT}`);
    await settle();
    expect(root.textContent).toContain(LINK_COVER_FAILED_COPY);
    expect(lastVideo.cover).toBe("");
  });

  it("an answer for a link that has since changed is ignored", async () => {
    vi.useFakeTimers();
    let resolveFirst:
      ((v: { asset: string; thumbUrl: string }) => void) | null = null;
    const capture = vi.fn<LinkCoverCapture>(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        }),
    );
    mounted = mount(<VideoHarness source={fakeSource([])} capture={capture} />);
    const root = mounted.container;
    pasteMode(root);
    const input = field(root, "Paste a link or embed");
    typeInto(input, `https://youtu.be/${YT}`);
    await settle();
    typeInto(input, "https://vimeo.com/76979871");
    await act(async () => {
      resolveFirst!({ asset: "late", thumbUrl: "/hub/media/late/thumb" });
      await Promise.resolve();
    });
    expect(lastVideo.cover).toBe("");
  });
});

describe("VideoCaptionsRow (07-23 choice 9)", () => {
  function send(status = 200, json: Record<string, unknown> = {}) {
    return vi.fn<
      (
        o: XhrOptions,
      ) => Promise<{ status: number; json: Record<string, unknown> }>
    >(async () => ({ status, json }));
  }

  async function choose(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  }

  it("with captions: captions.vtt, Replace and Remove (DELETE)", async () => {
    const xhr = send();
    mounted = mount(
      <VideoCaptionsRow
        assetId="m1"
        source={fakeSource([lib("m1", { hasCaptions: true })])}
        send={xhr}
      />,
    );
    await flush();
    const root = mounted.container;
    expect(root.textContent).toContain("captions.vtt");
    expect(button(root, "Replace")).not.toBeNull();
    click(button(root, "Remove"));
    await flush();
    expect(xhr).toHaveBeenCalledWith({
      method: "DELETE",
      url: "/hub/api/media/captions?asset=m1",
    });
    expect(root.textContent).toContain("No captions yet");
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Captions removed.",
    );
  });

  it("without captions: Add captions file checks the file, then PUTs it", async () => {
    const xhr = send();
    mounted = mount(
      <VideoCaptionsRow
        assetId="m1"
        source={fakeSource([lib("m1")])}
        send={xhr}
      />,
    );
    await flush();
    const root = mounted.container;
    expect(root.textContent).toContain("No captions yet");
    expect(button(root, "Add captions file")).not.toBeNull();
    const manage = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Manage in Media",
    )!;
    expect(manage.getAttribute("href")).toBe("/hub/website?tab=media&asset=m1");
    expect(manage.getAttribute("target")).toBe("_blank");
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    await choose(input, new File(["x"], "subs.srt", { type: "text/plain" }));
    expect(root.textContent).toContain(MEDIA_COPY.captions);
    await choose(input, new File([new Uint8Array(512 * 1024 + 1)], "big.vtt"));
    expect(xhr).not.toHaveBeenCalled();
    const ok = new File(["WEBVTT\n"], "subs.vtt", { type: "text/vtt" });
    await choose(input, ok);
    expect(xhr).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        url: "/hub/api/media/captions?asset=m1",
        body: ok,
      }),
    );
    expect(root.textContent).toContain("captions.vtt");
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Captions added.",
    );
  });

  it("a server refusal shows its copy as-is", async () => {
    const xhr = send(400, { error: "This captions file is empty." });
    mounted = mount(
      <VideoCaptionsRow
        assetId="m1"
        source={fakeSource([lib("m1")])}
        send={xhr}
      />,
    );
    await flush();
    const input =
      mounted.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await choose(input, new File(["WEBVTT"], "a.vtt"));
    expect(mounted.container.textContent).toContain(
      "This captions file is empty.",
    );
  });
});

let lastAudio: AudioColumnItem | null = null;

function AudioHarness({ source }: { source: MediaSource }) {
  const [draft, setDraft] = useState<AudioColumnItem>({
    id: "a",
    kind: "audio",
    title: "",
    source: "media",
    asset: "",
    provider: "",
    provider_id: "",
  });
  lastAudio = draft;
  return (
    <AudioItemEditor
      draft={draft}
      patch={(f) => setDraft((d) => ({ ...d, ...f }))}
      errors={{}}
      fid={(f) => `a-${f}`}
      source={source}
    />
  );
}

describe("Audio and booking calendar editors (07-23)", () => {
  it("audio: From your media picks an MP3; Paste a link takes Spotify", async () => {
    const mp3 = lib("s1", {
      kind: "audio",
      rowKind: "audio",
      name: "ep1.mp3",
      thumbUrl: null,
      posterUrl: null,
      previewUrl: "/hub/media/s1/audio.mp3",
    });
    mounted = mount(<AudioHarness source={fakeSource([mp3])} />);
    const root = mounted.container;
    click(button(root, "Choose audio"));
    await flush();
    click(optionEl("s1"));
    click(button(pickerEl(), "Use this audio"));
    await flush();
    expect(lastAudio).toMatchObject({ source: "media", asset: "s1" });
    pasteMode(root);
    typeInto(
      field(root, "Paste a link from"),
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    );
    expect(lastAudio).toMatchObject({
      source: "link",
      provider: "spotify",
      asset: "",
    });
    expect(field(root, "Title")).toBeTruthy();
  });

  it("booking calendar: the link field and Title with its example helper", () => {
    mounted = mount(
      <EmbedItemEditor
        draft={{
          id: "e",
          kind: "embed",
          title: "",
          provider: "",
          provider_id: "",
        }}
        patch={() => {}}
        errors={{}}
        fid={(f) => `e-${f}`}
      />,
    );
    const root = mounted.container;
    expect(
      field(root, "Paste your Calendly or public Google Calendar link"),
    ).toBeTruthy();
    expect(root.textContent).toContain("For example, Book a consultation");
  });
});
