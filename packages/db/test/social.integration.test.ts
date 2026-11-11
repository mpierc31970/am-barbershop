// Social accounts and bio short links on the real PocketBase 0.39.11 binary (11-35; DASH-14,
// DASH-15; D198, D199; Pitfall 19; T-11-35-01..03). One source of social links; https and
// host checks; one account per preset; preset codes and custom codes; the page wins over a
// preset code (fallback to /go/<code>); codes resolve only for the host's own org.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput } from "@cds/core";
import { SOCIAL_COPY } from "@cds/core/social";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage, SlugReserved, updatePage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  addSocialAccount,
  bioLinkFor,
  listSocialAccounts,
  readGrowTicks,
  removeSocialAccount,
  setGrowTick,
  reorderSocialAccounts,
  resolveShortCode,
  socialLinksForSite,
  socialTag,
  updateSocialAccount,
} from "../src/social";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

let n = 0;
type Org = {
  org: string;
  host: string;
  owner: OrgContext;
  viewer: OrgContext;
};

async function bareOrg(): Promise<Org> {
  n += 1;
  const tag = `${n}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Social ${tag}`,
      slug: `soc-${tag}`,
      status: "active",
    })
  ).id;
  const host = `soc-${tag}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  const mk = (role: "owner" | "viewer") =>
    mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role,
      grants: [],
      ip: IP,
    });
  return { org, host, owner: mk("owner"), viewer: mk("viewer") };
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-social-"));
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

describe("social accounts (DASH-14)", () => {
  it("adds a preset with its code, refuses a second one, http and the wrong host", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    const inv = recordingInvalidator();
    const ig = await addSocialAccount(
      o.owner,
      { platform: "instagram", url: "https://instagram.com/rivera" },
      { invalidator: inv },
    );
    expect(ig).toMatchObject({
      platform: "instagram",
      name: "Instagram",
      shortCode: "ig",
      order: 0,
      fallback: false,
      bioPath: "/ig",
    });
    expect(inv.tags).toContain(socialTag(o.org));
    await expect(
      addSocialAccount(o.owner, {
        platform: "instagram",
        url: "https://instagram.com/other",
      }),
    ).rejects.toThrow(SOCIAL_COPY.dup);
    await expect(
      addSocialAccount(o.owner, {
        platform: "facebook",
        url: "http://facebook.com/rivera",
      }),
    ).rejects.toThrow(SOCIAL_COPY.https);
    await expect(
      addSocialAccount(o.owner, {
        platform: "facebook",
        url: "https://instagram.com.evil.com/x",
      }),
    ).rejects.toThrow("That isn't a Facebook address");
    await expect(
      addSocialAccount(o.owner, { platform: "myspace", url: "https://a.b/" }),
    ).rejects.toThrow(InvalidInput);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action ~ 'social.'", {
        o: o.org,
      }),
    });
    expect(audit.map((a) => a.action)).toEqual(["social.account_added"]);
    expect(JSON.stringify(audit[0]!.meta)).not.toContain("instagram.com");
  });

  it("custom accounts get a code from their name; own-site links are refused", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    const etsy = await addSocialAccount(o.owner, {
      platform: "custom",
      label: "Etsy",
      url: "https://www.etsy.com/shop/rivera",
    });
    expect(etsy).toMatchObject({
      platform: "custom",
      name: "Etsy",
      label: "Etsy",
      shortCode: "etsy",
      bioPath: "/go/etsy",
    });
    const etsy2 = await addSocialAccount(o.owner, {
      platform: "custom",
      label: "Etsy",
      url: "https://www.etsy.com/shop/rivera-two",
    });
    expect(etsy2.shortCode).toBe("etsy-2");
    await expect(
      addSocialAccount(o.owner, {
        platform: "custom",
        label: "Mine",
        url: `https://${o.host}/about`,
      }),
    ).rejects.toThrow(SOCIAL_COPY.ownHost);
    await expect(
      addSocialAccount(o.owner, {
        platform: "custom",
        label: " ",
        url: "https://a.example.org/",
      }),
    ).rejects.toThrow(SOCIAL_COPY.label);
  });

  it("edits, reorders and removes; a foreign id is refused", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    const other = await bareOrg();
    const a = await addSocialAccount(o.owner, {
      platform: "instagram",
      url: "https://instagram.com/a",
    });
    const b = await addSocialAccount(o.owner, {
      platform: "youtube",
      url: "https://youtube.com/@a",
    });
    const foreign = await addSocialAccount(other.owner, {
      platform: "x",
      url: "https://x.com/z",
    });
    const edited = await updateSocialAccount(o.owner, a.id, {
      url: "https://instagram.com/a2",
    });
    expect(edited.url).toBe("https://instagram.com/a2");
    expect(edited.shortCode).toBe("ig");
    await expect(
      reorderSocialAccounts(o.owner, [b.id, foreign.id]),
    ).rejects.toThrow(InvalidInput);
    await expect(reorderSocialAccounts(o.owner, [b.id])).rejects.toThrow(
      InvalidInput,
    );
    await reorderSocialAccounts(o.owner, [b.id, a.id]);
    expect((await listSocialAccounts(o.owner)).map((x) => x.id)).toEqual([
      b.id,
      a.id,
    ]);
    await expect(
      updateSocialAccount(o.owner, foreign.id, { url: "https://x.com/q" }),
    ).rejects.toThrow();
    await expect(removeSocialAccount(o.owner, foreign.id)).rejects.toThrow();
    const removed = await removeSocialAccount(o.owner, b.id);
    expect(removed.platform).toBe("youtube");
    expect((await listSocialAccounts(o.owner)).map((x) => x.id)).toEqual([
      a.id,
    ]);
    // Viewers read, never write.
    expect(await listSocialAccounts(o.viewer)).toHaveLength(1);
    await expect(
      addSocialAccount(o.viewer, {
        platform: "tiktok",
        url: "https://tiktok.com/@a",
      }),
    ).rejects.toThrow(Forbidden);
  });

  it("socialLinksForSite lists the site's own accounts in order", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    await addSocialAccount(o.owner, {
      platform: "threads",
      url: "https://threads.net/@a",
    });
    await addSocialAccount(o.owner, {
      platform: "custom",
      label: "Etsy",
      url: "https://etsy.com/shop/a",
    });
    expect(await socialLinksForSite(await site(o.host))).toEqual([
      { platform: "threads", url: "https://threads.net/@a" },
      { platform: "other", url: "https://etsy.com/shop/a", label: "Etsy" },
    ]);
  });
});

