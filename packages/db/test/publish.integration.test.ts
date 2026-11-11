// Publish state machine, versions and restore on the real PocketBase 0.39.11 binary
// (CONT-08, CONT-30, CONT-31; D184, D187, D188, D248, D254; T-03-32..T-03-38).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, NotFound } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  type PublishedPage,
  type SiteManifest,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage, SlugTaken, updatePage } from "../src/content/pages";
import {
  pageTag,
  recordingInvalidator,
  siteTag,
  type ContentScanner,
  type SearchPinger,
} from "../src/content/ports";
import { previewPage } from "../src/content/project";
import {
  listPageVersions,
  publishPage,
  restorePageVersion,
  VERSIONS_KEPT,
  type PublishDeps,
} from "../src/content/publish";
import { deletePopup, savePopup } from "../src/content/popups";
import {
  deleteSection,
  listSections,
  saveSection,
  setSectionHidden,
} from "../src/content/sections";
import { mintOrgContext, type OrgContext } from "../src/context";
import { tenantRepo } from "../src/repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantVersionPrefix,
  type ObjectStore,
} from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

type Recorded = PublishDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
  pings: string[][];
};

function deps(scanner?: ContentScanner): Recorded {
  const pings: string[][] = [];
  const pinger: SearchPinger = {
    ping: (urls) => {
      pings.push(urls);
      return Promise.resolve();
    },
  };
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger,
    pings,
    store,
    ...(scanner ? { scanner } : {}),
  };
}

async function readJson<T>(key: string): Promise<T | null> {
  const bytes = await store.get(key);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
}

async function readText(key: string): Promise<string> {
  const bytes = await store.get(key);
  return bytes ? new TextDecoder().decode(bytes) : "";
}

async function versionKeys(ctx: OrgContext, pageId: string): Promise<string[]> {
  return (await store.list(tenantVersionPrefix(ctx.orgId, pageId))).map(
    (o) => o.key,
  );
}

let slugN = 0;
async function newPage(
  ctx: OrgContext,
  texts: string[] = ["<p>Hello</p>"],
): Promise<string> {
  slugN += 1;
  const page = await createPage(ctx, {
    title: `Page ${slugN}`,
    slug: `page-${slugN}`,
  });
  for (const text of texts) {
    await saveSection(ctx, registry, {
      pageId: page.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Heading", text },
    });
  }
  return page.id;
}

