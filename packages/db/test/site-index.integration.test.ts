// index.json on the real PocketBase 0.39.11 binary (07-31; CONT-37, CONT-13, CONT-15,
// CONT-28; D277, D187, D253, D275; invariant 1; T-07-31-01, -05, -06, -07, -08).
//
// Rebuild points (publish, held republish, live saves incl. settings save AND restore,
// services writes, add-on state), the one exclusion rule fed from live rows (raw password,
// held, system-404, disabled add-on page), soft-deleted refs stay indexed, cheap carry-over,
// failure tolerance, the per-org rebuild lock, and isolation.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { parseSiteIndex, type SiteIndex } from "@cds/core/seo";
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
import { saveSiteSettings } from "../src/content/chrome";
import {
  listSiteSettingsVersions,
  restoreSiteSettingsVersion,
} from "../src/content/history";
import { withOrgLock } from "../src/content/lock";
import { createPage, updatePage } from "../src/content/pages";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import { siteContextForHost } from "../src/content/site-context";
import { readSiteIndex } from "../src/content/site-index";
import { refreshSiteIndex } from "../src/content/site-index/build";
import { mintOrgContext, type OrgContext } from "../src/context";
import { deleteService, saveService } from "../src/intake/services";
import { clearResolverCache } from "../src/resolve";
import {
  tenantPublishedPageKey,
  tenantSiteIndexKey,
  type ObjectStore,
} from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedMediaRow } from "./media-seed";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

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
async function bareOrg(
  name: string,
): Promise<{ org: string; ctx: OrgContext; host: string }> {
  n += 1;
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `six-${n}-${Math.random().toString(36).slice(2, 8)}`,
      status: "active",
    })
  ).id;
  const host = `six-${n}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  return {
    org,
    host,
    ctx: mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    }),
  };
}

async function page(
  ctx: OrgContext,
  title: string,
  slug: string,
  text: string,
  d: PublishDeps = deps(),
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
  await publishPage(ctx, p.id, d);
  return p.id;
}

async function rawIndex(org: string): Promise<string> {
  const bytes = await store.get(tenantSiteIndexKey(org));
  if (!bytes) throw new Error("no index.json");
  return new TextDecoder().decode(bytes);
}

async function indexOf(org: string): Promise<SiteIndex> {
  const idx = parseSiteIndex(JSON.parse(await rawIndex(org)));
  if (!idx) throw new Error("bad index.json");
  return idx;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-site-index-"));
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

beforeEach(() => clearResolverCache());

describe("publish writes index.json", () => {
  it("holds the page's path, title, description, text and lastmod", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Crumb Bakery");
    const id = await page(
      ctx,
      "Home",
      "home",
      "We bake sourdough every morning.",
    );
    const idx = await indexOf(org);
    expect(idx.site.name).toBe("Crumb Bakery");
    expect(idx.site.allow_ai_crawlers).toBe(true);
    expect(idx.pages).toHaveLength(1);
    const p = idx.pages[0]!;
    expect(p).toMatchObject({ id, path: "/", title: "Home" });
    expect(p.text).toContain("sourdough");
    expect(p.description).toContain("sourdough");
    const row = await pb.collection("pages").getOne(id);
    expect(p.lastmod).toBe(new Date(row.published_at).toISOString());
    expect(idx.site.summary).toBe(p.description);
  });
});

describe("the one rule, fed from live rows (choice 1)", () => {
  it("drops raw-password, held, system-404 and disabled add-on pages; leaks nothing", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Rule Co");
    await page(ctx, "Home", "home", "Welcome home.");
    const members = await page(
      ctx,
      "Members Lounge",
      "members",
      "zanzibarquince secret.",
    );
    const promo = await page(ctx, "Promo", "promo", "promowordxylo offer.");
    const oops = await page(ctx, "Oops", "oops", "notfoundwordqq.");
    const events = await page(ctx, "Events", "events", "eventwordzz.");
    expect((await indexOf(org)).pages).toHaveLength(5);

    // a raw password write, no republish
    await pb.collection("pages").update(members, { password_hash: "x$hash" });
    // a held republish
    await updatePage(ctx, promo, { title: "Promo 2" });
    const held = await publishPage(
      ctx,
      promo,
      deps({
        scanner: {
          scan: () => Promise.resolve({ verdict: "held", reasons: ["x"] }),
        },
      }),
    );
    expect(held.status).toBe("held");
    // a raw system-404 kind
    await pb.collection("pages").update(oops, { kind: "system-404" });
    // a disabled add-on's seeded page
    await pb.collection("org_addons").create({
      organization: org,
      addon: "testimonials",
      status: "disabled",
      source: "staff",
      seeded: { page: { id: events, slug: "events" } },
    });
    expect(await refreshSiteIndex(org, deps())).toBe(true);
    const idx = await indexOf(org);
    expect(idx.pages.map((p) => p.path)).toEqual(["/"]);
    const raw = await rawIndex(org);
    for (const leak of [
      "Members Lounge",
      "zanzibarquince",
      "promowordxylo",
      "notfoundwordqq",
      "eventwordzz",
      "x$hash",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("keeps a page whose refs were soft-deleted (07-28 relay, D275)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Soft Co");
    const media = await seedMediaRow(org);
    const p = await createPage(ctx, { title: "Gallery", slug: "gallery" });
    await saveSection(
      ctx,
      registry,
      {
        pageId: p.id,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Gallery", text: "<p>Photos</p>" },
      },
      NO_OWNERS,
    );
    await updatePage(ctx, p.id, { seo: { share_image: media } });
    await publishPage(ctx, p.id, deps());
    await pb
      .collection("media_assets")
      .update(media, { deleted_at: new Date().toISOString() });
    expect(await refreshSiteIndex(org, deps())).toBe(true);
    expect((await indexOf(org)).pages.map((x) => x.path)).toEqual(["/gallery"]);
  });
});

describe("live saves rebuild: settings save and restore (07-29 relay)", () => {
  it("save turns the AI toggle off; restore turns it back on", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Toggle Co");
    await page(ctx, "Home", "home", "Hello.");
    await saveSiteSettings(ctx, deps(), { allow_ai_crawlers: true });
    expect((await indexOf(org)).site.allow_ai_crawlers).toBe(true);
    await saveSiteSettings(ctx, deps(), { allow_ai_crawlers: false });
    expect((await indexOf(org)).site.allow_ai_crawlers).toBe(false);
    const older = (
      await listSiteSettingsVersions(ctx, "settings", { store })
    ).find((v) => !v.current);
    expect(older).toBeDefined();
    await restoreSiteSettingsVersion(ctx, deps(), "settings", older!.id);
    expect((await indexOf(org)).site.allow_ai_crawlers).toBe(true);
  });
});

describe("services writes rebuild", () => {
  it("adds, retargets, hides and deletes service records", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Service Co");
    await page(ctx, "Home", "home", "Hello.");
    const svc = await saveService(ctx, {
      name: "Bread class",
      description: "Learn to bake",
      price_display: "fixed",
      price_cents: 4000,
      duration_minutes: 60,
    });
    let idx = await indexOf(org);
    expect(idx.records).toEqual([
      {
        kind: "Service",
        group: "Services",
        title: "Bread class",
        text: "Learn to bake · $40 · 60 min",
        path: "/",
      },
    ]);
    await page(ctx, "Services", "services", "All our classes.");
    idx = await indexOf(org);
    expect(idx.records[0]!.path).toBe("/services");
    await saveService(ctx, { is_published: false }, svc.id);
    expect((await indexOf(org)).records).toEqual([]);
    await saveService(ctx, { is_published: true }, svc.id);
    expect((await indexOf(org)).records).toHaveLength(1);
    await deleteService(ctx, svc.id);
    expect((await indexOf(org)).records).toEqual([]);
  });

  it("drops services when no indexable page can hold them", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Lonely Co");
    const about = await page(ctx, "About", "about", "Hi.");
    await saveService(ctx, {
      name: "Orphan",
      price_display: "free",
    });
    expect((await indexOf(org)).records).toEqual([]);
    expect((await indexOf(org)).pages.map((p) => p.id)).toEqual([about]);
  });
});

describe("add-on publicIndex hook (invariant 4)", () => {
  it("an active add-on contributes sanitized records; uninstalled, none", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Hook Co");
    await page(ctx, "Home", "home", "Hello.");
    const base = ADDON_REGISTRY.get("testimonials")!;
    const hooked: AddonManifest = {
      ...base,
      publicIndex: ({ records }) => [
        ...(records.testimonials ?? []).map((r) => ({
          title: String(r.author_name),
          text: String(r.quote),
          path: "/",
          organization: "leak",
        })),
        { title: "Evil", path: "javascript:alert(1)" },
      ],
    };
    const addons = { list: () => [hooked] };
    const row = await pb.collection("org_addons").create({
      organization: org,
      addon: "testimonials",
      status: "active",
      source: "staff",
      seeded: {},
    });
    await pb.collection("testimonials").create({
      organization: org,
      quote: "Best bread in town.",
      author_name: "Ann",
      source: "manual",
      featured: false,
      is_published: true,
      sort_order: 1,
    });
    expect(await refreshSiteIndex(org, deps({ addons }))).toBe(true);
    let idx = await indexOf(org);
    expect(idx.records).toEqual([
      {
        kind: base.name,
        group: base.name,
        title: "Ann",
        text: "Best bread in town.",
        path: "/",
      },
    ]);
    expect(await rawIndex(org)).not.toContain("leak");
    await pb.collection("org_addons").update(row.id, { status: "disabled" });
    expect(await refreshSiteIndex(org, deps({ addons }))).toBe(true);
    idx = await indexOf(org);
    expect(idx.records).toEqual([]);
  });
});

describe("cheap rebuilds, failure tolerance, concurrency", () => {
  function spyStore(inner: ObjectStore, failIndexPut = false) {
    const gets: string[] = [];
    const s: ObjectStore = {
      ...inner,
      get: (k: string) => {
        gets.push(k);
        return inner.get(k);
      },
      put: (k: string, b: Uint8Array | string, ct?: string) => {
        if (failIndexPut && k.endsWith("published/index.json")) {
          return Promise.reject(new Error("disk full"));
        }
        return inner.put(k, b as never, ct as never);
      },
      list: (p: string) => inner.list(p),
      delete: (k: string) => inner.delete(k),
    } as ObjectStore;
    return { s, gets };
  }

  it("an unchanged site reads no page JSON; a changed page is re-extracted", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Cheap Co");
    const home = await page(ctx, "Home", "home", "First words.");
    const { s, gets } = spyStore(store);
    expect(await refreshSiteIndex(org, deps({ store: s }))).toBe(true);
    expect(gets.some((k) => k.includes("/published/pages/"))).toBe(false);
    await saveSection(
      ctx,
      registry,
      {
        pageId: home,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "More", text: "<p>Croissantword arrives.</p>" },
      },
      NO_OWNERS,
    );
    await publishPage(ctx, home, deps({ store: s }));
    expect(gets).toContain(tenantPublishedPageKey(org, home));
    expect((await indexOf(org)).pages[0]!.text).toContain("Croissantword");
  });

  it("a failed index write never fails the publish; old file stays", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Fail Co");
    await page(ctx, "Home", "home", "Old text.");
    const before = await rawIndex(org);
    const { s } = spyStore(store, true);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const p = await createPage(ctx, { title: "New", slug: "new" });
      const res = await publishPage(ctx, p.id, deps({ store: s }));
      expect(res.status).toBe("published");
      const calls = err.mock.calls.filter(
        (c) => c[0] === "[site-index] rebuild failed",
      );
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(calls)).not.toContain(org);
      expect(JSON.stringify(calls)).not.toContain(p.id);
    } finally {
      err.mockRestore();
    }
    expect(await rawIndex(org)).toBe(before);
  });

  it("rebuilds of one org serialize; one called under the org lock completes", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Lock Co");
    await page(ctx, "Home", "home", "Hi.");
    const results = await Promise.all([
      refreshSiteIndex(
        org,
        deps({ now: () => new Date("2026-10-01T00:00:00Z") }),
      ),
      refreshSiteIndex(
        org,
        deps({ now: () => new Date("2026-10-02T00:00:00Z") }),
      ),
    ]);
    expect(results).toEqual([true, true]);
    expect((await indexOf(org)).built_at).toBe("2026-10-02T00:00:00.000Z");
    const inner = await Promise.race([
      withOrgLock(org, () => refreshSiteIndex(org, deps())),
      new Promise<string>((r) => setTimeout(() => r("deadlock"), 5000)),
    ]);
    expect(inner).toBe(true);
  });
});

describe("isolation (invariant 1)", () => {
  it("each site reads only its own index; no secret keys in the file", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg("Iso A");
    const b = await bareOrg("Iso B");
    await page(a.ctx, "Home", "home", "alphaonlyword.");
    await saveService(a.ctx, { name: "Alpha svc", price_display: "free" });
    await page(b.ctx, "Home", "home", "betaonlyword.");
    await saveService(b.ctx, { name: "Beta svc", price_display: "free" });
    const siteA = await siteContextForHost(a.host);
    const siteB = await siteContextForHost(b.host);
    const ia = await readSiteIndex(siteA!, store);
    const ib = await readSiteIndex(siteB!, store);
    expect(JSON.stringify(ia)).toContain("alphaonlyword");
    expect(JSON.stringify(ia)).not.toContain("betaonlyword");
    expect(JSON.stringify(ia)).not.toContain("Beta svc");
    expect(JSON.stringify(ib)).toContain("betaonlyword");
    expect(JSON.stringify(ib)).not.toContain("alphaonlyword");
    await expect(
      readSiteIndex({ orgId: a.org, host: a.host } as never, store),
    ).rejects.toThrow(InvalidContext);
    const raw = await rawIndex(a.org);
    for (const k of [
      "password_hash",
      "password_version",
      "notify_route",
      '"email"',
      '"token"',
    ]) {
      expect(raw).not.toContain(k);
    }
  });

  it("an org with nothing published reads null", async (t) => {
    if (!inst) return t.skip();
    const c = await bareOrg("Empty Co");
    const site = await siteContextForHost(c.host);
    expect(await readSiteIndex(site!, store)).toBeNull();
  });
});
