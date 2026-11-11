// Media lifecycle on the real PocketBase 0.39.11 binary (07-12; CONT-33, CONT-36, D255,
// D275, resolution d; T-07-12-02, -08, -09): publish-time promote (private -> public, once,
// never for a protected page, never failing the publish), pages.version_refs over the kept
// versions, and the D275 delete rule (soft when referenced, else hard + objects + purge +
// invalidation). Sections use a test-only full-width probe whose refsOf reports chosen ids.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  FULL_WIDTH_ONLY,
  type SectionTypeDefinition,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureAddonSection } from "../../core/src/content/__fixtures__/fixture-addon";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import { savePopup } from "../src/content/popups";
import {
  liveTag,
  pageTag,
  recordingInvalidator,
  siteTag,
} from "../src/content/ports";
import {
  publishPage,
  restorePageVersion,
  listPageVersions,
  type PublishDeps,
} from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import { parseVersionRefs } from "../src/content/version-refs";
import { mintOrgContext, type OrgContext } from "../src/context";
import { uploadImage } from "../src/media";
import { solidPng } from "../src/media/__fixtures__/make-fixtures";
import {
  deleteMediaAsset,
  listLibrary,
  mediaUsedOn,
  uploadLibraryImage,
} from "../src/media/library";
import type { MediaDelivery } from "../src/media/ports";
import { getObjectStore, type ObjectStore } from "../src/storage";
import {
  tenantMediaDerivativeKey,
  tenantMediaKey,
  tenantPublicMediaKey,
} from "../src/storage/keys";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";

function idList(content: unknown, key: string): string[] {
  const v =
    typeof content === "object" && content !== null
      ? (content as Record<string, unknown>)[key]
      : undefined;
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Test-only block whose refsOf reports caller-chosen ids. */
const mediaProbe: SectionTypeDefinition = {
  type: "fixture-media",
  label: "Media (fixture)",
  description: "Test-only block reporting references.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => ({ popup_ids: [], media_ids: [] }),
  validate: (raw) => ({
    popup_ids: idList(raw, "popup_ids"),
    media_ids: idList(raw, "media_ids"),
  }),
  mapRichText: (content) => content,
  textsOf: () => [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "none" },
  refsOf: (content) => ({
    popups: idList(content, "popup_ids"),
    forms: [],
    media: idList(content, "media_ids"),
  }),
};

const registry = composeSectionRegistry(CORE_SECTIONS, [
  fixtureAddonSection,
  mediaProbe,
]);

/** An add-on owner lookup that owns nothing (no add-ons installed here). */
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let publicDir = "";
let store: ObjectStore;
let publicStore: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

type Spy = ObjectStore & { puts: string[]; failing: boolean };

function spyPublic(): Spy {
  const s: Spy = {
    puts: [],
    failing: false,
    async put(key, body, type) {
      if (s.failing) throw new Error("public store down");
      s.puts.push(key);
      return publicStore.put(key, body, type);
    },
    get: (k) => publicStore.get(k),
    delete: (k) => publicStore.delete(k),
    list: (p) => publicStore.list(p),
  };
  return s;
}

function fakeDelivery(): MediaDelivery & { purged: string[][] } {
  const purged: string[][] = [];
  return {
    name: "app",
    purged,
    urlFor: (a, v) => `/_media/${a.id}/${v}`,
    async purge(keys) {
      purged.push([...keys]);
    },
    async deliveryBytes() {
      return null;
    },
  };
}

type Deps = PublishDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
  publicStore: Spy;
};

