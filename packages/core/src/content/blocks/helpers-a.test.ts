// Group A shared helpers (07-06; T-07-06-03, T-07-06-04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { MALFORMED_COPY } from "../validate-helpers";
import {
  assertUniqueIds,
  assetId,
  bool,
  boundedArray,
  clonePanelFreshIds,
  intInRange,
  mapPanelsRichText,
  mediaRefs,
  mergeRefs,
  newPanel,
  noRefs,
  panelsRefs,
  panelsTexts,
  panelsUrls,
  validatePanels,
} from "./helpers-a";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("assetId", () => {
  it("trims a safe id", () => {
    expect(assetId(" abc123 ", "copy")).toBe("abc123");
  });
  it("refuses malformed ids with the given copy, never minting one", () => {
    for (const bad of ["a b", 5, "", "../x", null, undefined, "x".repeat(65)]) {
      expect(msg(() => assetId(bad, "copy"))).toBe("copy");
    }
  });
});

describe("bool", () => {
  it("reads own booleans only", () => {
    expect(bool({ a: true }, "a", false)).toBe(true);
    expect(bool({ a: "true" }, "a", false)).toBe(false);
    expect(bool({ a: 1 }, "a", true)).toBe(true);
    expect(
      bool(Object.create({ a: true }) as Record<string, unknown>, "a", false),
    ).toBe(false);
  });
});

describe("boundedArray", () => {
  it("missing -> []", () => {
    expect(boundedArray({}, "x", 3, "over")).toEqual([]);
  });
  it("non-array -> malformed", () => {
    expect(msg(() => boundedArray({ x: "a" }, "x", 3, "over"))).toBe(
      MALFORMED_COPY,
    );
    expect(msg(() => boundedArray({ x: { 0: 1 } }, "x", 3, "over"))).toBe(
      MALFORMED_COPY,
    );
  });
  it("over max -> over copy", () => {
    expect(msg(() => boundedArray({ x: [1, 2, 3, 4] }, "x", 3, "over"))).toBe(
      "over",
    );
    expect(boundedArray({ x: [1, 2, 3] }, "x", 3, "over")).toHaveLength(3);
  });
  it("ignores inherited lists", () => {
    const raw = Object.create({ x: [1] }) as Record<string, unknown>;
    expect(boundedArray(raw, "x", 3, "over")).toEqual([]);
  });
});

describe("intInRange", () => {
  it("clamps, truncates and ignores strings", () => {
    expect(intInRange(9, 2, 6, 3)).toBe(6);
    expect(intInRange(1, 2, 6, 3)).toBe(2);
    expect(intInRange("4", 2, 6, 3)).toBe(3);
    expect(intInRange(4.7, 2, 6, 3)).toBe(4);
    expect(intInRange(Number.NaN, 2, 6, 3)).toBe(3);
    expect(intInRange(Infinity, 2, 6, 3)).toBe(3);
  });
});

describe("refs", () => {
  it("mergeRefs de-dups per key in first-seen order", () => {
    expect(
      mergeRefs([
        { popups: ["p1", "p2"], forms: [], media: ["m2"] },
        { popups: ["p2", "p3", ""], forms: ["f1"], media: ["m1", "m2"] },
      ]),
    ).toEqual({
      popups: ["p1", "p2", "p3"],
      forms: ["f1"],
      media: ["m2", "m1"],
    });
  });
  it("mediaRefs and noRefs return fresh lists", () => {
    expect(mediaRefs(["a", "b", "a"])).toEqual({
      popups: [],
      forms: [],
      media: ["a", "b"],
    });
    const a = noRefs();
    a.media.push("x");
    expect(noRefs()).toEqual({ popups: [], forms: [], media: [] });
  });
});

describe("assertUniqueIds", () => {
  it("refuses a repeated id", () => {
    expect(() => assertUniqueIds([{ id: "a" }, { id: "b" }])).not.toThrow();
    expect(msg(() => assertUniqueIds([{ id: "a" }, { id: "a" }]))).toBe(
      MALFORMED_COPY,
    );
  });
});

// ---- Panels (Task 2) ----
const heading = (id: string, text = "Hi") => ({
  id,
  kind: "heading",
  text,
  level: 2,
});

