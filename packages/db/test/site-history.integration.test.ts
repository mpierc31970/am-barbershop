// Site-part histories on the real PocketBase 0.39.11 binary (07-29; CONT-36, D184, D187,
// D275; CONTEXT Area 5 row 3; invariant 1, TEN-03; T-07-29-01..10).
//
// snapshots: every save of nav / footer / banner / settings leaves a deny-by-default JSON
// file of only that part, at most 10, no duplicates, a baseline on the first save, never
// blocks the save, never nests the org lock.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  resolveNav,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  addPageToNav,
  getNav,
  saveFooter,
  saveNav,
  saveSiteSettings,
} from "../src/content/chrome";
import {
  listSiteSettingsVersions,
  restoreSiteSettingsVersion,
} from "../src/content/history";
import { deletePopup } from "../src/content/popups";
import {
  liveTag,
  recordingInvalidator,
  type ContentDeps,
} from "../src/content/ports";
import { saveBanner } from "../src/content/site-settings";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  getObjectStore,
  tenantSitePartVersionKey,
  tenantSitePartVersionPrefix,
  type ObjectStore,
  type SiteHistoryPart,
} from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let store: ObjectStore;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function historyDeps(): {
  d: ContentDeps;
  invalidator: ReturnType<typeof recordingInvalidator>;
} {
  const invalidator = recordingInvalidator();
  const d: ContentDeps = {
    sections: registry,
    invalidator,
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
  return { d, invalidator };
}

async function keysOf(org: string, part: SiteHistoryPart): Promise<string[]> {
  return (await store.list(tenantSitePartVersionPrefix(org, part)))
    .map((o) => o.key)
    .sort();
}

async function fileOf(key: string): Promise<Record<string, unknown>> {
  const bytes = await store.get(key);
  return JSON.parse(new TextDecoder().decode(bytes!)) as Record<
    string,
    unknown
  >;
}

async function rowOf(org: string) {
  return pb
    .collection("site_settings")
    .getFirstListItem(pb.filter("organization = {:org}", { org }));
}

function within<T>(p: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error("timed out: nested lock?")), ms),
    ),
  ]);
}

