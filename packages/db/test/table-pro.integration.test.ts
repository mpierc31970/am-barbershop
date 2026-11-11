// Pro table plan check on section save (BILL-14, D233; 10-41; invariant 9; T-10-41-01,
// T-10-41-03): without Builder Pro a table may not newly use a Pro part; an existing Pro
// table whose Builder Pro lapsed keeps its Pro settings when only text changes.
// 10-42: the published read and the preview follow the org's Builder Pro state: a lapsed
// site gets the free table (10 x 200, Pro off), the stored JSON keeps everything, and
// paying again restores it (D233, invariant 9; T-10-42-02).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  PRO_TABLE_COPY,
  type PublishedPage,
  type TableBlockContent,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import { previewPage } from "../src/content/project";
import { publishPage } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import {
  readPublishedPage,
  siteContextForHost,
} from "../src/content/site-context";
import { clearResolverCache } from "../src/resolve";
import {
  getObjectStore,
  tenantPublishedPageKey,
  type ObjectStore,
} from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let pageA = "";
let pageB = "";
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

type Cell = {
  text: string;
  bold: boolean;
  italic: boolean;
  link: string;
  icon?: string;
};

function grid(rows: number, cols: number, icon?: string): Cell[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      text: `r${r}c${c}`,
      bold: false,
      italic: false,
      link: "",
      ...(icon && r > 0 && c === 1 ? { icon } : {}),
    })),
  );
}

function table(
  rows: Cell[][],
  pro?: Record<string, unknown>,
): Record<string, unknown> {
  const width = rows[0]?.length ?? 0;
  return {
    heading: "Compare",
    header_row: true,
    first_column_header: false,
    striped: false,
    align: Array.from({ length: width }, () => "left"),
    mobile: "scroll",
    rows,
    ...(pro ? { pro } : {}),
  };
}

const PRO = {
  sticky: false,
  sortable: true,
  searchable: false,
  paged: false,
  highlight: null,
  widths: [],
  section_rows: [],
};

