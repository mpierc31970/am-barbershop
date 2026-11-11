// Page delete and restore on the real PocketBase 0.39.11 binary (11-29; DASH-06, DASH-08;
// D183, D254, D275; T-11-29-01..04). A page (never Home or the 404 page) leaves the live
// site at once: its manifest entry goes, its old address redirects to the chosen page (or
// 404s), menus and footers skip it, the allowance frees. Restore within 30 days brings it
// back unless the allowance is full or its slug is taken. Readers skip the bin; the GC
// purges after 30 days.
import "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  PageLimitReached,
  type SiteManifest,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { pagesUsage } from "../src/content/allowance";
import { saveFooter } from "../src/content/chrome/footer";
import { addPageToNav, saveNav } from "../src/content/chrome/nav";
import { readPageDraft } from "../src/content/draft-print";
import { previewPage } from "../src/content/project";
import { findRefHolders } from "../src/content/references";
import { gcSoftDeleted } from "../src/content/soft-delete-gc";
import { exportTenant } from "../src/export";
import {
  deletePage,
  listRecentlyDeleted,
  pageDeleteCase,
  restoreDeletedPage,
} from "../src/content/page-delete";
import {
  createPage,
  getPage,
  listPages,
  SlugTaken,
  updatePage,
} from "../src/content/pages";
import {
  recordingInvalidator,
  siteTag,
  type ContentScanner,
  type SearchPinger,
} from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { newRecordId } from "../src/repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteIndexKey,
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
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const clean: ContentScanner = {
  scan: () => Promise.resolve({ verdict: "clean", reasons: [] }),
};
const pinger: SearchPinger = { ping: () => Promise.resolve() };

type Deps = PublishDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
};
function deps(): Deps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    scanner: clean,
    pinger,
    store,
  };
}

let n = 0;
type Org = {
  org: string;
  owner: OrgContext;
  editor: OrgContext;
  viewer: OrgContext;
};
async function bareOrg(): Promise<Org> {
  n += 1;
  const tag = `${n}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Del ${tag}`,
      slug: `del-${tag}`,
      status: "active",
    })
  ).id;
  const mk = (role: "owner" | "editor" | "viewer") =>
    mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role,
      grants: [],
      ip: IP,
    });
  return {
    org,
    owner: mk("owner"),
    editor: mk("editor"),
    viewer: mk("viewer"),
  };
}

async function published(
  ctx: OrgContext,
  title: string,
  slug: string,
): Promise<string> {
  const page = await createPage(ctx, { title, slug }, store);
  await saveSection(ctx, registry, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: title, text: "<p>Hello</p>" },
  });
  const res = await publishPage(ctx, page.id, deps());
  expect(res.status).toBe("published");
  return page.id;
}

async function manifestOf(org: string): Promise<SiteManifest> {
  const bytes = await store.get(tenantSiteManifestKey(org));
  return JSON.parse(new TextDecoder().decode(bytes!)) as SiteManifest;
}

/** Home + About + Contact, published, About in the menu and the footer. */
async function site(): Promise<
  Org & { home: string; about: string; contact: string }
