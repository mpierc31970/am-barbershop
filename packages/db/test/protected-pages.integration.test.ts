// Protected pages + the system 404 page on the real PocketBase 0.39.11 binary (07-32;
// CONT-28, CONT-33; D235 #11/#12, D255, D187, D-UI-P7-14; invariant 1; T-07-32-01..09).
//
// Live on save (manifest + row in step, cookies invalidated by the version bump), the
// per-request gate read, the limiter, the 404 page's identity and exclusions, menu removal
// with a history snapshot, and that no hash or version leaks into any snapshot.
import "@cds/addon-registry/server";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { parseSiteIndex } from "@cds/core/seo";
import type PocketBase from "pocketbase";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  addPageToNav,
  removePageFromNav,
  saveNav,
} from "../src/content/chrome";
import { listSiteSettingsVersions } from "../src/content/history";
import {
  createPage,
  listPages,
  SlugReserved,
  updatePage,
} from "../src/content/pages";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import {
  ensureNotFoundPage,
  GateRateLimited,
  getNotFoundPage,
  readPageGate,
  setPagePassword,
  verifyPagePassword,
  WrongPagePassword,
} from "../src/content/protected";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import { exportTenant } from "../src/export";
import { resetPageGateLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import {
  tenantPublishedPageKey,
  tenantSiteIndexKey,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedMediaRow } from "./media-seed";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const commitFail = vi.hoisted(() => ({ on: false }));
vi.mock("../src/content/shared", async (orig) => {
  const mod = await orig<typeof import("../src/content/shared")>();
  return {
    ...mod,
    commit: (...args: Parameters<typeof mod.commit>) => {
      const ops = args[2];
      if (
        commitFail.on &&
        ops.some(
          (o) =>
            o.collection === "pages" &&
            "body" in o &&
            "password_version" in o.body,
        )
      ) {
        return Promise.reject(new Error("commit failed"));
      }
      return mod.commit(...args);
    },
  };
});

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };
const CLEAN = {
  scan: () => Promise.resolve({ verdict: "clean" as const, reasons: [] }),
};

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(over: Partial<PublishDeps> = {}): PublishDeps & ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: CLEAN,
    store,
    ...over,
  };
}

