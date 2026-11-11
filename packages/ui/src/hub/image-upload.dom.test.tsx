// @vitest-environment jsdom
// 06-19 Task 1: ImageUpload (06-UI-SPEC "Upload field", Copywriting UPL-* / LOW-RES,
// Accessibility "ImageUpload"; ONB-04, D280, D-UI-P6-27, D-UI-P6-30, D-UI-P6-31, PD-6).
// XMLHttpRequest is replaced by a controllable fake; no request leaves the test.
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALT_SAVE_FAILED_COPY,
  ImageUpload,
  checkFile,
  formatBytes,
  lowResCopy,
  mediaViewFromServer,
  UPL_COPY,
  type ImageUploadProps,
  type MediaAssetView,
} from "./ImageUpload";
import { ToastRegion } from "./Toast";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";

class FakeXHR {
  static last: FakeXHR | null = null;
  static count = 0;
  method = "";
  url = "";
  status = 0;
  responseText = "";
  body: FormData | null = null;
  aborted = false;
  upload: {
    onprogress: ((e: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
    FakeXHR.count += 1;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    act(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded,
        total,
      } as ProgressEvent);
    });
  }
  respond(status: number, body: unknown) {
    act(() => {
      this.upload.onload?.();
    });
    this.status = status;
    this.responseText = JSON.stringify(body);
    act(() => {
      this.onload?.();
    });
  }
}

const MB = 1024 * 1024;

