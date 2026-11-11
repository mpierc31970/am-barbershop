// 07-30 Task 1: SEO & accessibility checklist + suggestions (CONT-14, CONT-35, D188, D280).
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_COPY,
  NAV_FIX_HREF,
  pageChecklist,
  suggestDescription,
  suggestTitle,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistSite,
} from "./checklist";
import type { SeoSection } from "./content-walk";

const NAV_WITH_PAGE = {
  items: [{ label: "About", target: "page:p1", children: [] }],
  cta: null,
};

function site(over: Partial<ChecklistSite> = {}): ChecklistSite {
  return {
    businessName: "Rivera Bakery",
    nav: NAV_WITH_PAGE,
    theme: {
      text: "#1b1b19",
      textMuted: "#55524c",
      surface: "#ffffff",
      surfaceRaised: "#f5f3ef",
      primary: "#1b4d3e",
      onPrimary: "#ffffff",
    },
    mediaNeedsDescription: new Set<string>(),
    blockLabel: (t) =>
      t === "columns" ? "Columns" : t === "hero" ? "Hero" : t,
    ...over,
  };
}

function cols(
  id: string,
  items: unknown[],
  extra: Partial<SeoSection> = {},
): SeoSection {
  return {
    id,
    section_type: "columns",
    content: { columns: [{ id: `${id}-c`, items }] },
    ...extra,
  };
}

function draft(over: Partial<ChecklistDraft> = {}): ChecklistDraft {
  return {
    pageId: "p1",
    isHome: false,
    pageKind: "builder",
    title: "About us",
    seo: { meta_description: "Fresh bread every morning in Austin." },
    sections: [
      cols("s1", [
        { id: "h", kind: "heading", text: "Our story", level: 2 },
        {
          id: "t",
          kind: "text",
          html: "<p>See <a href='/menu'>our menu</a>.</p>",
        },
      ]),
    ],
    ...over,
  };
}

function byId(items: ChecklistItem[], id: string): ChecklistItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe("suggestions", () => {
  it("suggestTitle", () => {
    expect(suggestTitle("About us", "Rivera Bakery")).toBe(
      "About us | Rivera Bakery",
    );
    expect(suggestTitle("Home", "Rivera Bakery", { isHome: true })).toBe(
      "Rivera Bakery",
    );
    expect(suggestTitle("About us", "")).toBe("About us");
  });

  it("suggestDescription takes the first text in page order, skipping hidden blocks", () => {
    const sections = [
      {
        id: "a",
        section_type: "text-only",
        content: { text: "<p>Hidden</p>" },
        hidden: true,
      },
      { id: "b", section_type: "hero", content: { heading: "Hi" } },
      cols("c", [
        { id: "t", kind: "text", html: "<p>Hello   <b>world</b></p>" },
      ]),
      { id: "d", section_type: "text-only", content: { text: "<p>Later</p>" } },
    ];
    expect(suggestDescription(sections)).toBe("Hello world");
    expect(suggestDescription([])).toBe("");
  });

  it("cuts at the last space at or before 155 characters", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = suggestDescription([
      {
        id: "x",
        section_type: "text-image",
        content: { text: `<p>${words}</p>` },
      },
    ]);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(words.startsWith(out)).toBe(true);
    expect(words.charAt(out.length)).toBe(" ");
  });
});