function navWith(label: string) {
  return { items: [{ id: "home", label, target: `page:${seed.A.page}` }] };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-site-history-"));
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

describe("snapshots", () => {
  it("keeps the newest 10 nav versions and adds none for an identical re-save", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    for (let i = 1; i <= 12; i++) {
      await saveNav(seed.ctxA, d, navWith(`Home ${i}`));
    }
    const keys = await keysOf(seed.A.org, "nav");
    expect(keys).toHaveLength(10);
    const newest = await fileOf(keys[keys.length - 1]!);
    expect((newest.row as { nav: unknown }).nav).toEqual(
      await getNav(seed.ctxA),
    );
    const oldest = await fileOf(keys[0]!);
    expect(
      (oldest.row as { nav: { items: { label: string }[] } }).nav.items[0]!
        .label,
    ).toBe("Home 3");
    await saveNav(seed.ctxA, d, navWith("Home 12"));
    expect(await keysOf(seed.A.org, "nav")).toEqual(keys);
  });

  it("writes the fixed envelope with only the part's fields", async (t) => {
    if (!inst) return t.skip();
    const keys = await keysOf(seed.A.org, "nav");
    const file = await fileOf(keys[keys.length - 1]!);
    expect(Object.keys(file).sort()).toEqual(["at", "by", "part", "row", "v"]);
    expect(file.v).toBe(1);
    expect(file.part).toBe("nav");
    expect(Object.keys(file.row as object)).toEqual(["nav"]);
    expect(file.by).toEqual({ actor: seed.ctxA.actor, staff: false });
    const raw = JSON.stringify(file);
    expect(raw).not.toContain(seed.A.org);
    expect(raw).not.toContain("@");
  });

  it("an impersonated save is marked staff", async (t) => {
    if (!inst) return t.skip();
    const staff: OrgContext = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.ctxA.actor,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
      impersonator: seed.ctxA.actor,
    });
    await saveNav(staff, historyDeps().d, navWith("Staff edit"));
    const keys = await keysOf(seed.A.org, "nav");
    expect((await fileOf(keys[keys.length - 1]!)).by).toEqual({
      actor: seed.ctxA.actor,
      staff: true,
    });
  });

  it("footer, banner and settings each write under their own part only", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const navBefore = await keysOf(seed.A.org, "nav");
    const before = {
      footer: (await keysOf(seed.A.org, "footer")).length,
      banner: (await keysOf(seed.A.org, "banner")).length,
      settings: (await keysOf(seed.A.org, "settings")).length,
    };
    await saveFooter(seed.ctxA, d, {
      show_hours: false,
      copyright: "© {year} A",
    });
    expect((await keysOf(seed.A.org, "footer")).length).toBeGreaterThan(
      before.footer,
    );
    expect((await keysOf(seed.A.org, "banner")).length).toBe(before.banner);
    await saveSiteSettings(seed.ctxA, d, {
      language: "es",
      show_translate: true,
      allow_ai_crawlers: false,
    });
    const sKeys = await keysOf(seed.A.org, "settings");
    expect(sKeys.length).toBeGreaterThan(before.settings);
    const sFile = await fileOf(sKeys[sKeys.length - 1]!);
    const row = sFile.row as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["language", "seo", "settings"]);
    expect(row.language).toBe("es");
    expect((row.seo as { allow_ai_crawlers: boolean }).allow_ai_crawlers).toBe(
      false,
    );
    expect(await keysOf(seed.A.org, "nav")).toEqual(navBefore);
    const fKeys = await keysOf(seed.A.org, "footer");
    expect(
      Object.keys((await fileOf(fKeys[fKeys.length - 1]!)).row as object),
    ).toEqual(["footer"]);
  });

  it("the first banner save keeps the pre-history banner as a baseline", async (t) => {
    if (!inst) return t.skip();
    const row = await rowOf(seed.B.org);
    await pb.collection("site_settings").update(row.id, {
      banner: { enabled: true, message: "Old B banner" },
    });
    expect(await keysOf(seed.B.org, "banner")).toHaveLength(0);
    await saveBanner(seed.ctxB, historyDeps().d, {
      enabled: true,
      message: "New B banner",
    });
    const keys = await keysOf(seed.B.org, "banner");
    expect(keys).toHaveLength(2);
    const base = await fileOf(keys[0]!);
    expect(base.by).toBeNull();
    expect((base.row as { banner: { message: string } }).banner.message).toBe(
      "Old B banner",
    );
    const next = await fileOf(keys[1]!);
    expect((next.row as { banner: { message: string } }).banner.message).toBe(
      "New B banner",
    );
  });

  it("a failing store never blocks the save and logs without ids", async (t) => {
    if (!inst) return t.skip();
    const put = vi
      .spyOn(LocalDiskStore.prototype, "put")
      .mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await saveNav(seed.ctxA, historyDeps().d, navWith("Store down"));
      expect((await getNav(seed.ctxA))?.items[0]?.label).toBe("Store down");
      const lines = warn.mock.calls.map((c) => c.join(" "));
      expect(lines).toContain("[history] snapshot failed");
      for (const l of lines) {
        expect(l).not.toContain(seed.A.org);
        expect(l).not.toContain("versions/site");
      }
    } finally {
      put.mockRestore();
      warn.mockRestore();
    }
  });

  it("no writer nests the org lock", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    await within(saveNav(seed.ctxA, d, navWith("Lock 1")));
    await within(saveFooter(seed.ctxA, d, { copyright: "Lock" }));
    await within(saveBanner(seed.ctxA, d, { enabled: false, message: "Lock" }));
    await within(saveSiteSettings(seed.ctxA, d, { show_search: true }));
    await within(addPageToNav(seed.ctxA, d, seed.A.page));
    await within(
      Promise.all([
        saveSiteSettings(seed.ctxA, d, { show_search: false }),
        saveNav(seed.ctxA, d, navWith("Lock 2")),
      ]),
    );
  });
});

function idOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1, -".json".length);
}

function picked(row: Record<string, unknown>) {
  return {
    nav: row.nav,
    footer: row.footer,
    banner: row.banner,
    language: row.language,
    settings: row.settings,
    seo: row.seo,
  };
}

function viewerA(): OrgContext {
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.ctxA.actor,
    role: "viewer",
    grants: [],
    ip: "127.0.0.1",
  });
}

describe("list and restore", () => {
  it("lists newest first, at most 10, with one Current and who labels", async (t) => {
    if (!inst) return t.skip();
    const list = await listSiteSettingsVersions(seed.ctxA, "nav");
    expect(list.length).toBeLessThanOrEqual(10);
    expect([...list].sort((a, b) => (a.at < b.at ? 1 : -1))).toEqual(list);
    expect(list.filter((v) => v.current)).toHaveLength(1);
    expect(list[0]!.current).toBe(true);
    expect(list.some((v) => v.who.kind === "member")).toBe(true);
    expect(list.some((v) => v.who.kind === "support")).toBe(true);
    expect(JSON.stringify(list)).not.toContain(seed.ctxA.actor);
    expect(await listSiteSettingsVersions(viewerA(), "nav")).toEqual(list);
    const banner = await listSiteSettingsVersions(seed.ctxB, "banner");
    expect(banner.at(-1)!.who).toEqual({ kind: "earlier" });
    await expect(
      listSiteSettingsVersions(seed.ctxA, "pages" as never),
    ).rejects.toThrow(InvalidInput);
  });

  it("labels a removed member as former; skips unreadable files; a raw write clears Current", async (t) => {
    if (!inst) return t.skip();
    const m = await pb.collection("memberships").getFirstListItem(
      pb.filter("organization = {:o} && user = {:u}", {
        o: seed.A.org,
        u: seed.ctxA.actor,
      }),
    );
    await pb.collection("memberships").delete(m.id);
    try {
      const list = await listSiteSettingsVersions(seed.ctxA, "footer");
      expect(list.every((v) => v.who.kind !== "member")).toBe(true);
      expect(list.some((v) => v.who.kind === "former")).toBe(true);
    } finally {
      await pb.collection("memberships").create({
        organization: m.organization,
        user: m.user,
        role: m.role,
      });
    }
    const junk = tenantSitePartVersionKey(
      seed.A.org,
      "footer",
      new Date("2020-01-01T00:00:00.000Z"),
    );
    await store.put(junk, "not json", "application/json");
    const ids = (await listSiteSettingsVersions(seed.ctxA, "footer")).map(
      (v) => v.id,
    );
    expect(ids).not.toContain(idOf(junk));
    await store.delete(junk);

    const row = await rowOf(seed.A.org);
    await pb
      .collection("site_settings")
      .update(row.id, { footer: { copyright: "raw" } });
    const after = await listSiteSettingsVersions(seed.ctxA, "footer");
    expect(after.some((v) => v.current)).toBe(false);
    await saveFooter(seed.ctxA, historyDeps().d, { copyright: "© {year} A" });
  });

  it("restores the menu only, audited, live at once, and as a new Current version", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    await saveNav(seed.ctxA, d, navWith("Restore me"));
    const v1 = (await listSiteSettingsVersions(seed.ctxA, "nav"))[0]!.id;
    await saveNav(seed.ctxA, d, navWith("Later"));
    const before = picked(await rowOf(seed.A.org));
    const { d: d2, invalidator } = historyDeps();
    const res = await restoreSiteSettingsVersion(seed.ctxA, d2, "nav", v1);
    expect(res.part).toBe("nav");
    expect(res.dropped).toBe(0);
    expect(res.at.replace(/[:.]/g, "-")).toBe(v1);
    const nav = await getNav(seed.ctxA);
    expect(nav?.items[0]?.label).toBe("Restore me");
    expect(res.value).toEqual(nav);
    const after = picked(await rowOf(seed.A.org));
    expect({ ...after, nav: null }).toEqual({ ...before, nav: null });
    const list = await listSiteSettingsVersions(seed.ctxA, "nav");
    expect(list[0]!.current).toBe(true);
    expect(list[0]!.id).not.toBe(v1);
    expect(invalidator.tags).toContain(liveTag(seed.A.org));
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = {:a}", {
        o: seed.A.org,
        a: "site_settings.restore",
      }),
    });
    expect(JSON.stringify(audits.map((a) => a.meta))).toContain(v1);
  });

  it("restores footer, banner and settings one part at a time", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    await saveFooter(seed.ctxA, d, { copyright: "Footer v1" });
    const f1 = (await listSiteSettingsVersions(seed.ctxA, "footer"))[0]!.id;
    await saveFooter(seed.ctxA, d, { copyright: "Footer v2" });
    await saveBanner(seed.ctxA, d, { enabled: false, message: "Banner off" });
    const b1 = (await listSiteSettingsVersions(seed.ctxA, "banner"))[0]!.id;
    await saveBanner(seed.ctxA, d, { enabled: true, message: "Banner on" });
    await saveSiteSettings(seed.ctxA, d, {
      language: "es",
      show_translate: true,
      allow_ai_crawlers: false,
    });
    const s1 = (await listSiteSettingsVersions(seed.ctxA, "settings"))[0]!.id;
    await saveSiteSettings(seed.ctxA, d, {
      language: "en",
      show_translate: false,
      allow_ai_crawlers: true,
    });
    const row = await rowOf(seed.A.org);
    await pb.collection("site_settings").update(row.id, {
      seo: { ...(row.seo as object), title_suffix: " | A" },
    });

    let before = picked(await rowOf(seed.A.org));
    const f = await restoreSiteSettingsVersion(seed.ctxA, d, "footer", f1);
    let after = picked(await rowOf(seed.A.org));
    expect((after.footer as { copyright: string }).copyright).toBe("Footer v1");
    expect({ ...after, footer: null }).toEqual({ ...before, footer: null });
    expect(f.value).toEqual(after.footer);

    before = after;
    await restoreSiteSettingsVersion(seed.ctxA, d, "banner", b1);
    after = picked(await rowOf(seed.A.org));
    expect(after.banner).toMatchObject({
      enabled: false,
      message: "Banner off",
    });
    expect({ ...after, banner: null }).toEqual({ ...before, banner: null });

    before = after;
    const s = await restoreSiteSettingsVersion(seed.ctxA, d, "settings", s1);
    after = picked(await rowOf(seed.A.org));
    expect(after.language).toBe("es");
    expect((after.settings as { show_translate: boolean }).show_translate).toBe(
      true,
    );
    expect(after.seo).toMatchObject({
      allow_ai_crawlers: false,
      title_suffix: " | A",
    });
    expect(s.value).toMatchObject({ language: "es", allow_ai_crawlers: false });
    expect({ ...after, language: null, settings: null, seo: null }).toEqual({
      ...before,
      language: null,
      settings: null,
      seo: null,
    });
  });

  it("brings a soft-deleted CTA pop-up back, and drops a gone one", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const popId = seed.A.popup;
    await saveNav(seed.ctxA, d, {
      ...navWith("With CTA"),
      cta: { label: "Book", target: "popup:" + popId },
    });
    const v1 = (await listSiteSettingsVersions(seed.ctxA, "nav"))[0]!.id;
    expect((await deletePopup(seed.ctxA, d, popId)).outcome).toBe("soft");
    await saveNav(seed.ctxA, d, navWith("No CTA"));
    const res = await restoreSiteSettingsVersion(seed.ctxA, d, "nav", v1);
    expect(res.dropped).toBe(0);
    expect((await getNav(seed.ctxA))?.cta?.target).toBe("popup:" + popId);
    expect((await pb.collection("popups").getOne(popId)).deleted_at).toBe("");

    const clone = await pb.collection("popups").getOne(popId);
    await saveNav(seed.ctxA, d, navWith("No CTA again"));
    const {
      id: _id,
      created: _c,
      updated: _u,
      collectionId: _ci,
      collectionName: _cn,
      ...body
    } = clone as Record<string, unknown>;
    void _id;
    void _c;
    void _u;
    void _ci;
    void _cn;
    const tmp = await pb.collection("popups").create(body);
    await saveNav(seed.ctxA, d, {
      ...navWith("Temp CTA"),
      cta: { label: "Book", target: "popup:" + tmp.id },
    });
    const v2 = (await listSiteSettingsVersions(seed.ctxA, "nav"))[0]!.id;
    await saveNav(seed.ctxA, d, navWith("After temp"));
    await pb.collection("popups").delete(tmp.id);
    const gone = await restoreSiteSettingsVersion(seed.ctxA, d, "nav", v2);
    expect(gone.dropped).toBe(1);
    expect((await getNav(seed.ctxA))?.cta).toBeNull();
  });

  it("keeps a link to a deleted page (visitors never see it)", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const home = await pb.collection("pages").getOne(seed.A.page);
    const {
      id: _id,
      created: _c,
      updated: _u,
      collectionId: _ci,
      collectionName: _cn,
      ...body
    } = home as Record<string, unknown>;
    void _id;
    void _c;
    void _u;
    void _ci;
    void _cn;
    const page = await pb
      .collection("pages")
      .create({ ...body, title: "Going", slug: "going-history" });
    await saveNav(seed.ctxA, d, {
      items: [
        { id: "home", label: "Home", target: "page:" + seed.A.page },
        { id: "going", label: "Going", target: "page:" + page.id },
      ],
    });
    const v1 = (await listSiteSettingsVersions(seed.ctxA, "nav"))[0]!.id;
    await saveNav(seed.ctxA, d, navWith("Only home"));
    await pb.collection("pages").delete(page.id);
    const res = await restoreSiteSettingsVersion(seed.ctxA, d, "nav", v1);
    expect(res.dropped).toBe(0);
    const nav = await getNav(seed.ctxA);
    expect(nav?.items.map((i) => i.label)).toEqual(["Home", "Going"]);
    const resolved = resolveNav(nav, {
      pages: new Map([[seed.A.page, { path: "/", title: "Home" }]]),
    });
    expect(JSON.stringify(resolved)).not.toContain("Going");
  });

  it("a tampered file loses foreign keys and another org's page link", async (t) => {
    if (!inst) return t.skip();
    const bRowBefore = picked(await rowOf(seed.B.org));
    const at = new Date("2026-01-02T03:04:05.006Z");
    const key = tenantSitePartVersionKey(seed.A.org, "nav", at);
    await store.put(
      key,
      JSON.stringify({
        v: 1,
        part: "nav",
        at: at.toISOString(),
        by: null,
        row: {
          organization: seed.B.org,
          sneaky: "x",
          nav: {
            items: [
              { id: "home", label: "Home", target: "page:" + seed.A.page },
              {
                id: "evil",
                label: "Evil",
                target: "page:" + seed.B.page,
                children: [
                  { id: "c", label: "C", target: "page:" + seed.A.page },
                ],
              },
            ],
          },
        },
      }),
      "application/json",
    );
    const res = await restoreSiteSettingsVersion(
      seed.ctxA,
      historyDeps().d,
      "nav",
      idOf(key),
    );
    expect(res.dropped).toBe(1);
    const row = await rowOf(seed.A.org);
    expect(row.organization).toBe(seed.A.org);
    expect(JSON.stringify(row.nav)).not.toContain(seed.B.page);
    expect(row).not.toHaveProperty("sneaky");
    expect(picked(await rowOf(seed.B.org))).toEqual(bRowBefore);
    await store.delete(key);
  });

  it("refuses malformed files, bad ids, missing files and viewers", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const before = picked(await rowOf(seed.A.org));
    const at = new Date("2026-01-03T00:00:00.000Z");
    const key = tenantSitePartVersionKey(seed.A.org, "nav", at);
    await store.put(
      key,
      JSON.stringify({ v: 2, part: "nav" }),
      "application/json",
    );
    await expect(
      restoreSiteSettingsVersion(seed.ctxA, d, "nav", idOf(key)),
    ).rejects.toThrow("This version is malformed.");
    await store.put(
      key,
      JSON.stringify({
        v: 1,
        part: "nav",
        at: at.toISOString(),
        by: null,
        row: { nav: 7 },
      }),
      "application/json",
    );
    await expect(
      restoreSiteSettingsVersion(seed.ctxA, d, "nav", idOf(key)),
    ).rejects.toThrow(InvalidInput);
    await store.delete(key);
    for (const bad of [
      "../x",
      tenantSitePartVersionKey(seed.A.org, "nav", at),
      "2026-13-01T00-00-00-000Z",
      "2026-01-03T00-00-00-000Z",
    ]) {
      await expect(
        restoreSiteSettingsVersion(seed.ctxA, d, "nav", bad),
      ).rejects.toThrow(NotFound);
    }
    await expect(
      restoreSiteSettingsVersion(seed.ctxA, d, "bogus" as never, "x"),
    ).rejects.toThrow(InvalidInput);
    const v = (await listSiteSettingsVersions(seed.ctxA, "nav")).at(-1)!.id;
    await expect(
      restoreSiteSettingsVersion(viewerA(), d, "nav", v),
    ).rejects.toThrow(Forbidden);
    expect(picked(await rowOf(seed.A.org))).toEqual(before);
  });

  it("a restore and a footer save on the same org never deadlock", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const v = (await listSiteSettingsVersions(seed.ctxA, "nav")).at(-1)!.id;
    await within(
      Promise.all([
        restoreSiteSettingsVersion(seed.ctxA, d, "nav", v),
        saveFooter(seed.ctxA, d, { copyright: "Concurrent" }),
      ]),
    );
  });
});

