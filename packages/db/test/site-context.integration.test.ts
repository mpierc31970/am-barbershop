// Read-only visitor context on the real PocketBase 0.39.11 binary (CONTEXT A3-Q1,
// invariant 1, D187, D253; T-03-32, T-03-36).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as dbIndex from "../src/index";
import { resetClientForTests, superuser } from "../src/client";
import { createPage, updatePage } from "../src/content/pages";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { publishPage } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import { saveBanner } from "../src/content/site-settings";
import {
  projectPublicBusiness,
  readPublicAnalytics,
  readPublicBusiness,
  readPublicPopups,
  readPublicSiteSettings,
  readPublishedPage,
  readSiteManifest,
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { clearResolverCache } from "../src/resolve";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(): ContentDeps & { store: ObjectStore } {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
  };
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-site-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("siteContextForHost", () => {
  it("resolves a tenant host to its org; an unknown host is null", async (t) => {
    if (!inst) return t.skip();
    const a = await site("a.example.com");
    expect(a.orgId).toBe(seed.A.org);
    expect(a.host).toBe("a.example.com");
    expect(await siteContextForHost("nobody.example.com")).toBeNull();
  });

  it("a plain object is refused with InvalidContext (T-03-36)", async (t) => {
    if (!inst) return t.skip();
    const forged = { orgId: seed.A.org, host: "a.example.com" };
    await expect(
      readSiteManifest(forged as unknown as SiteContext, store),
    ).rejects.toThrow(InvalidContext);
    await expect(
      readPublicPopups(forged as unknown as SiteContext),
    ).rejects.toThrow(InvalidContext);
  });

  it("the minter is not exported from @cds/db", () => {
    const keys = Object.keys(dbIndex);
    expect(keys).not.toContain("mintSiteContext");
    expect(keys).not.toContain("assertSiteContext");
    expect(keys).toContain("siteContextForHost");
  });
});

describe("published reads", () => {
  it("null before a publish, the parsed JSON after", async (t) => {
    if (!inst) return t.skip();
    const b = await site("b.example.com");
    expect(await readSiteManifest(b, store)).toBeNull();
    expect(await readPublishedPage(b, seed.B.page, store)).toBeNull();

    await saveSection(seed.ctxB, registry, {
      pageId: seed.B.page,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Welcome B" },
    });
    await publishPage(seed.ctxB, seed.B.page, deps());
    const manifest = await readSiteManifest(b, store);
    expect(manifest!.pages.home!.id).toBe(seed.B.page);
    const page = await readPublishedPage(b, seed.B.page, store);
    expect(page!.page.id).toBe(seed.B.page);
    expect(page!.sections.length).toBeGreaterThanOrEqual(1);
  });

  it("a page id outside the org's manifest is null (no cross-org key guessing)", async (t) => {
    if (!inst) return t.skip();
    const a = await site("a.example.com");
    await publishPage(seed.ctxA, seed.A.page, deps());
    // Org B's published page, asked for through org A's site.
    expect(await readPublishedPage(a, seed.B.page, store)).toBeNull();
    // An unpublished page of org A.
    const draft = await createPage(seed.ctxA, {
      title: "Draft",
      slug: "draft",
    });
    expect(await readPublishedPage(a, draft.id, store)).toBeNull();
    expect(await readPublishedPage(a, "../../x", store)).toBeNull();
  });

  it("draft edits after publish are not visible to visitors (T-03-32)", async (t) => {
    if (!inst) return t.skip();
    const a = await site("a.example.com");
    const page = await createPage(seed.ctxA, {
      title: "Services",
      slug: "services",
    });
    await publishPage(seed.ctxA, page.id, deps());
    await updatePage(seed.ctxA, page.id, { title: "Secret draft title" });
    const pub = await readPublishedPage(a, page.id, store);
    expect(pub!.page.title).toBe("Services");
  });
});

describe("public live records", () => {
  it("site settings return exactly the org's banner", async (t) => {
    if (!inst) return t.skip();
    await saveBanner(seed.ctxA, deps(), {
      enabled: true,
      message: "Banner for A",
    });
    await saveBanner(seed.ctxB, deps(), {
      enabled: true,
      message: "Banner for B",
    });
    const res = await readPublicSiteSettings(await site("a.example.com"));
    expect(Object.keys(res)).toEqual(["banner", "nav", "footer", "settings"]);
    expect(res.banner!.message).toBe("Banner for A");
    expect(JSON.stringify(res)).not.toContain("Banner for B");
  });

  it("pop-ups: enabled only, public fields only, own org only", async (t) => {
    if (!inst) return t.skip();
    const disabled = await pb.collection("popups").create({
      organization: seed.A.org,
      name: "Off",
      trigger: "click",
      frequency: "once-per-visitor",
      show_on: "button-only",
      enabled: false,
      content: { items: [] },
    });
    const popups = await readPublicPopups(await site("a.example.com"));
    const ids = popups.map((p) => p.id);
    expect(ids).toContain(seed.A.popup);
    expect(ids).not.toContain(disabled.id);
    expect(ids).not.toContain(seed.B.popup);
    for (const p of popups) {
      const keys = Object.keys(p);
      expect(keys).not.toContain("organization");
      expect(keys).not.toContain("created");
      expect(keys).not.toContain("updated");
      expect(p.enabled).toBe(true);
    }
  });
});

describe("readPublicBusiness (07-07)", () => {
  const closed = { open: false, ranges: [] };
  const hours = {
    mon: { open: true, ranges: [{ start: "09:00", end: "17:00" }] },
    tue: closed,
    wed: closed,
    thu: closed,
    fri: closed,
    sat: closed,
    sun: closed,
  };

  it("returns exactly the eight public fields of the site's own org (T-07-07-05; 07-30 business_type)", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("business_profile").update(seed.A.businessProfile, {
      phone: "512-555-0100",
      public_email: "hello@a.example.com",
      address: {
        street: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      time_zone: "America/Chicago",
      hours,
      about: "PRIVATE-ABOUT-A",
      ga4_id: "G-SECRETA",
      legal_name: "LEGAL-NAME-A LLC",
      privacy_contact: "privacy-a@example.com",
    });
    await pb.collection("business_profile").update(seed.B.businessProfile, {
      phone: "512-555-0199",
      time_zone: "America/New_York",
    });
    // 11-35 (DASH-14): social links come from social_accounts, in order. Two safe rows (a
    // preset and a custom one) and two unsafe rows written directly, which are dropped.
    const own = await pb.collection("social_accounts").getFullList({
      filter: pb.filter("organization = {:o}", { o: seed.A.org }),
    });
    for (const r of own) await pb.collection("social_accounts").delete(r.id);
    const row = (data: Record<string, unknown>) =>
      pb
        .collection("social_accounts")
        .create({ organization: seed.A.org, label: "", ...data });
    await row({
      platform: "instagram",
      url: "https://instagram.com/orga",
      short_code: "ig",
      order: 0,
    });
    await row({
      platform: "custom",
      label: "Etsy",
      url: "https://etsy.com/shop/orga",
      short_code: "etsy",
      order: 1,
    });
    await row({
      platform: "x",
      url: "javascript:alert(1)",
      short_code: "x",
      order: 2,
    });
    await row({
      platform: "myspace",
      url: "https://myspace.com/a",
      short_code: "go-1",
      order: 3,
    });
    const a = await readPublicBusiness(await site("a.example.com"));
    expect(Object.keys(a!).sort()).toEqual(
      [
        "address",
        "business_type",
        "hours",
        "name",
        "phone",
        "public_email",
        "socials",
        "time_zone",
      ].sort(),
    );
    expect(a!.name).toBe("Org A");
    expect(a!.phone).toBe("512-555-0100");
    expect(a!.public_email).toBe("hello@a.example.com");
    expect(a!.address).toEqual({
      street: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });
    expect(a!.time_zone).toBe("America/Chicago");
    expect(a!.hours!.mon.ranges).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(a!.socials).toEqual([
      { platform: "instagram", url: "https://instagram.com/orga" },
      { platform: "other", url: "https://etsy.com/shop/orga", label: "Etsy" },
    ]);
    const json = JSON.stringify(a);
    for (const secret of [
      "PRIVATE-ABOUT-A",
      "G-SECRETA",
      "LEGAL-NAME-A",
      "privacy-a@",
      "tagline",
      "ga4_id",
      "legal_name",
      "privacy_contact",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("site B sees only org B; a forged context is refused (T-07-07-06)", async (t) => {
    if (!inst) return t.skip();
    const b = await readPublicBusiness(await site("b.example.com"));
    expect(b!.name).toBe("Org B");
    expect(b!.phone).toBe("512-555-0199");
    expect(b!.time_zone).toBe("America/New_York");
    expect(JSON.stringify(b)).not.toContain("512-555-0100");
    const forged = { orgId: seed.A.org, host: "a.example.com" };
    await expect(
      readPublicBusiness(forged as unknown as SiteContext),
    ).rejects.toThrow(InvalidContext);
  });

  it("an org without a business profile returns null", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("business_profile").delete(seed.B.businessProfile);
    expect(await readPublicBusiness(await site("b.example.com"))).toBeNull();
  });

  it("projection: bad hours -> null, bad zone -> '', missing address -> ''", () => {
    const p = projectPublicBusiness(
      {
        hours: { mon: "nope" },
        time_zone: "Not/AZone",
        address: "x",
        socials: Array.from({ length: 20 }, (_, i) => ({
          platform: "other",
          url: `https://e.com/${i}`,
        })),
      },
      42,
    );
    expect(p.hours).toBeNull();
    expect(p.time_zone).toBe("");
    expect(p.name).toBe("");
    expect(p.address).toEqual({ street: "", city: "", state: "", zip: "" });
    expect(p.socials).toHaveLength(12);
    expect(
      projectPublicBusiness({ phone: "x".repeat(300) }, "N").phone,
    ).toHaveLength(200);
  });
});

describe("readPublicAnalytics (11-32; DASH-11)", () => {
  it("returns only the site's own GA4 measurement id", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("organizations").update(seed.A.org, {
      analytics: {
        ga4_measurement_id: "G-ORGA1234",
        ga4_property_id: "123456789",
        gsc_site_url: "sc-domain:a.example.com",
        owner: "cds",
      },
    });
    await pb.collection("organizations").update(seed.B.org, {
      analytics: { ga4_measurement_id: "UA-12345-1" },
    });
    expect(await readPublicAnalytics(await site("a.example.com"))).toEqual({
      ga4MeasurementId: "G-ORGA1234",
    });
    // A malformed stored id never reaches the page.
    expect(await readPublicAnalytics(await site("b.example.com"))).toEqual({
      ga4MeasurementId: null,
    });
    await pb
      .collection("organizations")
      .update(seed.B.org, { analytics: null });
    expect(await readPublicAnalytics(await site("b.example.com"))).toEqual({
      ga4MeasurementId: null,
    });
  });

  it("refuses a forged site context", async () => {
    await expect(
      readPublicAnalytics({ orgId: "x", host: "y" } as unknown as SiteContext),
    ).rejects.toBeInstanceOf(InvalidContext);
  });
});
