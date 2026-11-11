// @vitest-environment jsdom
// Lightbox island in a real DOM (07-22; CONT-22; UI-SPEC Lightbox, a11y line 680).
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { button, click, mount, type Mounted } from "../../test-support/dom";
import { Lightbox, type LightboxPhoto } from "./Lightbox";

let reduced = false;

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

beforeEach(() => {
  reduced = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const PHOTOS: LightboxPhoto[] = Array.from({ length: 12 }, (_, i) => ({
  src: `/_media/m${i + 1}/w960.webp`,
  srcSet: `/_media/m${i + 1}/w1600.webp 1600w, /_media/m${i + 1}/w2560.webp 2560w`,
  width: 1600,
  height: 1200,
  alt: `Photo alt ${i + 1}`,
  caption: `Caption ${i + 1}`,
  position: i + 1,
}));

function render() {
  mounted = mount(
    <Lightbox photos={PHOTOS} total={12}>
      <ul>
        {PHOTOS.map((p, i) => (
          <li key={p.src}>
            <button
              type="button"
              data-gallery-photo=""
              data-index={i}
              aria-label={`Open photo ${i + 1} of 12: ${p.alt}`}
            >
              <img src={p.src} alt="" />
            </button>
          </li>
        ))}
      </ul>
    </Lightbox>,
  );
  return mounted.container;
}

const dialog = () => document.querySelector("dialog")!;
const shown = () => dialog().querySelector("img");
const counter = () => dialog().querySelector("[aria-live]")?.textContent;

function key(k: string) {
  act(() => {
    dialog().dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
  });
}

function pointer(type: string, x: number, y: number) {
  const stage = dialog().querySelector("[data-lightbox-stage]")!;
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  act(() => {
    stage.dispatchEvent(e);
  });
}

describe("Lightbox", () => {
  it("mounts no dialog image while closed", () => {
    render();
    expect(dialog().getAttribute("aria-label")).toBe("Photo viewer");
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(shown()).toBeNull();
  });

  it("opens on the clicked photo with its alt, srcset, counter and caption", () => {
    const root = render();
    click(button(root, "Open photo 3 of 12: Photo alt 3"));
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(shown()?.getAttribute("alt")).toBe("Photo alt 3");
    expect(shown()?.getAttribute("srcset")).toContain("w2560.webp 2560w");
    expect(shown()?.getAttribute("sizes")).toBe("100vw");
    expect(counter()).toBe("3 of 12");
    expect(dialog().textContent).toContain("Caption 3");
  });

  it("steps with Next/Previous and the arrow keys", () => {
    const root = render();
    click(button(root, "Open photo 3 of 12: Photo alt 3"));
    click(button(dialog(), "Next photo"));
    expect(counter()).toBe("4 of 12");
    click(button(dialog(), "Previous photo"));
    expect(counter()).toBe("3 of 12");
    key("ArrowRight");
    expect(counter()).toBe("4 of 12");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(counter()).toBe("2 of 12");
  });

  it("stops at the ends (no wrap-around)", () => {
    const root = render();
    click(button(root, "Open photo 1 of 12: Photo alt 1"));
    expect(
      button(dialog(), "Previous photo")?.getAttribute("aria-disabled"),
    ).toBe("true");
    click(button(dialog(), "Previous photo"));
    expect(counter()).toBe("1 of 12");
    for (let i = 0; i < 15; i++) key("ArrowRight");
    expect(counter()).toBe("12 of 12");
    expect(button(dialog(), "Next photo")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(
      button(dialog(), "Previous photo")?.hasAttribute("aria-disabled"),
    ).toBe(false);
  });

  it("a horizontal swipe over 40px steps; a short or vertical one does not", () => {
    const root = render();
    click(button(root, "Open photo 3 of 12: Photo alt 3"));
    pointer("pointerdown", 300, 200);
    pointer("pointerup", 250, 205);
    expect(counter()).toBe("4 of 12");
    pointer("pointerdown", 300, 200);
    pointer("pointerup", 280, 200);
    expect(counter()).toBe("4 of 12");
    pointer("pointerdown", 300, 200);
    pointer("pointerup", 250, 320);
    expect(counter()).toBe("4 of 12");
    pointer("pointerdown", 200, 200);
    pointer("pointerup", 300, 200);
    expect(counter()).toBe("3 of 12");
  });

  it("Close closes and returns focus to the photo button", () => {
    const root = render();
    const opener = button(root, "Open photo 3 of 12: Photo alt 3")!;
    opener.focus();
    click(opener);
    const close = button(dialog(), "Close photo")!;
    expect(close.hasAttribute("data-cds-popup-close")).toBe(true);
    click(close);
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(shown()).toBeNull();
  });

  it("animates the open unless reduced motion is on", () => {
    const root = render();
    click(button(root, "Open photo 2 of 12: Photo alt 2"));
    expect(dialog().className).toContain("transition-[opacity,scale]");
    click(button(dialog(), "Close photo"));
    reduced = true;
    click(button(root, "Open photo 2 of 12: Photo alt 2"));
    expect(dialog().className).not.toContain("transition");
  });
});