function viewerA(): OrgContext {
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.A.owner,
    role: "viewer",
    grants: [],
    ip: IP,
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-publish-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // 11-26 (DASH-08): this suite creates many pages in org A; give it room past the
  // 10-page allowance so the publish cases test publishing, not the limit.
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

/**
 * 14-21 (CONT-16): pings reach the pinger only for a live org (the eligibility guard), and the
 * seeded orgs have an empty stage. Make org A live for one test; restored when it ends.
 */
async function liveForTest(orgId: string): Promise<void> {
  await pb.collection("organizations").update(orgId, { stage: "live" });
  onTestFinished(async () => {
    await pb.collection("organizations").update(orgId, { stage: "" });
  });
}

describe("publishPage (CONT-30, CONT-31)", () => {
  it("writes config only JSON: hidden blocks omitted, settings reduced, manifest entry", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = seed.A.page; // home, one seeded text-only row
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "50-50",
      content: { heading: "Second", text: "<p>two</p><script>x</script>" },
      settings: { background_variant: "alternate", bg_color: "#f00" },
    });
    const hidden = await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Hidden draft" },
    });
    await setSectionHidden(ctx, hidden.id, true);

    const res = await publishPage(ctx, pageId, deps());
    expect(res.status).toBe("published");

    const json = await readJson<PublishedPage>(
      tenantPublishedPageKey(ctx.orgId, pageId),
    );
    expect(json).not.toBeNull();
    expect(json!.version).toBe(1);
    expect(json!.sections).toHaveLength(2);
    expect(json!.sections.map((s) => s.id)).not.toContain(hidden.id);
    for (const s of json!.sections) {
      expect(Object.keys(s).sort()).toEqual(
        ["content", "id", "row_layout", "section_type", "settings"].sort(),
      );
      expect(Object.keys(s.settings)).toEqual(["background_variant"]);
      expect(s.row_layout).toBe("full");
    }
    expect(json!.sections[1]!.settings.background_variant).toBe("alternate");
    expect(JSON.stringify(json)).not.toContain("<script");
    expect(Object.keys(json!.page).sort()).toEqual(
      ["id", "password_protected", "seo", "slug", "title"].sort(),
    );

    const manifest = await readJson<SiteManifest>(
      tenantSiteManifestKey(ctx.orgId),
    );
    expect(manifest!.pages.home).toEqual({
      id: pageId,
      title: "Home",
      published_at: res.status === "published" ? res.published_at : "",
      protected: false,
    });

    const row = await pb.collection("pages").getOne(pageId);
    expect(row.status).toBe("published");
    expect(row.has_unpublished_changes).toBe(false);
    expect(row.published_at).toBeTruthy();
  });

  it("version JSON sits under versions/pages/<pid>/ and never holds password_hash", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    await pb
      .collection("pages")
      .update(pageId, { password_hash: "$2a$10$secret-hash-value" });
    const res = await publishPage(ctx, pageId, deps());
    if (res.status !== "published") throw new Error("expected published");
    expect(
      res.versionKey.startsWith(tenantVersionPrefix(ctx.orgId, pageId)),
    ).toBe(true);
    expect(res.versionKey).toContain(`/versions/pages/${pageId}/`);
    const text = await readText(res.versionKey);
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("secret-hash-value");
    const published = await readText(tenantPublishedPageKey(ctx.orgId, pageId));
    expect(published).not.toContain("password_hash");
    expect(published).not.toContain("secret-hash-value");
    const version = JSON.parse(text) as { page: object; sections: object[] };
    expect(version.sections).toHaveLength(1);
    expect(Object.keys(version.page)).toContain("password_protected");
  });

  it("tenantRepo reads of pages never return password_hash (WR-A01)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    await pb
      .collection("pages")
      .update(pageId, { password_hash: "$2a$10$repo-read-hash" });
    const one = await tenantRepo("pages").get(viewerA(), pageId);
    expect(one.id).toBe(pageId);
    expect(one.title).toBeTruthy();
    expect(Object.keys(one)).not.toContain("password_hash");
    const list = await tenantRepo("pages").list(viewerA(), { perPage: 500 });
    expect(list.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.items)).not.toContain("password_hash");
    expect(JSON.stringify(list.items)).not.toContain("repo-read-hash");
  });

  it("a page with a password hash or the protected flag is protected in the manifest", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const hashed = await newPage(ctx);
    await pb.collection("pages").update(hashed, { password_hash: "h" });
    const flagged = await newPage(ctx);
    // A restored page has the flag and no hash (03-03): still protected (fail closed).
    await pb.collection("pages").update(flagged, { password_protected: true });
    await publishPage(ctx, hashed, deps());
    await publishPage(ctx, flagged, deps());
    const manifest = await readJson<SiteManifest>(
      tenantSiteManifestKey(ctx.orgId),
    );
    const entries = Object.values(manifest!.pages);
    expect(entries.find((e) => e.id === hashed)!.protected).toBe(true);
    expect(entries.find((e) => e.id === flagged)!.protected).toBe(true);
  });

  it("12 publishes keep exactly the newest 10 versions", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    const keys: string[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await publishPage(ctx, pageId, deps());
      if (res.status === "published") keys.push(res.versionKey);
    }
    const stored = await versionKeys(ctx, pageId);
    expect(stored).toHaveLength(10);
    expect(stored).not.toContain(keys[0]);
    expect(stored).not.toContain(keys[1]);
    const listed = await listPageVersions(ctx, pageId, store);
    expect(listed).toHaveLength(10);
    expect(keys[11]!.endsWith(`/${listed[0]!.id}.json`)).toBe(true);
    expect(Date.parse(listed[0]!.at)).toBeGreaterThanOrEqual(
      Date.parse(listed[9]!.at),
    );
  });

  it("a publish that fails after the version write keeps the 10 real versions (WR-A07)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    for (let i = 0; i < VERSIONS_KEPT; i++)
      await publishPage(ctx, pageId, deps());
    const before = (await versionKeys(ctx, pageId)).sort();
    expect(before).toHaveLength(VERSIONS_KEPT);
    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const failing: ObjectStore = {
      ...store,
      get: (k) => store.get(k),
      list: (p) => store.list(p),
      delete: (k) => store.delete(k),
      put: (k, b, c) =>
        k === manifestKey
          ? Promise.reject(new Error("store down"))
          : store.put(k, b, c),
    };
    await expect(
      publishPage(ctx, pageId, { ...deps(), store: failing }),
    ).rejects.toThrow("store down");
    expect((await versionKeys(ctx, pageId)).sort()).toEqual(before);
  });

  it("an impersonated publish commits with its audit row; a throwing invalidator does not fail it (WR-A04)", async (t) => {
    if (!inst) return t.skip();
    const ctx = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.B.owner,
      role: "owner",
      grants: [],
      impersonator: seed.B.owner,
      ip: "10.0.0.9",
    });
    const pageId = await newPage(seed.ctxA);
    const d = deps();
    d.invalidator = {
      tags: [],
      invalidate: () => {
        throw new Error("next cache down");
      },
    } as unknown as Recorded["invalidator"];
    const res = await publishPage(ctx, pageId, d);
    expect(res.status).toBe("published");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.publish' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.impersonator).toBe(seed.B.owner);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe(
      "published",
    );
  });

  it("a publish that fails before the DB commit puts the live site back (WR-A04)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>first live</p>"]);
    await publishPage(ctx, pageId, deps());
    const pageKey = tenantPublishedPageKey(ctx.orgId, pageId);
    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const liveBefore = await readText(pageKey);
    const manifestBefore = await readText(manifestKey);
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Second", text: "<p>second draft</p>" },
    });
    // The page row is gone from under the publish: the DB batch fails after the store
    // writes, so both objects must be put back as they were.
    const failing: ObjectStore = {
      get: (k) => store.get(k),
      list: (p) => store.list(p),
      delete: (k) => store.delete(k),
      put: async (k, b, c) => {
        await store.put(k, b, c);
        if (k === manifestKey) {
          const rows = await pb.collection("page_sections").getFullList({
            filter: pb.filter("page = {:p}", { p: pageId }),
          });
          for (const r of rows)
            await pb.collection("page_sections").delete(r.id);
          await pb.collection("pages").delete(pageId);
        }
      },
    };
    const auditBefore = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.publish' && target_id = {:id}", {
        id: pageId,
      }),
    });
    await expect(
      publishPage(ctx, pageId, { ...deps(), store: failing }),
    ).rejects.toThrow();
    expect(await readText(pageKey)).toBe(liveBefore);
    expect(await readText(manifestKey)).toBe(manifestBefore);
    const auditAfter = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.publish' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(auditAfter).toHaveLength(auditBefore.length);
  });

  it("an unsure publish that fails before the DB commit leaves no flag (IN-R06)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>Maybe __cds_test_unsure__</p>"]);
    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const failing: ObjectStore = {
      get: (k) => store.get(k),
      list: (p) => store.list(p),
      delete: (k) => store.delete(k),
      put: async (k, b, c) => {
        await store.put(k, b, c);
        if (k === manifestKey) {
          const rows = await pb.collection("page_sections").getFullList({
            filter: pb.filter("page = {:p}", { p: pageId }),
          });
          for (const r of rows)
            await pb.collection("page_sections").delete(r.id);
          await pb.collection("pages").delete(pageId);
        }
      },
    };
    await expect(
      publishPage(ctx, pageId, { ...deps(), store: failing }),
    ).rejects.toThrow();
    const flags = await pb.collection("content_flags").getFullList({
      filter: pb.filter("target_id = {:id}", { id: pageId }),
    });
    expect(flags).toHaveLength(0);
  });

  it("a save between publishes writes no version (D254)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    await publishPage(ctx, pageId, deps());
    expect(await versionKeys(ctx, pageId)).toHaveLength(1);
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Added" },
    });
    await updatePage(ctx, pageId, { title: "Renamed" });
    expect(await versionKeys(ctx, pageId)).toHaveLength(1);
    const row = await pb.collection("pages").getOne(pageId);
    expect(row.has_unpublished_changes).toBe(true);
  });

  it("a held scan stops publish: status held, nothing written, a held flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>Buy __cds_test_held__ now</p>"]);
    const d = deps();
    const res = await publishPage(ctx, pageId, d);
    expect(res.status).toBe("held");
    const row = await pb.collection("pages").getOne(pageId);
    expect(row.status).toBe("held");
    expect(
      await store.get(tenantPublishedPageKey(ctx.orgId, pageId)),
    ).toBeNull();
    expect(await versionKeys(ctx, pageId)).toHaveLength(0);
    expect(d.invalidator.tags).toHaveLength(0);
    const flags = await pb.collection("content_flags").getFullList({
      filter: pb.filter("target_id = {:id}", { id: pageId }),
    });
    expect(flags.map((f) => f.verdict)).toEqual(["held"]);
    expect(flags[0]!.organization).toBe(ctx.orgId);
  });

  it("an unsure scan publishes and writes a flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>Maybe __cds_test_unsure__</p>"]);
    const res = await publishPage(ctx, pageId, deps());
    expect(res.status).toBe("published");
    if (res.status === "published") expect(res.flagged).toBe(true);
    const flags = await pb.collection("content_flags").getFullList({
      filter: pb.filter("target_id = {:id}", { id: pageId }),
    });
    expect(flags.map((f) => f.verdict)).toEqual(["unsure"]);
  });

  it("a scanner that throws publishes, flagged with verdict error (D248)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    const broken: ContentScanner = {
      scan: () => Promise.reject(new Error("scanner down")),
    };
    const res = await publishPage(ctx, pageId, deps(broken));
    expect(res.status).toBe("published");
    if (res.status === "published") expect(res.flagged).toBe(true);
    const flags = await pb.collection("content_flags").getFullList({
      filter: pb.filter("target_id = {:id}", { id: pageId }),
    });
    expect(flags.map((f) => f.verdict)).toEqual(["error"]);
  });

  it("the scanner sees plain text of title and blocks", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>Rich <strong>words</strong></p>"]);
    const seen: string[][] = [];
    const spy: ContentScanner = {
      scan: (input) => {
        seen.push(input.texts);
        return Promise.resolve({ verdict: "clean", reasons: [] });
      },
    };
    await publishPage(ctx, pageId, deps(spy));
    expect(seen[0]).toContain("Rich words");
    expect(seen[0]!.some((s) => s.startsWith("Page "))).toBe(true);
    expect(seen[0]!.join(" ")).not.toContain("<");
  });

  it("invalidates page + site tags, pings once and audits page.publish", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    await liveForTest(ctx.orgId);
    const pageId = await newPage(ctx);
    const d = deps();
    await publishPage(ctx, pageId, d);
    expect(d.invalidator.tags).toEqual([
      pageTag(ctx.orgId, pageId),
      siteTag(ctx.orgId),
    ]);
    expect(d.pings).toHaveLength(1);
    expect(d.pings[0]).toHaveLength(1);
    const page = await pb.collection("pages").getOne(pageId);
    expect(d.pings[0]![0]).toBe(`https://a.example.com/${String(page.slug)}`);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.publish' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(ctx.orgId);
  });

  it("a published slug change adds a redirect and previous_slugs (D188)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const page = await createPage(ctx, { title: "About", slug: "about" });
    await publishPage(ctx, page.id, deps());
    await updatePage(ctx, page.id, { slug: "about-us" });
    await publishPage(ctx, page.id, deps());
    const manifest = await readJson<SiteManifest>(
      tenantSiteManifestKey(ctx.orgId),
    );
    expect(manifest!.pages["about-us"]!.id).toBe(page.id);
    expect(manifest!.pages.about).toBeUndefined();
    expect(manifest!.redirects.about).toBe("about-us");
    const row = await pb.collection("pages").getOne(page.id);
    expect(row.previous_slugs).toContain("about");
  });

  it("a slug still live for another page cannot be taken by create, update or publish (CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const a = await createPage(ctx, { title: "Live A", slug: "live-a" });
    await publishPage(ctx, a.id, deps());
    // A draft rename frees the DB slug; the manifest still serves /live-a as page A.
    await updatePage(ctx, a.id, { slug: "live-a-renamed" });
    await expect(
      createPage(ctx, { title: "B", slug: "live-a" }),
    ).rejects.toThrow(SlugTaken);
    const c = await createPage(ctx, { title: "C", slug: "live-a-c" });
    await expect(updatePage(ctx, c.id, { slug: "live-a" })).rejects.toThrow(
      SlugTaken,
    );
    // The DB check is bypassed (a stale writer, a restore): publish itself refuses and
    // writes nothing, so page A stays live.
    await pb.collection("pages").update(c.id, { slug: "live-a" });
    await expect(publishPage(ctx, c.id, deps())).rejects.toThrow(SlugTaken);
    const manifest = await readJson<SiteManifest>(
      tenantSiteManifestKey(ctx.orgId),
    );
    expect(manifest!.pages["live-a"]!.id).toBe(a.id);
    expect(await versionKeys(ctx, c.id)).toHaveLength(0);
    expect(await store.get(tenantPublishedPageKey(ctx.orgId, c.id))).toBeNull();
    // Page A may take its own live slug back.
    await pb.collection("pages").update(c.id, { slug: "live-a-c" });
    await updatePage(ctx, a.id, { slug: "live-a" });
    const back = await publishPage(ctx, a.id, deps());
    expect(back.status).toBe("published");
  });

  it("a manifest entry for a page that no longer exists does not hold its slug", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const key = tenantSiteManifestKey(ctx.orgId);
    const manifest = await readJson<SiteManifest>(key);
    const next: SiteManifest = manifest ?? {
      version: 1,
      pages: {},
      redirects: {},
      updated_at: new Date().toISOString(),
    };
    next.pages["orphan-slug"] = {
      id: "zzzzzzzzzzzzzzz",
      title: "Gone",
      published_at: "",
      protected: false,
    };
    await store.put(key, JSON.stringify(next), "application/json");
    const page = await createPage(ctx, { title: "O", slug: "orphan-slug" });
    const res = await publishPage(ctx, page.id, deps());
    expect(res.status).toBe("published");
  });

  it("previewPage shows the draft with hidden blocks omitted (CONT-08)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>one</p>", "<p>two</p>"]);
    const rows = await listSections(ctx, pageId);
    await setSectionHidden(ctx, rows[0]!.id, true);
    const preview = await previewPage(viewerA(), pageId, registry);
    expect(preview.sections.map((s) => s.id)).toEqual([rows[1]!.id]);
    await expect(previewPage(seed.ctxB, pageId, registry)).rejects.toThrow(
      NotFound,
    );
  });
});

