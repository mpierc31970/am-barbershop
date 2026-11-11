// Credentials end to end in the chokepoint on the real PocketBase 0.39.11 binary (ADDON-03,
// ADDON-04, ADDON-05, ADDON-06, ADDON-08; CONTEXT A5-Q2; T-05-44..47). The second, differently
// shaped add-on (grouped list, dates, expiry at render) through the same contract: install
// page, record rules, visitor reads vs blockData(now), hidden numbers, reorder, uninstall /
// reinstall, two add-ons side by side, and cross-tenant reads.
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY, ADDON_SERVER } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import { AddonNotActive } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addonRepo } from "../src/addons/addon-repo";
import { standInBillingGate } from "../src/addons/billing";
import { installAddon, uninstallAddon } from "../src/addons/installer";
import { readPublicAddonRecords } from "../src/addons/site-state";
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import type { OrgContext } from "../src/context";
import { clearResolverCache } from "../src/resolve";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const SLUG = "credentials";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

function deps(): AddonDeps {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons: ADDON_REGISTRY,
    billing: standInBillingGate(),
  };
}

const repoFor = (ctx: OrgContext) =>
  addonRepo(ctx, deps(), SLUG).collection(SLUG);

type Group = {
  category: string;
  items: { id: string; number: string | null; expires_on: string }[];
};

function blockData(
  records: readonly ({ id: string } & Record<string, unknown>)[],
  now: Date,
  content: Record<string, unknown> = {
    heading: "Credentials",
    group_by_category: true,
  },
): Group[] {
  const out = ADDON_SERVER[SLUG]!.blockData(
    [{ id: "s1", section_type: "credentials", content }],
    { credentials: records },
    now,
  ) as Record<string, Group[]>;
  return out.s1!;
}

