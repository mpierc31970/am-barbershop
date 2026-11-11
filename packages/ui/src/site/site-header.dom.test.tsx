// @vitest-environment jsdom
// 07-25 Task 2: SiteHeader SSR and the NavDisclosure island (CONT-13; D-UI-P7-19,
// D-UI-P7-28; 07-25 choices 4-6, 9, 12).
import type { ResolvedNav } from "@cds/core/content";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { button, click, mount, type Mounted } from "../test-support/dom";
import { SiteHeader } from "./SiteHeader";
import { siteButtonClasses } from "./SiteButton";

const NAV: ResolvedNav = {
  entries: [
    { kind: "link", id: "home", label: "Home", href: "/", newTab: false },
    {
      kind: "group",
      id: "about",
      label: "About",
      links: [
        { id: "about", label: "About", href: "/about", newTab: false },
        { id: "team", label: "Team", href: "/team", newTab: false },
        { id: "story", label: "Story", href: "/story", newTab: false },
      ],
    },
    {
      kind: "link",
      id: "shop",
      label: "Shop",
      href: "https://shop.example.com/",
      newTab: true,
    },
  ],
  cta: { label: "Book now", href: "/book" },
};

const BRAND = { name: "Rivera Bakery" };

describe("SiteHeader SSR", () => {
  const html = renderToStaticMarkup(<SiteHeader brand={BRAND} nav={NAV} />);

  it("renders one header, the wordmark, the Main nav and no h1", () => {
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain(">Rivera Bakery</span>");
    expect(html).toContain('<nav aria-label="Main">');
    expect(html).not.toContain("<h1");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
  });

  it("renders dropdowns and the phone menu as <details> without JavaScript", () => {
    expect(html).toMatch(
      /<details[^>]*data-nav-group="about"[^>]*><summary[^>]*>About/,
    );
    expect(html).toMatch(/<summary[^>]*>.*?Menu<\/summary>/);
  });

  it("opens external links in a new tab safely and styles the CTA as primary", () => {
    expect(html).toMatch(
      /<a href="https:\/\/shop\.example\.com\/" target="_blank" rel="noopener noreferrer"/,
    );
    expect(html).toContain(`class="${siteButtonClasses("primary")}"`);
  });

  it("renders the logo image when given", () => {
    const out = renderToStaticMarkup(
      <SiteHeader
        brand={{
          name: "Rivera Bakery",
          logo: {
            id: "l1",
            kind: "image",
            src: "/_media/l1/w480.webp",
            alt: "x",
            width: 480,
            height: 120,
          },
        }}
        nav={NAV}
      />,
    );
    expect(out).toMatch(
      /<img src="\/_media\/l1\/w480.webp"[^>]*alt="Rivera Bakery"/,
    );
  });

  it("renders the search slot and utilities when set", () => {
    const out = renderToStaticMarkup(
      <SiteHeader
        brand={BRAND}
        nav={NAV}
        searchHref="/search"
        utilities={<a href="#t">Translate</a>}
      />,
    );
    expect(out).toContain('aria-label="Search this site"');
    expect(out).toContain("Translate");
  });

  it("an empty menu renders the logo only", () => {
    const out = renderToStaticMarkup(
      <SiteHeader brand={BRAND} nav={{ entries: [], cta: null }} />,
    );
    expect(out).not.toContain("<nav");
    expect(out).not.toContain("Menu");
  });

  it("a pop-up CTA is hidden on the server", () => {
    const out = renderToStaticMarkup(
      <SiteHeader
        brand={BRAND}
        nav={{ entries: [], cta: { label: "Offer", popupId: "pop1" } }}
      />,
    );
    expect(out).toMatch(/<span hidden=""[^>]*data-nav-cta/);
  });
});

describe("NavDisclosure island", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.unmount();
    m = null;
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  function key(k: string) {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    });
  }

  it("turns the dropdown into a disclosure button with Esc and outside close", () => {
    m = mount(<SiteHeader brand={BRAND} nav={NAV} layout="desktop" />);
    const about = button(m.container, /About/)!;
    expect(about.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(
      about.getAttribute("aria-controls")!,
    )!;
    expect(panel.hidden).toBe(true);
    click(about);
    expect(about.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    key("Escape");
    expect(about.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(about);
    click(about);
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(about.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens one dropdown at a time", () => {
    const nav: ResolvedNav = {
      entries: [
        NAV.entries[1]!,
        {
          kind: "group",
          id: "more",
          label: "More",
          links: [{ id: "x", label: "X", href: "/x", newTab: false }],
        },
      ],
      cta: null,
    };
    m = mount(<SiteHeader brand={BRAND} nav={nav} layout="desktop" />);
    const about = button(m.container, /About/)!;
    const more = button(m.container, /More/)!;
    click(about);
    click(more);
    expect(about.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  // A&M fork: the phone menu is a modal <dialog> drawer (Esc arrives as the dialog's own
  // cancel/close, simulated here with close()).
  it("the phone Menu opens the drawer dialog and closing returns focus", () => {
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
    m = mount(<SiteHeader brand={BRAND} nav={NAV} layout="mobile" />);
    const menu = button(m.container, "Menu")!;
    const panel = document.getElementById(
      menu.getAttribute("aria-controls")!,
    ) as HTMLDialogElement;
    expect(panel.tagName).toBe("DIALOG");
    expect(panel.open).toBe(false);
    click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(panel.open).toBe(true);
    expect(panel.querySelector("ul ul a[href='/team']")).not.toBeNull();
    expect(panel.querySelector("button[aria-expanded]")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    act(() => panel.close());
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);
    expect(document.body.style.overflow).toBe("");
  });

  it("marks the current page", () => {
    window.history.replaceState(null, "", "/team");
    m = mount(<SiteHeader brand={BRAND} nav={NAV} layout="desktop" />);
    const current = m.container.querySelectorAll('[aria-current="page"]');
    expect(Array.from(current).map((a) => a.getAttribute("href"))).toContain(
      "/team",
    );
    expect(m.container.querySelector('a[href="/"][aria-current]')).toBeNull();
  });

  it("shows a pop-up CTA only when its dialog is on the page", () => {
    const nav: ResolvedNav = {
      entries: [],
      cta: { label: "Offer", popupId: "pop1" },
    };
    m = mount(<SiteHeader brand={BRAND} nav={nav} layout="desktop" />);
    expect(
      (m.container.querySelector("[data-nav-cta]") as HTMLElement).hidden,
    ).toBe(true);
    m.unmount();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("data-cds-popup", "pop1");
    document.body.appendChild(dialog);
    m = mount(<SiteHeader brand={BRAND} nav={nav} layout="desktop" />);
    expect(
      (m.container.querySelector("[data-nav-cta]") as HTMLElement).hidden,
    ).toBe(false);
  });
});