describe("settings restore: the site share image (07-30)", () => {
  async function photo(): Promise<string> {
    const { uploadLibraryImage } = await import("../src/media/library");
    const { solidPng } =
      await import("../src/media/__fixtures__/make-fixtures");
    return (
      await uploadLibraryImage(seed.ctxA, await solidPng(600, 315), {
        alt: "Share",
        store,
      })
    ).asset.id;
  }

  it("brings a share image back, un-deletes a soft-deleted one, keeps the snapshot's AI switch", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const img = await photo();
    await saveSiteSettings(seed.ctxA, d, {
      share_image: img,
      allow_ai_crawlers: false,
    });
    const v1 = (await listSiteSettingsVersions(seed.ctxA, "settings"))[0]!.id;
    await saveSiteSettings(seed.ctxA, d, {
      share_image: "",
      allow_ai_crawlers: true,
    });
    await pb
      .collection("media_assets")
      .update(img, { deleted_at: "2026-10-01 00:00:00.000Z" });

    const res = await within(
      restoreSiteSettingsVersion(seed.ctxA, d, "settings", v1),
    );
    expect(res.dropped).toBe(0);
    const row = await rowOf(seed.A.org);
    expect(row.seo).toMatchObject({
      share_image: img,
      allow_ai_crawlers: false,
    });
    expect((await pb.collection("media_assets").getOne(img)).deleted_at).toBe(
      "",
    );
  });

  it("drops a gone share image and counts it", async (t) => {
    if (!inst) return t.skip();
    const { d } = historyDeps();
    const img = await photo();
    await saveSiteSettings(seed.ctxA, d, {
      share_image: img,
      allow_ai_crawlers: true,
    });
    const v = (await listSiteSettingsVersions(seed.ctxA, "settings"))[0]!.id;
    await saveSiteSettings(seed.ctxA, d, { share_image: "" });
    await pb.collection("media_assets").delete(img);

    const res = await within(
      restoreSiteSettingsVersion(seed.ctxA, d, "settings", v),
    );
    expect(res.dropped).toBe(1);
    const seo = (await rowOf(seed.A.org)).seo as Record<string, unknown>;
    expect(seo.share_image).toBeUndefined();
    expect(seo.allow_ai_crawlers).toBe(true);
  });
});
