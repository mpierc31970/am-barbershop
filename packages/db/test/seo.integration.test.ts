// SEO data on the real PocketBase 0.39.11 binary (07-30; CONT-13, CONT-14, CONT-28; D170,
// D188, D235; invariant 1; T-07-30-02..05): host kind + primary host on the resolver and the
// site context, published services / team, share image ownership + references + promote, and
// the generated site icons.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext, InvalidInput } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import sharp from "sharp";
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
import { getSiteSettings, saveSiteSettings } from "../src/content/chrome";
import { createPage, updatePage } from "../src/content/pages";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import {
  listPublishedServices,
  listPublishedTeam,
  readPublicServices,
  readPublicTeam,
  readSiteIcons,
  readOwnSiteIcons,
  refreshSiteIcons,
} from "../src/content/seo";
import { regenerateSiteIcons, xmlEscape } from "../src/content/seo/site-icons";
import { siteContextForHost } from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import { uploadImage } from "../src/media";
import { solidPng } from "../src/media/__fixtures__/make-fixtures";
import { deleteMediaAsset, uploadLibraryImage } from "../src/media/library";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
import { tenantSiteAssetKey, type ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedMediaRow } from "./media-seed";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let publicDir = "";
let store: ObjectStore;
let publicStore: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
const savedPublicDir = process.env.CDS_PUBLIC_STORAGE_DIR;

function deps(): PublishDeps & ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
    store,
    publicStore,
  };
}