let n = 0;
async function bareOrg(): Promise<{
  org: string;
  ctx: OrgContext;
  host: string;
  site: () => Promise<SiteContext>;
}> {
  n += 1;
  const tag = `${n}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Gate ${tag}`,
      slug: `gate-${tag}`,
      status: "active",
    })
  ).id;
  const host = `gate-${tag}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  const ctx = mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
  return {
    org,
    host,
    ctx,
    site: async () => {
      clearResolverCache();
      const s = await siteContextForHost(host);
      if (!s) throw new Error("no site");
      return s;
    },
  };
}

async function page(
  ctx: OrgContext,
  title: string,
  slug: string,
  text: string,
  publish = true,
): Promise<string> {
  const p = await createPage(ctx, { title, slug });
  await saveSection(
    ctx,
    registry,
    {
      pageId: p.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: title, text: `<p>${text}</p>` },
    },
    NO_OWNERS,
  );
  if (publish) await publishPage(ctx, p.id, deps());
  return p.id;
}

async function manifestOf(org: string) {
  const bytes = await store.get(tenantSiteManifestKey(org));
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    pages: Record<string, { id: string; protected: boolean }>;
  };
}

async function indexPaths(org: string): Promise<string[]> {
  const bytes = await store.get(tenantSiteIndexKey(org));
  if (!bytes) return [];
  const idx = parseSiteIndex(JSON.parse(new TextDecoder().decode(bytes)));
  return idx ? idx.pages.map((p) => p.path) : [];
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-protected-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = new LocalDiskStore(storageDir);
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

beforeEach(() => {
  clearResolverCache();
  resetPageGateLimitsForTests();
  commitFail.on = false;
});

describe("setPagePassword: live on save", () => {
  it("protects a published page at once, then clears it", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await page(ctx, "Home", "home", "Welcome.");
    const id = await page(ctx, "Members", "members", "quincewordzz inside.");
    const media = await seedMediaRow(org);
    await updatePage(ctx, id, { seo: { share_image: media } });
    await publishPage(ctx, id, deps());
    const before = await pb.collection("pages").getOne(id);
    expect(before.has_unpublished_changes).toBe(false);
    expect(await indexPaths(org)).toContain("/members");

    const imp = mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
      impersonator: seed.B.owner,
    });
    const inv = recordingInvalidator();
    // WR-C04: note, at each site-tag invalidation, whether index.json still lists the page.
    const indexFile = join(storageDir, tenantSiteIndexKey(org));
    const listedAtSiteTag: boolean[] = [];
    const recordInvalidate = inv.invalidate.bind(inv);
    inv.invalidate = (tags: string[]) => {
      if (tags.includes(`org:${org}:site`)) {
        listedAtSiteTag.push(
          existsSync(indexFile) &&
            readFileSync(indexFile, "utf8").includes("/members"),
        );
      }
      recordInvalidate(tags);
    };
    const refresh = vi.fn(
      (await import("../src/content/site-index/build")).refreshSiteIndex,
    );
    const summary = await setPagePassword(
      imp,
      id,
      { password: "sourdough1" },
      { ...deps(), invalidator: inv, refreshIndex: refresh },
    );
    expect(summary.password_protected).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("scrypt");
    const row = await pb.collection("pages").getOne(id);
    expect(row.password_protected).toBe(true);
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_version).toBe(
      (Number(before.password_version) || 0) + 1,
    );
    expect(row.has_unpublished_changes).toBe(false);
    expect((await manifestOf(org))!.pages.members!.protected).toBe(true);
    expect(inv.tags).toEqual(
      expect.arrayContaining([
        `org:${org}:site`,
        `org:${org}:page:${id}`,
        `org:${org}:live`,
      ]),
    );
    expect(refresh).toHaveBeenCalledWith(org, expect.anything());
    expect(await indexPaths(org)).not.toContain("/members");
    // The last site-tag invalidation comes after index.json dropped the page (WR-C04).
    expect(listedAtSiteTag.at(-1)).toBe(false);
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:org} && action = 'pages.password'", {
        org,
      }),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toEqual({ protected: true });

    // clear: flag + hash gone, version bumped, manifest false, media promoted
    const promoted: string[] = [];
    await setPagePassword(
      ctx,
      id,
      { password: null },
      {
        ...deps(),
        promote: (_c, ids) => {
          promoted.push(...ids);
          return Promise.resolve({ promoted: [] });
        },
      },
    );
    const cleared = await pb.collection("pages").getOne(id);
    expect(cleared.password_protected).toBe(false);
    expect(cleared.password_hash).toBe("");
    expect(cleared.password_version).toBe(row.password_version + 1);
    expect((await manifestOf(org))!.pages.members!.protected).toBe(false);
    expect(promoted).toContain(media);
    expect(await indexPaths(org)).toContain("/members");
  });

  it("protecting a published page takes back media public only because of it (WR-A09)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await page(ctx, "Home", "home", "Welcome.");
    const at = "2026-10-01 10:00:00.000Z";
    const solo = await seedMediaRow(org, { public_at: at });
    const shared = await seedMediaRow(org, { public_at: at });
    const members = await page(ctx, "Members", "members", "Inside.", false);
    await updatePage(ctx, members, { seo: { share_image: solo } });
    await publishPage(ctx, members, deps());
    const vip = await page(ctx, "VIP", "vip", "Inside too.", false);
    await updatePage(ctx, vip, { seo: { share_image: shared } });
    await publishPage(ctx, vip, deps());
    const open = await page(ctx, "Open", "open", "Public.", false);
    await updatePage(ctx, open, { seo: { share_image: shared } });
    await publishPage(ctx, open, deps());

    const pubDir = mkdtempSync(join(tmpdir(), "cds-protected-pub-"));
    const publicStore = new LocalDiskStore(pubDir);
    const purged: string[] = [];
    const delivery = {
      purge: (keys: readonly string[]) => {
        purged.push(...keys);
        return Promise.resolve();
      },
    } as never;
    try {
      await setPagePassword(
        ctx,
        members,
        { password: "sourdough1" },
        { ...deps(), publicStore, delivery },
      );
      expect(
        String((await pb.collection("media_assets").getOne(solo)).public_at),
      ).toBe("");
      expect(purged.some((k) => k.includes(`/${solo}/`))).toBe(true);
      // Another public page still shows `shared`: protecting VIP keeps it public.
      await setPagePassword(
        ctx,
        vip,
        { password: "sourdough1" },
        { ...deps(), publicStore, delivery },
      );
      expect(
        String((await pb.collection("media_assets").getOne(shared)).public_at),
      ).not.toBe("");
      expect(purged.some((k) => k.includes(`/${shared}/`))).toBe(false);
    } finally {
      rmSync(pubDir, { recursive: true, force: true });
    }
  });

  it("a draft-only page sets the row and touches no manifest", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await page(ctx, "Home", "home", "Welcome.");
    const draft = await page(ctx, "Draft", "draft", "Not yet.", false);
    const m0 = JSON.stringify(await manifestOf(org));
    await setPagePassword(ctx, draft, { password: "sourdough1" }, deps());
    expect(
      (await pb.collection("pages").getOne(draft)).password_protected,
    ).toBe(true);
    expect(JSON.stringify(await manifestOf(org))).toBe(m0);
  });

  it("refuses the 404 page, viewers and foreign pages", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const nf = await ensureNotFoundPage(ctx);
    await expect(
      setPagePassword(ctx, nf.id, { password: "sourdough1" }, deps()),
    ).rejects.toThrow(InvalidInput);
    const viewer = mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "",
    });
    const id = await page(ctx, "Home", "home", "Welcome.");
    await expect(
      setPagePassword(viewer, id, { password: "sourdough1" }, deps()),
    ).rejects.toThrow(Forbidden);
    await expect(
      setPagePassword(seed.ctxB, id, { password: "sourdough1" }, deps()),
    ).rejects.toThrow(NotFound);
  });

  it("a failed manifest write leaves the row; a failed row commit restores the manifest", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const id = await page(ctx, "Home", "home", "Welcome.");
    const before = await pb.collection("pages").getOne(id);
    const broken: ObjectStore = Object.create(store) as ObjectStore;
    broken.put = () => Promise.reject(new Error("disk full"));
    await expect(
      setPagePassword(
        ctx,
        id,
        { password: "sourdough1" },
        deps({ store: broken }),
      ),
    ).rejects.toThrow("disk full");
    const after = await pb.collection("pages").getOne(id);
    expect(after.password_version).toBe(before.password_version);
    expect(after.password_protected).toBe(false);

    const m0 = new TextDecoder().decode(
      (await store.get(tenantSiteManifestKey(org)))!,
    );
    commitFail.on = true;
    await expect(
      setPagePassword(ctx, id, { password: "sourdough1" }, deps()),
    ).rejects.toThrow("commit failed");
    commitFail.on = false;
    expect(
      new TextDecoder().decode((await store.get(tenantSiteManifestKey(org)))!),
    ).toBe(m0);
    expect((await pb.collection("pages").getOne(id)).password_protected).toBe(
      false,
    );
  });
});

describe("the gate read and the password check", () => {
  it("reads only the site's own page, and counts only wrong tries", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    const id = await page(a.ctx, "Home", "home", "Welcome.");
    const siteA = await a.site();
    const siteB = await b.site();
    expect(await readPageGate(siteA, id)).toEqual({
      protected: false,
      version: 0,
    });
    expect(await verifyPagePassword(siteA, id, "x", { ip: "1.1.1.1" })).toEqual(
      {
        version: 0,
        open: true,
      },
    );
    await setPagePassword(a.ctx, id, { password: "sourdough1" }, deps());
    const gate = await readPageGate(siteA, id);
    expect(gate).toEqual({ protected: true, version: 1 });
    expect(Object.keys(gate!)).toEqual(["protected", "version"]);
    expect(await readPageGate(siteB, id)).toBeNull();
    expect(await readPageGate(siteA, "zzzzzzzzzzzzzzz")).toBeNull();
    expect(await readPageGate(siteA, "../bad")).toBeNull();

    // a hash with the flag off still reports protected (fail closed)
    await pb.collection("pages").update(id, { password_protected: false });
    expect((await readPageGate(siteA, id))!.protected).toBe(true);
    await pb.collection("pages").update(id, { password_protected: true });

    await expect(
      verifyPagePassword(siteB, id, "sourdough1", { ip: "1.1.1.1" }),
    ).rejects.toThrow(NotFound);
    for (let i = 0; i < 9; i++) {
      await expect(
        verifyPagePassword(siteA, id, "wrong-one", { ip: "1.1.1.1" }),
      ).rejects.toThrow(WrongPagePassword);
    }
    expect(
      await verifyPagePassword(siteA, id, "sourdough1", { ip: "1.1.1.1" }),
    ).toEqual({ version: 1, open: false });
    // the success did not count: one more wrong is the 10th, the 11th is limited
    await expect(
      verifyPagePassword(siteA, id, "wrong-one", { ip: "1.1.1.1" }),
    ).rejects.toThrow(WrongPagePassword);
    const err = await verifyPagePassword(siteA, id, "sourdough1", {
      ip: "1.1.1.1",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateRateLimited);
    expect((err as GateRateLimited).retryAfterS).toBeGreaterThanOrEqual(1);
    expect((err as GateRateLimited).retryAfterS).toBeLessThanOrEqual(900);
    // another IP has its own bucket; an over-long password is wrong without hashing
    await expect(
      verifyPagePassword(siteA, id, "x".repeat(200), { ip: "2.2.2.2" }),
    ).rejects.toThrow(WrongPagePassword);
    expect(
      (await verifyPagePassword(siteA, id, "sourdough1", { ip: "2.2.2.2" }))
        .open,
    ).toBe(false);
  });
});

describe("the system 404 page", () => {
  it("exists once, outside the page list, with the default title and text", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await page(ctx, "Home", "home", "Welcome.");
    expect(await getNotFoundPage(ctx)).toBeNull();
    const [x, y] = await Promise.all([
      ensureNotFoundPage(ctx),
      ensureNotFoundPage(ctx),
    ]);
    expect(x.id).toBe(y.id);
    expect((await ensureNotFoundPage(ctx)).id).toBe(x.id);
    expect(x).toMatchObject({
      slug: "system-404",
      title: "We can't find that page",
      status: "draft",
      kind: "system-404",
      password_protected: false,
    });
    expect((await getNotFoundPage(ctx))!.id).toBe(x.id);
    expect((await listPages(ctx)).map((p) => p.id)).not.toContain(x.id);
    const rows = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: x.id }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.section_type).toBe("text-only");
    expect(JSON.stringify(rows[0]!.content)).toContain(
      "The page may have moved, or the address may have a typo.",
    );
    await expect(
      createPage(ctx, { title: "X", slug: "system-404" }),
    ).rejects.toThrow(SlugReserved);
    await expect(updatePage(ctx, x.id, { slug: "oops" })).rejects.toThrow(
      InvalidInput,
    );
    await expect(addPageToNav(ctx, deps(), x.id)).rejects.toThrow(InvalidInput);
    const res = await publishPage(ctx, x.id, deps());
    expect(res.status).toBe("published");
    expect((await manifestOf(org))!.pages["system-404"]!.id).toBe(x.id);
    expect(await indexPaths(org)).not.toContain("/system-404");
  });
});

describe("removePageFromNav", () => {
  it("removes every link to the page, keeps the CTA and snapshots the menu", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const home = await page(ctx, "Home", "home", "Welcome.");
    const about = await page(ctx, "About", "about", "Us.");
    await saveNav(ctx, deps(), {
      items: [
        {
          id: "n1",
          label: "About",
          target: `page:${about}`,
          new_tab: false,
          children: [],
        },
        {
          id: "n2",
          label: "Home",
          target: `page:${home}`,
          new_tab: false,
          children: [
            {
              id: "n3",
              label: "About too",
              target: `page:${about}`,
              new_tab: false,
            },
          ],
        },
      ],
      cta: { label: "Go", target: `page:${about}` },
    });
    const v0 = (await listSiteSettingsVersions(ctx, "nav", { store })).length;
    expect(await removePageFromNav(ctx, deps(), about)).toEqual({ removed: 2 });
    const row = await pb
      .collection("site_settings")
      .getFirstListItem(pb.filter("organization = {:org}", { org: ctx.orgId }));
    const nav = row.nav as {
      items: { id: string; children: unknown[] }[];
      cta: unknown;
    };
    expect(nav.items.map((i) => i.id)).toEqual(["n2"]);
    expect(nav.items[0]!.children).toEqual([]);
    expect(nav.cta).toEqual({ label: "Go", target: `page:${about}` });
    expect((await listSiteSettingsVersions(ctx, "nav", { store })).length).toBe(
      v0 + 1,
    );
    expect(await removePageFromNav(ctx, deps(), about)).toEqual({ removed: 0 });
  });
});

describe("snapshot safety (D187)", () => {
  it("no hash, no password_hash, no password_version in versions, published JSON, export or audit", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const id = await page(ctx, "Home", "home", "Welcome.");
    const imp = mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
      impersonator: seed.B.owner,
    });
    await setPagePassword(imp, id, { password: "sourdough1" }, deps());
    await updatePage(ctx, id, { title: "Home again" });
    await publishPage(ctx, id, deps());
    const hash = String(
      (await pb.collection("pages").getOne(id)).password_hash,
    );
    expect(hash).toMatch(/^scrypt\$/);
    const texts: string[] = [];
    for (const obj of await store.list(`tenants/${org}/`)) {
      const bytes = await store.get(obj.key);
      if (bytes) texts.push(new TextDecoder().decode(bytes));
    }
    const exp = await exportTenant(ctx, org, { store });
    const expBytes = await store.get(exp.key);
    texts.push(new TextDecoder().decode(expBytes!));
    const published = await store.get(tenantPublishedPageKey(org, id));
    expect(published).not.toBeNull();
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:org}", { org }),
    });
    texts.push(JSON.stringify(audits.map((a) => a.meta)));
    for (const text of texts) {
      expect(text).not.toContain(hash);
      expect(text).not.toContain("password_hash");
      expect(text).not.toContain("password_version");
      expect(text).not.toContain("sourdough1");
    }
  });
});
