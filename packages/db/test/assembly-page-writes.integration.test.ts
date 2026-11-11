// P8 (08-15): the page write rules assembly runs through, on the real PocketBase 0.39.11
// binary (TMPL-02, TMPL-03; CONTEXT A2-Q3, A2-Q4; RESEARCH R-5; invariants 1, 9;
// T-08-15-01..04). A fresh org per case, so cases never see each other's pages.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type { LedgerPage } from "@cds/core/templates";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AssemblyStepError,
  ensureAssemblyNav,
  ensureFooterDefaults,
  writeTemplatePage,
  type TemplateBlock,
} from "../src/assembly/page-writes";
import { resetClientForTests, superuser } from "../src/client";
import { addPageToNav, getNav } from "../src/content/chrome/nav";
import { getFooter, saveFooter } from "../src/content/chrome/footer";
import { readPageDraft } from "../src/content/draft-print";
import { createPage, listPages } from "../src/content/pages";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import {
  listSections,
  replacePageSections,
  saveSection,
} from "../src/content/sections";
import { mintOrgContext, type OrgContext } from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
let orgN = 0;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-page-writes-"));
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

/** A fresh org and an owner context on it. */
async function freshOrg(): Promise<OrgContext> {
  orgN += 1;
  const slug = `pw-org-${orgN}`;
  const org = await pb
    .collection("organizations")
    .create({ name: slug, slug, status: "active" });
  return mintOrgContext({
    orgId: org.id,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: IP,
  });
}

const text = (heading: string) => ({
  section_type: "text-only",
  row_layout: "full",
  content: { heading, text: "<p>Body</p>" },
});
const hero = (heading: string) => ({
  section_type: "hero",
  row_layout: "full",
  content: { heading },
});

async function rawSections(pageId: string) {
  return pb.collection("page_sections").getFullList({
    filter: pb.filter("page = {:p}", { p: pageId }),
    sort: "sort_order",
  });
}

describe("replacePageSections (08-15 choice 3)", () => {
  it("replaces every section in order and leaves other pages untouched", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const page = await createPage(ctx, { title: "About", slug: "about" });
    const other = await createPage(ctx, { title: "Other", slug: "other" });
    await saveSection(ctx, registry, { pageId: page.id, ...text("Old") });
    const keep = await saveSection(ctx, registry, {
      pageId: other.id,
      ...text("Keep"),
    });
    const rows = await replacePageSections(
      ctx,
      registry,
      page.id,
      [
        hero("Welcome"),
        { ...text("Second"), settings: { background_variant: "alternate" } },
        text("Third"),
      ],
      NO_OWNERS,
    );
    expect(rows.map((r) => r.section_type)).toEqual([
      "hero",
      "text-only",
      "text-only",
    ]);
    expect(rows.map((r) => r.sort_order)).toEqual([1, 2, 3]);
    expect(rows[1]!.settings).toEqual({ background_variant: "alternate" });
    const listed = await listSections(ctx, page.id);
    expect(
      listed.map((r) => (r.content as { heading: string }).heading),
    ).toEqual(["Welcome", "Second", "Third"]);
    const others = await listSections(ctx, other.id);
    expect(others.map((r) => r.id)).toEqual([keep.id]);
    const p = await pb.collection("pages").getOne(page.id);
    expect(p.has_unpublished_changes).toBe(true);
  });

  it("an invalid block throws before any row is deleted", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const page = await createPage(ctx, { title: "About", slug: "about" });
    const old = await saveSection(ctx, registry, {
      pageId: page.id,
      ...text("Old"),
    });
    await expect(
      replacePageSections(
        ctx,
        registry,
        page.id,
        [
          text("New"),
          { section_type: "nope", row_layout: "full", content: {} },
        ],
        NO_OWNERS,
      ),
    ).rejects.toThrow(InvalidInput);
    // Two heroes: refused as a set.
    await expect(
      replacePageSections(
        ctx,
        registry,
        page.id,
        [hero("One"), hero("Two")],
        NO_OWNERS,
      ),
    ).rejects.toThrow(InvalidInput);
    expect((await rawSections(page.id)).map((r) => r.id)).toEqual([old.id]);
  });

  it("cross-tenant: org A's context on org B's page id throws and B is unchanged", async (t) => {
    if (!inst) return t.skip();
    const before = await rawSections(seed.B.page);
    await expect(
      replacePageSections(
        seed.ctxA,
        registry,
        seed.B.page,
        [text("Hijack")],
        NO_OWNERS,
      ),
    ).rejects.toThrow(NotFound);
    const after = await rawSections(seed.B.page);
    expect(after.map((r) => [r.id, r.updated])).toEqual(
      before.map((r) => [r.id, r.updated]),
    );
  });
});

