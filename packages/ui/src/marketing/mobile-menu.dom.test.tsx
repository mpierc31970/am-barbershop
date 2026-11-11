// @vitest-environment jsdom
// MkMobileMenu behaviour in a real DOM (15-09; 15-UI-SPEC "MkMobileMenu", Accessibility contract):
// upgrade from the no-JS link, open/close via the button, Esc, backdrop and links, focus to the first
// link and back to the Menu button, Tab wrap inside the panel, inert background, body scroll lock.
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { button, click, mount, type Mounted } from "../test-support/dom";
import { MkMobileMenu } from "./MkMobileMenu";

let mounted: Mounted | null = null;
let main: HTMLElement | null = null;
let footer: HTMLElement | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  main?.remove();
  footer?.remove();
  main = null;
  footer = null;
  document.body.style.overflow = "";
});

function setup() {
  mounted = mount(<MkMobileMenu current="studio" />);
  main = document.createElement("main");
  main.id = "main";
  main.innerHTML = '<a href="/x">page link</a>';
  document.body.appendChild(main);
  footer = document.createElement("footer");
  document.body.appendChild(footer);
  return mounted.container;
}

const menuButton = (root: ParentNode) => button(root, "Menu");
const panel = () => document.getElementById("mk-menu");

function key(target: EventTarget, k: string, shiftKey = false) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }),
    );
  });
}

function open(root: HTMLElement) {
  const b = menuButton(root);
  if (!b) throw new Error("no menu button");
  act(() => b.focus());
  click(b);
  return b;
}

describe("MkMobileMenu", () => {
  it("upgrades the no-JS link to a button that controls the panel", () => {
    const root = setup();
    expect(root.querySelector('a[href="#footer-nav"]')).toBeNull();
    const b = menuButton(root);
    expect(b).not.toBeNull();
    expect(b?.getAttribute("aria-expanded")).toBe("false");
    expect(b?.getAttribute("aria-controls")).toBe("mk-menu");
  });

  it("opens as a modal dialog, focuses the first link and makes the page inert", () => {
    const root = setup();
    const b = open(root);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const dlg = panel();
    expect(dlg?.getAttribute("role")).toBe("dialog");
    expect(dlg?.getAttribute("aria-modal")).toBe("true");
    expect(dlg?.getAttribute("aria-label")).toBe("Menu");
    const first = dlg?.querySelector("a");
    expect(first?.getAttribute("href")).toBe("/standard");
    expect(document.activeElement).toBe(first);
    expect(main?.hasAttribute("inert")).toBe(true);
    expect(footer?.hasAttribute("inert")).toBe(true);
    expect(dlg?.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("the panel always leaves a 48px backdrop strip, so a phone can tap outside to close (WR-C03)", () => {
    const root = setup();
    open(root);
    const cls = panel()?.className ?? "";
    expect(cls).toContain("w-[min(360px,calc(100vw_-_48px))]");
    expect(cls).not.toContain("100%");
  });

  it("lists every link, marks the current one and pins Sign in and Start your site", () => {
    const root = setup();
    open(root);
    const hrefs = Array.from(panel()?.querySelectorAll("a") ?? []).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/standard",
      "/studio",
      "/add-ons",
      "/pricing",
      "/work",
      "/about",
      "/contact",
      "/sign-in",
      "/start",
    ]);
    const current = panel()?.querySelector('[aria-current="page"]');
    expect(current?.getAttribute("href")).toBe("/studio");
  });

  it("Esc closes, removes inert, unlocks scroll and returns focus to the Menu button", () => {
    const root = setup();
    const b = open(root);
    key(document.activeElement ?? document, "Escape");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(main?.hasAttribute("inert")).toBe(false);
    expect(footer?.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(b);
  });

  it("the Close button, the backdrop and a link each close it", () => {
    const root = setup();
    const b = open(root);
    click(button(panel() as HTMLElement, "Close menu"));
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(b);

    open(root);
    click(document.querySelector("[data-mk-menu-backdrop]"));
    expect(b.getAttribute("aria-expanded")).toBe("false");

    open(root);
    const link = panel()?.querySelector('a[href="/pricing"]') as HTMLElement;
    link.addEventListener("click", (e) => e.preventDefault());
    click(link);
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("Tab and Shift+Tab wrap inside the panel", () => {
    const root = setup();
    open(root);
    const focusables = Array.from(
      panel()?.querySelectorAll<HTMLElement>("a[href], button") ?? [],
    );
    const firstEl = focusables[0] as HTMLElement;
    const lastEl = focusables[focusables.length - 1] as HTMLElement;
    act(() => lastEl.focus());
    key(lastEl, "Tab");
    expect(document.activeElement).toBe(firstEl);
    key(firstEl, "Tab", true);
    expect(document.activeElement).toBe(lastEl);
  });

  it("crossing to >= 1024px closes it and focus goes to the desktop nav, not <body> (WR-C04)", () => {
    let onChange: ((e: { matches: boolean }) => void) | null = null;
    const prevMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        onChange = fn;
      },
      removeEventListener: () => {
        onChange = null;
      },
    })) as unknown as typeof window.matchMedia;
    const header = document.createElement("header");
    header.innerHTML =
      '<nav aria-label="Main"><a href="/standard">Standard</a></nav>';
    document.body.appendChild(header);
    try {
      const root = setup();
      const b = open(root);
      // At >= 1024px the button's lg:hidden wrapper is display:none, so focus() is a no-op.
      b.focus = () => {};
      act(() => onChange?.({ matches: true }));
      expect(b.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(header.querySelector("a"));
    } finally {
      header.remove();
      window.matchMedia = prevMatchMedia;
    }
  });

  it("keeps attributes it did not set: a pre-inert element stays inert after close", () => {
    const root = setup();
    footer?.setAttribute("inert", "");
    const b = open(root);
    click(button(panel() as HTMLElement, "Close menu"));
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(footer?.hasAttribute("inert")).toBe(true);
    expect(main?.hasAttribute("inert")).toBe(false);
  });
});
