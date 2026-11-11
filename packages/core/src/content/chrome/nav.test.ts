// 07-25 Task 1: menu rules (CONT-13; D248; T-07-25-03).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import {
  NAV_COPY,
  appendPageLink,
  navHasPage,
  removePageLinks,
  navRefs,
  navTopCount,
  resolveNav,
  validateNav,
  type NavSettings,
} from "./nav";

const P1 = "aaaaaaaaaaaaaa1";
const P2 = "aaaaaaaaaaaaaa2";
const P3 = "aaaaaaaaaaaaaa3";
const POP = "bbbbbbbbbbbbbb1";

const link = (id: string, target: string, extra: object = {}) => ({
  id,
  label: `L ${id}`,
  target,
  ...extra,
});

function expectInvalid(fn: () => unknown, msg: string) {
  expect(fn).toThrow(InvalidInput);
  expect(fn).toThrow(msg);
}

describe("validateNav", () => {
  it("empty input is an empty menu", () => {
    expect(validateNav(null)).toEqual({ items: [], cta: null, held: false });
    expect(validateNav({})).toEqual({ items: [], cta: null, held: false });
  });

  it("refuses 9 top-level links with NAV-LIMIT", () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      link(`i${i}`, "https://x.com"),
    );
    expectInvalid(() => validateNav({ items }), NAV_COPY.limit);
  });

  it("drops grandchildren and refuses 9 children", () => {
    const v = validateNav({
      items: [
        {
          ...link("a", `page:${P1}`),
          children: [
            { ...link("b", `page:${P2}`), children: [link("c", `page:${P3}`)] },
          ],
        },
      ],
    });
    expect(v.items[0]!.children[0]).toEqual({
      id: "b",
      label: "L b",
      target: `page:${P2}`,
      new_tab: false,
    });
    const children = Array.from({ length: 9 }, (_, i) =>
      link(`c${i}`, "https://x.com"),
    );
    expectInvalid(
      () =>
        validateNav({ items: [{ ...link("a", "https://x.com"), children }] }),
      "Dropdowns hold up to 8 links.",
    );
  });

  it("requires a label of at most 40 characters", () => {
    expectInvalid(
      () =>
        validateNav({
          items: [{ id: "a", label: " ", target: "https://x.com" }],
        }),
      "Give this link a name.",
    );
    expectInvalid(
      () =>
        validateNav({
          items: [{ id: "a", label: "x".repeat(41), target: "https://x.com" }],
        }),
      "Keep this under 40 characters.",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "//evil.com",
    "mailto:x@y.z",
    "/about",
    "page:short",
    `popup:${POP}`,
    "",
  ])("refuses the link target %s", (target) => {
    expectInvalid(
      () => validateNav({ items: [link("a", target)] }),
      NAV_COPY.target,
    );
  });

  it("keeps http(s) URLs normalised and new_tab only for URLs", () => {
    const v = validateNav({
      items: [
        link("a", "http://x.com", { new_tab: true }),
        link("b", "https://x.com/a?b", { new_tab: "yes" }),
        link("c", `page:${P1}`, { new_tab: true }),
      ],
    });
    expect(v.items.map((i) => [i.target, i.new_tab])).toEqual([
      ["http://x.com/", true],
      ["https://x.com/a?b", false],
      [`page:${P1}`, false],
    ]);
  });

  it("refuses duplicate ids and drops unknown keys and organization", () => {
    expectInvalid(
      () =>
        validateNav({
          items: [link("a", "https://x.com"), link("a", "https://y.com")],
        }),
      NAV_COPY.duplicate,
    );
    const v = validateNav({
      organization: "evil",
      extra: 1,
      items: [{ ...link("a", "https://x.com"), organization: "evil", x: 1 }],
    });
    expect(Object.keys(v).sort()).toEqual(["cta", "held", "items"]);
    expect(Object.keys(v.items[0]!).sort()).toEqual([
      "children",
      "id",
      "label",
      "new_tab",
      "target",
    ]);
  });

  it("keeps a page or pop-up menu button, defaults the label, refuses URLs", () => {
    expect(
      validateNav({ cta: { label: "", target: `popup:${POP}` } }).cta,
    ).toEqual({
      label: "Book now",
      target: `popup:${POP}`,
    });
    expect(
      validateNav({ cta: { label: "Call", target: `page:${P1}` } }).cta,
    ).toEqual({
      label: "Call",
      target: `page:${P1}`,
    });
    expectInvalid(
      () => validateNav({ cta: { label: "x", target: "https://x.com" } }),
      NAV_COPY.target,
    );
  });

  it("held only from an own boolean", () => {
    expect(validateNav({ held: true }).held).toBe(true);
    expect(validateNav({ held: "true" }).held).toBe(false);
    expect(validateNav(Object.create({ held: true })).held).toBe(false);
  });
});

