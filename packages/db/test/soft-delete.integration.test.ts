// CONT-36 soft-delete for pop-ups, forms and media on the real PocketBase 0.39.11 binary
// (07-28; D275, resolution f; invariant 1). One rule (content/soft-delete.ts): soft when a
// draft, a kept version, a pop-up's items, the menu button (or, for media, a cover or an
// active intake slot) references the item; otherwise hard. Restore clears deleted_at on what
// the restored version uses; the hourly GC hard-deletes what nothing references any more.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext, NotFound } from "@cds/core";
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
import { publishPage, restorePageVersion } from "../src/content/publish";
import { gcSoftDeleted } from "../src/content/soft-delete-gc";
import {
  deletePopup,
  getPopup,
  listPopups,
  popupUsage,
  savePopup,
} from "../src/content/popups";
import {
  liveTag,
  siteTag,
  recordingInvalidator,
  type ContentDeps,
} from "../src/content/ports";
import { deleteSection, saveSection } from "../src/content/sections";
import {
  readPublicPopups,
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import {
  deletedRefsAmong,
  isReferenced,
  undeleteOps,
} from "../src/content/soft-delete";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { deleteMediaAsset } from "../src/media/library";
import type { MediaDelivery } from "../src/media/ports";
import {
  PUBLIC_VARIANTS_BY_KIND,
  tenantMediaKey,
  tenantPublicMediaKey,
} from "../src/storage/keys";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  createForm,
  deleteForm,
  submitForm,
  type FormRecord,
} from "../src/forms";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import { getObjectStore, type ObjectStore } from "../src/storage";
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

/** Test-only block whose refsOf reports caller-chosen ids (the 07-12 mediaProbe pattern). */
const refProbe: SectionTypeDefinition = {
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

const registry = composeSectionRegistry(CORE_SECTIONS, [refProbe]);
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let publicDir = "";
let store: ObjectStore;
let publicStore: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
let ipCounter = 0;

type Refs = { popup_ids?: string[]; form_ids?: string[]; media_ids?: string[] };

function deps(): ContentDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
} {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

function ctxAs(orgId: string, impersonator?: string): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

type Org = { org: string; ctx: OrgContext; host: string };

let orgN = 0;
async function bareOrg(): Promise<Org> {
  orgN += 1;
  const slug = `sd-${orgN}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: "Soft Co",
      slug,
      status: "active",
    })
  ).id;
  const host = `${slug}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  return { org, ctx: ctxAs(org), host };
}

async function site(host: string): Promise<SiteContext> {
  clearResolverCache();
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

let slugN = 0;
async function pageWith(
  ctx: OrgContext,
  content: Refs,
): Promise<{ pageId: string; sectionId: string }> {
  slugN += 1;
  const page = await createPage(ctx, {
    title: `Page ${slugN}`,
    slug: `page-${slugN}`,
  });
  const section = await saveSection(
    ctx,
    registry,
    {
      pageId: page.id,
      section_type: "fixture-refs",
      row_layout: "full",
      content,
    },
    NO_OWNERS,
  );
  return { pageId: page.id, sectionId: section.id };
}

async function newPopup(
  ctx: OrgContext,
  items: unknown[] = [],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { popup } = await savePopup(ctx, deps(), {
    name: "Spring offer",
    trigger: "delay",
    delay_seconds: 5,
    frequency: "once-per-visitor",
    show_on: "all-pages",
    enabled: true,
    content: { items },
    ...extra,
  });
  return popup.id;
}

async function newForm(ctx: OrgContext): Promise<FormRecord> {
  return (await createForm(ctx, deps(), { template: "contact" })).form;
}

const formItem = (formId: string) => ({
  id: "fi1",
  kind: "form",
  form_id: formId,
});
const imageItem = (assetId: string) => ({
  id: "im1",
  kind: "image",
  asset: assetId,
  alt: "Photo",
});

async function mediaRow(
  org: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  return (
    await pb.collection("media_assets").create({
      organization: org,
      kind: "library",
      status: "ready",
      source: "library",
      original_ext: "png",
      storage_dir: `tenants/${org}/media/x`,
      mime: "image/png",
      width: 100,
      height: 100,
      ...fields,
    })
  ).id;
}

async function softMark(collection: string, id: string): Promise<void> {
  await pb
    .collection(collection)
    .update(id, { deleted_at: new Date().toISOString().replace("T", " ") });
}

async function deletedAt(collection: string, id: string): Promise<string> {
  return String((await pb.collection(collection).getOne(id)).deleted_at ?? "");
}

async function gone(collection: string, id: string): Promise<boolean> {
  try {
    await pb.collection(collection).getOne(id);
    return false;
  } catch {
    return true;
  }
}

async function auditActions(org: string, targetId: string): Promise<string[]> {
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org} && target_id = {:id}", {
      org,
      id: targetId,
    }),
    sort: "created",
  });
  return rows.map((r) => String(r.action));
}

