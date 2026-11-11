// Site-level settings on the real PocketBase 0.39.11 binary (CONT-29; CONT-15 toggle; 07-26
// choices 1, 2, 4; invariant 1, TEN-03; T-07-26-01, T-07-26-06, T-07-26-07, T-07-26-08).
import { Forbidden, InvalidInput } from "@cds/core";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  SITE_SETTINGS_DEFAULTS,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { getSiteSettings, saveSiteSettings } from "../src/content/chrome";
import {
  liveTag,
  recordingInvalidator,
  type ContentDeps,
} from "../src/content/ports";
import {
  readPublicSiteSettings,
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { mintOrgContext } from "../src/context";
import { clearResolverCache } from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function deps() {
  const invalidator = recordingInvalidator();
  const d: ContentDeps = {
    sections: registry,
    invalidator,
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
  return { d, invalidator };
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

async function rowOf(org: string) {
  return pb
    .collection("site_settings")
    .getFirstListItem(pb.filter("organization = {:org}", { org }));
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // Start org A with no row so the defaults and the create path are both exercised.
  await pb.collection("site_settings").delete((await rowOf(seed.A.org)).id);
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
});

describe("getSiteSettings / saveSiteSettings", () => {
  it("defaults with no row (private and public read)", async (t) => {
    if (!inst) return t.skip();
    expect(await getSiteSettings(seed.ctxA)).toEqual(SITE_SETTINGS_DEFAULTS);
    const pub = await readPublicSiteSettings(await site("a.example.com"));
    expect(pub).toEqual({
      banner: null,
      nav: null,
      footer: null,
      settings: SITE_SETTINGS_DEFAULTS,
    });
  });

  it("saves a subset, creates the row and invalidates the live tag", async (t) => {
    if (!inst) return t.skip();
    const { d, invalidator } = deps();
    const res = await saveSiteSettings(seed.ctxA, d, {
      language: "es",
      show_translate: true,
    });
    expect(res.settings).toEqual({
      language: "es",
      show_translate: true,
      show_search: false,
      allow_ai_crawlers: true,
      share_image: "",
    });
    const row = await rowOf(seed.A.org);
    expect(row.language).toBe("es");
    expect(row.settings).toEqual({ show_translate: true, show_search: false });
    expect(row.seo).toEqual({ allow_ai_crawlers: true });
    expect(invalidator.tags).toContain(liveTag(seed.A.org));
    expect(
      (await readPublicSiteSettings(await site("a.example.com"))).settings,
    ).toEqual(res.settings);
  });

  it("a later patch keeps the other keys", async (t) => {
    if (!inst) return t.skip();
    await saveSiteSettings(seed.ctxA, deps().d, { show_search: true });
    expect(await getSiteSettings(seed.ctxA)).toEqual({
      language: "es",
      show_translate: true,
      show_search: true,
      allow_ai_crawlers: true,
      share_image: "",
    });
  });

  it("keeps other seo keys", async (t) => {
    if (!inst) return t.skip();
    const row = await rowOf(seed.A.org);
    await pb
      .collection("site_settings")
      .update(row.id, { seo: { title_suffix: "x", allow_ai_crawlers: true } });
    await saveSiteSettings(seed.ctxA, deps().d, { allow_ai_crawlers: false });
    expect((await rowOf(seed.A.org)).seo).toEqual({
      title_suffix: "x",
      allow_ai_crawlers: false,
    });
    expect((await getSiteSettings(seed.ctxA)).allow_ai_crawlers).toBe(false);
  });

  it("two concurrent saves both survive", async (t) => {
    if (!inst) return t.skip();
    await saveSiteSettings(seed.ctxA, deps().d, {
      show_search: false,
      show_translate: false,
    });
    await Promise.all([
      saveSiteSettings(seed.ctxA, deps().d, { show_search: true }),
      saveSiteSettings(seed.ctxA, deps().d, { show_translate: true }),
    ]);
    const g = await getSiteSettings(seed.ctxA);
    expect(g.show_search).toBe(true);
    expect(g.show_translate).toBe(true);
  });

  it("refuses a viewer and a bad language; nothing written", async (t) => {
    if (!inst) return t.skip();
    const before = await rowOf(seed.A.org);
    const viewer = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(
      saveSiteSettings(viewer, deps().d, { show_search: false }),
    ).rejects.toThrow(Forbidden);
    await expect(
      saveSiteSettings(seed.ctxA, deps().d, { language: "bad tag" }),
    ).rejects.toThrow(InvalidInput);
    const after = await rowOf(seed.A.org);
    expect(after.language).toBe(before.language);
    expect(after.settings).toEqual(before.settings);
    expect(after.updated).toBe(before.updated);
  });

  it("writes an audit row when staff impersonate", async (t) => {
    if (!inst) return t.skip();
    const staff = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
      impersonator: seed.B.owner,
    });
    const row = await rowOf(seed.A.org);
    await saveSiteSettings(staff, deps().d, { language: "fr" });
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:org} && action = {:a}", {
        org: seed.A.org,
        a: "site_settings.update",
      }),
    });
    expect(audits.some((a) => a.target_id === row.id)).toBe(true);
    await saveSiteSettings(seed.ctxA, deps().d, { language: "es" });
  });

  it("a malformed stored settings json reads back as default switches", async (t) => {
    if (!inst) return t.skip();
    const row = await rowOf(seed.A.org);
    await pb
      .collection("site_settings")
      .update(row.id, { settings: ["junk"], language: "<b>" });
    const pub = await readPublicSiteSettings(await site("a.example.com"));
    expect(pub.settings).toEqual({
      ...SITE_SETTINGS_DEFAULTS,
      allow_ai_crawlers: false,
    });
    expect(pub.banner).toBeNull();
  });
});
