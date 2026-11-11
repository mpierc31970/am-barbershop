// Section contract in the chokepoint on the real PocketBase 0.39.11 binary (07-04; CONT-13,
// CONT-35, D280; T-03-18 generalized, T-07-04-01, T-07-04-02): one hero per page on save
// and on undo-delete, and every pop-up, form and media id a block's refsOf reports must be
// the org's own.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  FULL_WIDTH_ONLY,
  type SectionTypeDefinition,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import {
  deleteSection,
  listSections,
  saveSection,
  setSectionHidden,
  undoDeleteSection,
} from "../src/content/sections";
import { fixtureAddonSection } from "../../core/src/content/__fixtures__/fixture-addon";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const SECOND_HERO =
  "This page already has a Hero block. A page can have only one.";

function idList(raw: unknown, key: string): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const v = (raw as Record<string, unknown>)[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Test-only block whose refsOf reports caller-chosen ids. */
const refsProbe: SectionTypeDefinition = {
  type: "fixture-refs",
  label: "Refs (fixture)",
  description: "Test-only block reporting references.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => ({ popup_ids: [], form_ids: [], media_ids: [] }),
  validate: (raw) => ({
    popup_ids: idList(raw, "popup_ids"),
    form_ids: idList(raw, "form_ids"),
    media_ids: idList(raw, "media_ids"),
  }),
  mapRichText: (content) => content,
  textsOf: () => [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "none" },
  refsOf: (content) => ({
    popups: idList(content, "popup_ids"),
    forms: idList(content, "form_ids"),
    media: idList(content, "media_ids"),
  }),
};

const registry = composeSectionRegistry(CORE_SECTIONS, [
  fixtureAddonSection,
  refsProbe,
]);
/** An add-on owner lookup that owns nothing (no add-ons installed here). */
const NO_OWNERS = { ownerOf: () => undefined };
/** A well-formed record id that exists nowhere. */
const ABSENT_ID = "zzzzzzzzzzzzzz1";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-section-contract-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // 11-26 (DASH-08): this suite creates many pages in org A; give it room past the
  // 10-page allowance so the contract cases test sections, not the limit.
  await pb.collection("billing_accounts").create({
    organization: seed.A.org,
    provider: "fake",
    status: "active",
    installments_paid: 0,
    pages_5_qty: 50,
  });
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
    title: `Contract ${pageSeq}`,
    slug: `contract-${pageSeq}`,
  });
  return page.id;
}

function hero(pageId: string, heading = "Welcome") {
  return saveSection(seed.ctxA, registry, {
    pageId,
    section_type: "hero",
    row_layout: "full",
    content: { heading },
  });
}

describe("one hero per page (CONT-35, D280)", () => {
  it("saves the first hero and refuses a second on the same page", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await hero(pageId);
    const err = await hero(pageId, "Again").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(SECOND_HERO);
    const rows = await listSections(seed.ctxA, pageId);
    expect(rows.filter((r) => r.section_type === "hero")).toHaveLength(1);
  });

  it("still lets the existing hero be edited", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const first = await hero(pageId);
    await saveSection(seed.ctxA, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "About", text: "" },
    });
    const edited = await saveSection(seed.ctxA, registry, {
      pageId,
      id: first.id,
      section_type: "hero",
      row_layout: "full",
      content: { heading: "Hello again" },
    });
    expect((edited.content as { heading: string }).heading).toBe("Hello again");
  });

  it("allows a hero on another page of the same org", async (t) => {
    if (!inst) return t.skip();
    await hero(await freshPage());
    const other = await hero(await freshPage());
    expect(other.section_type).toBe("hero");
  });

  it("counts a hidden hero", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const first = await hero(pageId);
    await setSectionHidden(seed.ctxA, first.id, true);
    await expect(hero(pageId, "Second")).rejects.toThrow(SECOND_HERO);
  });

  it("refuses to turn another block into a second hero", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await hero(pageId);
    const text = await saveSection(seed.ctxA, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "About", text: "" },
    });
    await expect(
      saveSection(seed.ctxA, registry, {
        pageId,
        id: text.id,
        section_type: "hero",
        row_layout: "full",
        content: { heading: "Sneaky" },
      }),
    ).rejects.toThrow(SECOND_HERO);
  });

  it("undo-delete refuses a hero while the page has another one", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const first = await hero(pageId);
    const deleted = await deleteSection(seed.ctxA, first.id);
    await hero(pageId, "Replacement");
    await expect(
      undoDeleteSection(seed.ctxA, registry, deleted),
    ).rejects.toThrow(SECOND_HERO);
  });

  it("undo-delete of the only hero succeeds", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const first = await hero(pageId);
    const deleted = await deleteSection(seed.ctxA, first.id);
    const back = await undoDeleteSection(seed.ctxA, registry, deleted);
    expect(back.id).toBe(first.id);
    expect(back.section_type).toBe("hero");
  });
});

describe("reference ownership from refsOf (T-03-18 generalized)", () => {
  it("accepts the org's own media asset", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    const row = await saveSection(
      seed.ctxA,
      registry,
      {
        pageId,
        section_type: "fixture-refs",
        row_layout: "full",
        content: { media_ids: [seed.A.media] },
      },
      NO_OWNERS,
    );
    expect(row.content).toMatchObject({ media_ids: [seed.A.media] });
  });

  it("refuses another org's media asset with NotFound, writing nothing", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(
      saveSection(
        seed.ctxA,
        registry,
        {
          pageId,
          section_type: "fixture-refs",
          row_layout: "full",
          content: { media_ids: [seed.A.media, seed.B.media] },
        },
        NO_OWNERS,
      ),
    ).rejects.toThrow(NotFound);
    expect(await listSections(seed.ctxA, pageId)).toEqual([]);
  });

  it("refuses an unknown form id with NotFound", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(
      saveSection(
        seed.ctxA,
        registry,
        {
          pageId,
          section_type: "fixture-refs",
          row_layout: "full",
          content: { form_ids: [ABSENT_ID] },
        },
        NO_OWNERS,
      ),
    ).rejects.toThrow(NotFound);
  });

  it("keeps the pop-up check: a button opening an unknown pop-up is NotFound", async (t) => {
    if (!inst) return t.skip();
    const pageId = await freshPage();
    await expect(
      saveSection(seed.ctxA, registry, {
        pageId,
        section_type: "columns",
        row_layout: "full",
        content: {
          columns: [
            {
              id: "c1",
              items: [
                {
                  id: "b1",
                  kind: "button",
                  text: "Open",
                  link: "",
                  style: "primary",
                  action: "popup",
                  popup_id: ABSENT_ID,
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow(NotFound);
  });
});