async function bareOrg(
  name: string,
): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `seo-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  return {
    org,
    ctx: mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    }),
  };
}

async function libraryImage(ctx: OrgContext): Promise<string> {
  return (
    await uploadLibraryImage(ctx, await solidPng(1200, 630), {
      alt: "Photo",
      store,
    })
  ).asset.id;
}

async function row(id: string) {
  return pb.collection("media_assets").getOne(id);
}

async function pngMeta(
  org: string,
  name: "icon-32.png" | "icon-180.png" | "icon-512.png" | "share.png",
) {
  const bytes = await publicStore.get(tenantSiteAssetKey(org, name));
  if (!bytes) throw new Error(`missing ${name}`);
  return { meta: await sharp(Buffer.from(bytes)).metadata(), bytes };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-seo-"));
  publicDir = mkdtempSync(join(tmpdir(), "cds-seo-public-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = publicDir;
  store = new LocalDiskStore(storageDir);
  publicStore = new LocalDiskStore(publicDir);
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
  if (savedPublicDir === undefined) delete process.env.CDS_PUBLIC_STORAGE_DIR;
  else process.env.CDS_PUBLIC_STORAGE_DIR = savedPublicDir;
  rmSync(storageDir, { recursive: true, force: true });
  rmSync(publicDir, { recursive: true, force: true });
});

beforeEach(() => clearResolverCache());

describe("host kind and primary host (choice 1, D170)", () => {
  it("a preview host reports preview and the custom primary", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("org_hosts").create({
      hostname: "a-preview.example.com",
      organization: seed.A.org,
      kind: "preview",
      primary: false,
    });
    const r = await resolveOrganization("a-preview.example.com");
    expect(r).toMatchObject({
      hostKind: "preview",
      primaryHost: "a.example.com",
    });
    const custom = await resolveOrganization("a.example.com");
    expect(custom).toMatchObject({
      hostKind: "custom",
      primaryHost: "a.example.com",
    });
    const site = await siteContextForHost("a-preview.example.com");
    expect(site?.hostKind).toBe("preview");
    expect(site?.primaryHost).toBe("a.example.com");
  });

  it("an org with no primary row has primaryHost null", async (t) => {
    if (!inst) return t.skip();
    const { org } = await bareOrg("No Primary");
    await pb.collection("org_hosts").create({
      hostname: "noprimary.example.com",
      organization: org,
      kind: "preview",
      primary: false,
    });
    expect(await resolveOrganization("noprimary.example.com")).toMatchObject({
      hostKind: "preview",
      primaryHost: null,
    });
    expect(await resolveOrganization("never.example.com")).toBeNull();
  });
});

describe("public services and team", () => {
  it("lists only the site's published rows, in order", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("services").create({
      organization: seed.A.org,
      name: "Hidden",
      price_display: "fixed",
      sort_order: 0,
      is_published: false,
    });
    await pb.collection("services").create({
      organization: seed.A.org,
      name: "First",
      price_display: "fixed",
      sort_order: 0,
      is_published: true,
    });
    const first = await pb
      .collection("services")
      .getFirstListItem(
        pb.filter("organization = {:o} && name = 'First'", { o: seed.A.org }),
      );
    const site = await siteContextForHost("a.example.com");
    const services = await readPublicServices(site!);
    const names = services.map((s) => s.name);
    // 08-08: each row carries its record id (React keys).
    expect(services.find((s) => s.name === "First")?.id).toBe(first.id);
    expect(
      services.every((s) => typeof s.id === "string" && s.id.length > 0),
    ).toBe(true);
    expect(names[0]).toBe("First");
    expect(names).toContain("Service A");
    expect(names).not.toContain("Hidden");
    expect(names).not.toContain("Service B");
    const team = await readPublicTeam(site!);
    expect(team.map((m) => m.name)).toEqual(["Staff A"]);
    const staff = await pb
      .collection("team_members")
      .getFirstListItem(
        pb.filter("organization = {:o} && name = 'Staff A'", { o: seed.A.org }),
      );
    expect(team[0]!.id).toBe(staff.id);
    expect(Object.keys(team[0]!).sort()).toEqual([
      "bio",
      "id",
      "name",
      "photo",
      "role",
      "sort_order",
    ]);
  });

  it("refuses an unminted context", async (t) => {
    if (!inst) return t.skip();
    const fake = { orgId: seed.A.org, host: "a.example.com" } as never;
    await expect(readPublicServices(fake)).rejects.toThrow(InvalidContext);
    await expect(readPublicTeam(fake)).rejects.toThrow(InvalidContext);
    const fakeOrg = { orgId: seed.A.org } as never;
    await expect(listPublishedServices(fakeOrg)).rejects.toThrow(
      InvalidContext,
    );
    await expect(listPublishedTeam(fakeOrg)).rejects.toThrow(InvalidContext);
  });

  it("WR-C02: a Viewer reads the same published rows with an OrgContext, own org only", async (t) => {
    if (!inst) return t.skip();
    const viewer = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    });
    const site = await siteContextForHost("a.example.com");
    expect(await listPublishedServices(viewer)).toEqual(
      await readPublicServices(site!),
    );
    expect(await listPublishedTeam(viewer)).toEqual(
      await readPublicTeam(site!),
    );
    const bNames = (await listPublishedTeam(seed.ctxB)).map((m) => m.name);
    expect(bNames).not.toContain("Staff A");
    const services = (await listPublishedServices(viewer)).map((s) => s.name);
    expect(services).not.toContain("Hidden");
    expect(services).not.toContain("Service B");
  });
});

describe("page share image (choices 5, 6)", () => {
  it("stores an own ready image and clears the pasted link", async (t) => {
    if (!inst) return t.skip();
    const img = await libraryImage(seed.ctxA);
    const linked = await updatePage(seed.ctxA, seed.A.page, {
      seo: { og_image: "https://images.unsplash.com/photo-1" },
    });
    expect(linked.seo.og_image).toBe("https://images.unsplash.com/photo-1");
    const page = await updatePage(seed.ctxA, seed.A.page, {
      seo: {
        share_image: img,
        og_image: "https://images.unsplash.com/photo-1",
      },
    });
    expect(page.seo.share_image).toBe(img);
    expect(page.seo.og_image).toBeUndefined();
  });

  it("refuses foreign, soft-deleted, video and unready assets", async (t) => {
    if (!inst) return t.skip();
    const foreign = await libraryImage(seed.ctxB);
    const deleted = await seedMediaRow(seed.A.org, {
      deleted_at: "2026-01-01 00:00:00.000Z",
    });
    const video = await seedMediaRow(seed.A.org, { kind: "video" });
    const waiting = await seedMediaRow(seed.A.org, { status: "processing" });
    for (const id of [foreign, deleted, video, waiting, "../etc/passwd"]) {
      await expect(
        updatePage(seed.ctxA, seed.A.page, { seo: { share_image: id } }),
        id,
      ).rejects.toThrow(InvalidInput);
    }
  });
});

describe("site share image", () => {
  it("stores at seo.share_image, keeps allow_ai_crawlers, promotes the photo", async (t) => {
    if (!inst) return t.skip();
    await saveSiteSettings(seed.ctxA, deps(), { allow_ai_crawlers: false });
    const img = await libraryImage(seed.ctxA);
    const { settings } = await saveSiteSettings(seed.ctxA, deps(), {
      share_image: img,
    });
    expect(settings.share_image).toBe(img);
    expect(settings.allow_ai_crawlers).toBe(false);
    const stored = await pb
      .collection("site_settings")
      .getFirstListItem(
        pb.filter("organization = {:org}", { org: seed.A.org }),
      );
    expect(stored.seo).toMatchObject({
      allow_ai_crawlers: false,
      share_image: img,
    });
    expect((await getSiteSettings(seed.ctxA)).share_image).toBe(img);
    expect(String((await row(img)).public_at)).not.toBe("");
  });

  it("refuses a foreign photo and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const before = (await getSiteSettings(seed.ctxA)).share_image;
    const foreign = await libraryImage(seed.ctxB);
    await expect(
      saveSiteSettings(seed.ctxA, deps(), { share_image: foreign }),
    ).rejects.toThrow(InvalidInput);
    expect((await getSiteSettings(seed.ctxA)).share_image).toBe(before);
  });

  it("a photo used only as a share image is soft-deleted", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("Share Ref Co");
    const pagePhoto = await libraryImage(ctx);
    const sitePhoto = await libraryImage(ctx);
    const page = await createPage(ctx, { title: "About", slug: "about" });
    await updatePage(ctx, page.id, { seo: { share_image: pagePhoto } });
    await saveSiteSettings(ctx, deps(), { share_image: sitePhoto });
    const d = {
      sections: registry,
      invalidator: recordingInvalidator(),
      store,
      publicStore,
    };
    expect(await deleteMediaAsset(ctx, pagePhoto, d)).toEqual({
      outcome: "soft",
    });
    expect(await deleteMediaAsset(ctx, sitePhoto, d)).toEqual({
      outcome: "soft",
    });
  });
});

describe("publish promotes the page share image", () => {
  it("non-protected: promoted; protected: nothing", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("Publish Share Co");
    const open = await libraryImage(ctx);
    const hidden = await libraryImage(ctx);
    for (const [slug, img, isProtected] of [
      ["open-page", open, false],
      ["gated-page", hidden, true],
    ] as const) {
      const page = await createPage(ctx, { title: slug, slug });
      await saveSection(
        ctx,
        registry,
        {
          pageId: page.id,
          section_type: "text-only",
          row_layout: "full",
          content: { heading: "Hi", text: "<p>Hello</p>" },
        },
        NO_OWNERS,
      );
      await updatePage(ctx, page.id, { seo: { share_image: img } });
      if (isProtected) {
        await pb
          .collection("pages")
          .update(page.id, { password_protected: true });
      }
      await publishPage(ctx, page.id, deps());
    }
    expect(String((await row(open)).public_at)).not.toBe("");
    expect(String((await row(hidden)).public_at)).toBe("");
  });

  it("the published share image stays held after the draft moves on (WR-A05)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("Live Share Co");
    const live = await libraryImage(ctx);
    const next = await libraryImage(ctx);
    const page = await createPage(ctx, { title: "Live", slug: "live" });
    await saveSection(
      ctx,
      registry,
      {
        pageId: page.id,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Hi", text: "<p>Hello</p>" },
      },
      NO_OWNERS,
    );
    await updatePage(ctx, page.id, { seo: { share_image: live } });
    await publishPage(ctx, page.id, deps());
    // The draft now names another image, unpublished; the live page still serves `live`.
    await updatePage(ctx, page.id, { seo: { share_image: next } });
    const d = {
      sections: registry,
      invalidator: recordingInvalidator(),
      store,
      publicStore,
    };
    expect(await deleteMediaAsset(ctx, live, d)).toEqual({ outcome: "soft" });
    expect(String((await row(live)).deleted_at)).not.toBe("");
  });
});

describe("site icons (choices 7, 8)", () => {
  it("escapes the org name for the SVG", () => {
    expect(xmlEscape(`<svg onload="x">&'`)).toBe(
      "&lt;svg onload=&quot;x&quot;&gt;&amp;&apos;",
    );
  });

  it("generates a logo set, then writes nothing when unchanged", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Logo Co");
    await uploadImage(
      ctx,
      await solidPng(600, 300, { r: 20, g: 120, b: 200 }),
      "logo",
      {
        alt: "Logo",
        store,
      },
    );
    // The upload hook used the env public store (same dir).
    const site = await (async () => {
      await pb.collection("org_hosts").create({
        hostname: "logo.example.com",
        organization: org,
        kind: "custom",
        primary: true,
      });
      return siteContextForHost("logo.example.com");
    })();
    const icons = await readSiteIcons(site!, { publicStore });
    expect(icons?.source).toBe("logo");
    expect(icons?.v).toMatch(/^[0-9a-f]{12}$/);
    for (const [name, w, h] of [
      ["icon-32.png", 32, 32],
      ["icon-180.png", 180, 180],
      ["icon-512.png", 512, 512],
      ["share.png", 1200, 630],
    ] as const) {
      const { meta } = await pngMeta(org, name);
      expect([meta.format, meta.width, meta.height], name).toEqual([
        "png",
        w,
        h,
      ]);
    }
    const spy: ObjectStore & { puts: number } = {
      puts: 0,
      put: async (k, b, c) => {
        spy.puts += 1;
        return publicStore.put(k, b, c);
      },
      get: (k) => publicStore.get(k),
      delete: (k) => publicStore.delete(k),
      list: (p) => publicStore.list(p),
    };
    const quiet = recordingInvalidator();
    expect(
      await refreshSiteIcons(ctx, {
        publicStore: spy,
        store,
        invalidator: quiet,
      }),
    ).toEqual(icons);
    expect(spy.puts).toBe(0);
    // WR-C06: nothing written, nothing invalidated; the read-only reader sees the same set.
    expect(quiet.tags).toEqual([]);
    expect(await readOwnSiteIcons(ctx, { publicStore })).toEqual(icons);
  });

  it("a write drops the tenant's cached icon set (liveTag) (WR-C06)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Fresh Icons Co");
    expect(await readOwnSiteIcons(ctx, { publicStore })).toBeNull();
    const inv = recordingInvalidator();
    const r = await regenerateSiteIcons(org, {
      publicStore,
      store,
      invalidator: inv,
    });
    expect(r).toMatchObject({ ok: true, written: true });
    expect(inv.tags).toEqual([`org:${org}:live`]);
    expect((await readOwnSiteIcons(ctx, { publicStore }))?.source).toBe(
      "wordmark",
    );
  });

  it("without a logo draws a wordmark (not a flat colour)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await bareOrg("Rivera Bakery");
    const r = await regenerateSiteIcons(org, { publicStore, store });
    expect(r).toMatchObject({
      ok: true,
      written: true,
      icons: { source: "wordmark" },
    });
    const { bytes } = await pngMeta(org, "share.png");
    const stats = await sharp(Buffer.from(bytes)).stats();
    expect(stats.channels.some((c) => c.min !== c.max)).toBe(true);
    const icon = await sharp(
      Buffer.from((await pngMeta(org, "icon-180.png")).bytes),
    ).stats();
    expect(icon.channels.some((c) => c.min !== c.max)).toBe(true);
  });

  it("a failure is logged and never fails the logo upload", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Broken Store Co");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved = process.env.CDS_PUBLIC_STORAGE_DIR;
    process.env.CDS_PUBLIC_STORAGE_DIR = process.env.CDS_STORAGE_DIR;
    try {
      const up = await uploadImage(ctx, await solidPng(200, 200), "logo", {
        alt: "Logo",
        store,
      });
      expect(up.asset.id).toBeTruthy();
    } finally {
      process.env.CDS_PUBLIC_STORAGE_DIR = saved;
    }
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("[seo] site icons failed"),
      ),
    ).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(org);
    log.mockRestore();
  });

  it("refreshSiteIcons needs content or business write", async (t) => {
    if (!inst) return t.skip();
    const viewer = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(refreshSiteIcons(viewer, { publicStore })).rejects.toThrow();
  });
});