describe("restorePageVersion (D184)", () => {
  it("replaces the draft from a version and publishes a new version", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>first</p>", "<p>second</p>"]);
    const first = await publishPage(ctx, pageId, deps());
    if (first.status !== "published") throw new Error("expected published");
    const before = await listSections(ctx, pageId);
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Later" },
    });
    await setSectionHidden(ctx, before[0]!.id, true);
    await publishPage(ctx, pageId, deps());

    const res = await restorePageVersion(ctx, pageId, first.versionKey, deps());
    expect(res.status).toBe("published");
    if (res.status === "published") {
      expect(res.versionKey).not.toBe(first.versionKey);
    }
    expect(await versionKeys(ctx, pageId)).toHaveLength(3);
    const after = await listSections(ctx, pageId);
    const shape = (rows: typeof after) =>
      rows.map((r) => ({
        section_type: r.section_type,
        content: r.content,
        sort_order: r.sort_order,
        is_published: r.is_published,
      }));
    expect(shape(after)).toEqual(shape(before));
    for (const r of after) {
      expect(before.map((b) => b.id)).not.toContain(r.id);
      const raw = await pb.collection("page_sections").getOne(r.id);
      expect(raw.organization).toBe(ctx.orgId);
      expect(raw.page).toBe(pageId);
    }
    const row = await pb.collection("pages").getOne(pageId);
    expect(row.status).toBe("published");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.restore' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(audit).toHaveLength(1);
  });

  it("restore brings back a pop-up the version uses", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const d = deps();
    const { popup } = await savePopup(ctx, d, {
      name: "Gone soon",
      trigger: "delay",
      delay_seconds: 5,
      frequency: "once-per-visitor",
      show_on: "all-pages",
      enabled: true,
      content: { items: [{ id: "t1", kind: "text", html: "<p>Hi</p>" }] },
    });
    const pageId = await newPage(ctx);
    const button = await saveSection(ctx, registry, {
      pageId,
      section_type: "columns",
      row_layout: "full",
      content: {
        columns: [
          {
            id: "col1",
            items: [
              {
                id: "btn1",
                kind: "button",
                text: "Open",
                link: "",
                style: "primary",
                action: "popup",
                popup_id: popup.id,
              },
            ],
          },
        ],
      },
    });
    const v1 = await publishPage(ctx, pageId, d);
    if (v1.status !== "published") throw new Error("expected published");
    // 1. remove the button, 2. publish, 3. delete the pop-up, 4. restore v1.
    await deleteSection(ctx, button.id);
    await publishPage(ctx, pageId, d);
    // v1 is a kept version, so the delete is soft (07-28, D275).
    expect(await deletePopup(ctx, d, popup.id)).toEqual({ outcome: "soft" });
    const res = await restorePageVersion(ctx, pageId, v1.versionKey, d);
    expect(res.status).toBe("published");
    expect((await pb.collection("popups").getOne(popup.id)).deleted_at).toBe(
      "",
    );
    // A pop-up removed outright (no row): the restore still succeeds, the button keeps
    // its dangling id.
    await pb.collection("popups").delete(popup.id);
    const again = await restorePageVersion(ctx, pageId, v1.versionKey, d);
    expect(again.status).toBe("published");
    const rows = await listSections(ctx, pageId);
    expect(rows.some((r) => JSON.stringify(r.content).includes(popup.id))).toBe(
      true,
    );
  });

  it("a restore whose publish would take a live slug is refused, draft untouched (IN-R07)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const a = await createPage(ctx, { title: "Held A", slug: "held-slug" });
    await publishPage(ctx, a.id, deps());
    await updatePage(ctx, a.id, { slug: "held-slug-renamed" });
    const pageId = await newPage(ctx, ["<p>version one</p>"]);
    const first = await publishPage(ctx, pageId, deps());
    if (first.status !== "published") throw new Error("expected published");
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Draft only" },
    });
    // A stale writer put this page on the slug page A still serves live.
    await pb.collection("pages").update(pageId, { slug: "held-slug" });
    const before = (await listSections(ctx, pageId)).map((r) => r.id);

    await expect(
      restorePageVersion(ctx, pageId, first.versionKey, deps()),
    ).rejects.toThrow(SlugTaken);
    expect((await listSections(ctx, pageId)).map((r) => r.id)).toEqual(before);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.restore' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(audit).toHaveLength(0);
    await updatePage(ctx, a.id, { slug: "held-slug-a" });
  });

  it("a version key outside the caller's own prefix is NotFound (T-03-35)", async (t) => {
    if (!inst) return t.skip();
    const pageB = await newPage(seed.ctxB);
    const resB = await publishPage(seed.ctxB, pageB, deps());
    if (resB.status !== "published") throw new Error("expected published");
    const pageA = await newPage(seed.ctxA);
    const resA = await publishPage(seed.ctxA, pageA, deps());
    if (resA.status !== "published") throw new Error("expected published");
    // Org B's key against org A's page.
    await expect(
      restorePageVersion(seed.ctxA, pageA, resB.versionKey, deps()),
    ).rejects.toThrow(NotFound);
    // Another page's key of the same org.
    const other = await newPage(seed.ctxA);
    await expect(
      restorePageVersion(seed.ctxA, other, resA.versionKey, deps()),
    ).rejects.toThrow(NotFound);
    // Traversal-shaped key.
    await expect(
      restorePageVersion(
        seed.ctxA,
        pageA,
        `${tenantVersionPrefix(seed.A.org, pageA)}../../x.json`,
        deps(),
      ),
    ).rejects.toThrow(NotFound);
    // Org B cannot restore onto org A's page with a key built for it.
    await expect(
      restorePageVersion(seed.ctxB, pageA, resA.versionKey, deps()),
    ).rejects.toThrow(NotFound);
  });
});