const NAV: NavSettings = {
  items: [
    { ...link("h", `page:${P1}`), new_tab: false, children: [] },
    {
      ...link("about", `page:${P2}`),
      label: "About us",
      new_tab: false,
      children: [
        { ...link("team", `page:${P3}`), new_tab: false },
        { ...link("shop", "https://shop.example.com/"), new_tab: true },
      ],
    },
    { ...link("ext", "https://x.com/"), new_tab: true, children: [] },
  ],
  cta: { label: "Book now", target: `popup:${POP}` },
  held: false,
};

const PAGES = new Map([
  [P1, { path: "/", title: "Home" }],
  [P2, { path: "/about", title: "About" }],
  [P3, { path: "/team", title: "Team" }],
]);

describe("resolveNav", () => {
  it("resolves pages, groups, URL links and the pop-up button", () => {
    const r = resolveNav(NAV, { pages: PAGES });
    expect(r.entries).toEqual([
      { kind: "link", id: "h", label: "L h", href: "/", newTab: false },
      {
        kind: "group",
        id: "about",
        label: "About us",
        links: [
          { id: "about", label: "About us", href: "/about", newTab: false },
          { id: "team", label: "L team", href: "/team", newTab: false },
          {
            id: "shop",
            label: "L shop",
            href: "https://shop.example.com/",
            newTab: true,
          },
        ],
      },
      {
        kind: "link",
        id: "ext",
        label: "L ext",
        href: "https://x.com/",
        newTab: true,
      },
    ]);
    expect(r.cta).toEqual({ label: "Book now", popupId: POP });
  });

  it("drops missing and hidden pages, and a parent with nothing left", () => {
    const nav: NavSettings = {
      ...NAV,
      items: [
        {
          ...link("p", `page:${P2}`),
          new_tab: false,
          children: [{ ...link("c", `page:${P3}`), new_tab: false }],
        },
      ],
    };
    const r = resolveNav(nav, {
      pages: new Map([[P3, { path: "/team", title: "Team" }]]),
      hiddenPageIds: [P3],
    });
    expect(r.entries).toEqual([]);
  });

  it("a held menu shows page links only, labelled with page titles", () => {
    const r = resolveNav({ ...NAV, held: true }, { pages: PAGES });
    expect(r.cta).toBeNull();
    expect(JSON.stringify(r)).not.toContain("x.com");
    expect(r.entries[0]).toMatchObject({ label: "Home" });
    expect(r.entries[1]).toMatchObject({
      kind: "group",
      label: "About",
      links: [{ label: "About" }, { label: "Team" }],
    });
  });

  it("a page button resolves to its path", () => {
    const r = resolveNav(
      { ...NAV, cta: { label: "Go", target: `page:${P2}` } },
      { pages: PAGES },
    );
    expect(r.cta).toEqual({ label: "Go", href: "/about" });
    expect(resolveNav(null, { pages: PAGES })).toEqual({
      entries: [],
      cta: null,
    });
  });
});