async function site(host: string): Promise<SiteContext> {
  clearResolverCache();
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

async function publicRows(host: string) {
  return readPublicAddonRecords(await site(host), SLUG, SLUG);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-credentials-"));
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
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("Credentials add-on in the chokepoint", () => {
  let rn = "";
  let lapsed = "";

  it("owner install publishes /credentials with one Credentials block", async (t) => {
    if (!inst) return t.skip();
    const res = await installAddon(seed.ctxA, deps(), SLUG);
    expect(res.outcome).toBe("installed");
    expect(res.page?.slug).toBe("credentials");
    const page = await pb.collection("pages").getOne(res.page!.id);
    expect(page.status).toBe("published");
    expect(page.title).toBe("Credentials");
    expect(page.organization).toBe(seed.A.org);
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: res.page!.id }),
    });
    expect(blocks.map((b) => b.section_type)).toEqual(["credentials"]);
    expect(blocks[0]!.content).toMatchObject({
      heading: "Credentials",
      group_by_category: true,
    });
  });

  it("save runs the record rules: dates, verify link, expires after issued", async (t) => {
    if (!inst) return t.skip();
    const repo = repoFor(seed.ctxA);
    const base = { title: "Registered Nurse", issuer: "Texas BON" };
    await expect(
      repo.save({ ...base, verify_url: "javascript:alert(1)" }),
    ).rejects.toThrow("Verify link must start with https:// or http://");
    await expect(repo.save({ ...base, expires_on: "soon" })).rejects.toThrow(
      "Expires isn't a date",
    );
    await expect(
      repo.save({ ...base, issued_on: "2020-01-01", expires_on: "2019-01-01" }),
    ).rejects.toThrow(InvalidInput);

    const saved = await repo.save({
      ...base,
      category: "Licenses",
      credential_number: "RN123456",
      show_number: true,
      issued_on: "2019-06-01",
      expires_on: "2099-03-14",
      verify_url: "https://bon.texas.gov/verify",
    });
    expect(saved.held).toBe(false);
    rn = saved.id;
    const row = await pb.collection("credentials").getOne(rn);
    expect(row.organization).toBe(seed.A.org);
    expect(String(row.expires_on).slice(0, 10)).toBe("2099-03-14");
    expect(String(row.issued_on).slice(0, 10)).toBe("2019-06-01");
    expect(row.show_number).toBe(true);
    // Re-saving the stored row (PocketBase date format) passes the same rules.
    const again = await repo.save({
      id: rn,
      title: row.title,
      issuer: row.issuer,
      category: row.category,
      credential_number: row.credential_number,
      show_number: row.show_number,
      issued_on: row.issued_on,
      expires_on: row.expires_on,
      verify_url: row.verify_url,
      is_published: row.is_published,
    });
    expect(again.id).toBe(rn);
  });

  it("an expired credential is readable by visitors' query but dropped by blockData(now)", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    // Two UTC days back: past its expiry day even at UTC-12, the latest zone (B-WR-03).
    const lapsedDay = new Date(now.getTime() - 2 * 86_400_000);
    lapsed = (
      await repoFor(seed.ctxA).save({
        title: "CPR",
        issuer: "Red Cross",
        category: "Certifications",
        expires_on: isoDay(lapsedDay),
      })
    ).id;
    const rows = await publicRows("a.example.com");
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(lapsed);
    expect(ids).toContain(rn);
    // Public fields only (deny by default, T-05-46).
    expect(Object.keys(rows.find((r) => r.id === rn)!).sort()).toEqual(
      [
        "category",
        "credential_number",
        "expires_on",
        "id",
        "issued_on",
        "issuer",
        "show_number",
        "sort_order",
        "title",
        "verify_url",
      ].sort(),
    );
    const shown = blockData(rows, now).flatMap((g) => g.items.map((i) => i.id));
    expect(shown).toContain(rn);
    expect(shown).not.toContain(lapsed);
    // On its expiry day (UTC) it still shows: expiry is never early anywhere.
    const before = blockData(rows, lapsedDay);
    expect(before.flatMap((g) => g.items.map((i) => i.id))).toContain(lapsed);
  });

  it("the number reaches blockData only when show_number is on (T-05-45)", async (t) => {
    if (!inst) return t.skip();
    const rows = await publicRows("a.example.com");
    const items = blockData(rows, new Date()).flatMap((g) => g.items);
    expect(items.find((i) => i.id === rn)!.number).toBe("RN123456");
    // The fixture credential keeps show_number off.
    expect(items.find((i) => i.id === seed.A.credential)!.number).toBeNull();
    expect(JSON.stringify(items)).not.toContain("NUM-A");
    // The chokepoint itself never hands a hidden number to any visitor read (B-WR-04).
    expect(rows.find((r) => r.id === rn)!.credential_number).toBe("RN123456");
    expect(
      rows.find((r) => r.id === seed.A.credential)!.credential_number,
    ).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("NUM-A");
  });

  it("reorder writes 1..n; a record from another org is refused", async (t) => {
    if (!inst) return t.skip();
    const repo = repoFor(seed.ctxA);
    const ids = (await repo.list()).map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const reversed = [...ids].reverse();
    await repo.reorder(reversed);
    const after = await repo.list();
    expect(after.map((r) => r.id)).toEqual(reversed);
    expect(after.map((r) => r.sort_order)).toEqual(
      reversed.map((_, i) => i + 1),
    );
    await expect(
      repo.reorder([...reversed.slice(1), seed.B.credential]),
    ).rejects.toThrow(InvalidInput);
  });

  it("uninstall refuses writes and keeps records; reinstall brings the same ids back", async (t) => {
    if (!inst) return t.skip();
    const before = (await repoFor(seed.ctxA).list()).map((r) => r.id);
    expect((await uninstallAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "removed",
    );
    const repo = repoFor(seed.ctxA);
    await expect(repo.save({ title: "X", issuer: "Y" })).rejects.toThrow(
      AddonNotActive,
    );
    await expect(repo.setPublished(rn, false)).rejects.toThrow(AddonNotActive);
    expect((await repo.list()).map((r) => r.id)).toEqual(before);
    expect(await publicRows("a.example.com")).toEqual([]);

    expect((await installAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "reinstalled",
    );
    expect((await repoFor(seed.ctxA).list()).map((r) => r.id)).toEqual(before);
    expect((await publicRows("a.example.com")).map((r) => r.id)).toContain(rn);
  });

  it("Testimonials and Credentials run side by side; each refuses the other's collection (T-05-47)", async (t) => {
    if (!inst) return t.skip();
    expect(
      (await installAddon(seed.ctxA, deps(), "testimonials")).outcome,
    ).toBe("installed");
    const creds = addonRepo(seed.ctxA, deps(), SLUG);
    const quotes = addonRepo(seed.ctxA, deps(), "testimonials");
    expect(() => creds.collection("testimonials")).toThrow(InvalidInput);
    expect(() => quotes.collection("credentials")).toThrow(InvalidInput);
    const q = await quotes
      .collection("testimonials")
      .save({ quote: "Great care.", author_name: "Ann" });
    const c = await creds
      .collection("credentials")
      .save({ title: "BLS", issuer: "AHA" });
    expect(
      (await pb.collection("testimonials").getOne(q.id)).organization,
    ).toBe(seed.A.org);
    expect((await pb.collection("credentials").getOne(c.id)).organization).toBe(
      seed.A.org,
    );
    const slugs = (
      await pb.collection("pages").getFullList({
        filter: pb.filter("organization = {:o} && status = 'published'", {
          o: seed.A.org,
        }),
      })
    ).map((p) => p.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(["credentials", "testimonials"]),
    );
  });

  it("org B cannot read org A's credential", async (t) => {
    if (!inst) return t.skip();
    await expect(repoFor(seed.ctxB).get(rn)).rejects.toThrow(NotFound);
    expect((await repoFor(seed.ctxB).list()).map((r) => r.id)).not.toContain(
      rn,
    );
    expect((await publicRows("b.example.com")).map((r) => r.id)).not.toContain(
      rn,
    );
  });
});