function deps(): Deps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    publicStore: spyPublic(),
  };
}

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name: "Promote Co",
      slug: `promote-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  return { org, ctx: ctxAs(org, "owner") };
}

let slugN = 0;
async function pageWith(
  ctx: OrgContext,
  content: { media_ids?: string[]; popup_ids?: string[] },
): Promise<{ pageId: string; sectionId: string }> {
  slugN += 1;
  const page = await createPage(ctx, {
    title: `Media page ${slugN}`,
    slug: `media-page-${slugN}`,
  });
  const section = await saveSection(
    ctx,
    registry,
    {
      pageId: page.id,
      section_type: "fixture-media",
      row_layout: "full",
      content,
    },
    NO_OWNERS,
  );
  return { pageId: page.id, sectionId: section.id };
}

async function setSection(
  ctx: OrgContext,
  pageId: string,
  sectionId: string,
  content: { media_ids?: string[]; popup_ids?: string[] },
): Promise<void> {
  await saveSection(
    ctx,
    registry,
    {
      id: sectionId,
      pageId,
      section_type: "fixture-media",
      row_layout: "full",
      content,
    },
    NO_OWNERS,
  );
}

async function libraryImage(
  ctx: OrgContext,
  w = 1000,
  h = 500,
): Promise<string> {
  return (
    await uploadLibraryImage(ctx, await solidPng(w, h), {
      alt: "Photo",
      store,
    })
  ).asset.id;
}

async function row(id: string) {
  return pb.collection("media_assets").getOne(id);
}

async function exists(id: string): Promise<boolean> {
  try {
    await row(id);
    return true;
  } catch {
    return false;
  }
}

const enc = (s: string) => new TextEncoder().encode(s);

async function videoRow(
  org: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const id = (
    await pb.collection("media_assets").create({
      organization: org,
      kind: "video",
      status: "ready",
      source: "library",
      original_ext: "mp4",
      storage_dir: `tenants/${org}/media/v`,
      mime: "video/mp4",
      width: 1280,
      height: 720,
      ...fields,
    })
  ).id;
  for (const v of [
    "video.mp4",
    "poster.jpg",
    "poster.webp",
    "thumb",
    "captions.vtt",
  ] as const) {
    await store.put(tenantMediaDerivativeKey(org, id, v), enc(v));
  }
  return id;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-media-publish-"));
  publicDir = mkdtempSync(join(tmpdir(), "cds-media-publish-pub-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
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
  rmSync(storageDir, { recursive: true, force: true });
  rmSync(publicDir, { recursive: true, force: true });
});

describe("publish-time promote (CONT-33, resolution d)", () => {
  it("promotes section and pop-up media once, sets public_at, and records version_refs", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const y = await libraryImage(ctx, 700, 400);
    const d = deps();
    const { popup } = await savePopup(ctx, d, {
      name: "Promo",
      trigger: "delay",
      delay_seconds: 5,
      frequency: "once-per-visitor",
      show_on: "all-pages",
      enabled: true,
      content: {
        items: [{ id: "i1", kind: "image", asset: y, alt: "Pop photo" }],
      },
    });
    const { pageId } = await pageWith(ctx, {
      media_ids: [x],
      popup_ids: [popup.id],
    });
    const res = await publishPage(ctx, pageId, d);
    expect(res.status).toBe("published");

    const rx = await row(x);
    const ry = await row(y);
    expect(rx.public_at).not.toBe("");
    expect(ry.public_at).not.toBe("");
    for (const v of ["w480", "w960", "w2560", "thumb"] as const) {
      expect(
        await publicStore.get(tenantPublicMediaKey(org, "image", x, v)),
      ).not.toBeNull();
    }
    expect(
      await publicStore.get(tenantPublicMediaKey(org, "image", x, "w1600")),
    ).toBeNull();
    for (const v of ["w480", "w2560", "thumb"] as const) {
      expect(
        await publicStore.get(tenantPublicMediaKey(org, "image", y, v)),
      ).not.toBeNull();
    }
    const page = await pb.collection("pages").getOne(pageId);
    const refs = parseVersionRefs(page.version_refs)!;
    expect(refs.union.media).toEqual([x]);
    expect(refs.union.popups).toEqual([popup.id]);
    expect(Object.keys(refs.versions)).toHaveLength(1);
    expect(d.invalidator.tags).toEqual(
      expect.arrayContaining([pageTag(org, pageId), siteTag(org)]),
    );

    // A second publish copies nothing and leaves public_at alone.
    const d2 = deps();
    await publishPage(ctx, pageId, d2);
    expect(d2.publicStore.puts).toEqual([]);
    expect((await row(x)).public_at).toBe(rx.public_at);
  });

  it("never copies an original to the public store", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId } = await pageWith(ctx, { media_ids: [x] });
    const d = deps();
    await publishPage(ctx, pageId, d);
    expect(d.publicStore.puts.length).toBeGreaterThan(0);
    expect(d.publicStore.puts.some((k) => k.includes("original"))).toBe(false);
    expect(
      d.publicStore.puts.every((k) => k.includes(`/media/image/${x}/`)),
    ).toBe(true);
    expect(org).not.toBe("");
  });

  it("backfills the widths of a P6 intake photo from its private original", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const { asset } = await uploadImage(
      ctx,
      await solidPng(2000, 1000),
      "gallery",
      { store, alt: "Shop front" },
    );
    // A P6-era photo: no library widths in the private store.
    for (const v of ["w480", "w960", "w1600"] as const) {
      await store.delete(tenantMediaDerivativeKey(org, asset.id, v));
    }
    const { pageId } = await pageWith(ctx, { media_ids: [asset.id] });
    await publishPage(ctx, pageId, deps());
    for (const v of ["w480", "w960", "w1600"] as const) {
      expect(
        await store.get(tenantMediaDerivativeKey(org, asset.id, v)),
      ).not.toBeNull();
      expect(
        await publicStore.get(tenantPublicMediaKey(org, "image", asset.id, v)),
      ).not.toBeNull();
    }
    expect((await row(asset.id)).public_at).not.toBe("");
  });

  it("copies a video's file, posters, thumb and captions; a processing video stays private", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const video = await videoRow(org, { captions_path: "captions.vtt" });
    const busy = await videoRow(org, { status: "processing" });
    const { pageId } = await pageWith(ctx, { media_ids: [video, busy] });
    await publishPage(ctx, pageId, deps());
    for (const v of [
      "video.mp4",
      "poster.jpg",
      "poster.webp",
      "thumb",
      "captions.vtt",
    ] as const) {
      const got = await publicStore.get(
        tenantPublicMediaKey(org, "video", video, v),
      );
      expect(got, v).not.toBeNull();
    }
    expect((await row(video)).public_at).not.toBe("");
    expect((await row(busy)).public_at).toBe("");
    expect(
      await publicStore.get(
        tenantPublicMediaKey(org, "video", busy, "video.mp4"),
      ),
    ).toBeNull();
  });

  it("a password-protected page promotes nothing", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId } = await pageWith(ctx, { media_ids: [x] });
    await pb.collection("pages").update(pageId, { password_protected: true });
    const d = deps();
    const res = await publishPage(ctx, pageId, d);
    expect(res.status).toBe("published");
    expect(d.publicStore.puts).toEqual([]);
    expect((await row(x)).public_at).toBe("");
    expect(
      await publicStore.get(tenantPublicMediaKey(org, "image", x, "w960")),
    ).toBeNull();
  });

  it("a failing promote never fails the publish; the next publish promotes", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId } = await pageWith(ctx, { media_ids: [x] });
    const d = deps();
    d.publicStore.failing = true;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      errors.push(a);
    };
    try {
      const res = await publishPage(ctx, pageId, d);
      expect(res.status).toBe("published");
    } finally {
      console.error = orig;
    }
    expect((await row(x)).public_at).toBe("");
    expect(JSON.stringify(errors)).not.toMatch(/tenants\//);
    await publishPage(ctx, pageId, deps());
    expect((await row(x)).public_at).not.toBe("");
  });

  it("restoring a version promotes what it uses", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [] });
    await pb.collection("pages").update(pageId, { password_protected: true });
    await setSection(ctx, pageId, sectionId, { media_ids: [x] });
    await publishPage(ctx, pageId, deps());
    expect((await row(x)).public_at).toBe("");
    await pb.collection("pages").update(pageId, { password_protected: false });
    const [v] = await listPageVersions(ctx, pageId, store);
    await restorePageVersion(ctx, pageId, v!.id, deps());
    expect((await row(x)).public_at).not.toBe("");
  });
});

describe("pages.version_refs (CONT-36, D275)", () => {
  it("after 11 publishes the page keeps 10 versions and drops refs only in the pruned one", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const first = await libraryImage(ctx, 40, 30);
    const later = await libraryImage(ctx, 40, 30);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [first] });
    await publishPage(ctx, pageId, deps());
    await setSection(ctx, pageId, sectionId, { media_ids: [later] });
    for (let i = 0; i < 10; i += 1) await publishPage(ctx, pageId, deps());
    const versions = await listPageVersions(ctx, pageId, store);
    expect(versions).toHaveLength(10);
    const page = await pb.collection("pages").getOne(pageId);
    const refs = parseVersionRefs(page.version_refs)!;
    const names = versions.map((v) => `${v.id}.json`).sort();
    expect(Object.keys(refs.versions).sort()).toEqual(names);
    expect(refs.union.media).toEqual([later]);
  });

  it("a page published before P7 gets version_refs filled from its stored versions", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const a = await libraryImage(ctx, 40, 30);
    const b = await libraryImage(ctx, 40, 30);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [a] });
    await publishPage(ctx, pageId, deps());
    await pb.collection("pages").update(pageId, { version_refs: null });
    await setSection(ctx, pageId, sectionId, { media_ids: [b] });
    await publishPage(ctx, pageId, deps());
    const refs = parseVersionRefs(
      (await pb.collection("pages").getOne(pageId)).version_refs,
    )!;
    expect(Object.keys(refs.versions)).toHaveLength(2);
    expect(refs.union.media).toEqual([a, b]);
  });
});

describe("deleteMediaAsset (D275)", () => {
  function delDeps(d = deps()) {
    const delivery = fakeDelivery();
    return {
      d,
      delivery,
      dd: {
        sections: registry,
        invalidator: d.invalidator,
        delivery,
        store,
        publicStore: d.publicStore,
      },
    };
  }

  it("soft-deletes media used in a draft: hidden from the library, objects kept, no purge", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    await pageWith(ctx, { media_ids: [x] });
    const { dd, delivery } = delDeps();
    expect(await deleteMediaAsset(ctx, x, dd)).toEqual({ outcome: "soft" });
    expect((await row(x)).deleted_at).not.toBe("");
    expect((await listLibrary(ctx)).items.map((i) => i.id)).not.toContain(x);
    expect(await store.get(tenantMediaKey(org, x, "web.webp"))).not.toBeNull();
    expect(delivery.purged).toEqual([]);
  });

  it("soft-deletes media only in a kept version", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [x] });
    await publishPage(ctx, pageId, deps());
    await setSection(ctx, pageId, sectionId, { media_ids: [] });
    const { dd } = delDeps();
    expect((await deleteMediaAsset(ctx, x, dd)).outcome).toBe("soft");
  });

  it("soft-deletes media only in a pop-up", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const d = deps();
    await savePopup(ctx, d, {
      name: "Only here",
      trigger: "delay",
      delay_seconds: 5,
      frequency: "once-per-visitor",
      show_on: "all-pages",
      enabled: false,
      content: { items: [{ id: "i1", kind: "image", asset: x, alt: "P" }] },
    });
    const { dd } = delDeps(d);
    expect((await deleteMediaAsset(ctx, x, dd)).outcome).toBe("soft");
    const used = await mediaUsedOn(ctx, x, registry, { store });
    expect(used.inPopups).toBe(true);
  });

  it("soft-deletes a video cover and an active intake logo", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const cover = await libraryImage(ctx);
    await videoRow(org, { poster_asset: cover });
    const { dd } = delDeps();
    expect((await deleteMediaAsset(ctx, cover, dd)).outcome).toBe("soft");
    const logo = (
      await uploadImage(ctx, await solidPng(40, 30), "logo", { store })
    ).asset.id;
    expect((await deleteMediaAsset(ctx, logo, dd)).outcome).toBe("soft");
  });

  it("hard-deletes an unreferenced promoted asset: row, objects, purge and invalidation", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [x] });
    await publishPage(ctx, pageId, deps());
    expect((await row(x)).public_at).not.toBe("");
    // Drop every reference: draft, kept versions.
    await setSection(ctx, pageId, sectionId, { media_ids: [] });
    await pb.collection("pages").update(pageId, {
      version_refs: {
        v: 1,
        union: { popups: [], forms: [], media: [] },
        versions: {},
      },
    });
    const prefix = `dev/tenants/${org}/versions/pages/${pageId}/`;
    for (const o of await store.list(prefix)) await store.delete(o.key);

    const { dd, delivery, d } = delDeps();
    expect(await deleteMediaAsset(ctx, x, dd)).toEqual({ outcome: "hard" });
    expect(await exists(x)).toBe(false);
    expect(await store.list(`dev/tenants/${org}/media/${x}/`)).toEqual([]);
    expect(
      await publicStore.list(`dev/tenants/${org}/media/image/${x}/`),
    ).toEqual([]);
    expect(delivery.purged).toHaveLength(1);
    expect([...delivery.purged[0]!].sort()).toEqual(
      (["w480", "w960", "w1600", "w2560", "thumb"] as const)
        .map((v) => tenantPublicMediaKey(org, "image", x, v))
        .sort(),
    );
    expect(d.invalidator.tags).toEqual(
      expect.arrayContaining([siteTag(org), liveTag(org)]),
    );
  });

  it("hard-deletes a never-promoted asset without a purge; an impersonated delete is audited", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { dd, delivery } = delDeps();
    expect((await deleteMediaAsset(ctx, x, dd)).outcome).toBe("hard");
    expect(delivery.purged).toEqual([]);

    const y = await libraryImage(ctx);
    const staff = mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: IP,
      impersonator: seed.A.owner,
    });
    expect((await deleteMediaAsset(staff, y, dd)).outcome).toBe("hard");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:org} && action = {:a}", {
        org,
        a: "media_assets.delete",
      }),
    });
    expect(audit.map((r) => r.target_id)).toContain(y);
  });

  it("a soft-deleted asset is hard-deleted once nothing references it", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { media_ids: [x] });
    const { dd } = delDeps();
    expect((await deleteMediaAsset(ctx, x, dd)).outcome).toBe("soft");
    await setSection(ctx, pageId, sectionId, { media_ids: [] });
    expect((await deleteMediaAsset(ctx, x, dd)).outcome).toBe("hard");
    expect(await exists(x)).toBe(false);
  });

  it("a Viewer is Forbidden; an intake-kind asset needs business write", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { dd } = delDeps();
    await expect(
      deleteMediaAsset(ctxAs(org, "viewer"), x, dd),
    ).rejects.toBeInstanceOf(Forbidden);
    const hero = (
      await uploadImage(ctx, await solidPng(40, 30), "hero", { store })
    ).asset.id;
    await expect(
      deleteMediaAsset(ctxAs(org, "editor"), hero, dd),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await exists(x)).toBe(true);
    expect(await exists(hero)).toBe(true);
  });

  it("mediaUsedOn lists draft pages with titles, versions and pop-ups", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const x = await libraryImage(ctx);
    const { pageId } = await pageWith(ctx, { media_ids: [x] });
    await publishPage(ctx, pageId, deps());
    const used = await mediaUsedOn(ctx, x, registry, { store });
    expect(used.pages).toEqual([{ id: pageId, title: `Media page ${slugN}` }]);
    expect(used.inVersions).toBe(true);
    expect(used.inPopups).toBe(false);
    expect(used.asCover).toBe(false);
    expect(used.intakeSlot).toBe(false);
  });
});