> {
  const o = await bareOrg();
  const home = await published(o.owner, "Home", "home");
  const about = await published(o.owner, "About", "about");
  const contact = await published(o.owner, "Contact", "contact");
  await saveNav(o.owner, deps(), {
    items: [
      {
        id: newRecordId(),
        label: "About us",
        target: `page:${about}`,
        new_tab: false,
        children: [],
      },
    ],
    cta: null,
  });
  await saveFooter(o.owner, deps(), {
    show_address: true,
    show_hours: true,
    show_socials: true,
    extra_links: [
      {
        id: newRecordId(),
        label: "Who we are",
        target: `page:${about}`,
        new_tab: false,
      },
    ],
    copyright: "",
  });
  return { ...o, home, about, contact };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-page-delete-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
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

describe("pageDeleteCase", () => {
  it("Home and the 404 page are not deletable; delete throws", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const c = await pageDeleteCase(s.owner, s.home);
    expect(c.deletable).toBe(false);
    expect(c.reason).toBe("home");
    await expect(
      deletePage(s.owner, s.home, { redirectTo: null }, deps()),
    ).rejects.toBeInstanceOf(InvalidInput);

    const nf = await pb.collection("pages").create({
      organization: s.org,
      title: "Page not found",
      slug: "system-404",
      seo: {},
      status: "draft",
      kind: "system-404",
      has_unpublished_changes: true,
      previous_slugs: [],
      password_protected: false,
    });
    const c404 = await pageDeleteCase(s.owner, nf.id);
    expect(c404.deletable).toBe(false);
    expect(c404.reason).toBe("system");
    await expect(
      deletePage(s.owner, nf.id, { redirectTo: null }, deps()),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("lists menu and footer links to the page and the redirect options", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const c = await pageDeleteCase(s.owner, s.about);
    expect(c.deletable).toBe(true);
    expect(c.page).toEqual({ id: s.about, title: "About", slug: "about" });
    expect(c.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: "menu", label: "About us" }),
        expect.objectContaining({ where: "footer", label: "Who we are" }),
      ]),
    );
    expect(c.redirectOptions.map((o) => o.id)).toEqual([s.home, s.contact]);
  });

  it("lists draft buttons on other pages that link to the page's address", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await saveSection(s.owner, registry, {
      pageId: s.contact,
      section_type: "cta-banner",
      row_layout: "full",
      content: {
        heading: "Learn more",
        button_text: "Read about us",
        button_link: "/about",
      },
    });
    const c = await pageDeleteCase(s.owner, s.about);
    const buttons = c.links.filter((l) => l.where === "button");
    expect(buttons).toEqual([
      { where: "button", label: "Read about us", place: "Contact" },
    ]);
  });
});

describe("deletePage", () => {
  it("drops the page from the manifest, redirects its address to Home and frees the allowance", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const before = await pagesUsage(s.owner);
    const d = deps();
    await deletePage(s.owner, s.about, { redirectTo: s.home }, d);
    const m = await manifestOf(s.org);
    expect(m.pages.about).toBeUndefined();
    expect(m.redirects.about).toBe("home");
    expect((await pagesUsage(s.owner)).used).toBe(before.used - 1);
    expect(d.invalidator.tags).toContain(siteTag(s.org));
    const row = await pb.collection("pages").getOne(s.about);
    expect(row.deleted_at).not.toBe("");
    expect(row.delete_redirect_to).toBe(s.home);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'page.deleted'", {
        o: s.org,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.target_id).toBe(s.about);
  });

  it("no redirect target: the old address 404s (no redirect entry)", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.contact, { redirectTo: null }, deps());
    const m = await manifestOf(s.org);
    expect(m.pages.contact).toBeUndefined();
    expect(m.redirects.contact).toBeUndefined();
  });

  it("WR-B02: older redirects follow a deleted target (A->B->C) or go when it has none", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: s.contact }, deps());
    expect((await manifestOf(s.org)).redirects.about).toBe("contact");
    await deletePage(s.owner, s.contact, { redirectTo: s.home }, deps());
    const m = await manifestOf(s.org);
    expect(m.redirects.about).toBe("home");
    expect(m.redirects.contact).toBe("home");

    const s2 = await site();
    await deletePage(s2.owner, s2.about, { redirectTo: s2.contact }, deps());
    await deletePage(s2.owner, s2.contact, { redirectTo: null }, deps());
    const m2 = await manifestOf(s2.org);
    expect(m2.redirects.about).toBeUndefined();
    expect(m2.redirects.contact).toBeUndefined();
  });

  it("refuses another org's page as the redirect target", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const other = await site();
    await expect(
      deletePage(s.owner, s.about, { redirectTo: other.home }, deps()),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      deletePage(s.owner, s.about, { redirectTo: s.about }, deps()),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await manifestOf(s.org)).pages.about).toBeDefined();
  });

  it("another org's page is NotFound", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const other = await site();
    await expect(
      deletePage(s.owner, other.about, { redirectTo: null }, deps()),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("an Editor can delete; a Viewer cannot", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await expect(
      deletePage(s.viewer, s.about, { redirectTo: null }, deps()),
    ).rejects.toBeInstanceOf(Forbidden);
    await deletePage(s.editor, s.about, { redirectTo: null }, deps());
    expect((await manifestOf(s.org)).pages.about).toBeUndefined();
  });
});