async function setAddon(
  org: string,
  status: "active" | "disabled",
): Promise<void> {
  const existing = await pb
    .collection("org_addons")
    .getFirstListItem(
      pb.filter("organization = {:org} && addon = 'builder-pro'", { org }),
    )
    .catch(() => null);
  const body = {
    organization: org,
    addon: "builder-pro",
    status,
    disabled_reason: status === "disabled" ? "billing_lapse" : "",
    source: "billing",
    installed_version: "1.0.0",
    installed_at: new Date().toISOString(),
  };
  if (existing) await pb.collection("org_addons").update(existing.id, body);
  else await pb.collection("org_addons").create(body);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-table-pro-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // A: Studio (Builder Pro included at $0). B: Standard, no Builder Pro yet.
  await pb.collection("organizations").update(seed.A.org, { path: "studio" });
  await pb.collection("organizations").update(seed.B.org, { path: "standard" });
  pageA = (await createPage(seed.ctxA, { title: "Prices", slug: "prices" })).id;
  pageB = (await createPage(seed.ctxB, { title: "Prices", slug: "prices" })).id;
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

function save(which: "A" | "B", content: Record<string, unknown>, id?: string) {
  return saveSection(which === "A" ? seed.ctxA : seed.ctxB, registry, {
    pageId: which === "A" ? pageA : pageB,
    ...(id ? { id } : {}),
    section_type: "table",
    row_layout: "full",
    content,
  });
}

describe("Standard org without Builder Pro", () => {
  it("refuses a sortable table with PRO_TABLE_COPY", async (t) => {
    if (!inst) return t.skip();
    const err = await save("B", table(grid(3, 3), PRO)).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(PRO_TABLE_COPY);
  });

  it("refuses 11 columns", async (t) => {
    if (!inst) return t.skip();
    await expect(save("B", table(grid(3, 11)))).rejects.toThrow(PRO_TABLE_COPY);
  });

  it("refuses icons", async (t) => {
    if (!inst) return t.skip();
    await expect(save("B", table(grid(3, 3, "yes")))).rejects.toThrow(
      PRO_TABLE_COPY,
    );
  });

  it("saves a free table", async (t) => {
    if (!inst) return t.skip();
    const row = await save("B", table(grid(3, 3)));
    expect(row.section_type).toBe("table");
  });
});

describe("Studio org (Builder Pro included)", () => {
  it("saves a 20 x 300 table with icons, a highlight and Pro options", async (t) => {
    if (!inst) return t.skip();
    const row = await save(
      "A",
      table(grid(300, 20, "yes"), {
        ...PRO,
        sticky: true,
        searchable: true,
        paged: true,
        highlight: { column: 2, label: "Most popular" },
        section_rows: [1, 50],
      }),
    );
    const c = row.content as {
      rows: Cell[][];
      pro: { highlight: { column: number }; sortable: boolean };
    };
    expect(c.rows).toHaveLength(300);
    expect(c.rows[0]).toHaveLength(20);
    expect(c.rows[1]![1]!.icon).toBe("yes");
    expect(c.pro.highlight.column).toBe(2);
    expect(c.pro.sortable).toBe(true);
  });
});

describe("Standard org whose Builder Pro lapsed", () => {
  it("keeps existing Pro settings on a text-only save and refuses a new Pro setting", async (t) => {
    if (!inst) return t.skip();
    await setAddon(seed.B.org, "active");
    const rows = grid(250, 12, "no");
    const saved = await save("B", table(rows, PRO));
    await setAddon(seed.B.org, "disabled");

    // Text change only: saved, Pro parts intact.
    const edited = grid(250, 12, "no");
    edited[1]![0]!.text = "Changed";
    const again = await save("B", table(edited, PRO), saved.id);
    const c = again.content as {
      rows: Cell[][];
      pro: { sortable: boolean };
    };
    expect(c.rows[1]![0]!.text).toBe("Changed");
    expect(c.rows).toHaveLength(250);
    expect(c.rows[0]).toHaveLength(12);
    expect(c.rows[2]![1]!.icon).toBe("no");
    expect(c.pro.sortable).toBe(true);

    // A new Pro setting: refused.
    await expect(
      save("B", table(edited, { ...PRO, searchable: true }), saved.id),
    ).rejects.toThrow(PRO_TABLE_COPY);
    // Growing past the previous size: refused.
    await expect(
      save("B", table(grid(251, 12, "no"), PRO), saved.id),
    ).rejects.toThrow(PRO_TABLE_COPY);
  });
});

describe("published render follows Builder Pro (10-42)", () => {
  function proTables(page: PublishedPage | null): TableBlockContent[] {
    return (page?.sections ?? [])
      .filter((s) => s.section_type === "table")
      .map((s) => s.content as TableBlockContent)
      .filter((c) => (c.rows?.length ?? 0) > 200);
  }

  it("entitled keeps the Pro table; lapsed gets the free table; paying again restores it", async (t) => {
    if (!inst) return t.skip();
    // B holds the 250 x 12 sortable table with "no" icons from the lapse test above.
    await setAddon(seed.B.org, "active");
    await publishPage(seed.ctxB, pageB, {
      sections: registry,
      invalidator: recordingInvalidator(),
      pinger: { ping: () => Promise.resolve() },
      store,
    });
    clearResolverCache();
    const site = await siteContextForHost("b.example.com");
    expect(site).not.toBeNull();

    const full = proTables(await readPublishedPage(site!, pageB, store));
    expect(full).toHaveLength(1);
    expect(full[0]!.rows[0]).toHaveLength(12);
    expect(full[0]!.pro?.sortable).toBe(true);
    expect(full[0]!.rows[2]![1]!.icon).toBe("no");

    await setAddon(seed.B.org, "disabled");
    const lapsed = await readPublishedPage(site!, pageB, store);
    const tables = (lapsed?.sections ?? [])
      .filter((s) => s.section_type === "table")
      .map((s) => s.content as TableBlockContent);
    expect(tables.length).toBeGreaterThan(0);
    for (const c of tables) {
      expect(c.rows.length).toBeLessThanOrEqual(200);
      for (const row of c.rows) {
        expect(row.length).toBeLessThanOrEqual(10);
        for (const cell of row) expect(cell.icon).toBeUndefined();
      }
      expect(c.pro?.sortable ?? false).toBe(false);
      expect(c.pro?.sticky ?? false).toBe(false);
    }
    // The builder preview shows the same free table.
    const preview = await previewPage(seed.ctxB, pageB, registry);
    expect(proTables(preview)).toHaveLength(0);

    // The stored JSON is untouched (invariant 9).
    const bytes = await store.get(tenantPublishedPageKey(seed.B.org, pageB));
    const stored = JSON.parse(
      new TextDecoder().decode(bytes!),
    ) as PublishedPage;
    expect(proTables(stored)).toHaveLength(1);
    expect(proTables(stored)[0]!.pro?.sortable).toBe(true);

    await setAddon(seed.B.org, "active");
    const restored = proTables(await readPublishedPage(site!, pageB, store));
    expect(restored).toHaveLength(1);
    expect(restored[0]!.rows[0]).toHaveLength(12);
  });

  it("a Studio site keeps its Pro table (Builder Pro included on the path)", async (t) => {
    if (!inst) return t.skip();
    await publishPage(seed.ctxA, pageA, {
      sections: registry,
      invalidator: recordingInvalidator(),
      pinger: { ping: () => Promise.resolve() },
      store,
    });
    const a = await siteContextForHost("a.example.com");
    const studio = proTables(await readPublishedPage(a!, pageA, store));
    expect(studio).toHaveLength(1);
    expect(studio[0]!.rows[0]).toHaveLength(20);
  });
});