// ---------------------------------------------------------------------------------------
// writeTemplatePage, nav and footer (08-15 choices 1, 2, 4)

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { async ping() {} },
  };
}

const ABOUT: TemplateBlock[] = [
  { ...hero("About us"), band: "main" },
  { ...text("Our story"), band: "alternate" },
  { ...text("Our values"), band: "main" },
];

type Saved = { page: LedgerPage; sectionsAtCall: number };

function recorder() {
  const saved: Saved[] = [];
  return {
    saved,
    savePage: async (page: LedgerPage) => {
      saved.push({ page, sectionsAtCall: (await rawSections(page.id)).length });
    },
  };
}

type Input = Parameters<typeof writeTemplatePage>[2];

function input(
  rec: ReturnType<typeof recorder>,
  over: Partial<Input> = {},
): Input {
  return {
    pageKey: "about",
    slug: "about",
    title: "About",
    blocks: ABOUT,
    ledgerPage: undefined,
    rerun: false,
    savePage: rec.savePage,
    ...over,
  };
}

async function pagesWithSlugPrefix(org: string, prefix: string) {
  const all = await pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return all.filter((p) => String(p.slug).startsWith(prefix));
}

describe("writeTemplatePage (CONTEXT A2-Q3, A2-Q4; R-5)", () => {
  it("created: a new About page, ledger saved pending before any block, bands applied", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const rec = recorder();
    const res = await writeTemplatePage(ctx, registry, input(rec), NO_OWNERS);
    expect(res.outcome).toBe("created");
    expect(res.page).not.toBeNull();
    const page = res.page!;
    expect(page.slug).toBe("about");
    expect(page.pending).toBe(true);
    expect(page.published).toBe(false);
    // Ledger first: the first save happened while the page had no blocks.
    expect(rec.saved[0]!.sectionsAtCall).toBe(0);
    expect(rec.saved[0]!.page).toMatchObject({ id: page.id, pending: true });
    // Then once per block, each with the refreshed print.
    expect(rec.saved.map((s) => s.sectionsAtCall)).toEqual([0, 1, 2, 3]);
    const rows = await rawSections(page.id);
    expect(rows.map((r) => r.section_type)).toEqual([
      "hero",
      "text-only",
      "text-only",
    ]);
    expect(
      rows.map(
        (r) =>
          (r.settings as { background_variant: string }).background_variant,
      ),
    ).toEqual(["main", "alternate", "main"]);
    const draft = await readPageDraft(ctx, page.id);
    expect(page.print).toBe(draft!.print);
    expect(rec.saved.at(-1)!.page.print).toBe(draft!.print);
  });

  it("WR-A06: an empty never-published about page is adopted (same id, no about-2)", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const mine = await createPage(ctx, { title: "Mine", slug: "about" });
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder()),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect(res.page!.id).toBe(mine.id);
    expect(res.page!.slug).toBe("about");
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(1);
  });

  it("WR-A06: an about page with the owner's blocks is left alone (skipped_existing)", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const about = await createPage(ctx, { title: "Mine", slug: "about" });
    const block = await saveSection(ctx, registry, {
      pageId: about.id,
      ...text("Mine"),
    });
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, { label: "About" }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("skipped_existing");
    expect(res.page).toBeNull();
    expect(res.polish).toBe("About · Already existed: left alone");
    expect(rec.saved).toHaveLength(0);
    expect((await rawSections(about.id)).map((r) => r.id)).toEqual([block.id]);
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(1);
  });

  it("Home adopts an empty never-published home page (same id)", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const home = await createPage(ctx, { title: "Home", slug: "home" });
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { pageKey: "home", slug: "home", title: "Home" }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect(res.page!.id).toBe(home.id);
    expect((await rawSections(home.id)).length).toBe(ABOUT.length);
    expect(await pagesWithSlugPrefix(ctx.orgId, "home")).toHaveLength(1);
  });

  it("Home creates the home page when the org has none", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { pageKey: "home", slug: "home", title: "Home" }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect(res.page!.slug).toBe("home");
  });

  it("skipped_existing: a home page with blocks is left alone and nothing is written", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const home = await createPage(ctx, { title: "Home", slug: "home" });
    const mine = await saveSection(ctx, registry, {
      pageId: home.id,
      ...text("Mine"),
    });
    const before = await readPageDraft(ctx, home.id);
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, { pageKey: "home", slug: "home", title: "Home" }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("skipped_existing");
    expect(res.page).toBeNull();
    expect(res.polish).toBe("Home · Already existed: left alone");
    expect(rec.saved).toHaveLength(0);
    expect((await rawSections(home.id)).map((r) => r.id)).toEqual([mine.id]);
    expect((await readPageDraft(ctx, home.id))!.print).toBe(before!.print);
  });

  it("rebuilt: a re-run with a matching print replaces the blocks on the same page", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const first = await writeTemplatePage(
      ctx,
      registry,
      input(recorder()),
      NO_OWNERS,
    );
    const ledger: LedgerPage = { ...first.page!, pending: false };
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, {
        ledgerPage: ledger,
        rerun: true,
        blocks: [{ ...hero("New about"), band: "main" }],
      }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("rebuilt");
    expect(res.page!.id).toBe(ledger.id);
    const rows = await rawSections(ledger.id);
    expect(rows.map((r) => (r.content as { heading: string }).heading)).toEqual(
      ["New about"],
    );
    expect(res.page!.print).toBe((await readPageDraft(ctx, ledger.id))!.print);
    expect(rec.saved[0]!.page.pending).toBe(true);
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(1);
  });

  it("edited: a page changed since assembly is left alone on a re-run", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const first = await writeTemplatePage(
      ctx,
      registry,
      input(recorder()),
      NO_OWNERS,
    );
    const page = first.page!;
    const rows = await rawSections(page.id);
    await saveSection(ctx, registry, {
      id: rows[1]!.id,
      pageId: page.id,
      ...text("Owner wrote this"),
    });
    const before = await readPageDraft(ctx, page.id);
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, { ledgerPage: { ...page, pending: false }, rerun: true }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("edited");
    expect(rec.saved).toHaveLength(0);
    expect((await readPageDraft(ctx, page.id))!.print).toBe(before!.print);
  });

  it("deleted: a page the owner deleted is never recreated", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const first = await writeTemplatePage(
      ctx,
      registry,
      input(recorder()),
      NO_OWNERS,
    );
    const page = first.page!;
    for (const r of await rawSections(page.id)) {
      await pb.collection("page_sections").delete(r.id);
    }
    await pb.collection("pages").delete(page.id);
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, { ledgerPage: { ...page, pending: false }, rerun: true }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("deleted");
    expect(rec.saved).toHaveLength(0);
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(0);
  });

  it("unchanged: not a re-run and not pending writes nothing", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const first = await writeTemplatePage(
      ctx,
      registry,
      input(recorder()),
      NO_OWNERS,
    );
    const ledger: LedgerPage = { ...first.page!, pending: false };
    const rec = recorder();
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(rec, { ledgerPage: ledger, rerun: false }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("unchanged");
    expect(res.page).toEqual(ledger);
    expect(rec.saved).toHaveLength(0);
  });

  it("resume: a crash mid-page finishes the same page on the next call (one about page)", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const rec = recorder();
    // The third block is a second hero: refused after two blocks are saved.
    const err = await writeTemplatePage(
      ctx,
      registry,
      input(rec, {
        blocks: [
          { ...hero("Intake secret heading"), band: "main" },
          { ...text("Two"), band: "alternate" },
          { ...hero("Second hero"), band: "main" },
        ],
      }),
      NO_OWNERS,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssemblyStepError);
    expect((err as AssemblyStepError).code).toBe("SECTION_FAILED");
    expect((err as AssemblyStepError).page).toBe("about");
    expect((err as Error).message).toBe("SECTION_FAILED");
    const last = rec.saved.at(-1)!.page;
    expect(last.pending).toBe(true);
    expect((await rawSections(last.id)).length).toBe(2);

    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { ledgerPage: last, rerun: false }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect(res.page!.id).toBe(last.id);
    expect((await rawSections(last.id)).length).toBe(ABOUT.length);
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(1);
  });

  it("CR-A01: a crash after a block write but before its ledger save finishes the page on resume", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const saved: LedgerPage[] = [];
    // The ledger save after block 2 dies: the page holds 2 blocks, the ledger the 1-block print.
    const err = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), {
        savePage: async (p) => {
          if (saved.length === 2) throw new Error("process died");
          saved.push(p);
        },
      }),
      NO_OWNERS,
    ).catch((e: unknown) => e);
    expect((err as Error).message).toBe("process died");
    const last = saved.at(-1)!;
    expect((await rawSections(last.id)).length).toBe(2);
    expect((await readPageDraft(ctx, last.id))!.print).not.toBe(last.print);

    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { ledgerPage: last }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect(res.page!.id).toBe(last.id);
    expect((await rawSections(last.id)).map((r) => r.section_type)).toEqual([
      "hero",
      "text-only",
      "text-only",
    ]);
    expect(await pagesWithSlugPrefix(ctx.orgId, "about")).toHaveLength(1);
  });

  it("CR-A01: every template block present after the last ledger save (replace/publish crash) resumes as created", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const rec = recorder();
    await writeTemplatePage(ctx, registry, input(rec), NO_OWNERS);
    // The ledger only got the empty-page save; every block landed after it.
    const stale = rec.saved[0]!.page;
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { ledgerPage: stale }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("created");
    expect((await rawSections(stale.id)).length).toBe(ABOUT.length);
  });

  it("CR-A01: a first-run page that diverged from the template fails RESUME_DIVERGED and is left alone", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const rec = recorder();
    await writeTemplatePage(ctx, registry, input(rec), NO_OWNERS);
    const oneBlock = rec.saved[1]!.page;
    // Back to one block, then someone else changes it.
    const rows = await rawSections(oneBlock.id);
    for (const r of rows.slice(1)) {
      await pb.collection("page_sections").delete(r.id);
    }
    await saveSection(ctx, registry, {
      id: rows[0]!.id,
      pageId: oneBlock.id,
      ...hero("Someone else"),
    });
    const before = await readPageDraft(ctx, oneBlock.id);
    const res = await writeTemplatePage(
      ctx,
      registry,
      input(recorder(), { ledgerPage: oneBlock }),
      NO_OWNERS,
    ).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(AssemblyStepError);
    expect((res as AssemblyStepError).code).toBe("RESUME_DIVERGED");
    expect((res as AssemblyStepError).page).toBe("about");
    expect((await readPageDraft(ctx, oneBlock.id))!.print).toBe(before!.print);
  });

  it("cross-tenant: org A's context with org B's ledger page id is deleted and B is unchanged", async (t) => {
    if (!inst) return t.skip();
    const before = await rawSections(seed.B.page);
    const bPage = await pb.collection("pages").getOne(seed.B.page);
    const rec = recorder();
    const res = await writeTemplatePage(
      seed.ctxA,
      registry,
      input(rec, {
        ledgerPage: {
          id: seed.B.page,
          slug: String(bPage.slug),
          print: "x",
          pending: true,
          published: false,
        },
        rerun: true,
      }),
      NO_OWNERS,
    );
    expect(res.outcome).toBe("deleted");
    expect(rec.saved).toHaveLength(0);
    const after = await rawSections(seed.B.page);
    expect(after.map((r) => [r.id, r.updated])).toEqual(
      before.map((r) => [r.id, r.updated]),
    );
    expect((await pb.collection("pages").getOne(seed.B.page)).updated).toBe(
      bPage.updated,
    );
  });
});

