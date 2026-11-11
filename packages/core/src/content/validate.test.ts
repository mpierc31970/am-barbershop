// Deny-by-default content validators (RESEARCH Pattern 1, Pitfall 6; T-03-04, T-03-05).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  MAX_ITEMS_PER_COLUMN,
  MAX_LIST_ITEMS,
  MAX_RICH_TEXT,
  MAX_TEXT,
  repairDuplicateItemIds,
  safeHref,
  safeImageUrl,
  validateColumnItem,
  validateColumnsContent,
  validateCtaBanner,
  validateHero,
  validateTextImage,
  validateTextOnly,
} from "./validate";

const POPUP_OK = { allowPopupButton: true };
const NO_POPUP = { allowPopupButton: false };

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("safeHref", () => {
  it("allows empty", () => {
    expect(safeHref("")).toBe("");
    expect(safeHref(undefined)).toBe("");
    expect(safeHref("   ")).toBe("");
  });

  it("allows a site path", () => {
    expect(safeHref("/about")).toBe("/about");
    expect(safeHref("/")).toBe("/");
    expect(safeHref("/a/b?x=1#top")).toBe("/a/b?x=1#top");
  });

  it("rejects protocol-relative and backslash paths", () => {
    expect(() => safeHref("//evil.test")).toThrow(InvalidInput);
    expect(() => safeHref("/\\evil.test")).toThrow(InvalidInput);
  });

  it("rejects script and data schemes, however they are dressed", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "about",
    ]) {
      expect(() => safeHref(bad), bad).toThrow(InvalidInput);
    }
  });

  it("gives the plain-language copy", () => {
    expect(msg(() => safeHref("javascript:alert(1)"))).toBe(
      "Links must start with https://, http://, mailto: or tel:, or be a page path like /about.",
    );
  });

  it("allows http(s), mailto and tel, trimmed", () => {
    expect(safeHref("https://x.test/a")).toBe("https://x.test/a");
    expect(safeHref("http://x.test/a")).toBe("http://x.test/a");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("tel:+15551234")).toBe("tel:+15551234");
    expect(safeHref("  https://x.test ")).toBe("https://x.test/");
  });

  it("rejects non-strings", () => {
    expect(() => safeHref(42)).toThrow(InvalidInput);
    expect(() => safeHref({})).toThrow(InvalidInput);
  });
});

