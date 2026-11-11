// Item references on the real PocketBase 0.39.11 binary (07-08; T-07-08-04, T-03-18
// generalized): every form and media id a column item references, in a page block or a
// pop-up, must be the org's own. Another org's id is NotFound and nothing is written.
// Pop-up item titles are screened like other pop-up text.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import { savePopup } from "../src/content/popups";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { keywordScanner } from "../src/content/scan-standin";
import { listSections, saveSection } from "../src/content/sections";
import { fixtureAddonSection } from "../../core/src/content/__fixtures__/fixture-addon";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, [fixtureAddonSection]);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-item-refs-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

let pageSeq = 0;
async function freshPage(): Promise<string> {
  pageSeq += 1;
  const page = await createPage(seed.ctxA, {
    title: `Item refs ${pageSeq}`,
    slug: `item-refs-${pageSeq}`,
  });
  return page.id;
}

const formItem = (formId: string) => ({
  id: "f1",
  kind: "form",
  form_id: formId,
});
const videoItem = (assetId: string, title = "Studio tour") => ({
  id: "v1",
  kind: "video",
  title,
  source: "media",
  asset: assetId,
});

function columns(pageId: string, items: Record<string, unknown>[]) {
  return saveSection(seed.ctxA, registry, {
    pageId,
    section_type: "columns",
    row_layout: "full",
    content: { columns: [{ id: "c1", items }] },
  });
}

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    scanner: keywordScanner,
    pinger: { async ping() {} },
  };
}

const popup = (items: Record<string, unknown>[], name = "Item refs") => ({
  name,
  trigger: "delay",
  delay_seconds: 5,
  frequency: "once-per-visitor",
  show_on: "all-pages",
  enabled: true,
  content: { items },
});

async function popupCount(org: string): Promise<number> {
  const rows = await pb.collection("popups").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return rows.length;
}

describe("column items in page blocks", () => {
  it("accepts the org's own form", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const row = await columns(pageId, [formItem(seed.A.form)]);
    expect(JSON.stringify(row.content)).toContain(seed.A.form);
  });

  it("refuses another org's form with NotFound, writing nothing", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(columns(pageId, [formItem(seed.B.form)])).rejects.toThrow(
      NotFound,
    );
    expect(await listSections(seed.ctxA, pageId)).toEqual([]);
  });

  it("accepts the org's own media asset in a video item", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const row = await columns(pageId, [videoItem(seed.A.media)]);
    expect(JSON.stringify(row.content)).toContain(seed.A.media);
  });

  it("refuses another org's media asset in a video item", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(columns(pageId, [videoItem(seed.B.media)])).rejects.toThrow(
      NotFound,
    );
    expect(await listSections(seed.ctxA, pageId)).toEqual([]);
  });

  it("refuses another org's media asset as an image item's library photo", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(
      columns(pageId, [
        { id: "i1", kind: "image", alt: "Room", asset: seed.B.media },
      ]),
    ).rejects.toThrow(NotFound);
  });
});

describe("column items in pop-ups (savePopup)", () => {
  it("refuses another org's form with NotFound, writing nothing", async (t) => {
    if (!inst) return t.skip();
    const before = await popupCount(seed.A.org);
    await expect(
      savePopup(seed.ctxA, deps(), popup([formItem(seed.B.form)])),
    ).rejects.toThrow(NotFound);
    expect(await popupCount(seed.A.org)).toBe(before);
  });

  it("refuses another org's media asset with NotFound", async (t) => {
    if (!inst) return t.skip();
    await expect(
      savePopup(seed.ctxA, deps(), popup([videoItem(seed.B.media)])),
    ).rejects.toThrow(NotFound);
  });

  it("accepts the org's own form and media", async (t) => {
    if (!inst) return t.skip();
    const { popup: saved, held } = await savePopup(
      seed.ctxA,
      deps(),
      popup([formItem(seed.A.form), videoItem(seed.A.media)]),
    );
    expect(held).toBe(false);
    expect(saved.content.items.map((i) => i.kind)).toEqual(["form", "video"]);
  });

  it("screens a video title like other pop-up text", async (t) => {
    if (!inst) return t.skip();
    const { popup: saved, held } = await savePopup(
      seed.ctxA,
      deps(),
      popup([videoItem(seed.A.media, "Tour __cds_test_held__")]),
    );
    expect(held).toBe(true);
    expect(saved.enabled).toBe(false);
  });
});