describe("bio short links (DASH-15)", () => {
  it("resolves preset and /go codes; unknown and foreign codes are null", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    const other = await bareOrg();
    const ig = await addSocialAccount(o.owner, {
      platform: "instagram",
      url: "https://instagram.com/a",
    });
    await addSocialAccount(o.owner, {
      platform: "custom",
      label: "Etsy",
      url: "https://etsy.com/shop/a",
    });
    await addSocialAccount(other.owner, {
      platform: "tiktok",
      url: "https://tiktok.com/@b",
    });
    const s = await site(o.host);
    expect(await resolveShortCode(s, ["ig"])).toEqual({
      platform: "instagram",
    });
    expect(await resolveShortCode(s, ["go", "ig"])).toEqual({
      platform: "instagram",
    });
    expect(await resolveShortCode(s, ["go", "etsy"])).toEqual({
      platform: "custom",
    });
    expect(await resolveShortCode(s, ["etsy"])).toBeNull();
    expect(await resolveShortCode(s, ["go", "nope"])).toBeNull();
    expect(await resolveShortCode(s, ["fb"])).toBeNull();
    // Org B's TikTok code never resolves on org A's host (T-11-35-03).
    expect(await resolveShortCode(s, ["tt"])).toBeNull();
    expect(await resolveShortCode(await site(other.host), ["tt"])).toEqual({
      platform: "tiktok",
    });
    expect(bioLinkFor(ig, "https://riverabakery.com/")).toBe(
      "https://riverabakery.com/ig",
    );
    await expect(
      resolveShortCode({ orgId: o.org } as unknown as SiteContext, ["ig"]),
    ).rejects.toThrow();
  });

  it("a page slugged ig wins: the account falls back to /go/ig", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    // An existing page that owns "ig" (made before the code was reserved).
    const page = await createPage(
      o.owner,
      { title: "Ig page", slug: "ig-old" },
      store,
    );
    await pb.collection("pages").update(page.id, { slug: "ig" });
    const ig = await addSocialAccount(o.owner, {
      platform: "instagram",
      url: "https://instagram.com/a",
    });
    expect(ig.fallback).toBe(true);
    expect(ig.bioPath).toBe("/go/ig");
    const s = await site(o.host);
    expect(await resolveShortCode(s, ["ig"])).toBeNull();
    expect(await resolveShortCode(s, ["go", "ig"])).toEqual({
      platform: "instagram",
    });
    // The account added first, then the page: still the page (both orders).
    const o2 = await bareOrg();
    await addSocialAccount(o2.owner, {
      platform: "x",
      url: "https://x.com/a",
    });
    const p2 = await createPage(
      o2.owner,
      { title: "X page", slug: "x-old" },
      store,
    );
    await pb.collection("pages").update(p2.id, { slug: "x" });
    const [xAcc] = await listSocialAccounts(o2.owner);
    expect(xAcc!.fallback).toBe(true);
    expect(xAcc!.bioPath).toBe("/go/x");
  });
});