describe("safeImageUrl", () => {
  it("allows http(s) and empty", () => {
    expect(safeImageUrl("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
    expect(safeImageUrl("http://x")).toBe("http://x/");
    expect(safeImageUrl("")).toBe("");
  });

  it("rejects data:, javascript: and relative paths", () => {
    expect(() => safeImageUrl("data:image/png;base64,x")).toThrow(InvalidInput);
    expect(() => safeImageUrl("javascript:alert(1)")).toThrow(InvalidInput);
    expect(() => safeImageUrl("/local.png")).toThrow(InvalidInput);
    expect(() => safeImageUrl("//cdn.test/a.png")).toThrow(InvalidInput);
  });
});

describe("validateColumnItem", () => {
  it("drops unknown keys, including planted handlers and __proto__", () => {
    const raw = JSON.parse(
      '{"id":"i1","kind":"heading","text":"Hi","level":3,"onclick":"x","style":"color:red","__proto__":{"polluted":true}}',
    );
    const out = validateColumnItem(raw, POPUP_OK);
    expect(out).toEqual({ id: "i1", kind: "heading", text: "Hi", level: 3 });
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect((out as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects unknown kinds and non-objects", () => {
    expect(() =>
      validateColumnItem({ id: "a", kind: "custom" }, POPUP_OK),
    ).toThrow(InvalidInput);
    expect(() =>
      validateColumnItem({ id: "a", kind: "toString" }, POPUP_OK),
    ).toThrow(InvalidInput);
    expect(() => validateColumnItem("x", POPUP_OK)).toThrow(InvalidInput);
    expect(() => validateColumnItem([], POPUP_OK)).toThrow(InvalidInput);
  });

  it("mints an id when the stored one is missing or malformed", () => {
    const out = validateColumnItem({ kind: "divider" }, POPUP_OK);
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    const bad = validateColumnItem(
      { id: "<script>", kind: "divider" },
      POPUP_OK,
    );
    expect(bad.id).not.toBe("<script>");
  });

  it("coerces heading level and trims text", () => {
    expect(
      validateColumnItem(
        { id: "h", kind: "heading", text: "  Hi  ", level: 1 },
        POPUP_OK,
      ),
    ).toEqual({ id: "h", kind: "heading", text: "Hi", level: 2 });
  });

  it("caps plain text and rich text", () => {
    expect(() =>
      validateColumnItem(
        { id: "h", kind: "heading", text: "x".repeat(MAX_TEXT + 1) },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
    expect(() =>
      validateColumnItem(
        { id: "t", kind: "text", html: "x".repeat(MAX_RICH_TEXT + 1) },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
    expect(
      validateColumnItem({ id: "t", kind: "text", html: "<p>a</p>" }, POPUP_OK),
    ).toEqual({ id: "t", kind: "text", html: "<p>a</p>" });
  });

  it("keeps only string list items and caps the count", () => {
    expect(
      validateColumnItem(
        { id: "l", kind: "list", items: [" a ", 3, "b"] },
        POPUP_OK,
      ),
    ).toEqual({ id: "l", kind: "list", items: ["a", "b"] });
    expect(() =>
      validateColumnItem(
        { id: "l", kind: "list", items: Array(MAX_LIST_ITEMS + 1).fill("a") },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
  });

  it("requires image alt when a url is set", () => {
    expect(
      msg(() =>
        validateColumnItem(
          { id: "m", kind: "image", url: "https://x.test/a.jpg", alt: " " },
          POPUP_OK,
        ),
      ),
    ).toBe("Add a short description of the image for people who can't see it.");
    expect(
      validateColumnItem(
        { id: "m", kind: "image", url: "", alt: "" },
        POPUP_OK,
      ),
    ).toEqual({ id: "m", kind: "image", url: "", alt: "" });
    expect(() =>
      validateColumnItem(
        { id: "m", kind: "image", url: "data:image/png;base64,x", alt: "a" },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
  });

  it("validates button links and defaults action to link", () => {
    expect(
      validateColumnItem(
        { id: "b", kind: "button", text: "Go", link: "/about", style: "bogus" },
        POPUP_OK,
      ),
    ).toEqual({
      id: "b",
      kind: "button",
      text: "Go",
      link: "/about",
      style: "primary",
      action: "link",
      popup_id: "",
    });
    expect(() =>
      validateColumnItem(
        { id: "b", kind: "button", text: "Go", link: "javascript:alert(1)" },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
  });

  it("drops a stray popup_id on a link button", () => {
    const out = validateColumnItem(
      { id: "b", kind: "button", text: "Go", action: "link", popup_id: "p1" },
      POPUP_OK,
    );
    expect(out).toMatchObject({ action: "link", popup_id: "" });
  });

  it("requires popup_id on a popup button", () => {
    expect(
      msg(() =>
        validateColumnItem(
          {
            id: "b",
            kind: "button",
            text: "Open",
            action: "popup",
            popup_id: "",
          },
          POPUP_OK,
        ),
      ),
    ).toBe("Choose which pop-up this button opens.");
    expect(
      validateColumnItem(
        {
          id: "b",
          kind: "button",
          text: "Open",
          action: "popup",
          popup_id: "abc123",
        },
        POPUP_OK,
      ),
    ).toMatchObject({ action: "popup", popup_id: "abc123" });
  });

  it("rejects a popup button where popups are not allowed", () => {
    expect(() =>
      validateColumnItem(
        {
          id: "b",
          kind: "button",
          text: "Open",
          action: "popup",
          popup_id: "abc123",
        },
        NO_POPUP,
      ),
    ).toThrow(InvalidInput);
  });

  it("rejects a malformed popup_id", () => {
    expect(() =>
      validateColumnItem(
        {
          id: "b",
          kind: "button",
          text: "O",
          action: "popup",
          popup_id: 'a b"<',
        },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
  });

  it("coerces spacer height", () => {
    expect(
      validateColumnItem({ id: "s", kind: "spacer", height: "xl" }, POPUP_OK),
    ).toEqual({
      id: "s",
      kind: "spacer",
      height: "md",
    });
    expect(
      validateColumnItem({ id: "s", kind: "spacer", height: "lg" }, POPUP_OK),
    ).toEqual({
      id: "s",
      kind: "spacer",
      height: "lg",
    });
  });

  it("requires a countdown zero message", () => {
    expect(
      msg(() =>
        validateColumnItem(
          {
            id: "c",
            kind: "countdown",
            target_at: "2027-01-01T00:00:00Z",
            zero_message: "",
          },
          POPUP_OK,
        ),
      ),
    ).toBe(
      'Write what visitors see when the countdown ends, like "Doors are open."',
    );
  });

  it("re-emits the countdown target as UTC ISO and rejects unparseable dates", () => {
    expect(
      validateColumnItem(
        {
          id: "c",
          kind: "countdown",
          target_at: "2027-01-01T05:00:00-05:00",
          zero_message: "Doors are open.",
        },
        POPUP_OK,
      ),
    ).toEqual({
      id: "c",
      kind: "countdown",
      target_at: "2027-01-01T10:00:00.000Z",
      zero_message: "Doors are open.",
    });
    expect(() =>
      validateColumnItem(
        { id: "c", kind: "countdown", target_at: "soon", zero_message: "Open" },
        POPUP_OK,
      ),
    ).toThrow(InvalidInput);
  });
});

describe("validateColumnsContent", () => {
  it("rejects two items with the same id, in one column or across columns (CR-C02)", () => {
    const same = {
      columns: [
        {
          id: "c1",
          items: [
            { id: "i1", kind: "divider" },
            { id: "i1", kind: "divider" },
          ],
        },
        { id: "c2", items: [] },
      ],
    };
    expect(msg(() => validateColumnsContent(same, "50-50"))).toBe(
      "Two items share the same id. Refresh the page and try again.",
    );
    const across = {
      columns: [
        { id: "c1", items: [{ id: "i1", kind: "divider" }] },
        { id: "c2", items: [{ id: "i1", kind: "divider" }] },
      ],
    };
    expect(() => validateColumnsContent(across, "50-50")).toThrow(InvalidInput);
    // Missing ids are minted fresh, so they never clash.
    const missing = {
      columns: [
        { id: "c1", items: [{ kind: "divider" }, { kind: "divider" }] },
      ],
    };
    expect(
      validateColumnsContent(missing, "full").columns[0]!.items,
    ).toHaveLength(2);
  });

  it("returns exactly the layout's column count", () => {
    const raw = {
      columns: [
        { id: "c1", items: [{ id: "i1", kind: "divider" }] },
        { id: "c2", items: [{ id: "i2", kind: "divider" }] },
        { id: "c3", items: [{ id: "i3", kind: "divider" }] },
      ],
      extra: "dropped",
    };
    const out = validateColumnsContent(raw, "50-50");
    expect(Object.keys(out)).toEqual(["columns"]);
    expect(out.columns).toHaveLength(2);
    expect(out.columns[1]!.items.map((i) => i.id)).toEqual(["i2", "i3"]);
    expect(
      validateColumnsContent({ columns: [] }, "25-25-25-25").columns,
    ).toHaveLength(4);
    expect(validateColumnsContent(undefined, "full").columns).toHaveLength(1);
  });

  it("validates every item and caps items per column", () => {
    expect(() =>
      validateColumnsContent(
        {
          columns: [
            {
              id: "c1",
              items: [{ id: "x", kind: "text", html: 5, onclick: 1 }],
            },
          ],
        },
        "full",
      ),
    ).not.toThrow();
    expect(() =>
      validateColumnsContent(
        {
          columns: [
            {
              id: "c1",
              items: [{ id: "b", kind: "button", link: "javascript:x" }],
            },
          ],
        },
        "full",
      ),
    ).toThrow(InvalidInput);
    expect(() =>
      validateColumnsContent(
        {
          columns: [
            {
              id: "c1",
              items: Array.from({ length: MAX_ITEMS_PER_COLUMN + 1 }, () => ({
                kind: "divider",
              })),
            },
          ],
        },
        "full",
      ),
    ).toThrow(InvalidInput);
  });

  it("rejects non-object content", () => {
    expect(() => validateColumnsContent("x", "full")).toThrow(InvalidInput);
    expect(() => validateColumnsContent({ columns: "x" }, "full")).toThrow(
      InvalidInput,
    );
  });
});

describe("section content validators", () => {
  it("hero copies known keys, validates links and image", () => {
    const out = validateHero({
      heading: " Welcome ",
      cta_primary_link: "/book",
      cta_secondary_link: "mailto:a@b.c",
      image_url: "https://x.test/h.jpg",
      image_alt: "A room",
      onload: "x",
    });
    expect(out.heading).toBe("Welcome");
    expect(out.cta_primary_link).toBe("/book");
    expect(out).not.toHaveProperty("onload");
    expect(() => validateHero({ cta_primary_link: "javascript:x" })).toThrow(
      InvalidInput,
    );
    expect(() => validateHero({ image_url: "https://x.test/a.jpg" })).toThrow(
      "Add a short description of the image for people who can't see it.",
    );
  });

  it("hero keeps a media-library image_asset (P8, R-3)", () => {
    const out = validateHero({
      heading: "Rivera Bakery",
      image_asset: "abc123def456ghi",
      image_alt: "Fresh loaves",
    });
    expect(out.image_asset).toBe("abc123def456ghi");
    for (const bad of ["../x", "<b>", "a".repeat(300), 42]) {
      expect(validateHero({ heading: "H", image_asset: bad }).image_asset).toBe(
        "",
      );
    }
  });

  it("a hero library photo needs a description, like a column image (WR-B03)", () => {
    for (const image_alt of [undefined, "", "   "]) {
      expect(() =>
        validateHero({
          heading: "H",
          image_asset: "abc123def456ghi",
          image_alt,
        }),
      ).toThrow(InvalidInput);
    }
  });

  it("hero without image_asset validates as before plus an empty image_asset", () => {
    const p3 = {
      heading: "Welcome",
      image_url: "https://x.test/h.jpg",
      image_alt: "A room",
    };
    const out = validateHero(p3);
    expect(out).toMatchObject(p3);
    expect(out.image_asset).toBe("");
    expect(Object.keys(out)).toHaveLength(12);
  });

  it("text & image keeps rich text and list items", () => {
    const out = validateTextImage({
      text: "<p>Hi</p>",
      list_items: ["a", 1, "b"],
      cta_link: "tel:+15551234",
      style: "x",
    });
    expect(out.text).toBe("<p>Hi</p>");
    expect(out.list_items).toEqual(["a", "b"]);
    expect(out).not.toHaveProperty("style");
    expect(() => validateTextImage({ cta_link: "//evil.test" })).toThrow(
      InvalidInput,
    );
  });

  it("text only and CTA banner", () => {
    expect(validateTextOnly({ heading: "H", text: "<p>t</p>", x: 1 })).toEqual({
      heading: "H",
      text: "<p>t</p>",
    });
    expect(
      validateCtaBanner({ button_link: "https://x.test/", button_text: "Go" }),
    ).toEqual({
      heading: "",
      description: "",
      button_text: "Go",
      button_link: "https://x.test/",
    });
    expect(() =>
      validateCtaBanner({ button_link: "data:text/html,x" }),
    ).toThrow(InvalidInput);
  });

  it("rejects non-object content", () => {
    expect(() => validateHero([])).toThrow(InvalidInput);
    expect(validateTextOnly(undefined)).toEqual({ heading: "", text: "" });
  });
});

describe("repairDuplicateItemIds (IN-R02, read path only)", () => {
  const dupColumns = {
    columns: [
      {
        id: "c1",
        items: [
          { id: "i1", kind: "divider" },
          { id: "i1", kind: "heading", text: "Two", level: 2 },
        ],
      },
      { id: "c2", items: [{ id: "i1", kind: "divider" }] },
    ],
  };

  it("gives every repeat a fresh id, keeps the first, and then validates", () => {
    const repaired = repairDuplicateItemIds(dupColumns);
    const out = validateColumnsContent(repaired, "50-50");
    const ids = out.columns.flatMap((c) => c.items.map((i) => i.id));
    expect(ids[0]).toBe("i1");
    expect(new Set(ids).size).toBe(3);
    expect(out.columns[0]!.items[1]).toMatchObject({ text: "Two" });
    // The input is not mutated.
    expect(dupColumns.columns[1]!.items[0]!.id).toBe("i1");
  });

  it("repairs a pop-up's items list", () => {
    const repaired = repairDuplicateItemIds({
      items: [
        { id: "i1", kind: "divider" },
        { id: "i1", kind: "divider" },
      ],
    }) as { items: { id: string }[] };
    expect(repaired.items[0]!.id).toBe("i1");
    expect(repaired.items[1]!.id).not.toBe("i1");
  });

  it("returns clean or non-object content unchanged", () => {
    const clean = {
      columns: [{ id: "c1", items: [{ id: "a" }, { id: "b" }] }],
    };
    expect(repairDuplicateItemIds(clean)).toBe(clean);
    expect(repairDuplicateItemIds(null)).toBeNull();
    expect(repairDuplicateItemIds("x")).toBe("x");
  });

  it("writes still refuse duplicates", () => {
    expect(() => validateColumnsContent(dupColumns, "50-50")).toThrow(
      InvalidInput,
    );
  });
});

describe("image item stock credit (07-30, CONT-28)", () => {
  const base = {
    id: "m",
    kind: "image",
    url: "https://images.unsplash.com/photo-1",
    alt: "Bread",
  };
  const credit = {
    name: "Ana Silva",
    url: "https://unsplash.com/@ana?utm_source=cds_platform&utm_medium=referral",
    source: "unsplash",
  };

  it("keeps a valid credit", () => {
    expect(validateColumnItem({ ...base, credit }, POPUP_OK)).toEqual({
      ...base,
      credit: { ...credit, url: new URL(credit.url).href },
    });
  });

  it("has no key without a credit", () => {
    expect(validateColumnItem(base, POPUP_OK)).not.toHaveProperty("credit");
  });

  it("drops the credit for a library photo", () => {
    const out = validateColumnItem(
      {
        id: "m",
        kind: "image",
        url: "",
        alt: "x",
        asset: "abc123def456ghi",
        credit: { bad: 1 },
      },
      POPUP_OK,
    );
    expect(out).not.toHaveProperty("credit");
  });

  it("refuses foreign hosts, scripts, unknown sources and long names", () => {
    for (const bad of [
      { ...credit, url: "https://evil.com/@ana" },
      { ...credit, url: "javascript:alert(1)" },
      { ...credit, source: "flickr" },
      { ...credit, name: "x".repeat(81) },
      { ...credit, source: "pexels" },
      "Ana",
    ]) {
      expect(() =>
        validateColumnItem({ ...base, credit: bad }, POPUP_OK),
      ).toThrow(InvalidInput);
    }
    expect(
      validateColumnItem(
        {
          ...base,
          credit: {
            name: "Bo",
            url: "https://www.pexels.com/@bo",
            source: "pexels",
          },
        },
        POPUP_OK,
      ),
    ).toHaveProperty("credit.source", "pexels");
  });
});