describe("helpers", () => {
  it("counts, finds pages and lists refs", () => {
    expect(navTopCount(NAV)).toBe(3);
    expect(navTopCount(null)).toBe(0);
    expect(navHasPage(NAV, P3)).toBe(true);
    expect(navHasPage(NAV, "zzzzzzzzzzzzzzz")).toBe(false);
    expect(navRefs(NAV)).toEqual({ pages: [P1, P2, P3], popups: [POP] });
  });

  it("appendPageLink adds once and stops at 8", () => {
    const added = appendPageLink(null, {
      pageId: P1,
      title: "x".repeat(50),
      id: "n1",
    });
    expect(added.added).toBe(true);
    expect(added.nav.items[0]!.label).toHaveLength(40);
    expect(
      appendPageLink(added.nav, { pageId: P1, title: "x", id: "n2" }),
    ).toMatchObject({
      added: false,
      reason: "exists",
    });
    const full: NavSettings = {
      items: Array.from({ length: 8 }, (_, i) => ({
        ...link(`i${i}`, "https://x.com/"),
        new_tab: false,
        children: [],
      })),
      cta: null,
      held: false,
    };
    const r = appendPageLink(full, { pageId: P1, title: "x", id: "n" });
    expect(r).toMatchObject({ added: false, reason: "full" });
    expect(r.nav).toBe(full);
  });
});

describe("removePageLinks (07-32 choice 13)", () => {
  const item = (
    id: string,
    target: string,
    children: NavSettings["items"][number]["children"] = [],
  ) => ({
    id,
    label: `L ${id}`,
    target,
    new_tab: false,
    children,
  });
  const child = (id: string, target: string) => ({
    id,
    label: `L ${id}`,
    target,
    new_tab: false,
  });

  it("removes top-level and child links, keeps the CTA", () => {
    const nav: NavSettings = {
      items: [
        item("a", `page:${P1}`),
        item("b", `page:${P2}`, [
          child("c", `page:${P1}`),
          child("d", `page:${P3}`),
        ]),
        item("e", "https://x.com/"),
      ],
      cta: { label: "Book", target: `page:${P1}` },
      held: false,
    };
    const r = removePageLinks(nav, P1);
    expect(r.removed).toBe(2);
    expect(r.nav.items.map((i) => i.id)).toEqual(["b", "e"]);
    expect(r.nav.items[0]!.children.map((c) => c.id)).toEqual(["d"]);
    expect(r.nav.cta).toEqual(nav.cta);
    expect(navHasPage(r.nav, P1)).toBe(false);
    // never mutates
    expect(nav.items).toHaveLength(3);
  });

  it("a dropdown left with no children becomes a plain link", () => {
    const nav: NavSettings = {
      items: [item("b", `page:${P2}`, [child("c", `page:${P1}`)])],
      cta: null,
      held: false,
    };
    const r = removePageLinks(nav, P1);
    expect(r.nav.items).toEqual([item("b", `page:${P2}`)]);
  });

  it("a removed dropdown parent hands its slot to its first remaining child", () => {
    const nav: NavSettings = {
      items: [
        item("b", `page:${P1}`, [
          child("c", `page:${P2}`),
          child("d", `page:${P3}`),
        ]),
      ],
      cta: null,
      held: false,
    };
    const r = removePageLinks(nav, P1);
    expect(r.removed).toBe(1);
    expect(r.nav.items).toEqual([
      { ...child("c", `page:${P2}`), children: [child("d", `page:${P3}`)] },
    ]);
  });

  it("keeps object identity when nothing matched", () => {
    const nav: NavSettings = {
      items: [item("a", `page:${P2}`)],
      cta: null,
      held: false,
    };
    const r = removePageLinks(nav, P1);
    expect(r.nav).toBe(nav);
    expect(r.removed).toBe(0);
  });
});