describe("Recently deleted and restore", () => {
  it("lists pages deleted in the last 30 days, newest first", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    await deletePage(s.owner, s.contact, { redirectTo: null }, deps());
    await pb.collection("pages").update(s.about, {
      deleted_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const list = await listRecentlyDeleted(s.viewer);
    expect(list.map((p) => p.id)).toEqual([s.contact, s.about]);
    expect(list[0]).toMatchObject({ title: "Contact", slug: "contact" });
    // Older than 30 days: no longer listed.
    await pb.collection("pages").update(s.about, {
      deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    expect((await listRecentlyDeleted(s.viewer)).map((p) => p.id)).toEqual([
      s.contact,
    ]);
  });

  it("restore puts the page back in the manifest and removes the redirect", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: s.home }, deps());
    await restoreDeletedPage(s.owner, s.about, deps());
    const m = await manifestOf(s.org);
    expect(m.pages.about?.id).toBe(s.about);
    expect(m.redirects.about).toBeUndefined();
    const row = await pb.collection("pages").getOne(s.about);
    expect(row.deleted_at).toBe("");
    expect(row.delete_redirect_to).toBe("");
    expect((await listPages(s.owner)).map((p) => p.id)).toContain(s.about);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'page.restored'", {
        o: s.org,
      }),
    });
    expect(audit).toHaveLength(1);
  });

  it("IN-B02: restore takes the manifest's protected flag from the live row", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    // The password was set after the last publish: the published JSON still says false.
    await pb
      .collection("pages")
      .update(s.about, { password_protected: true, password_hash: "x$hash" });
    await restoreDeletedPage(s.owner, s.about, deps());
    expect((await manifestOf(s.org)).pages.about?.protected).toBe(true);
  });

  it("restore is refused at the allowance (PageLimitReached)", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    for (let i = 0; i < 8; i++) {
      await createPage(
        s.owner,
        { title: `Fill ${i}`, slug: `fill-${i}` },
        store,
      );
    }
    await expect(
      restoreDeletedPage(s.owner, s.about, deps()),
    ).rejects.toBeInstanceOf(PageLimitReached);
  });

  it("restore is refused when a new page took its live address (SlugTaken)", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    // A draft rename frees the DB slug while /about stays live for the page.
    await updatePage(s.owner, s.about, { slug: "about-us" }, store);
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    await published(s.owner, "New about", "about");
    await expect(
      restoreDeletedPage(s.owner, s.about, deps()),
    ).rejects.toBeInstanceOf(SlugTaken);
  });

  it("restore after 30 days is NotFound; a Viewer cannot restore", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    await expect(
      restoreDeletedPage(s.viewer, s.about, deps()),
    ).rejects.toBeInstanceOf(Forbidden);
    await pb.collection("pages").update(s.about, {
      deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    await expect(
      restoreDeletedPage(s.owner, s.about, deps()),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("a deleted page is gone from getPage and listPages", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    expect((await listPages(s.owner)).map((p) => p.id)).not.toContain(s.about);
    await expect(getPage(s.owner, s.about)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("readers skip a deleted page (Pitfall 12)", () => {
  it("publish, preview, add to menu and the assembly draft read refuse it", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.contact, { redirectTo: null }, deps());
    await expect(
      publishPage(s.owner, s.contact, deps()),
    ).rejects.toBeInstanceOf(NotFound);
    expect((await manifestOf(s.org)).pages.contact).toBeUndefined();
    await expect(
      previewPage(s.owner, s.contact, registry),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      addPageToNav(s.owner, deps(), s.contact),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await readPageDraft(s.owner, s.contact)).toBeNull();
  });

  it("the site index (sitemap, search, llms.txt) drops it; the export keeps it as deleted", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: s.home }, deps());
    const raw = await store.get(tenantSiteIndexKey(s.org));
    const index = JSON.parse(new TextDecoder().decode(raw!)) as {
      pages: { id: string }[];
    };
    const ids = index.pages.map((p) => p.id);
    expect(ids).toContain(s.home);
    expect(ids).not.toContain(s.about);

    const res = await exportTenant(s.owner, s.org, { store });
    const bundle = JSON.parse(
      new TextDecoder().decode((await store.get(res.key))!),
    ) as { collections: Record<string, Record<string, unknown>[]> };
    const row = bundle.collections.pages!.find((p) => p.id === s.about);
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBe("");
    expect(row!.deleted_by).toBeUndefined();
  });

  it("where-used lists (findRefHolders) leave out pages in the bin", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    const formId = newRecordId();
    // The page's one kept version also places a form (version_refs, 07-12).
    const vr = (await pb.collection("pages").getOne(s.about)).version_refs as {
      versions: Record<string, { forms: string[] }>;
    };
    for (const v of Object.values(vr.versions)) v.forms.push(formId);
    await pb.collection("pages").update(s.about, { version_refs: vr });
    const h0 = await findRefHolders(pb, s.owner, registry, "forms", formId);
    expect(h0.versionPages).toEqual([s.about]);
    await deletePage(s.owner, s.about, { redirectTo: null }, deps());
    const h1 = await findRefHolders(pb, s.owner, registry, "forms", formId);
    expect(h1.versionPages).toEqual([]);
  });
});

