// @vitest-environment jsdom
// 12-09 Task 2 (COMM-01, COMM-08, D119; 12-UI-SPEC "Composer" lines 335-351, a11y 828-850):
// typing, Ctrl/Cmd+Enter send, pasted screenshots, dropped files, Attach files, one XHR per
// file to /hub/api/support/upload, inline limits, read-only reasons and the session draft.
// A fake XMLHttpRequest records every request; nothing leaves the test.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../test-support/dom";
import { SUPPORT_UI_COPY } from "../copy";
import {
  Composer,
  SUPPORT_UPLOAD_URL,
  THREAD_COPY,
  type ComposerProps,
} from "./index";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-12T19:14:00Z");
const MB = 1024 * 1024;

type Handler = (x: FakeXHR) => void;

class FakeXHR {
  static all: FakeXHR[] = [];
  static handler: Handler = (x) =>
    x.respond(200, { token: `tok-${FakeXHR.all.length}`, scan: "clean" });
  method = "";
  url = "";
  body: unknown = null;
  status = 0;
  responseText = "";
  upload: {
    onprogress: ((e: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send(body: unknown) {
    this.body = body;
    FakeXHR.all.push(this);
    const h = FakeXHR.handler;
    queueMicrotask(() => h(this));
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent);
  }
  respond(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.upload.onload?.();
    this.onload?.();
  }
}

let mounted: Mounted | null = null;
beforeEach(() => {
  FakeXHR.all = [];
  FakeXHR.handler = (x) =>
    x.respond(200, { token: `tok-${FakeXHR.all.length}`, scan: "clean" });
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  sessionStorage.clear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function file(name: string, type: string, size = 1000): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function render(p: Partial<ComposerProps> = {}) {
  const onSend = vi.fn(async (): Promise<{ ok: true }> => ({
    ok: true,
  })) as unknown as ComposerProps["onSend"] & ReturnType<typeof vi.fn>;
  mounted = mount(
    <Composer
      threadKey="conv-1"
      label="Write to CDS"
      timeZone={TZ}
      now={() => NOW}
      onSend={onSend}
      {...p}
    />,
  );
  return { onSend: (p.onSend ?? onSend) as ReturnType<typeof vi.fn> };
}

function textarea(): HTMLTextAreaElement {
  return mounted!.container.querySelector("textarea")!;
}

function fileInput(): HTMLInputElement {
  return mounted!.container.querySelector('input[type="file"]')!;
}

function pick(files: File[]) {
  const input = fileInput();
  Object.defineProperty(input, "files", {
    value: files,
    configurable: true,
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function keydown(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

function paste(el: Element, files: File[], text = ""): Event {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", {
    value: {
      files,
      items: files.map((f) => ({
        kind: "file",
        type: f.type,
        getAsFile: () => f,
      })),
      types: text ? ["text/plain"] : ["Files"],
      getData: (t: string) => (t === "text/plain" ? text : ""),
    },
  });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe("Composer", () => {
  it("labels the textarea and advertises Ctrl/Cmd+Enter", () => {
    render();
    const ta = textarea();
    const label = mounted!.container.querySelector(`label[for="${ta.id}"]`);
    expect(label!.textContent).toBe("Write to CDS");
    expect(ta.getAttribute("aria-keyshortcuts")).toBe(
      "Control+Enter Meta+Enter",
    );
    expect(ta.maxLength).toBe(5000);
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.ATTACH_HINT,
    );
  });

  it("Send message is secondary by default; primary shows Send reply", () => {
    render();
    expect(button(mounted!.container, "Send message")).not.toBeNull();
    mounted!.unmount();
    render({ primary: true, label: "Your reply" });
    expect(button(mounted!.container, "Send reply")).not.toBeNull();
  });

  it("Ctrl+Enter sends the body with ready tokens; Enter alone does not", async () => {
    const { onSend } = render();
    pick([file("invoice.pdf", "application/pdf")]);
    await flush();
    expect(FakeXHR.all).toHaveLength(1);
    expect(FakeXHR.all[0]!.url).toBe(SUPPORT_UPLOAD_URL);
    expect(FakeXHR.all[0]!.method).toBe("POST");
    expect((FakeXHR.all[0]!.body as FormData).get("file")).toBeInstanceOf(File);

    typeInto(textarea(), "hello\nthere");
    const plain = keydown(textarea(), { key: "Enter" });
    expect(plain.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();

    const send = keydown(textarea(), { key: "Enter", ctrlKey: true });
    expect(send.defaultPrevented).toBe(true);
    await flush();
    expect(onSend).toHaveBeenCalledWith("hello\nthere", ["tok-1"]);
    // Success clears the composer.
    expect(textarea().value).toBe("");
    expect(mounted!.container.textContent).not.toContain("invoice.pdf");
  });

  it("Cmd+Enter sends too", async () => {
    const { onSend } = render();
    typeInto(textarea(), "hi");
    keydown(textarea(), { key: "Enter", metaKey: true });
    await flush();
    expect(onSend).toHaveBeenCalledWith("hi", []);
  });

  it("shows upload progress as a progressbar", async () => {
    FakeXHR.handler = () => {};
    render();
    pick([file("shot.png", "image/png", 2000)]);
    await flush();
    act(() => FakeXHR.all[0]!.progress(800, 2000));
    const bar = mounted!.container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuetext")).toBe("Uploading shot.png, 40%");
    expect(bar.textContent).toContain("Uploading 40%");
  });

  it("pasting an image adds a Screenshot chip; pasting text does not", async () => {
    render();
    const img = new File(["p"], "image.png", { type: "image/png" });
    const e = paste(textarea(), [img]);
    expect(e.defaultPrevented).toBe(true);
    await flush();
    expect(mounted!.container.textContent).toContain(
      "Screenshot 12 Oct, 2:14 pm.png",
    );
    const sent = (FakeXHR.all[0]!.body as FormData).get("file") as File;
    expect(sent.name).toBe("Screenshot 12 Oct, 2:14 pm.png");

    const t = paste(textarea(), [], "just words");
    expect(t.defaultPrevented).toBe(false);
    expect(FakeXHR.all).toHaveLength(1);
  });

  it("several pasted images get distinct names (IN-D03)", async () => {
    render();
    paste(textarea(), [
      new File(["p"], "a.png", { type: "image/png" }),
      new File(["q"], "b.jpg", { type: "image/jpeg" }),
    ]);
    await flush();
    const names = FakeXHR.all.map(
      (x) => ((x.body as FormData).get("file") as File).name,
    );
    expect(names).toEqual([
      "Screenshot 12 Oct, 2:14 pm.png",
      "Screenshot 12 Oct, 2:14 pm (2).jpg",
    ]);
  });

  it("dropping files on the composer attaches them", async () => {
    render();
    const zone = mounted!.container.querySelector("[data-composer]")!;
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", {
      value: { files: [file("notes.txt", "text/plain")], types: ["Files"] },
    });
    act(() => {
      zone.dispatchEvent(e);
    });
    await flush();
    expect(mounted!.container.textContent).toContain("notes.txt");
    expect(FakeXHR.all).toHaveLength(1);
  });

  it("a text drag is left alone: no overlay, not cancelled (IN-D04)", () => {
    render();
    const zone = mounted!.container.querySelector("[data-composer]")!;
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", {
      value: { files: [], types: ["text/plain"] },
    });
    act(() => {
      zone.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(false);
    expect(zone.hasAttribute("data-over")).toBe(false);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [], types: ["text/plain"] },
    });
    act(() => {
      zone.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(false);
  });

  it("Attach files opens the picker", () => {
    render();
    const spy = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    click(button(mounted!.container, "Attach files"));
    expect(spy).toHaveBeenCalled();
  });

  it("a 6th file shows FILE-TOO-MANY", async () => {
    render();
    pick(
      Array.from({ length: 6 }, (_, i) => file(`f${i}.pdf`, "application/pdf")),
    );
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.FILE_TOO_MANY,
    );
    expect(FakeXHR.all).toHaveLength(5);
    expect(mounted!.container.textContent).not.toContain("f5.pdf");
  });

  it("an 11 MB file shows FILE-TOO-BIG and a .exe shows FILE-TYPE; neither is sent", async () => {
    render();
    pick([file("big.png", "image/png", 11 * MB), file("setup.exe", "")]);
    await flush();
    const alert = mounted!.container.querySelector("[data-upload-errors]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(
      SUPPORT_UI_COPY.FILE_TOO_BIG("big.png"),
    );
    expect(alert.textContent).toContain(SUPPORT_UI_COPY.FILE_TYPE("setup.exe"));
    expect(document.activeElement).toBe(alert);
    expect(FakeXHR.all).toHaveLength(0);
  });

  it("a failed upload shows FILE-FAILED with Try again", async () => {
    let n = 0;
    FakeXHR.handler = (x) => {
      n += 1;
      if (n === 1) x.onerror?.();
      else x.respond(200, { token: "tok-retry", scan: "pending" });
    };
    const { onSend } = render();
    pick([file("a.pdf", "application/pdf")]);
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.FILE_FAILED("a.pdf"),
    );
    // Announced (WR-D05): the failure text is an alert.
    const chipAlert = mounted!.container.querySelector(
      '[data-upload] [role="alert"]',
    );
    expect(chipAlert?.textContent).toBe(SUPPORT_UI_COPY.FILE_FAILED("a.pdf"));
    click(button(mounted!.container, "Try again"));
    await flush();
    expect(mounted!.container.textContent).not.toContain(
      SUPPORT_UI_COPY.FILE_FAILED("a.pdf"),
    );
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(onSend).toHaveBeenCalledWith("", ["tok-retry"]);
  });

  it("a failed chip keeps its slot, so Try again never makes a 6th file (IN-D02)", async () => {
    let n = 0;
    FakeXHR.handler = (x) => {
      n += 1;
      if (n === 1) x.onerror?.();
      else x.respond(200, { token: `tok-${n}`, scan: "clean" });
    };
    render();
    pick(
      Array.from({ length: 5 }, (_, i) => file(`f${i}.pdf`, "application/pdf")),
    );
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.FILE_FAILED("f0.pdf"),
    );
    pick([file("f5.pdf", "application/pdf")]);
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.FILE_TOO_MANY,
    );
    expect(mounted!.container.textContent).not.toContain("f5.pdf");
    expect(FakeXHR.all).toHaveLength(5);
  });

  it("the server's refusal copy is shown (429 RATE-UPLOADS)", async () => {
    FakeXHR.handler = (x) =>
      x.respond(429, { error: SUPPORT_UI_COPY.RATE_UPLOADS });
    render();
    pick([file("a.pdf", "application/pdf")]);
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.RATE_UPLOADS,
    );
  });