describe("pageChecklist (CONT-14, CONT-35)", () => {
  it("a clean page is all fine, Search group first", () => {
    const items = pageChecklist(draft(), site());
    expect(items.every((i) => i.status === "fine")).toBe(true);
    expect(items.map((i) => i.text)).toEqual([
      "Has a description",
      "Title fits in search results",
      "Description fits in search results",
      "In your site menu",
      "Every photo has a description",
      "Headings are in order",
      "Links say where they go",
      "Text is easy to read",
      "No video plays by itself",
      "No counting animations",
    ]);
    const groups = items.map((i) => i.group);
    expect(groups.lastIndexOf("search")).toBeLessThan(
      groups.indexOf("accessibility"),
    );
  });

  it("missing description -> description field", () => {
    const i = byId(pageChecklist(draft({ seo: {} }), site()), "description");
    expect(i.status).toBe("check");
    expect(i.text).toBe(CHECKLIST_COPY.descriptionMissing);
    expect(i.fix).toEqual({ kind: "field", field: "description" });
  });

  it("long title and description show their counts", () => {
    const items = pageChecklist(
      draft({
        seo: { meta_title: "t".repeat(72), meta_description: "d".repeat(190) },
      }),
      site(),
    );
    expect(byId(items, "title-length").text).toBe(
      "The title is 72 characters. Search results cut it off after about 60.",
    );
    expect(byId(items, "title-length").fix).toEqual({
      kind: "field",
      field: "title",
    });
    expect(byId(items, "description-length").text).toBe(
      "The description is 190 characters. Search results cut it off after about 160.",
    );
  });

  it("photos without descriptions are counted", () => {
    const two = pageChecklist(
      draft({
        sections: [
          cols("s1", [
            { id: "i1", kind: "image", url: "", alt: "x", asset: "a1" },
            { id: "i2", kind: "image", url: "https://x.com/a.png", alt: "" },
          ]),
        ],
      }),
      site({ mediaNeedsDescription: new Set(["a1"]) }),
    );
    const p = byId(two, "photos");
    expect(p.text).toBe("2 photos don't have a description yet.");
    expect(p.fix).toEqual({ kind: "block", sectionId: "s1", itemId: "i1" });

    const one = pageChecklist(
      draft({
        sections: [
          {
            id: "g",
            section_type: "gallery",
            content: {
              images: [{ id: "x", asset: "a9", alt: "", alt_reviewed: false }],
            },
          },
        ],
      }),
      site(),
    );
    expect(byId(one, "photos").text).toBe(
      "1 photo doesn't have a description yet.",
    );
  });

  it("a Sub-heading before any Section heading", () => {
    const i = byId(
      pageChecklist(
        draft({
          sections: [
            cols("s1", [
              { id: "h3", kind: "heading", text: "Small", level: 3 },
              { id: "h2", kind: "heading", text: "Big", level: 2 },
            ]),
          ],
        }),
        site(),
      ),
      "headings",
    );
    expect(i.text).toBe(
      'A Sub-heading comes before any Section heading in the "Columns" block. Use a Section heading first.',
    );
    expect(i.fix).toEqual({ kind: "block", sectionId: "s1", itemId: "h3" });
  });

  it("vague link text, quoted", () => {
    const btn = byId(
      pageChecklist(
        draft({
          sections: [
            cols("s1", [
              {
                id: "b",
                kind: "button",
                text: "Click here",
                link: "/x",
                style: "primary",
                action: "link",
                popup_id: "",
              },
            ]),
          ],
        }),
        site(),
      ),
      "links",
    );
    expect(btn.text).toBe(
      'A link says "Click here". Say where it goes, like "See our prices".',
    );
    expect(btn.fix).toEqual({ kind: "block", sectionId: "s1", itemId: "b" });

    const rich = byId(
      pageChecklist(
        draft({
          sections: [
            {
              id: "t",
              section_type: "text-only",
              content: { text: '<p><a href="/x">read more</a></p>' },
            },
          ],
        }),
        site(),
      ),
      "links",
    );
    expect(rich.status).toBe("check");
    expect(rich.fix).toEqual({ kind: "block", sectionId: "t" });
  });

  it("low theme contrast", () => {
    const i = byId(
      pageChecklist(
        draft(),
        site({
          theme: {
            text: "#cccccc",
            textMuted: "#cccccc",
            surface: "#ffffff",
            surfaceRaised: "#ffffff",
            primary: "#000000",
            onPrimary: "#ffffff",
          },
        }),
      ),
      "contrast",
    );
    expect(i.text).toBe(CHECKLIST_COPY.contrast);
    expect(i.fix).toEqual({ kind: "block", sectionId: "s1" });
  });

  it("text on a photo uses the per-type map (fixture type)", () => {
    const sections = [
      {
        id: "o",
        section_type: "overlay-fixture",
        content: { image_url: "https://x.com/a.jpg", scrim: false },
      },
    ];
    const rules = { "overlay-fixture": { image: "image_url", scrim: "scrim" } };
    const i = byId(
      pageChecklist(draft({ sections }), site({ blockLabel: () => "Hero" }), {
        textOnImage: rules,
      }),
      "contrast",
    );
    expect(i.text).toBe(
      "The text on your Hero photo may be hard to read. Choose a darker or simpler photo, or turn off the photo.",
    );
    const withScrim = [
      {
        ...sections[0]!,
        content: { image_url: "https://x.com/a.jpg", scrim: true },
      },
    ];
    expect(
      byId(
        pageChecklist(draft({ sections: withScrim }), site(), {
          textOnImage: rules,
        }),
        "contrast",
      ).status,
    ).toBe("fine");
  });

  it("autoplay only for an uploaded video", () => {
    const video = (source: string, autoplay: boolean) =>
      cols("v", [
        {
          id: "vi",
          kind: "video",
          title: "T",
          source,
          asset: "a",
          provider: "",
          provider_id: "",
          cover: "",
          shape: "16:9",
          controls: true,
          loop: false,
          autoplay,
        },
      ]);
    expect(
      byId(
        pageChecklist(draft({ sections: [video("media", true)] }), site()),
        "autoplay",
      ).fix,
    ).toEqual({
      kind: "block",
      sectionId: "v",
      itemId: "vi",
    });
    expect(
      byId(
        pageChecklist(draft({ sections: [video("link", true)] }), site()),
        "autoplay",
      ).status,
    ).toBe("fine");
    expect(
      byId(
        pageChecklist(draft({ sections: [video("media", false)] }), site()),
        "autoplay",
      ).status,
    ).toBe("fine");
  });

  it("count-up only with count_up on", () => {
    const stats = (count_up: boolean) => ({
      id: "st",
      section_type: "stats",
      content: { count_up, items: [] },
    });
    expect(
      byId(
        pageChecklist(draft({ sections: [stats(true)] }), site()),
        "count-up",
      ).text,
    ).toBe(CHECKLIST_COPY.countUp);
    expect(
      byId(
        pageChecklist(draft({ sections: [stats(false)] }), site()),
        "count-up",
      ).status,
    ).toBe("fine");
  });

  it("not in the menu -> Navigation tab; never on home", () => {
    const i = byId(
      pageChecklist(draft(), site({ nav: { items: [], cta: null } })),
      "in-menu",
    );
    expect(i.text).toBe(CHECKLIST_COPY.notInMenu);
    expect(i.fix).toEqual({ kind: "href", href: NAV_FIX_HREF });
    expect(NAV_FIX_HREF).toBe("/hub/website?tab=navigation");
    const home = pageChecklist(draft({ isHome: true }), site({ nav: null }));
    expect(home.find((x) => x.id === "in-menu")).toBeUndefined();
    const sys = pageChecklist(
      draft({ pageKind: "system-404" }),
      site({ nav: null }),
    );
    expect(sys.find((x) => x.id === "in-menu")).toBeUndefined();
  });

  it("ignores hidden blocks", () => {
    const items = pageChecklist(
      draft({
        sections: [
          {
            id: "st",
            section_type: "stats",
            content: { count_up: true },
            hidden: true,
          },
        ],
      }),
      site(),
    );
    expect(byId(items, "count-up").status).toBe("fine");
  });

  it("never throws on malformed content", () => {
    const evil = [
      null,
      7,
      { id: "a", section_type: "columns", content: { columns: "x" } },
      { id: "b", section_type: "gallery", content: { images: [null, 4] } },
      {
        id: "c",
        section_type: "slider",
        content: { slides: [{ columns: [{ items: [null] }] }] },
      },
    ] as unknown as SeoSection[];
    expect(() =>
      pageChecklist(
        draft({ sections: evil }),
        site({ theme: { text: "bad" } as never }),
      ),
    ).not.toThrow();
    expect(() => pageChecklist({} as ChecklistDraft, site())).not.toThrow();
  });
});