describe("ensureAssemblyNav / ensureFooterDefaults (08-15 choice 4)", () => {
  it("adds Home and About once by page id and keeps the add-on entry", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const d = deps();
    const book = await createPage(ctx, { title: "Book", slug: "book" });
    await addPageToNav(ctx, d, book.id);
    const home = await createPage(ctx, { title: "Home", slug: "home" });
    const about = await createPage(ctx, { title: "About", slug: "about" });
    const pages = [
      { id: home.id, label: "Home" },
      { id: about.id, label: "About us" },
    ];
    await ensureAssemblyNav(ctx, d, pages);
    await ensureAssemblyNav(ctx, d, pages);
    const nav = await getNav(ctx);
    expect(nav!.items.map((i) => [i.label, i.target])).toEqual([
      ["Book", `page:${book.id}`],
      ["Home", `page:${home.id}`],
      ["About us", `page:${about.id}`],
    ]);
  });

  it("footer defaults only when the footer was never saved", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const d = deps();
    expect(await getFooter(ctx)).toBeNull();
    await ensureFooterDefaults(ctx, d);
    expect(await getFooter(ctx)).toMatchObject({
      show_address: true,
      show_hours: true,
      show_socials: true,
      extra_links: [],
      copyright: "",
    });

    const other = await freshOrg();
    await saveFooter(other, d, {
      show_address: false,
      show_hours: false,
      show_socials: false,
      extra_links: [],
      copyright: "Mine",
    });
    await ensureFooterDefaults(other, d);
    expect(await getFooter(other)).toMatchObject({
      show_address: false,
      show_hours: false,
      show_socials: false,
      copyright: "Mine",
    });
  });

  it("cross-tenant: org B's page id in org A's nav fails and B's nav is unchanged", async (t) => {
    if (!inst) return t.skip();
    const ctx = await freshOrg();
    const navB = await getNav(seed.ctxB);
    const err = await ensureAssemblyNav(ctx, deps(), [
      { id: seed.B.page, label: "Theirs" },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssemblyStepError);
    expect((err as AssemblyStepError).code).toBe("NAV_FAILED");
    expect(await getNav(ctx)).toBeNull();
    expect(await getNav(seed.ctxB)).toEqual(navB);
    expect((await listPages(seed.ctxB)).map((p) => p.id)).toContain(
      seed.B.page,
    );
  });
});
