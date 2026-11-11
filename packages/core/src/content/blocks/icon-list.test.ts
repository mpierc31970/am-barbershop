// Icon list block (07-07; CONT-27, CONTEXT decision 5; T-07-07-07).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  ICON_LIST_ICON_IDS,
  defaultIconListBlock,
  iconListSection,
  validateIconListBlock,
} from "./icon-list";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("icon list content", () => {
  it("has exactly 60 unique kebab-case ids", () => {
    expect(ICON_LIST_ICON_IDS).toHaveLength(60);
    expect(new Set(ICON_LIST_ICON_IDS).size).toBe(60);
    for (const id of ICON_LIST_ICON_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    expect(Object.isFrozen(ICON_LIST_ICON_IDS)).toBe(true);
  });

  it("default: 3 check items with fresh ids; validates", () => {
    const d = defaultIconListBlock();
    expect(d.heading).toBe("");
    expect(d.items).toHaveLength(3);
    for (const i of d.items) {
      expect(i).toEqual({ id: i.id, icon: "check", title: "", text: "" });
    }
    expect(new Set(d.items.map((i) => i.id)).size).toBe(3);
    expect(defaultIconListBlock().items[0]!.id).not.toBe(d.items[0]!.id);
    expect(validateIconListBlock(d)).toEqual(d);
  });

  it("unknown icons fall back to check", () => {
    const v = validateIconListBlock({
      items: [
        { icon: "../../evil" },
        { icon: "__proto__" },
        { icon: "flower-2" },
        { icon: 5 },
      ],
    });
    expect(v.items.map((i) => i.icon)).toEqual([
      "check",
      "check",
      "flower-2",
      "check",
    ]);
  });

  it("limits: 12 items, text 200", () => {
    const items = Array.from({ length: 13 }, () => ({ title: "t" }));
    expect(msg(() => validateIconListBlock({ items }))).toBe(
      "Keep this to 12 items or fewer.",
    );
    expect(() =>
      validateIconListBlock({ items: [{ text: "x".repeat(201) }] }),
    ).toThrow("Keep this under 200 characters.");
    expect(() =>
      validateIconListBlock({
        items: [
          { id: "a", title: "x" },
          { id: "a", title: "y" },
        ],
      }),
    ).toThrow(InvalidInput);
  });
});

describe("iconListSection", () => {
  it("contract", () => {
    expect(iconListSection.type).toBe("icon-list");
    expect(iconListSection.label).toBe("Icon list");
    expect(iconListSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(iconListSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(iconListSection.refsOf({})).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    const v = validateIconListBlock({
      heading: "H",
      items: [{ id: "a", title: "T", text: "X" }],
    });
    expect(iconListSection.textsOf(v)).toEqual(["H", "T", "X"]);
    expect(iconListSection.urlsOf(v)).toEqual([]);
    for (const bad of [null, undefined, 5, "x", [], { items: [5] }]) {
      expect(() => iconListSection.textsOf(bad)).not.toThrow();
      expect(() => iconListSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});