describe("GC purges pages after 30 days (D187, D275)", () => {
  const sys = () => mintSystemContext({ job: "media" });

  it("keeps a page deleted 29 days ago; purges one deleted 31 days ago with its sections, versions and JSON", async (t) => {
    if (!inst) return t.skip();
    const s = await site();
    await deletePage(s.owner, s.about, { redirectTo: s.home }, deps());
    await deletePage(s.owner, s.contact, { redirectTo: null }, deps());
    const day = 86_400_000;
    await pb.collection("pages").update(s.about, {
      deleted_at: new Date(Date.now() - 31 * day).toISOString(),
    });
    await pb.collection("pages").update(s.contact, {
      deleted_at: new Date(Date.now() - 29 * day).toISOString(),
    });
    expect(
      (await store.list(tenantVersionPrefix(s.org, s.about))).length,
    ).toBeGreaterThan(0);

    const r = await gcSoftDeleted(sys(), {
      sections: registry,
      invalidator: recordingInvalidator(),
      store,
    });
    // Earlier cases leave 31-day-old pages in other orgs: count at least this one.
    expect(r.gcPages).toBeGreaterThanOrEqual(1);
    expect(r.gcErrors).toBe(0);

    await expect(pb.collection("pages").getOne(s.about)).rejects.toThrow();
    const sections = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: s.about }),
    });
    expect(sections).toHaveLength(0);
    expect(await store.list(tenantVersionPrefix(s.org, s.about))).toHaveLength(
      0,
    );
    expect(await store.get(tenantPublishedPageKey(s.org, s.about))).toBeNull();
    // The old address keeps forwarding.
    expect((await manifestOf(s.org)).redirects.about).toBe("home");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'pages.gc_delete'", {
        o: s.org,
      }),
    });
    expect(audit.map((a) => a.target_id)).toEqual([s.about]);

    // Day 29: kept, still restorable.
    expect((await pb.collection("pages").getOne(s.contact)).id).toBe(s.contact);
    expect(
      (await store.list(tenantVersionPrefix(s.org, s.contact))).length,
    ).toBeGreaterThan(0);
  });
});
