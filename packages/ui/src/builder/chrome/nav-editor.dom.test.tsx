// @vitest-environment jsdom
// 07-25 Task 3: NavEditor and FooterEditor (CONT-13; UI-SPEC lines 474-486, 664; choice 11).
import type { FooterSettings, NavSettings } from "@cds/core/content";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { FooterEditor } from "./FooterEditor";
import type { ChromePageOption } from "./LinkListEditor";
import { NavEditor } from "./NavEditor";

const P_HOME = "aaaaaaaaaaaaaa1";
const P_ABOUT = "aaaaaaaaaaaaaa2";
const P_DRAFT = "aaaaaaaaaaaaaa3";

const PAGES: ChromePageOption[] = [
  { id: P_HOME, title: "Home", path: "/", published: true },
  { id: P_ABOUT, title: "About", path: "/about", published: true },
  { id: P_DRAFT, title: "Story", path: "/story", published: false },
];

const link = (id: string, label: string, target: string, new_tab = false) => ({
  id,
  label,
  target,
  new_tab,
  children: [],
});

let latest: NavSettings | null = null;
let latestFooter: FooterSettings | null = null;

function NavHarness({ initial }: { initial: NavSettings }) {
  const [v, setV] = useState(initial);
  latest = v;
  return (
    <ToastRegion>
      <NavEditor
        value={v}
        onChange={setV}
        pages={PAGES}
        popups={[{ id: "bbbbbbbbbbbbbb1", name: "Spring offer" }]}
      />
    </ToastRegion>
  );
}

function FooterHarness({ initial }: { initial: FooterSettings }) {
  const [v, setV] = useState(initial);
  latestFooter = v;
  return (
    <ToastRegion>
      <FooterEditor
        value={v}
        onChange={setV}
        pages={PAGES}
        businessName="Rivera Bakery"
      />
    </ToastRegion>
  );
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  latest = null;
  latestFooter = null;
  document.body.innerHTML = "";
});

const BASE: NavSettings = {
  items: [
    link("home", "Home", `page:${P_HOME}`),
    link("about", "About", `page:${P_ABOUT}`),
    link("shop", "Shop", "https://shop.example.com/", true),
    link("gone", "Old", "page:zzzzzzzzzzzzzzz"),
    link("story", "Story", `page:${P_DRAFT}`),
  ],
  cta: null,
  held: false,
};

function menuAction(root: HTMLElement, rowLabel: string, action: string) {
  click(button(root, `More actions for ${rowLabel}`));
  click(button(root, action));
}

const labels = () => latest!.items.map((i) => i.label);