describe("validatePanels", () => {
  it("normalizes each panel to its layout and keeps items", () => {
    const out = validatePanels(
      {
        slides: [
          {
            id: "s1",
            row_layout: "50-50",
            columns: [{ id: "c", items: [heading("h1")] }],
          },
        ],
      },
      "slides",
      10,
      "over",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.row_layout).toBe("50-50");
    expect(out[0]!.columns).toHaveLength(2);
    expect(out[0]!.columns[0]!.items[0]).toMatchObject({
      kind: "heading",
      text: "Hi",
    });
  });

  it("unknown layout -> full; missing columns -> the layout's empty columns", () => {
    const [p] = validatePanels(
      { s: [{ id: "a", row_layout: "nope" }] },
      "s",
      10,
      "over",
    );
    expect(p!.row_layout).toBe("full");
    expect(p!.columns).toHaveLength(1);
    expect(p!.columns[0]!.items).toEqual([]);
  });

  it("allows popup buttons and refuses unknown kinds", () => {
    const btn = {
      id: "b",
      kind: "button",
      text: "Go",
      action: "popup",
      popup_id: "pop1",
    };
    expect(() =>
      validatePanels(
        { s: [{ id: "a", columns: [{ id: "c", items: [btn] }] }] },
        "s",
        10,
        "o",
      ),
    ).not.toThrow();
    expect(
      msg(() =>
        validatePanels(
          {
            s: [{ id: "a", columns: [{ id: "c", items: [{ kind: "evil" }] }] }],
          },
          "s",
          10,
          "o",
        ),
      ),
    ).toBe("Unknown item type.");
  });

  it("refuses duplicate panel ids, item ids across panels, over-cap and non-arrays", () => {
    expect(() =>
      validatePanels({ s: [{ id: "a" }, { id: "a" }] }, "s", 10, "o"),
    ).toThrow(InvalidInput);
    expect(() =>
      validatePanels(
        {
          s: [
            { id: "a", columns: [{ id: "c1", items: [heading("x")] }] },
            { id: "b", columns: [{ id: "c2", items: [heading("x")] }] },
          ],
        },
        "s",
        10,
        "o",
      ),
    ).toThrow(InvalidInput);
    expect(msg(() => validatePanels({ s: [{}, {}, {}] }, "s", 2, "over"))).toBe(
      "over",
    );
    expect(() => validatePanels({ s: "x" }, "s", 2, "over")).toThrow(
      InvalidInput,
    );
  });

  it("caps items across all panels at 250", () => {
    const panel = (p: number) => ({
      id: `p${p}`,
      row_layout: "50-50",
      columns: [0, 1].map((c) => ({
        id: `c${p}${c}`,
        items: Array.from({ length: 30 }, (_, i) => heading(`i${p}-${c}-${i}`)),
      })),
    });
    // 5 panels x 60 items = 300 > 250
    expect(
      msg(() =>
        validatePanels({ s: [0, 1, 2, 3, 4].map(panel) }, "s", 10, "o"),
      ),
    ).toBe("A block can hold up to 250 items.");
    expect(() =>
      validatePanels({ s: [0, 1, 2, 3].map(panel) }, "s", 10, "o"),
    ).not.toThrow();
  });
});

describe("panel walkers", () => {
  const panels = validatePanels(
    {
      s: [
        {
          id: "a",
          columns: [
            {
              id: "c1",
              items: [
                heading("h1", "One"),
                { id: "t1", kind: "text", html: "<p>x</p>" },
              ],
            },
          ],
        },
        {
          id: "b",
          columns: [
            {
              id: "c2",
              items: [
                {
                  id: "b1",
                  kind: "button",
                  text: "Go",
                  action: "popup",
                  popup_id: "pop1",
                },
                { id: "b2", kind: "button", text: "Site", link: "/about" },
              ],
            },
          ],
        },
      ],
    },
    "s",
    10,
    "o",
  );

  it("maps rich text in text items only", () => {
    const out = mapPanelsRichText(panels, (h) => h.toUpperCase());
    expect(out[0]!.columns[0]!.items[1]).toMatchObject({ html: "<P>X</P>" });
    expect(out[0]!.columns[0]!.items[0]).toEqual(
      panels[0]!.columns[0]!.items[0],
    );
    expect(mapPanelsRichText(panels, (h) => h)).toEqual(panels);
    expect(mapPanelsRichText("x", (h) => h)).toEqual([]);
  });

  it("texts, urls and refs over every panel", () => {
    expect(panelsTexts(panels)).toEqual(["One", "<p>x</p>", "Go", "Site"]);
    expect(panelsUrls(panels)).toEqual(["/about"]);
    expect(panelsRefs(panels)).toEqual({
      popups: ["pop1"],
      forms: [],
      media: [],
    });
    expect(panelsRefs(null)).toEqual({ popups: [], forms: [], media: [] });
  });

  it("newPanel is a fresh empty full-width row", () => {
    const a = newPanel();
    expect(a.row_layout).toBe("full");
    expect(a.columns).toHaveLength(1);
    expect(newPanel().id).not.toBe(a.id);
  });
});

describe("clonePanelFreshIds (07-20)", () => {
  function filled() {
    const p = newPanel();
    p.columns[0].items = [
      { id: "h1", kind: "heading", text: "Spring menu", level: 2 },
      { id: "t1", kind: "text", html: "<p>Hello</p>" },
    ];
    return p;
  }

  it("mints fresh panel, column and item ids and keeps the content", () => {
    const src = filled();
    const copy = clonePanelFreshIds(src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.columns[0].id).not.toBe(src.columns[0].id);
    const srcIds = new Set([
      src.id,
      ...src.columns.flatMap((c) => [c.id, ...c.items.map((i) => i.id)]),
    ]);
    const copyIds = [
      copy.id,
      ...copy.columns.flatMap((c) => [c.id, ...c.items.map((i) => i.id)]),
    ];
    for (const id of copyIds) expect(srcIds.has(id)).toBe(false);
    expect(new Set(copyIds).size).toBe(copyIds.length);
    expect(copy.row_layout).toBe(src.row_layout);
    const strip = (items: { id: string }[]) =>
      items.map((item) => ({ ...item, id: "" }));
    expect(strip(copy.columns[0].items)).toEqual(strip(src.columns[0].items));
  });

  it("deep-copies: editing the clone never touches the source", () => {
    const src = filled();
    const copy = clonePanelFreshIds(src);
    (copy.columns[0].items[0] as { text: string }).text = "Changed";
    expect((src.columns[0].items[0] as { text: string }).text).toBe(
      "Spring menu",
    );
  });

  it("keeps extra fields such as a tab label", () => {
    const copy = clonePanelFreshIds({ ...newPanel(), label: "Prices" });
    expect(copy.label).toBe("Prices");
  });

  it("validatePanels accepts source and clone together", () => {
    const src = filled();
    const out = validatePanels(
      { slides: [src, clonePanelFreshIds(src)] },
      "slides",
      10,
      "over",
    );
    expect(out).toHaveLength(2);
  });
});
