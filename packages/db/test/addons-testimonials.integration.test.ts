// Testimonials end to end in the chokepoint on the real PocketBase 0.39.11 binary (ADDON-03,
// ADDON-04, ADDON-05, ADDON-06, ADDON-08; D248, D270; T-05-31..34). The first real add-on
// with a collection, so this is the real-database coverage 05-05 deferred: addonRepo saves,
// scanner holds, Show on site re-screening, reorder, declared-collection refusal, visitor
// reads, intake seeding idempotency, grants and cross-tenant reads.
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY, ADDON_SERVER } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { AddonNotActive } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addonRepo } from "../src/addons/addon-repo";
import { standInBillingGate } from "../src/addons/billing";
import {
  installAddon,
  installAddonAsStaff,
  uninstallAddon,
} from "../src/addons/installer";
import { readPublicAddonRecords } from "../src/addons/site-state";
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import {
  deleteSection,
  reorderSections,
  saveSection,
  setSectionHidden,
} from "../src/content/sections";
import { allTenantCollections } from "../src/registry";
import { clearResolverCache } from "../src/resolve";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

const SLUG = "testimonials";
const HELD = "__cds_test_held__";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
let superAdmin: PlatformContext;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

function deps(): AddonDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
} {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons: ADDON_REGISTRY,
    billing: standInBillingGate(),
  };
}

const repoFor = (ctx: OrgContext) =>
  addonRepo(ctx, deps(), SLUG).collection(SLUG);

function member(
  orgId: string,
  actor: string,
  role: "editor" | "viewer",
  grants: string[],
): OrgContext {
  return mintOrgContext({ orgId, actor, role, grants, ip: "127.0.0.1" });
}