describe("NavEditor", () => {
  it("shows label, target, new-tab icon and page notes", () => {
    m = mount(<NavHarness initial={BASE} />);
    const text = m.container.textContent ?? "";
    expect(text).toContain("Page: About");
    expect(text).toContain("shop.example.com");
    expect(
      m.container.querySelector('[aria-label="Opens in a new tab"]'),
    ).not.toBeNull();
    expect(text).toContain("This page was deleted. Remove it from your menu.");
    expect(text).toContain("Shows once the page is published.");
  });

  it("Move down then Move up restores the order", () => {
    m = mount(<NavHarness initial={BASE} />);
    menuAction(m.container, "Home", "Move down");
    expect(labels().slice(0, 2)).toEqual(["About", "Home"]);
    menuAction(m.container, "Home", "Move up");
    expect(labels().slice(0, 2)).toEqual(["Home", "About"]);
  });

  it("Put under and Move out of nest one level with a guide", () => {
    m = mount(<NavHarness initial={BASE} />);
    menuAction(m.container, "About", 'Put under "Home"');
    expect(latest!.items[0]!.children.map((c) => c.label)).toEqual(["About"]);
    const child = m.container.querySelector('[data-nav-row="about"] > div');
    expect(child?.className).toContain("ml-6");
    expect(child?.className).toContain("border-l");
    menuAction(m.container, "About", 'Move out of "Home"');
    expect(labels().slice(0, 2)).toEqual(["Home", "About"]);
  });

  it("Remove shows the Undo toast and Undo restores the row", async () => {
    m = mount(<NavHarness initial={BASE} />);
    menuAction(m.container, "About", "Remove from menu");
    expect(labels()).not.toContain("About");
    expect(document.body.textContent).toContain("About removed from the menu.");
    click(button(document.body, "Undo"));
    await flush();
    expect(labels()[1]).toBe("About");
  });

  it("Add link: a page pre-fills the label, a bad address shows the target copy", () => {
    m = mount(<NavHarness initial={{ items: [], cta: null, held: false }} />);
    expect(m.container.textContent).toContain(
      "Your menu is empty, so visitors only see your logo. Add your main pages.",
    );
    click(button(m.container, "Add link"));
    const select = m.container.querySelector(
      "#nav-link-new-page",
    ) as HTMLSelectElement;
    select.value = P_ABOUT;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      (m.container.querySelector("#nav-link-new-label") as HTMLInputElement)
        .value,
    ).toBe("About");
    click(button(m.container, "Add to menu"));
    expect(latest!.items).toHaveLength(1);
    expect(latest!.items[0]).toMatchObject({
      label: "About",
      target: `page:${P_ABOUT}`,
    });

    click(button(m.container, "Add link"));
    typeInto(m.container.querySelector("#nav-link-new-label"), "Shop");
    click(m.container.querySelector('input[type="radio"][value="url"]'));
    typeInto(
      m.container.querySelector("#nav-link-new-url"),
      "shop.example.com",
    );
    click(button(m.container, "Add to menu"));
    expect(m.container.textContent).toContain(
      "Choose a page or enter a web address starting with https://.",
    );
    click(button(m.container, "Discard link"));
    expect(m.container.querySelector("#nav-link-new-label")).toBeNull();
    expect(latest!.items).toHaveLength(1);
  });

  it("disables Add link at 8 top-level links with NAV-LIMIT", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      link(`l${i}`, `L${i}`, "https://x.test/"),
    );
    m = mount(<NavHarness initial={{ items, cta: null, held: false }} />);
    expect(button(m.container, "Add link")!.disabled).toBe(true);
    expect(m.container.textContent).toContain(
      "Menus hold up to 8 links. Put some under another link, or remove one.",
    );
  });

  it("Menu button switch reveals Button text and Opens", () => {
    m = mount(<NavHarness initial={BASE} />);
    click(m.container.querySelector("#nav-cta-on"));
    expect(latest!.cta).toEqual({ label: "Book now", target: "" });
    expect(
      (m.container.querySelector("#nav-cta-label") as HTMLInputElement).value,
    ).toBe("Book now");
    click(
      m.container.querySelector('input[name="nav-cta-kind"][value="popup"]'),
    );
    expect(m.container.textContent).toContain(
      "The button shows on pages where this pop-up is set to appear.",
    );
  });
});

describe("FooterEditor", () => {
  const FOOTER: FooterSettings = {
    show_address: true,
    show_hours: true,
    show_socials: true,
    extra_links: [],
    copyright: "",
    held: false,
  };

  it("has three switches on, the copyright helper and the Report note", () => {
    m = mount(<FooterHarness initial={FOOTER} />);
    for (const id of ["footer-address", "footer-hours", "footer-socials"]) {
      expect(
        (m.container.querySelector(`#${id}`) as HTMLInputElement).checked,
      ).toBe(true);
    }
    const copy = m.container.querySelector(
      "#footer-copyright",
    ) as HTMLInputElement;
    expect(copy.placeholder).toBe("© {year} Rivera Bakery");
    expect(m.container.textContent).toContain(
      "The year updates itself when you use {year}.",
    );
    expect(m.container.textContent).toContain(
      "Every footer has a small Report link that lets visitors tell CDS about a problem. It can't be removed.",
    );
    click(m.container.querySelector("#footer-hours"));
    expect(latestFooter!.show_hours).toBe(false);
  });

  it("extra links: no nesting, and disabled at 6", () => {
    const extra = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      label: `E${i}`,
      target: "https://x.test/",
      new_tab: false,
    }));
    m = mount(<FooterHarness initial={{ ...FOOTER, extra_links: extra }} />);
    expect(button(m.container, "Add link")!.disabled).toBe(true);
    expect(m.container.textContent).toContain(
      "Footers hold up to 6 extra links.",
    );
    click(button(m.container, "More actions for E1"));
    expect(button(m.container, 'Put under "E0"')).toBeNull();
  });
});