describe("page version history (DASH-07, D184, D254)", () => {
  function ctxWith(extra: {
    impersonator?: string;
    systemJob?: string;
    role?: "owner" | "viewer";
  }): OrgContext {
    return mintOrgContext({
      orgId: seed.A.org,
      actor: extra.systemJob ? "" : seed.A.owner,
      role: extra.role ?? "owner",
      grants: [],
      ip: IP,
      ...(extra.impersonator ? { impersonator: extra.impersonator } : {}),
      ...(extra.systemJob ? { systemJob: extra.systemJob } : {}),
    });
  }

  it("records who published: member, assembly, support, earlier", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("users").update(seed.A.owner, { name: "Maria Rivera" });
    const pageId = await newPage(seed.ctxA);
    await publishPage(ctxWith({ systemJob: "assembly" }), pageId, deps());
    await publishPage(ctxWith({ impersonator: seed.B.owner }), pageId, deps());
    await publishPage(seed.ctxA, pageId, deps());
    const listed = await listPageVersions(seed.ctxA, pageId, store);
    expect(listed).toHaveLength(3);
    expect(listed.map((v) => v.who)).toEqual([
      { kind: "member", name: "Maria Rivera" },
      { kind: "support" },
      { kind: "assembly" },
    ]);
    expect(listed.map((v) => v.current)).toEqual([true, false, false]);
    for (const v of listed) {
      expect(v).not.toHaveProperty("key");
      expect(v.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    }
    // A version written before authorship (no `by`) reads as "earlier".
    const keys = (await versionKeys(seed.ctxA, pageId)).sort();
    const oldest = keys[0]!;
    const raw = await readJson<Record<string, unknown>>(oldest);
    delete raw!.by;
    await store.put(oldest, JSON.stringify(raw), "application/json");
    const again = await listPageVersions(seed.ctxA, pageId, store);
    expect(again[2]!.who).toEqual({ kind: "earlier" });
  });

  it("a member no longer in the org reads as former", async (t) => {
    if (!inst) return t.skip();
    const pageId = await newPage(seed.ctxA);
    await publishPage(
      mintOrgContext({
        orgId: seed.A.org,
        actor: seed.B.owner,
        role: "owner",
        grants: [],
        ip: IP,
      }),
      pageId,
      deps(),
    );
    const [v] = await listPageVersions(seed.ctxA, pageId, store);
    expect(v!.who).toEqual({ kind: "former" });
  });

  it("restore by id publishes the old content as a new current version, capped at 10", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, ["<p>v-one</p>"]);
    await publishPage(ctx, pageId, deps());
    const [row] = await listSections(ctx, pageId);
    for (let i = 2; i <= VERSIONS_KEPT; i++) {
      await saveSection(ctx, registry, {
        id: row!.id,
        pageId,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Heading", text: `<p>v-${i}</p>` },
      });
      await publishPage(ctx, pageId, deps());
    }
    const before = await listPageVersions(ctx, pageId, store);
    expect(before).toHaveLength(VERSIONS_KEPT);
    const oldest = before[VERSIONS_KEPT - 1]!;
    const head = await restorePageVersion(ctx, pageId, oldest.id, deps());
    expect(head.status).toBe("published");
    const after = await listPageVersions(ctx, pageId, store);
    expect(after).toHaveLength(VERSIONS_KEPT);
    expect(after[0]!.current).toBe(true);
    expect(after.filter((v) => v.current)).toHaveLength(1);
    if (head.status === "published") {
      expect(head.versionId).toBe(after[0]!.id);
    }
    const rows = await listSections(ctx, pageId);
    expect(JSON.stringify(rows.map((r) => r.content))).toContain("v-one");
    // The pruned one is the old oldest: the restored id is gone, its content lives on.
    expect(after.map((v) => v.id)).not.toContain(oldest.id);
  });

  it("a foreign or malformed id is NotFound; a viewer restoring is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const pageA = await newPage(seed.ctxA);
    await publishPage(seed.ctxA, pageA, deps());
    const pageB = await newPage(seed.ctxB);
    await publishPage(seed.ctxB, pageB, deps());
    const [vA] = await listPageVersions(seed.ctxA, pageA, store);
    const [vB] = await listPageVersions(seed.ctxB, pageB, store);
    await expect(
      restorePageVersion(seed.ctxA, pageA, vB!.id, deps()),
    ).rejects.toThrow(NotFound);
    for (const bad of ["../x", "2026-13-01T00-00-00-000Z", "", "abc"]) {
      await expect(
        restorePageVersion(seed.ctxA, pageA, bad, deps()),
      ).rejects.toThrow(NotFound);
    }
    await expect(
      restorePageVersion(seed.ctxB, pageA, vA!.id, deps()),
    ).rejects.toThrow(NotFound);
    await expect(
      restorePageVersion(viewerA(), pageA, vA!.id, deps()),
    ).rejects.toThrow(Forbidden);
    // Viewers can read the history.
    expect(await listPageVersions(viewerA(), pageA, store)).toHaveLength(1);
  });

  it("saving a draft writes no version", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx);
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Draft" },
    });
    expect(await versionKeys(ctx, pageId)).toHaveLength(0);
    expect(await listPageVersions(ctx, pageId, store)).toEqual([]);
  });
});

describe("publish authorization and isolation", () => {
  it("a viewer is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const pageId = await newPage(seed.ctxA);
    await expect(publishPage(viewerA(), pageId, deps())).rejects.toThrow(
      Forbidden,
    );
  });

  it("org B publishing org A's page is NotFound", async (t) => {
    if (!inst) return t.skip();
    const pageId = await newPage(seed.ctxA);
    await expect(publishPage(seed.ctxB, pageId, deps())).rejects.toThrow(
      NotFound,
    );
    await expect(listPageVersions(seed.ctxB, pageId, store)).rejects.toThrow(
      NotFound,
    );
    const row = await pb.collection("pages").getOne(pageId);
    expect(row.status).toBe("draft");
  });

  it("two concurrent publishes in one org both land in the manifest (T-03-34)", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const p1 = await newPage(ctx);
    const p2 = await newPage(ctx);
    await Promise.all([
      publishPage(ctx, p1, deps()),
      publishPage(ctx, p2, deps()),
    ]);
    const manifest = await readJson<SiteManifest>(
      tenantSiteManifestKey(ctx.orgId),
    );
    const ids = Object.values(manifest!.pages).map((e) => e.id);
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);
  });
});