async function site(host: string): Promise<SiteContext> {
  clearResolverCache();
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

async function publicIds(host: string): Promise<string[]> {
  return (await readPublicAddonRecords(await site(host), SLUG, SLUG)).map(
    (r) => r.id,
  );
}

async function orgRows(orgId: string): Promise<unknown> {
  const rows: Record<string, unknown> = {};
  for (const name of Object.keys(allTenantCollections())) {
    rows[name] = await pb.collection(name).getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
      sort: "id",
    });
  }
  rows.organizations = await pb.collection("organizations").getOne(orgId);
  return rows;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-testimonials-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  superAdmin = await staffContext(
    inst,
    "testimonials-super@cds.test",
    "super_admin",
  );
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("Testimonials add-on in the chokepoint", () => {
  let clean = "";
  let held = "";

  it("owner install publishes /testimonials with one Testimonials block", async (t) => {
    if (!inst) return t.skip();
    const res = await installAddon(seed.ctxA, deps(), SLUG);
    expect(res.outcome).toBe("installed");
    expect(res.page?.slug).toBe("testimonials");
    const page = await pb.collection("pages").getOne(res.page!.id);
    expect(page.status).toBe("published");
    expect(page.organization).toBe(seed.A.org);
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: res.page!.id }),
    });
    expect(blocks.map((b) => b.section_type)).toEqual(["testimonials"]);
    expect(blocks[0]!.content).toMatchObject({
      heading: "What people say",
      layout: "grid",
      show: "all",
      limit: 6,
    });
  });

  it("a held save is hidden and flagged; a clean save is visible to visitors", async (t) => {
    if (!inst) return t.skip();
    const repo = repoFor(seed.ctxA);
    const bad = await repo.save({
      quote: `Visit ${HELD} now`,
      author_name: "Spam Bot",
      is_published: true,
    });
    expect(bad.held).toBe(true);
    held = bad.id;
    const row = await pb.collection("testimonials").getOne(held);
    expect(row.is_published).toBe(false);
    expect(row.organization).toBe(seed.A.org);
    expect(await repo.openHolds()).toContain(held);

    const good = await repo.save({
      quote: "The best bread in town.",
      author_name: "Maria Lopez",
      author_detail: "Owner, Rivera Bakery",
      featured: true,
    });
    expect(good.held).toBe(false);
    clean = good.id;

    const visible = await publicIds("a.example.com");
    expect(visible).toContain(clean);
    expect(visible).not.toContain(held);
    const pub = await readPublicAddonRecords(
      await site("a.example.com"),
      SLUG,
      SLUG,
    );
    const mine = pub.find((r) => r.id === clean)!;
    // Public fields only (deny by default, T-05-32).
    expect(Object.keys(mine).sort()).toEqual(
      [
        "author_detail",
        "author_name",
        "featured",
        "id",
        "photo_alt",
        "photo_url",
        "quote",
        "rating",
        "sort_order",
      ].sort(),
    );
    // A blank rating is stored as 0 by PocketBase and rendered as no rating.
    const data = ADDON_SERVER[SLUG]!.blockData(
      [
        {
          id: "s1",
          section_type: "testimonials",
          content: { layout: "grid", show: "featured", limit: 6 },
        },
      ],
      { testimonials: pub },
      new Date(),
    ) as Record<string, { id: string; rating: number | null }[]>;
    expect(data.s1!.map((v) => v.id)).toEqual([clean]);
    expect(data.s1![0]!.rating).toBeNull();
  });

  it("switching a held testimonial on re-screens it and it stays off", async (t) => {
    if (!inst) return t.skip();
    const repo = repoFor(seed.ctxA);
    expect(await repo.setPublished(held, true)).toEqual({ held: true });
    expect(
      (await pb.collection("testimonials").getOne(held)).is_published,
    ).toBe(false);
    expect(await publicIds("a.example.com")).not.toContain(held);
    // Switching a clean one off hides it; on shows it again.
    await repo.setPublished(clean, false);
    expect(await publicIds("a.example.com")).not.toContain(clean);
    expect(await repo.setPublished(clean, true)).toEqual({ held: false });
    expect(await publicIds("a.example.com")).toContain(clean);
  });

  it("reorder writes 1..n; a non-permutation is refused", async (t) => {
    if (!inst) return t.skip();
    const repo = repoFor(seed.ctxA);
    const ids = (await repo.list()).map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const reversed = [...ids].reverse();
    await repo.reorder(reversed);
    const after = await repo.list();
    expect(after.map((r) => r.id)).toEqual(reversed);
    expect(after.map((r) => r.sort_order)).toEqual(
      reversed.map((_, i) => i + 1),
    );
    await expect(repo.reorder(reversed.slice(1))).rejects.toThrow(InvalidInput);
    await expect(repo.reorder([...reversed, reversed[0]!])).rejects.toThrow(
      InvalidInput,
    );
    await expect(
      repo.reorder([...reversed.slice(1), seed.B.testimonial]),
    ).rejects.toThrow(InvalidInput);
  });

  it("reaches only its declared collection", async (t) => {
    if (!inst) return t.skip();
    expect(() =>
      addonRepo(seed.ctxA, deps(), SLUG).collection("pages"),
    ).toThrow(InvalidInput);
    expect(() =>
      addonRepo(seed.ctxA, deps(), SLUG).collection("__proto__"),
    ).toThrow(InvalidInput);
  });

  it("uninstall refuses writes, keeps reads; reinstall brings the same records back", async (t) => {
    if (!inst) return t.skip();
    const before = (await repoFor(seed.ctxA).list()).map((r) => r.id);
    expect((await uninstallAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "removed",
    );
    const repo = repoFor(seed.ctxA);
    await expect(
      repo.save({ quote: "More", author_name: "Ann" }),
    ).rejects.toThrow(AddonNotActive);
    await expect(repo.setPublished(clean, false)).rejects.toThrow(
      AddonNotActive,
    );
    await expect(repo.remove(clean)).rejects.toThrow(AddonNotActive);
    expect((await repo.list()).map((r) => r.id)).toEqual(before);
    expect(await publicIds("a.example.com")).toEqual([]);

    expect((await installAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "reinstalled",
    );
    expect((await repoFor(seed.ctxA).list()).map((r) => r.id)).toEqual(before);
    expect(await publicIds("a.example.com")).toContain(clean);
  });

  it("staff intake seeding with one records key runs once (byte-identical rerun)", async (t) => {
    if (!inst) return t.skip();
    const countB = async () =>
      (
        await pb.collection("testimonials").getFullList({
          filter: pb.filter("organization = {:o}", { o: seed.B.org }),
        })
      ).length;
    const start = await countB();
    const input = {
      orgId: seed.B.org,
      slug: SLUG,
      reason: "Site intake",
      recordsKey: "intake-1",
      records: [
        { quote: "Friendly and fast.", author_name: "Ann", rating: 5 },
        { quote: "Would come back.", author_name: "Bo", source: "import" },
      ],
    };
    expect((await installAddonAsStaff(superAdmin, deps(), input)).outcome).toBe(
      "installed",
    );
    expect(await countB()).toBe(start + 2);
    const snap = await orgRows(seed.B.org);
    await installAddonAsStaff(superAdmin, deps(), input);
    expect(await countB()).toBe(start + 2);
    expect(await orgRows(seed.B.org)).toEqual(snap);
  });

  it("a bad record N writes nothing; the retry with the same key seeds once (A-CR-01)", async (t) => {
    if (!inst) return t.skip();
    const countB = async () =>
      (
        await pb.collection("testimonials").getFullList({
          filter: pb.filter("organization = {:o}", { o: seed.B.org }),
          fields: "id",
        })
      ).length;
    const start = await countB();
    const good = [
      { quote: "First.", author_name: "Cy" },
      { quote: "Second.", author_name: "Di" },
    ];
    const input = {
      orgId: seed.B.org,
      slug: SLUG,
      reason: "Site intake",
      recordsKey: "intake-partial",
      records: [...good, { quote: "Third, no name.", author_name: "" }],
    };
    await expect(
      installAddonAsStaff(superAdmin, deps(), input),
    ).rejects.toThrow(/Record 3/);
    expect(await countB()).toBe(start);
    const fixed = {
      ...input,
      records: [...good, { quote: "Third.", author_name: "Ed" }],
    };
    await installAddonAsStaff(superAdmin, deps(), fixed);
    expect(await countB()).toBe(start + 3);
    await installAddonAsStaff(superAdmin, deps(), fixed);
    expect(await countB()).toBe(start + 3);
  });

  it("seeds more than 1100 records in one key and records a count marker (A-CR-01)", async (t) => {
    if (!inst) return t.skip();
    const countB = async () =>
      (
        await pb.collection("testimonials").getFullList({
          filter: pb.filter("organization = {:o}", { o: seed.B.org }),
          fields: "id",
        })
      ).length;
    const start = await countB();
    const records = Array.from({ length: 1200 }, (_, i) => ({
      quote: `Intake quote ${i}.`,
      author_name: `Client ${i}`,
    }));
    const input = {
      orgId: seed.B.org,
      slug: SLUG,
      reason: "Big intake",
      recordsKey: "intake-big",
      records,
    };
    await installAddonAsStaff(superAdmin, deps(), input);
    expect(await countB()).toBe(start + 1200);
    const row = await pb.collection("org_addons").getFirstListItem(
      pb.filter("organization = {:o} && addon = {:a}", {
        o: seed.B.org,
        a: SLUG,
      }),
    );
    const marker = (row.seeded as { records: Record<string, unknown> }).records[
      "intake-big"
    ] as { count: number };
    expect(marker.count).toBe(1200);
    await installAddonAsStaff(superAdmin, deps(), input);
    expect(await countB()).toBe(start + 1200);
  }, 120_000);

  it("an editor needs the testimonials grant; with it they can write", async (t) => {
    if (!inst) return t.skip();
    const plain = member(seed.A.org, seed.A.owner, "editor", []);
    await expect(repoFor(plain).list()).rejects.toThrow(Forbidden);
    await expect(
      repoFor(plain).save({ quote: "Hi", author_name: "Ed" }),
    ).rejects.toThrow(Forbidden);
    const granted = member(seed.A.org, seed.A.owner, "editor", [SLUG]);
    const { id } = await repoFor(granted).save({
      quote: "Granted words.",
      author_name: "Ed",
    });
    expect((await pb.collection("testimonials").getOne(id)).organization).toBe(
      seed.A.org,
    );
    const viewer = member(seed.A.org, seed.A.owner, "viewer", [SLUG]);
    expect((await repoFor(viewer).list()).map((r) => r.id)).toContain(id);
  });

  it("org B cannot read org A's testimonial by id", async (t) => {
    if (!inst) return t.skip();
    await expect(repoFor(seed.ctxB).get(clean)).rejects.toThrow(NotFound);
    await expect(repoFor(seed.ctxB).get("zzzzzzzzzzzzzzz")).rejects.toThrow(
      NotFound,
    );
    expect((await repoFor(seed.ctxB).list()).map((r) => r.id)).not.toContain(
      clean,
    );
    expect(await publicIds("b.example.com")).not.toContain(clean);
  });

  it("the chokepoint refuses an off add-on's block type; hide, reorder and delete stay (T-05-50)", async (t) => {
    if (!inst) return t.skip();
    const [row] = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:o} && addon = {:a}", {
        o: seed.A.org,
        a: SLUG,
      }),
    });
    const pageId = (row!.seeded as { page: { id: string } }).page.id;
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: pageId }),
      sort: "sort_order",
    });
    const block = blocks.find((b) => b.section_type === SLUG)!;
    const input = {
      id: block.id,
      pageId,
      section_type: SLUG,
      row_layout: "full",
      content: { heading: "Edited", layout: "grid", show: "all", limit: 3 },
    };
    // Active: the gate lets the edit through.
    await saveSection(seed.ctxA, sections, input, ADDON_REGISTRY);

    await uninstallAddon(seed.ctxA, deps(), SLUG);
    await expect(
      saveSection(seed.ctxA, sections, input, ADDON_REGISTRY),
    ).rejects.toThrow(AddonNotActive);
    await expect(
      saveSection(seed.ctxA, sections, input, ADDON_REGISTRY),
    ).rejects.toThrow(
      "Testimonials is off, so this block can't be changed. Add Testimonials back to edit it.",
    );
    // A new block of the off type is refused too.
    const { id: _id, ...fresh } = input;
    void _id;
    await expect(
      saveSection(seed.ctxA, sections, fresh, ADDON_REGISTRY),
    ).rejects.toThrow(AddonNotActive);
    // Core blocks on the same page still save.
    const text = await saveSection(
      seed.ctxA,
      sections,
      {
        pageId,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Still editable", text: "<p>x</p>" },
      },
      ADDON_REGISTRY,
    );
    await setSectionHidden(seed.ctxA, block.id, true);
    await reorderSections(seed.ctxA, pageId, [text.id, block.id]);
    await deleteSection(seed.ctxA, block.id);
    await expect(
      pb.collection("page_sections").getOne(block.id),
    ).rejects.toThrow();

    expect((await installAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "reinstalled",
    );
  });
});
