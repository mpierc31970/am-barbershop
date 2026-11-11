// P8 (08-11): the shared page-draft fingerprint (CONTEXT discretion: the installer's print,
// reused by assembly). The installer's own R2-WR-02 case stays in addons/installer.test.ts.
import { describe, expect, it } from "vitest";
import { canonicalJson, pageDraftPrint } from "./draft-print";

const page = {
  id: "p1",
  title: "Home",
  slug: "home",
  status: "published",
  updated: "2026-10-07 06:00:00.000Z",
  has_unpublished_changes: false,
};
const b1 = {
  id: "s1",
  section_type: "hero",
  content: { heading: "Rivera Bakery", sub: "Fresh daily" },
  sort_order: 0,
  updated: "t1",
};
const b2 = {
  id: "s2",
  section_type: "intro",
  content: { text: "Hi" },
  sort_order: 1,
  updated: "t1",
};

describe("pageDraftPrint (shared, 08-11)", () => {
  it("is a sha256 hex string", () => {
    expect(pageDraftPrint(page, [b1, b2])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order, fetch order, has_unpublished_changes and updated", () => {
    const base = pageDraftPrint(page, [b1, b2]);
    const reordered = {
      has_unpublished_changes: true,
      updated: "later",
      status: "published",
      slug: "home",
      title: "Home",
      id: "p1",
    };
    const b1Keys = {
      updated: "t9",
      sort_order: 0,
      content: { sub: "Fresh daily", heading: "Rivera Bakery" },
      section_type: "hero",
      id: "s1",
    };
    expect(pageDraftPrint(reordered, [b2, b1Keys])).toBe(base);
  });

  it("sees a content edit", () => {
    const base = pageDraftPrint(page, [b1, b2]);
    expect(
      pageDraftPrint(page, [b1, { ...b2, content: { text: "Hello" } }]),
    ).not.toBe(base);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth, keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });
});