function contactPayload(form: FormRecord): Record<string, unknown> {
  const idOf = (type: string) => form.fields.find((f) => f.type === type)!.id;
  return {
    [idOf("name")]: "Maria Lopez",
    [idOf("email")]: "maria@example.com",
    [idOf("long_text")]: "Hello there",
    website_url: "",
    _started: String(Date.now() - 10_000),
  };
}

function nextIp(): string {
  ipCounter += 1;
  return `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-soft-delete-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  publicDir = mkdtempSync(join(tmpdir(), "cds-soft-delete-pub-"));
  publicStore = new LocalDiskStore(publicDir);
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  resetFormSubmitLimitsForTests();
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

describe("delete rule (CONT-36, D275)", () => {
  it("isReferenced(popups): draft button, kept version only, menu button; false otherwise", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const scope = { orgId: org };
    const p = await newPopup(ctx);
    expect(await isReferenced(pb, scope, registry, "popups", p)).toBe(false);
    const { pageId, sectionId } = await pageWith(ctx, { popup_ids: [p] });
    expect(await isReferenced(pb, scope, registry, "popups", p)).toBe(true);
    // Kept version only: publish, then remove the draft row.
    await publishPage(ctx, pageId, { ...deps(), store });
    await deleteSection(ctx, sectionId);
    expect(await isReferenced(pb, scope, registry, "popups", p)).toBe(true);
    // Menu button only.
    const q = await newPopup(ctx);
    await pb.collection("site_settings").create({
      organization: org,
      nav: { items: [], cta: { label: "Book now", target: `popup:${q}` } },
    });
    expect(await isReferenced(pb, scope, registry, "popups", q)).toBe(true);
  });

  it("isReferenced(forms): draft form item, version, and inside any pop-up (soft-deleted too)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const scope = { orgId: org };
    const f = await newForm(ctx);
    expect(await isReferenced(pb, scope, registry, "forms", f.id)).toBe(false);
    const p = await newPopup(ctx, [formItem(f.id)]);
    expect(await isReferenced(pb, scope, registry, "forms", f.id)).toBe(true);
    await softMark("popups", p);
    expect(await isReferenced(pb, scope, registry, "forms", f.id)).toBe(true);
    await pb.collection("popups").delete(p);
    expect(await isReferenced(pb, scope, registry, "forms", f.id)).toBe(false);
    await pageWith(ctx, { form_ids: [f.id] });
    expect(await isReferenced(pb, scope, registry, "forms", f.id)).toBe(true);
  });

  it("isReferenced(media): draft, pop-up, cover and active intake slot", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const scope = { orgId: org };
    const m = await mediaRow(org);
    expect(await isReferenced(pb, scope, registry, "media", m)).toBe(false);
    await mediaRow(org, {
      kind: "video",
      mime: "video/mp4",
      original_ext: "mp4",
      poster_asset: m,
    });
    expect(await isReferenced(pb, scope, registry, "media", m)).toBe(true);
    const n = await mediaRow(org);
    await newPopup(ctx, [imageItem(n)]);
    expect(await isReferenced(pb, scope, registry, "media", n)).toBe(true);
    const logo = await mediaRow(org, { kind: "logo" });
    expect(await isReferenced(pb, scope, registry, "media", logo)).toBe(true);
    await pb.collection("media_assets").update(logo, {
      removed_at: new Date().toISOString().replace("T", " "),
    });
    expect(await isReferenced(pb, scope, registry, "media", logo)).toBe(false);
    const d = await mediaRow(org);
    await pageWith(ctx, { media_ids: [d] });
    expect(await isReferenced(pb, scope, registry, "media", d)).toBe(true);
  });

  it("another org's references never count", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    const p = await newPopup(a.ctx);
    // B's content mentions A's id (written directly: B's writers would refuse it).
    await pb.collection("site_settings").create({
      organization: b.org,
      nav: { items: [], cta: { label: "x", target: `popup:${p}` } },
    });
    const pageB = await createPage(b.ctx, { title: "B", slug: "b-page" });
    await pb.collection("page_sections").create({
      organization: b.org,
      page: pageB.id,
      page_slug: "b-page",
      section_type: "fixture-refs",
      row_layout: "full",
      content: { popup_ids: [p], form_ids: [], media_ids: [] },
      settings: {},
      sort_order: 0,
      is_published: true,
    });
    expect(
      await isReferenced(pb, { orgId: a.org }, registry, "popups", p),
    ).toBe(false);
    expect((await deletePopup(a.ctx, deps(), p)).outcome).toBe("hard");
  });

  it("deletePopup: soft while a draft button uses it (audited, hidden, still readable), hard once unused", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const staff = ctxAs(org, seed.A.owner);
    const p = await newPopup(ctx);
    const { sectionId } = await pageWith(ctx, { popup_ids: [p] });
    const d = deps();
    expect(await deletePopup(staff, d, p)).toEqual({ outcome: "soft" });
    expect(d.invalidator.tags).toEqual([liveTag(org)]);
    expect(await deletedAt("popups", p)).not.toBe("");
    expect(await auditActions(org, p)).toContain("popups.soft_delete");
    expect((await listPopups(ctx)).map((x) => x.id)).not.toContain(p);
    const all = await listPopups(ctx, { includeDeleted: true });
    expect(all.find((x) => x.id === p)?.deleted).toBe(true);
    expect((await getPopup(ctx, p)).deleted).toBe(true);
    // Deleting again while still used stays soft.
    expect(await deletePopup(ctx, deps(), p)).toEqual({ outcome: "soft" });
    await deleteSection(ctx, sectionId);
    expect(await deletePopup(staff, deps(), p)).toEqual({ outcome: "hard" });
    expect(await gone("popups", p)).toBe(true);
    expect(await auditActions(org, p)).toContain("popups.delete");
  });

  it("deletePopup: soft when only the menu button opens it; popupUsage reports inMenu", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const p = await newPopup(ctx);
    expect(await popupUsage(ctx, deps(), p)).toEqual({
      pages: [],
      inVersions: false,
      inMenu: false,
      used: false,
    });
    await pb.collection("site_settings").create({
      organization: org,
      nav: { items: [], cta: { label: "Book now", target: `popup:${p}` } },
    });
    expect(await popupUsage(ctx, deps(), p)).toEqual({
      pages: [],
      inVersions: false,
      inMenu: true,
      used: true,
    });
    expect((await deletePopup(ctx, deps(), p)).outcome).toBe("soft");
    const b = await bareOrg();
    await expect(popupUsage(b.ctx, deps(), p)).rejects.toThrow(NotFound);
  });

  it("readPublicPopups serves a soft-deleted pop-up button-only and never projects deleted_at", async (t) => {
    if (!inst) return t.skip();
    const { ctx, host } = await bareOrg();
    const live = await newPopup(ctx);
    const soft = await newPopup(ctx);
    const off = await newPopup(ctx, [], { enabled: false });
    await softMark("popups", soft);
    await softMark("popups", off);
    const pops = await readPublicPopups(await site(host));
    const byId = new Map(pops.map((p) => [p.id, p]));
    expect(byId.get(live)?.trigger).toBe("delay");
    expect(byId.get(soft)?.trigger).toBe("click");
    expect(byId.get(soft)?.show_on).toBe("button-only");
    expect(byId.get(soft)).not.toHaveProperty("deleted_at");
    expect(byId.has(off)).toBe(false);
    // The stored row is never rewritten.
    expect((await pb.collection("popups").getOne(soft)).trigger).toBe("delay");
  });

  it("deleteForm: soft in a draft or a pop-up; hard when unused, its messages keep form_name", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx, host } = await bareOrg();
    const staff = ctxAs(org, seed.A.owner);
    const inDraft = await newForm(ctx);
    await pageWith(ctx, { form_ids: [inDraft.id] });
    expect(await deleteForm(staff, deps(), inDraft.id)).toEqual({
      outcome: "soft",
    });
    expect(await auditActions(org, inDraft.id)).toContain("forms.soft_delete");
    // A soft-deleted form still takes messages (resolution f).
    const res = await submitForm(
      await site(host),
      inDraft.id,
      contactPayload(inDraft),
      { ip: nextIp() },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).form).toBe(
      inDraft.id,
    );

    const inPopup = await newForm(ctx);
    await newPopup(ctx, [formItem(inPopup.id)]);
    expect((await deleteForm(ctx, deps(), inPopup.id)).outcome).toBe("soft");

    const unused = await newForm(ctx);
    const msg = await submitForm(
      await site(host),
      unused.id,
      contactPayload(unused),
      { ip: nextIp() },
    );
    expect(await deleteForm(staff, deps(), unused.id)).toEqual({
      outcome: "hard",
    });
    expect(await gone("forms", unused.id)).toBe(true);
    expect(await auditActions(org, unused.id)).toContain("forms.delete");
    const kept = await pb.collection("form_submissions").getOne(msg.id);
    expect(kept.form).toBe("");
    expect(kept.form_name).toBe(unused.name);
  });

  it("deletedRefsAmong returns soft-deleted and missing ids only; a foreign id reads as missing", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    const live = await newPopup(a.ctx);
    const soft = await newPopup(a.ctx);
    await softMark("popups", soft);
    const f = await newForm(a.ctx);
    await softMark("forms", f.id);
    const m = await mediaRow(a.org);
    const foreign = await newPopup(b.ctx);
    const out = await deletedRefsAmong(a.ctx, {
      popups: [live, soft, "zzzzzzzzzzzzzzz", foreign],
      forms: [f.id],
      media: [m],
    });
    expect(out.popups.sort()).toEqual(
      [soft, "zzzzzzzzzzzzzzz", foreign].sort(),
    );
    expect(out.forms).toEqual([f.id]);
    expect(out.media).toEqual([]);
  });

  it("undeleteOps: one update per soft-deleted id of the org; none for live, missing or foreign", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    const soft = await newPopup(a.ctx);
    await softMark("popups", soft);
    const live = await newPopup(a.ctx);
    const f = await newForm(a.ctx);
    await softMark("forms", f.id);
    const m = await mediaRow(a.org);
    await softMark("media_assets", m);
    const foreign = await newPopup(b.ctx);
    await softMark("popups", foreign);
    const ops = await undeleteOps(
      pb,
      { orgId: a.org },
      {
        popups: [soft, live, foreign, "zzzzzzzzzzzzzzz"],
        forms: [f.id],
        media: [m],
      },
    );
    expect(ops).toEqual([
      {
        collection: "popups",
        op: "update",
        id: soft,
        body: { deleted_at: "" },
      },
      { collection: "forms", op: "update", id: f.id, body: { deleted_at: "" } },
      {
        collection: "media_assets",
        op: "update",
        id: m,
        body: { deleted_at: "" },
      },
    ]);
  });
});

async function setRefs(
  ctx: OrgContext,
  pageId: string,
  sectionId: string,
  content: Refs,
): Promise<void> {
  await saveSection(
    ctx,
    registry,
    {
      id: sectionId,
      pageId,
      section_type: "fixture-refs",
      row_layout: "full",
      content,
    },
    NO_OWNERS,
  );
}

function mediaDeps() {
  return { sections: registry, invalidator: recordingInvalidator(), store };
}

describe("restore clears deleted_at (CONT-36, D275)", () => {
  it("restoring a version brings back its pop-up, form, the pop-up's photo and a video's cover", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const f = await newForm(ctx);
    const photo = await mediaRow(org);
    const cover = await mediaRow(org);
    const video = await mediaRow(org, {
      kind: "video",
      mime: "video/mp4",
      original_ext: "mp4",
      poster_asset: cover,
    });
    const p = await newPopup(ctx, [imageItem(photo)]);
    const live = await newForm(ctx);
    const { pageId, sectionId } = await pageWith(ctx, {
      popup_ids: [p],
      form_ids: [f.id, live.id],
      media_ids: [video],
    });
    const d = { ...deps(), store };
    const v1 = await publishPage(ctx, pageId, d);
    if (v1.status !== "published") throw new Error("expected published");
    await setRefs(ctx, pageId, sectionId, {});
    await publishPage(ctx, pageId, d);
    // Everything v1 uses is still referenced by the kept version: all soft.
    expect((await deletePopup(ctx, deps(), p)).outcome).toBe("soft");
    expect((await deleteForm(ctx, deps(), f.id)).outcome).toBe("soft");
    for (const m of [video, cover, photo]) {
      expect((await deleteMediaAsset(ctx, m, mediaDeps())).outcome).toBe(
        "soft",
      );
    }
    const res = await restorePageVersion(ctx, pageId, v1.versionKey, d);
    expect(res.status).toBe("published");
    expect(await deletedAt("popups", p)).toBe("");
    expect(await deletedAt("forms", f.id)).toBe("");
    expect(await deletedAt("forms", live.id)).toBe("");
    for (const m of [video, cover, photo]) {
      expect(await deletedAt("media_assets", m)).toBe("");
    }
    expect((await listPopups(ctx)).map((x) => x.id)).toContain(p);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'page.restore' && target_id = {:id}", {
        id: pageId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect((audit[0]!.meta as Record<string, unknown>).undeleted).toEqual({
      popups: 1,
      forms: 1,
      media: 3,
    });
  });

  it("restore invalidates the live tag when it un-deletes something", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const p = await newPopup(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { popup_ids: [p] });
    const d = { ...deps(), store };
    const v1 = await publishPage(ctx, pageId, d);
    if (v1.status !== "published") throw new Error("expected published");
    await setRefs(ctx, pageId, sectionId, {});
    await deletePopup(ctx, deps(), p);
    d.invalidator.tags.length = 0;
    await restorePageVersion(ctx, pageId, v1.versionKey, d);
    expect(d.invalidator.tags).toContain(liveTag(org));
    expect(await deletedAt("popups", p)).toBe("");
  });
});

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

const enc = (s: string) => new TextEncoder().encode(s);

/** Un-delete every leftover soft-deleted row so the GC counts below are this test's alone. */
async function clearLeftovers(): Promise<void> {
  for (const c of ["popups", "forms", "media_assets"]) {
    const rows = await pb
      .collection(c)
      .getFullList({ filter: "deleted_at != ''", fields: "id" });
    for (const r of rows) {
      await pb.collection(c).update(r.id, { deleted_at: "" });
    }
  }
}

describe("soft-delete GC (D275, choice 7)", () => {
  it("needs a SystemContext and the section registry", async (t) => {
    if (!inst) return t.skip();
    const inv = recordingInvalidator();
    await expect(
      gcSoftDeleted(seed.ctxA as never, {
        sections: registry,
        invalidator: inv,
      }),
    ).rejects.toThrow(InvalidContext);
    await expect(
      gcSoftDeleted(mintSystemContext({ job: "test" }), {
        invalidator: inv,
      } as never),
    ).rejects.toThrow("gc needs the composed section registry");
  });

  it("cascades pop-ups -> forms -> media in one run, keeps what a version uses, scoped per org", async (t) => {
    if (!inst) return t.skip();
    await clearLeftovers();
    const a = await bareOrg();
    const b = await bareOrg();
    // Org A: pop-up P (form F + photo M inside), button removed; form K in a kept version.
    const f = await newForm(a.ctx);
    const m = await mediaRow(a.org, {
      public_at: "2026-10-01 10:00:00.000Z",
    });
    await store.put(tenantMediaKey(a.org, m, "web.webp"), enc("w"));
    for (const v of PUBLIC_VARIANTS_BY_KIND.image) {
      await publicStore.put(tenantPublicMediaKey(a.org, "image", m, v), enc(v));
    }
    const p = await newPopup(a.ctx, [formItem(f.id), imageItem(m)]);
    const btn = await pageWith(a.ctx, { popup_ids: [p] });
    expect((await deletePopup(a.ctx, deps(), p)).outcome).toBe("soft");
    expect((await deleteForm(a.ctx, deps(), f.id)).outcome).toBe("soft");
    expect((await deleteMediaAsset(a.ctx, m, mediaDeps())).outcome).toBe(
      "soft",
    );
    await setRefs(a.ctx, btn.pageId, btn.sectionId, {});
    const k = await newForm(a.ctx);
    const kept = await pageWith(a.ctx, { form_ids: [k.id] });
    await publishPage(a.ctx, kept.pageId, { ...deps(), store });
    await setRefs(a.ctx, kept.pageId, kept.sectionId, {});
    expect((await deleteForm(a.ctx, deps(), k.id)).outcome).toBe("soft");
    // Org B: its own soft-deleted pop-up Q, still used by B's draft; and a B row naming A's ids.
    const q = await newPopup(b.ctx);
    await pageWith(b.ctx, { popup_ids: [q] });
    await softMark("popups", q);
    const pageB = await createPage(b.ctx, { title: "B", slug: "gc-b" });
    await pb.collection("page_sections").create({
      organization: b.org,
      page: pageB.id,
      page_slug: "gc-b",
      section_type: "fixture-refs",
      row_layout: "full",
      content: { popup_ids: [p], form_ids: [f.id], media_ids: [m] },
      settings: {},
      sort_order: 0,
      is_published: true,
    });

    const invalidator = recordingInvalidator();
    const delivery = fakeDelivery();
    const sys = mintSystemContext({ job: "media" });
    const gcDeps = {
      sections: registry,
      invalidator,
      delivery,
      store,
      publicStore,
    };
    expect(await gcSoftDeleted(sys, gcDeps)).toEqual({
      gcPages: 0,
      gcPopups: 1,
      gcForms: 1,
      gcMedia: 1,
      gcKept: 2,
      gcErrors: 0,
    });
    expect(await gone("popups", p)).toBe(true);
    expect(await gone("forms", f.id)).toBe(true);
    expect(await gone("media_assets", m)).toBe(true);
    expect(await deletedAt("forms", k.id)).not.toBe("");
    expect(await deletedAt("popups", q)).not.toBe("");
    for (const [id, action] of [
      [p, "popups.gc_delete"],
      [f.id, "forms.gc_delete"],
      [m, "media_assets.gc_delete"],
    ] as const) {
      expect(await auditActions(a.org, id)).toContain(action);
    }
    expect(await store.get(tenantMediaKey(a.org, m, "web.webp"))).toBeNull();
    for (const v of PUBLIC_VARIANTS_BY_KIND.image) {
      expect(
        await publicStore.get(tenantPublicMediaKey(a.org, "image", m, v)),
      ).toBeNull();
    }
    expect(delivery.purged.flat()).toContain(
      tenantPublicMediaKey(a.org, "image", m, "w480"),
    );
    expect(invalidator.tags).toEqual([siteTag(a.org), liveTag(a.org)]);

    // A second run has nothing left to delete.
    expect(await gcSoftDeleted(sys, gcDeps)).toEqual({
      gcPages: 0,
      gcPopups: 0,
      gcForms: 0,
      gcMedia: 0,
      gcKept: 2,
      gcErrors: 0,
    });
  });

  it("pages past 200+ older still-referenced rows to collect a newer unused one (WR-A04)", async (t) => {
    if (!inst) return t.skip();
    await clearLeftovers();
    const a = await bareOrg();
    const template = await pb
      .collection("popups")
      .getOne(await newPopup(a.ctx));
    const body: Record<string, unknown> = { ...template };
    for (const k of [
      "id",
      "created",
      "updated",
      "collectionId",
      "collectionName",
    ]) {
      delete body[k];
    }
    const held: string[] = [template.id];
    for (let i = 0; i < 210; i++) {
      held.push((await pb.collection("popups").create(body)).id);
    }
    // Every held pop-up stays referenced by a draft section and is soft-deleted long ago.
    const page = await createPage(a.ctx, { title: "Held", slug: "gc-held" });
    await pb.collection("page_sections").create({
      organization: a.org,
      page: page.id,
      page_slug: "gc-held",
      section_type: "fixture-refs",
      row_layout: "full",
      content: { popup_ids: held, form_ids: [], media_ids: [] },
      settings: {},
      sort_order: 0,
      is_published: false,
    });
    for (const id of held) {
      await pb
        .collection("popups")
        .update(id, { deleted_at: "2026-01-01 00:00:00.000Z" });
    }
    const loose = (await pb.collection("popups").create(body)).id;
    await softMark("popups", loose);

    const res = await gcSoftDeleted(mintSystemContext({ job: "media" }), {
      sections: registry,
      invalidator: recordingInvalidator(),
      store,
      publicStore,
    });
    expect(res.gcPopups).toBe(1);
    expect(res.gcKept).toBe(held.length);
    expect(await gone("popups", loose)).toBe(true);
    expect(await deletedAt("popups", held[0]!)).not.toBe("");
    await clearLeftovers();
  });
});

describe("delete rule: edges", () => {
  it("a footer link that opens a pop-up counts as a reference", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const p = await newPopup(ctx);
    await pb.collection("site_settings").create({
      organization: org,
      footer: {
        extra_links: [{ id: "l1", label: "Offer", target: `popup:${p}` }],
      },
    });
    expect(await isReferenced(pb, { orgId: org }, registry, "popups", p)).toBe(
      true,
    );
    expect((await deletePopup(ctx, deps(), p)).outcome).toBe("soft");
  });

  it("deleting a soft-deleted form after its last use is removed is a hard delete", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const f = await newForm(ctx);
    const { pageId, sectionId } = await pageWith(ctx, { form_ids: [f.id] });
    expect((await deleteForm(ctx, deps(), f.id)).outcome).toBe("soft");
    await setRefs(ctx, pageId, sectionId, {});
    expect((await deleteForm(ctx, deps(), f.id)).outcome).toBe("hard");
    expect(await gone("forms", f.id)).toBe(true);
  });

  it("an un-deleted pop-up is served with its stored trigger again", async (t) => {
    if (!inst) return t.skip();
    const { ctx, host } = await bareOrg();
    const p = await newPopup(ctx);
    await softMark("popups", p);
    let pops = await readPublicPopups(await site(host));
    expect(pops.find((x) => x.id === p)?.trigger).toBe("click");
    const ops = await undeleteOps(pb, ctx, {
      popups: [p],
      forms: [],
      media: [],
    });
    expect(ops).toHaveLength(1);
    await pb.collection("popups").update(p, { deleted_at: "" });
    pops = await readPublicPopups(await site(host));
    expect(pops.find((x) => x.id === p)?.trigger).toBe("delay");
    expect(pops.find((x) => x.id === p)?.show_on).toBe("all-pages");
  });

  it("empty and all-live inputs: no ops, nothing reported deleted", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const p = await newPopup(ctx);
    const f = await newForm(ctx);
    const m = await mediaRow(org);
    const empty = { popups: [], forms: [], media: [] };
    expect(await undeleteOps(pb, ctx, empty)).toEqual([]);
    expect(await deletedRefsAmong(ctx, empty)).toEqual(empty);
    const live = { popups: [p], forms: [f.id], media: [m] };
    expect(await undeleteOps(pb, ctx, live)).toEqual([]);
    expect(await deletedRefsAmong(ctx, live)).toEqual(empty);
  });
});