function file(name: string, type: string, size = 1000): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function pick(root: HTMLElement, f: File) {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function asset(over: Partial<MediaAssetView> = {}): MediaAssetView {
  return {
    id: "m1",
    kind: "hero",
    width: 2560,
    height: 1707,
    webWidth: 2560,
    bytes: Math.round(1.8 * MB),
    alt: "",
    thumbUrl: "/hub/media/m1/thumb",
    ...over,
  };
}

const calls = {
  alt: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  reorder: vi.fn(),
  pick: vi.fn(),
  uploaded: vi.fn(),
};

function Harness(
  props: Partial<ImageUploadProps> & { initial?: MediaAssetView[] },
) {
  const { initial = [], ...rest } = props;
  const [value, setValue] = useState<MediaAssetView[]>(initial);
  return (
    <ToastRegion>
      <ImageUpload
        kind="hero"
        label="Main photo"
        helper="The big photo at the top of your home page."
        value={value}
        onUploaded={(a, p) => {
          calls.uploaded(a, p);
          setValue((v) => (props.multiple ? [...v, a] : [a]));
        }}
        onAltChange={calls.alt}
        onRemove={(id) => {
          calls.remove(id);
          setValue((v) => v.filter((x) => x.id !== id));
        }}
        onRestore={calls.restore}
        onReorder={calls.reorder}
        onPick={calls.pick}
        {...rest}
      />
    </ToastRegion>
  );
}

let mounted: Mounted | null = null;
const realXHR = globalThis.XMLHttpRequest;
beforeEach(() => {
  FakeXHR.last = null;
  FakeXHR.count = 0;
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  for (const fn of Object.values(calls)) fn.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = realXHR;
});

describe("client checks (PD-6, UPL-*)", () => {
  it("the file input accepts JPEG, PNG and WebP only and is labelled", () => {
    mounted = mount(<Harness kind="logo" label="Logo" />);
    const input = mounted.container.querySelector('input[type="file"]');
    expect(input?.getAttribute("accept")).toBe(
      "image/jpeg,image/png,image/webp",
    );
    expect(input?.getAttribute("aria-label")).toBe("Choose a logo");
    expect(mounted.container.textContent).toContain(
      "JPEG, PNG or WebP, up to 20 MB",
    );
  });

  it("a 34 MB photo is refused before any request", () => {
    mounted = mount(<Harness />);
    pick(mounted.container, file("big.jpg", "image/jpeg", 34 * MB));
    expect(FakeXHR.count).toBe(0);
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain(
      "This photo is 34 MB. The limit is 20 MB: export a smaller copy and try again.",
    );
  });

  it("a GIF shows UPL-TYPE, a HEIC shows UPL-HEIC, neither uploads", () => {
    expect(checkFile(file("a.gif", "image/gif"))).toBe(UPL_COPY.type);
    expect(checkFile(file("a.heic", ""))).toBe(UPL_COPY.heic);
    expect(checkFile(file("a.png", "image/png"))).toBeNull();
    mounted = mount(<Harness />);
    pick(mounted.container, file("a.gif", "image/gif"));
    expect(FakeXHR.count).toBe(0);
    expect(mounted.container.textContent).toContain(
      "This file isn't a photo we can use. Upload a JPEG, PNG or WebP.",
    );
  });
});

describe("upload flow", () => {
  it("progress, processing, then done with meta and the suggested description", async () => {
    mounted = mount(
      <Harness kind="team" label="Photo" suggestedAlt="Photo of Maria" />,
    );
    pick(mounted.container, file("maria.jpg", "image/jpeg", 2 * MB));
    const xhr = FakeXHR.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/hub/api/media");
    expect(xhr.body?.get("kind")).toBe("team");
    expect(xhr.body?.get("alt")).toBe("Photo of Maria");
    xhr.progress(42, 100);
    const bar = mounted.container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuetext")).toBe("42 percent uploaded");
    expect(mounted.container.textContent).toContain("Uploading… 42%");
    expect(button(mounted.container, "Stop upload")).not.toBeNull();
    xhr.progress(100, 100);
    expect(mounted.container.textContent).toContain("Making web-ready copies…");
    xhr.respond(200, {
      asset: {
        id: "m9",
        kind: "team",
        width: 2560,
        height: 1707,
        webWidth: 2560,
        bytes: Math.round(1.8 * MB),
        alt: "",
        url: "/hub/media/m9/thumb",
      },
    });
    await flush();
    expect(calls.uploaded).toHaveBeenCalledOnce();
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("2560 × 1707 · 1.8 MB");
    expect(text).toContain("maria.jpg");
    const img = mounted.container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/hub/media/m9/thumb");
    const alt = mounted.container.querySelector<HTMLInputElement>("#alt-m9");
    expect(alt?.value).toBe("Photo of Maria");
    expect(button(mounted.container, "Replace")).not.toBeNull();
    expect(button(mounted.container, "Remove")).not.toBeNull();
  });

  it("Stop upload aborts and returns to the drop zone", () => {
    mounted = mount(<Harness />);
    pick(mounted.container, file("a.jpg", "image/jpeg"));
    click(button(mounted.container, "Stop upload"));
    expect(FakeXHR.last?.aborted).toBe(true);
    expect(mounted.container.querySelector('[role="progressbar"]')).toBeNull();
    expect(mounted.container.textContent).toContain("Drop a photo here");
  });

  it("a server error shows in an alert and the drop zone returns", () => {
    mounted = mount(<Harness />);
    pick(mounted.container, file("a.jpg", "image/jpeg"));
    FakeXHR.last!.respond(400, { error: UPL_COPY.heic, reason: "heic" });
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain(UPL_COPY.heic);
    expect(mounted.container.textContent).toContain("Drop a photo here");
    expect(calls.uploaded).not.toHaveBeenCalled();
  });

  it("a network failure shows UPL-FAILED", () => {
    mounted = mount(<Harness />);
    pick(mounted.container, file("a.jpg", "image/jpeg"));
    act(() => FakeXHR.last!.onerror?.());
    expect(mounted.container.textContent).toContain(UPL_COPY.failed);
  });

  it("a mood board pick hands the file over before the upload", () => {
    mounted = mount(<Harness kind="moodboard" multiple max={3} />);
    const f = file("board.png", "image/png");
    pick(mounted.container, f);
    expect(calls.pick).toHaveBeenCalledWith(f);
  });
});

describe("done states", () => {
  it("a logo previews on light and on dark", () => {
    mounted = mount(
      <Harness
        kind="logo"
        label="Logo"
        initial={[
          asset({ kind: "logo", webWidth: 1200, alt: "Rivera Bakery" }),
        ]}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("On light");
    expect(text).toContain("On dark");
    const html = mounted.container.innerHTML;
    expect(html).toContain("bg-[#FFFFFF]");
    expect(html).toContain("bg-[#1B1B19]");
    expect(
      mounted.container.querySelectorAll("[data-logo-preview] img"),
    ).toHaveLength(2);
  });

  it("a hero 800 px wide warns (LOW-RES) and still shows", () => {
    expect(lowResCopy("hero", 800)).toBe(
      "This photo is 800 px wide, so it may look soft on a large screen. A photo at least 1,600 px wide looks best.",
    );
    expect(lowResCopy("hero", 1600)).toBeNull();
    expect(lowResCopy("logo", 300)).toContain("400 px");
    expect(lowResCopy("gallery", 300)).toBeNull();
    mounted = mount(
      <Harness initial={[asset({ webWidth: 800, width: 800 })]} />,
    );
    expect(mounted.container.textContent).toContain(
      "This photo is 800 px wide",
    );
  });

  it("the description saves on blur", () => {
    mounted = mount(<Harness initial={[asset()]} />);
    const alt = mounted.container.querySelector<HTMLInputElement>("#alt-m1")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(alt, "Loaves cooling");
      alt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      alt.focus();
      alt.blur();
    });
    expect(calls.alt).toHaveBeenCalledWith("m1", "Loaves cooling");
  });

  it("B-WR-07: a failed description save is flagged and retried on the next blur", async () => {
    calls.alt
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(true);
    mounted = mount(<Harness initial={[asset()]} />);
    const alt = mounted.container.querySelector<HTMLInputElement>("#alt-m1")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(alt, "Loaves cooling");
      alt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const blur = async () => {
      act(() => {
        alt.focus();
        alt.blur();
      });
      await flush();
    };
    await blur();
    expect(mounted.container.textContent).toContain(ALT_SAVE_FAILED_COPY);
    await blur();
    expect(calls.alt).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toContain(ALT_SAVE_FAILED_COPY);
    await blur();
    expect(calls.alt).toHaveBeenCalledTimes(3);
    expect(calls.alt).toHaveBeenLastCalledWith("m1", "Loaves cooling");
    expect(mounted.container.textContent).not.toContain(ALT_SAVE_FAILED_COPY);
    // Stored now: the same text is not sent again.
    await blur();
    expect(calls.alt).toHaveBeenCalledTimes(3);
  });

  it("Remove shows the Undo toast, and Undo restores", () => {
    mounted = mount(<Harness initial={[asset()]} />);
    click(button(mounted.container, "Remove"));
    expect(calls.remove).toHaveBeenCalledWith("m1");
    expect(mounted.container.textContent).toContain("Photo removed.");
    click(button(mounted.container, "Undo"));
    expect(calls.restore).toHaveBeenCalledWith("m1");
  });

  it("a full gallery shows UPL-LIMIT and hides the drop zone", () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      asset({
        id: `g${i}`,
        kind: "gallery",
        thumbUrl: `/hub/media/g${i}/thumb`,
      }),
    );
    mounted = mount(
      <Harness kind="gallery" multiple max={12} initial={twelve} />,
    );
    expect(mounted.container.textContent).toContain(
      "You've added 12 photos, the most for now. Remove one to add another.",
    );
    expect(mounted.container.querySelector("[data-file-drop]")).toBeNull();
    expect(mounted.container.querySelectorAll("[data-media-id]")).toHaveLength(
      12,
    );
  });

  it("gallery Move later reorders", () => {
    const two = [
      asset({ id: "g1", kind: "gallery" }),
      asset({ id: "g2", kind: "gallery" }),
    ];
    mounted = mount(<Harness kind="gallery" multiple initial={two} />);
    click(button(mounted.container, "Move photo 1 later"));
    expect(calls.reorder).toHaveBeenCalledWith(["g2", "g1"]);
  });

  it("read-only shows no drop zone, Replace or Remove", () => {
    mounted = mount(<Harness readOnly initial={[asset()]} />);
    expect(mounted.container.querySelector("[data-file-drop]")).toBeNull();
    expect(button(mounted.container, "Remove")).toBeNull();
    expect(
      mounted.container.querySelector<HTMLInputElement>("#alt-m1")?.disabled,
    ).toBe(true);
  });
});

describe("helpers", () => {
  it("formatBytes and mediaViewFromServer", () => {
    expect(formatBytes(Math.round(1.8 * MB))).toBe("1.8 MB");
    expect(formatBytes(640 * 1024)).toBe("640 KB");
    expect(mediaViewFromServer({ id: "../x" })).toBeNull();
    expect(
      mediaViewFromServer({ id: "abc", url: "https://evil.example/x.png" })
        ?.thumbUrl,
    ).toBe("/hub/media/abc/thumb");
  });
});
