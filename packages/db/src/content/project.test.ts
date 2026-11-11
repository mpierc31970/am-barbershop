// IN-R02: stored rows whose item ids repeat are repaired on read, not refused, so the page
// stays publishable and restorable and the builder can save the block again.
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  type ColumnsContent,
} from "@cds/core/content";
import type { RecordModel } from "pocketbase";
import { describe, expect, it } from "vitest";
import { projectSection } from "./project";
import { toSectionRow } from "./sections";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

const row = {
  id: "s1",
  page: "p1",
  section_type: "columns",
  row_layout: "50-50",
  content: {
    columns: [
      { id: "c1", items: [{ id: "i1", kind: "divider" }] },
      { id: "c2", items: [{ id: "i1", kind: "divider" }] },
    ],
  },
  settings: { background_variant: "main" },
  sort_order: 1,
  is_published: true,
} as unknown as RecordModel;

function ids(content: unknown): string[] {
  return (content as ColumnsContent).columns.flatMap((c) =>
    c.items.map((i) => i.id),
  );
}

describe("duplicate item ids on read (IN-R02)", () => {
  it("projectSection (publish and restore) repairs instead of throwing", () => {
    const out = projectSection(row, registry);
    const got = ids(out.content);
    expect(got).toHaveLength(2);
    expect(got[0]).toBe("i1");
    expect(new Set(got).size).toBe(2);
  });

  it("toSectionRow (the builder's read) hands back unique ids", () => {
    const got = ids(toSectionRow(row).content);
    expect(new Set(got).size).toBe(2);
  });
});