describe("reserved bio slugs (DASH-15, WR-A06)", () => {
  it("a new page may not take go or a preset code; an existing x page keeps working", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    for (const slug of ["go", "ig", "yelp", "nd", "x"]) {
      await expect(
        createPage(o.owner, { title: "Nope", slug }, store),
        slug,
      ).rejects.toThrow(SlugReserved);
    }
    const page = await createPage(
      o.owner,
      { title: "X", slug: "x-temp" },
      store,
    );
    await pb.collection("pages").update(page.id, { slug: "x" });
    const saved = await updatePage(o.owner, page.id, {
      title: "X renamed",
      slug: "x",
    });
    expect(saved.slug).toBe("x");
    expect(saved.title).toBe("X renamed");
  });
});

describe("Grow your social ticks (11-37; DASH-16)", () => {
  it("ticks persist per org, are shared by every member, refuse unknown tips, Editors and Viewers", async (t) => {
    if (!inst) return t.skip();
    const o = await bareOrg();
    const other = await bareOrg();
    const editor = mintOrgContext({
      orgId: o.org,
      actor: seed.A.owner,
      role: "editor",
      grants: [],
      ip: IP,
    });
    const admin = mintOrgContext({
      orgId: o.org,
      actor: seed.A.owner,
      role: "admin",
      grants: [],
      ip: IP,
    });
    // No business_profile row yet: empty ticks, category "other".
    expect(await readGrowTicks(o.owner)).toEqual({
      ticks: [],
      category: "other",
    });
    await expect(setGrowTick(o.owner, "nope", true)).rejects.toThrow(
      InvalidInput,
    );
    await expect(setGrowTick(o.owner, "ig-bio-link", "yes")).rejects.toThrow(
      InvalidInput,
    );
    await expect(setGrowTick(o.viewer, "all-bio-link", true)).rejects.toThrow(
      Forbidden,
    );
    // UI-SPEC: editing the Social tab is Owner and Admin only (11-50).
    await expect(setGrowTick(editor, "all-bio-link", true)).rejects.toThrow(
      Forbidden,
    );
    await expect(
      addSocialAccount(editor, {
        platform: "instagram",
        url: "https://instagram.com/editor",
      }),
    ).rejects.toThrow(Forbidden);
    // The first tick creates the profile row; ticks come back in checklist order.
    await setGrowTick(o.owner, "ig-bio-link", true);
    const two = await setGrowTick(admin, "all-same-name", true);
    expect(two.ticks).toEqual(["all-same-name", "ig-bio-link"]);
    // Shared: the Viewer reads the same ticks; another org sees none.
    expect((await readGrowTicks(o.viewer)).ticks).toEqual([
      "all-same-name",
      "ig-bio-link",
    ]);
    expect((await readGrowTicks(other.owner)).ticks).toEqual([]);
    // Idempotent; untick removes only that tip.
    await setGrowTick(o.owner, "ig-bio-link", true);
    const one = await setGrowTick(o.owner, "ig-bio-link", false);
    expect(one.ticks).toEqual(["all-same-name"]);
    // The category follows the intake business type.
    const row = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: o.org }));
    expect(row.grow_checklist).toEqual(["all-same-name"]);
    await pb
      .collection("business_profile")
      .update(row.id, { business_type: "bakery" });
    const state = await readGrowTicks(o.owner);
    expect(state.category).toBe("shop");
  });
});