  it("a failed file blocks Send until removed or retried (WR-D04)", async () => {
    let n = 0;
    FakeXHR.handler = (x) => {
      n += 1;
      if (n === 1) x.onerror?.();
      else x.respond(200, { token: `tok-${n}`, scan: "clean" });
    };
    const { onSend } = render();
    pick([file("a.pdf", "application/pdf"), file("b.pdf", "application/pdf")]);
    await flush();
    typeInto(textarea(), "see files");
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(onSend).not.toHaveBeenCalled();
    expect(mounted!.container.textContent).toContain(THREAD_COPY.failedUploads);
    click(button(mounted!.container, "Remove a.pdf"));
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(onSend).toHaveBeenCalledWith("see files", ["tok-2"]);
  });

  it("paste and drop are ignored while sending (WR-D04)", async () => {
    let finish!: (r: { ok: true }) => void;
    const onSend = vi.fn(
      () =>
        new Promise<{ ok: true }>((r) => {
          finish = r;
        }),
    );
    render({ onSend });
    typeInto(textarea(), "hi");
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(onSend).toHaveBeenCalledTimes(1);
    paste(textarea(), [new File(["p"], "image.png", { type: "image/png" })]);
    const zone = mounted!.container.querySelector("[data-composer]")!;
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", {
      value: { files: [file("notes.txt", "text/plain")], types: ["Files"] },
    });
    act(() => {
      zone.dispatchEvent(e);
    });
    await flush();
    expect(FakeXHR.all).toHaveLength(0);
    expect(mounted!.container.querySelector("[data-upload]")).toBeNull();
    await act(async () => finish({ ok: true }));
  });

  it("Remove drops a chip", async () => {
    render();
    pick([file("a.pdf", "application/pdf")]);
    await flush();
    click(button(mounted!.container, "Remove a.pdf"));
    expect(mounted!.container.textContent).not.toContain("a.pdf");
  });

  it("empty body and no files shows MSG-REQUIRED on send", async () => {
    const { onSend } = render();
    click(button(mounted!.container, "Send message"));
    await flush();
    expect(onSend).not.toHaveBeenCalled();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.MSG_REQUIRED,
    );
    expect(textarea().getAttribute("aria-invalid")).toBe("true");
  });

  it("a failed send keeps the text and shows ERR-SEND; a rate limit shows RATE-MESSAGES", async () => {
    const onSend = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, code: "rate_limited" });
    render({ onSend });
    typeInto(textarea(), "keep me");
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(mounted!.container.textContent).toContain(SUPPORT_UI_COPY.ERR_SEND);
    expect(textarea().value).toBe("keep me");
    keydown(textarea(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.RATE_MESSAGES,
    );
    expect(textarea().value).toBe("keep me");
  });

  it("counter appears from 4,500 characters, in aria-describedby", () => {
    render();
    typeInto(textarea(), "a".repeat(4499));
    expect(mounted!.container.textContent).not.toContain("of 5,000");
    typeInto(textarea(), "a".repeat(4620));
    expect(mounted!.container.textContent).toContain("4,620 of 5,000");
    const ids = textarea().getAttribute("aria-describedby")!;
    expect(document.getElementById(ids.split(" ")[0]!)!.textContent).toBe(
      "4,620 of 5,000",
    );
  });

  it("readOnlyReason renders the reason and no textarea", () => {
    render({ readOnlyReason: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT });
    expect(mounted!.container.querySelector("textarea")).toBeNull();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.IMPERSONATING_SUPPORT,
    );
  });

  it("disabled without a reason shows VIEWER-READONLY", () => {
    render({ disabled: true });
    expect(mounted!.container.querySelector("textarea")).toBeNull();
    expect(mounted!.container.textContent).toContain(
      SUPPORT_UI_COPY.VIEWER_READONLY,
    );
  });

  it("draft text survives an unmount and remount", async () => {
    render();
    typeInto(textarea(), "half a thought");
    mounted!.unmount();
    mounted = null;
    render();
    await flush();
    expect(textarea().value).toBe("half a thought");
    // Another thread has its own draft.
    mounted!.unmount();
    mounted = null;
    render({ threadKey: "ticket-1042" });
    await flush();
    expect(textarea().value).toBe("");
  });
});
