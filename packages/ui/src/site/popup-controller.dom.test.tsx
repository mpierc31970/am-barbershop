// @vitest-environment jsdom
// PopupController in a real DOM (03-REVIEW WR-C06, WR-C07; 07-14 consent gate and phones).
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PopupController,
  type PopupControllerConfig,
} from "./client/PopupController";
import { click, flush, mount, type Mounted } from "../test-support/dom";

beforeAll(() => {
  // jsdom has <dialog> but not the modal API; open/close by attribute is enough here.
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

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

function dialog(id: string): HTMLDialogElement {
  const el = document.createElement("dialog");
  el.dataset.cdsPopup = id;
  el.innerHTML = '<button type="button" data-cds-popup-close="">Close</button>';
  document.body.appendChild(el);
  return el;
}

function config(
  over: Partial<PopupControllerConfig> = {},
): PopupControllerConfig {
  return {
    id: "pop1",
    trigger: "scroll",
    delay_seconds: 5,
    scroll_percent: 50,
    frequency: "every-visit",
    show_on: "all-pages",
    page_ids: [],
    enabled: true,
    ...over,
  };
}

describe("WR-C06: scroll-triggered pop-ups", () => {
  it("open on a page too short to scroll, with no scroll event at all", async () => {
    const d = dialog("pop1");
    // jsdom reports scrollHeight == clientHeight == 0: an unscrollable page (100%).
    mounted = mount(
      <PopupController config={[config()]} pageId="page-short" />,
    );
    await flush();
    expect(d.hasAttribute("open")).toBe(true);
  });
});

// ---- 07-14: consent gate and phone suppression (CONT-34) ------------------------------------

let pageSeq = 0;
const nextPage = () => `page-07-14-${(pageSeq += 1)}`;

function stubViewport(wideViewport: boolean): () => void {
  const original = window.matchMedia;
  const state = { wide: wideViewport };
  window.matchMedia = ((q: string) => ({
    get matches() {
      return q.includes("min-width: 768px") ? state.wide : false;
    },
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  stubViewport.state = state;
  return () => {
    window.matchMedia = original;
  };
}
stubViewport.state = { wide: true };

function pendingBanner(): void {
  const banner = document.createElement("section");
  banner.setAttribute("data-cds-consent-pending", "");
  document.body.appendChild(banner);
}

function choose(choice: "all" | "necessary"): void {
  document.cookie = `cds_consent=${choice}; Path=/`;
  document.querySelector("[data-cds-consent-pending]")?.remove();
  act(() => {
    document.dispatchEvent(
      new CustomEvent("cds:consent", { detail: { choice } }),
    );
  });
}

function opener(id: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.cdsPopupOpen = id;
  b.textContent = "Open";
  document.body.appendChild(b);
  return b;
}

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("07-14: automatic pop-ups wait for the cookie choice", () => {
  afterEach(() => {
    document.cookie = "cds_consent=; Max-Age=0; Path=/";
  });

  it("a page-load pop-up waits while the banner is pending, then opens", async () => {
    pendingBanner();
    const d = dialog("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "page-load" })]}
        pageId={nextPage()}
      />,
    );
    await flush();
    expect(d.hasAttribute("open")).toBe(false);
    choose("necessary");
    await flush();
    expect(d.hasAttribute("open")).toBe(true);
  });

  it("a scroll pop-up waits too", async () => {
    pendingBanner();
    const d = dialog("pop1");
    mounted = mount(
      <PopupController config={[config()]} pageId={nextPage()} />,
    );
    await flush();
    expect(d.hasAttribute("open")).toBe(false);
    choose("all");
    await flush();
    expect(d.hasAttribute("open")).toBe(true);
  });

  it("a delay is counted from the choice", async () => {
    pendingBanner();
    const d = dialog("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "delay", delay_seconds: 0.1 })]}
        pageId={nextPage()}
      />,
    );
    await wait(150);
    expect(d.hasAttribute("open")).toBe(false);
    choose("all");
    await wait(30);
    expect(d.hasAttribute("open")).toBe(false);
    await wait(150);
    expect(d.hasAttribute("open")).toBe(true);
  });

  it("a click opens a pop-up while the banner is pending", async () => {
    pendingBanner();
    const d = dialog("pop1");
    const b = opener("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "click", show_on: "button-only" })]}
        pageId={nextPage()}
      />,
    );
    await flush();
    click(b);
    expect(d.hasAttribute("open")).toBe(true);
  });
});

describe("07-14: no automatic pop-ups under 768 px", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("never fires page-load or scroll pop-ups on a narrow viewport, even after consent", async () => {
    restore = stubViewport(false);
    const a = dialog("pop1");
    const b = dialog("pop2");
    mounted = mount(
      <PopupController
        config={[
          config({ id: "pop1", trigger: "page-load" }),
          config({ id: "pop2" }),
        ]}
        pageId={nextPage()}
      />,
    );
    await flush();
    choose("all");
    await flush();
    expect(a.hasAttribute("open")).toBe(false);
    expect(b.hasAttribute("open")).toBe(false);
    document.cookie = "cds_consent=; Max-Age=0; Path=/";
  });

  it("a button still opens the pop-up on a narrow viewport", async () => {
    restore = stubViewport(false);
    const d = dialog("pop1");
    const b = opener("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "page-load" })]}
        pageId={nextPage()}
      />,
    );
    await flush();
    expect(d.hasAttribute("open")).toBe(false);
    click(b);
    expect(d.hasAttribute("open")).toBe(true);
  });

  it("a viewport that turns narrow before a delay fires suppresses it", async () => {
    restore = stubViewport(true);
    const d = dialog("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "delay", delay_seconds: 0.05 })]}
        pageId={nextPage()}
      />,
    );
    await flush(1);
    stubViewport.state.wide = false;
    await wait(120);
    expect(d.hasAttribute("open")).toBe(false);
  });

  it("opens on a wide viewport", async () => {
    restore = stubViewport(true);
    const d = dialog("pop1");
    mounted = mount(
      <PopupController
        config={[config({ trigger: "page-load" })]}
        pageId={nextPage()}
      />,
    );
    await flush();
    expect(d.hasAttribute("open")).toBe(true);
  });
});
