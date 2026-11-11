// Add-on installer on the real PocketBase 0.39.11 binary (ADDON-04, ADDON-05, ADDON-07,
// ADDON-09; D27, D183; CONTEXT A2-Q1..Q4, A5-Q3; T-05-19..T-05-25). Fixture add-ons only.
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import {
  AddonConflict,
  AddonMissingRequirement,
  AddonNotActive,
  AddonRequiredBy,
  composeAddonRegistry,
} from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FIXTURE_CONFLICTS,
  FIXTURE_NEEDS,
  FIXTURE_PRIVATE,
  FIXTURE_QUOTE,
} from "../../core/src/addons/__fixtures__/manifests";
import { fixtureAddonSection } from "../../core/src/content/__fixtures__/fixture-addon";
import { standInBillingGate, type BillingGate } from "../src/addons/billing";
import { listOrgAddons, activeAddons } from "../src/addons/entitlements";
import {
  installAddon,
  installAddonAsStaff,
  retainedRecordCounts,
  uninstallAddon,
  uninstallAddonAsStaff,
} from "../src/addons/installer";
import { readAddonSiteState } from "../src/addons/site-state";
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { createPage, updatePage } from "../src/content/pages";
import {
  deleteSection,
  registerSectionAddonOwners,
  saveSection,
  undoDeleteSection,
} from "../src/content/sections";
import { recordingInvalidator } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { allTenantCollections } from "../src/registry";
import { clearResolverCache } from "../src/resolve";
import { envPrefix, getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

const IP = "127.0.0.1";
const QUOTE = "fixture-quote";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
let superAdmin: PlatformContext;
let supportAgent: PlatformContext;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const addons = composeAddonRegistry(
  [FIXTURE_QUOTE, FIXTURE_PRIVATE, FIXTURE_NEEDS, FIXTURE_CONFLICTS],
  { fileExists: () => true },
);
const sections = composeSectionRegistry(CORE_SECTIONS, [fixtureAddonSection]);

type SpyDeps = AddonDeps & {
  invalidator: ReturnType<typeof recordingInvalidator>;
  approvals: Parameters<BillingGate["approve"]>[0][];
};

function deps(): SpyDeps {
  const approvals: SpyDeps["approvals"] = [];
  const real = standInBillingGate();
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons,
    approvals,
    billing: {
      approve(input) {
        approvals.push(input);
        return real.approve(input);
      },
    },
  };
}

function ctxOf(
  orgId: string,
  actor: string,
  role: "owner" | "admin",
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

async function row(orgId: string, slug: string) {
  return pb
    .collection("org_addons")
    .getFirstListItem(
      pb.filter("organization = {:o} && addon = {:s}", { o: orgId, s: slug }),
    );
}

async function pagesOf(orgId: string) {
  return pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "slug",
  });
}

async function site(host: string): Promise<SiteContext> {
  clearResolverCache();
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

/** Every org row (full JSON incl. updated) plus every object under tenants/<org>/. */
async function snapshot(orgId: string): Promise<unknown> {
  const rows: Record<string, unknown> = {};
  for (const name of Object.keys(allTenantCollections())) {
    rows[name] = await pb.collection(name).getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
      sort: "id",
    });
  }
  rows.organizations = await pb.collection("organizations").getOne(orgId);
  const objects: Record<string, string> = {};
  for (const o of await store.list(`${envPrefix()}tenants/${orgId}/`)) {
    const bytes = await store.get(o.key);
    objects[o.key] = bytes ? new TextDecoder().decode(bytes) : "";
  }
  return { rows, objects };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addons-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  superAdmin = await staffContext(inst, "addons-super@cds.test", "super_admin");
  supportAgent = await staffContext(
    inst,
    "addons-support@cds.test",
    "support_agent",
  );
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("install, idempotency, uninstall and reinstall (ADDON-04, ADDON-05)", () => {
  let pageId = "";

  it("owner install seeds and publishes the page, activates the row, calls billing once", async (t) => {
    if (!inst) return t.skip();
    const d = deps();
    const res = await installAddon(seed.ctxA, d, QUOTE);
    expect(res.outcome).toBe("installed");
    expect(res.page?.slug).toBe(QUOTE);
    pageId = res.page!.id;

    const r = await row(seed.A.org, QUOTE);
    expect(r.status).toBe("active");
    expect(r.source).toBe("hub");
    expect(r.installed_version).toBe(FIXTURE_QUOTE.version);
    expect(r.seeded).toEqual({ page: { id: pageId, slug: QUOTE } });

    const page = await pb.collection("pages").getOne(pageId);
    expect(page.organization).toBe(seed.A.org);
    expect(page.slug).toBe(QUOTE);
    expect(page.status).toBe("published");
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: pageId }),
    });
    expect(blocks.map((b) => b.section_type)).toEqual([QUOTE]);

    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0]).toMatchObject({
      orgId: seed.A.org,
      slug: QUOTE,
      source: "hub",
    });
    expect(d.invalidator.tags).toEqual(
      expect.arrayContaining([
        `org:${seed.A.org}:addons`,
        `org:${seed.A.org}:site`,
        `org:${seed.A.org}:addon:${QUOTE}`,
        `org:${seed.A.org}:page:${pageId}`,
      ]),
    );
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'addon.install'", {
        o: seed.A.org,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({
      slug: QUOTE,
      source: "hub",
      version: FIXTURE_QUOTE.version,
    });
    expect(await activeAddons(seed.ctxA)).toContain(QUOTE);
    expect(await retainedRecordCounts(seed.ctxA, d, QUOTE)).toBe(0);
  });

  it("a second install changes no org row and no stored object (byte-identical)", async (t) => {
    if (!inst) return t.skip();
    const before = await snapshot(seed.A.org);
    const d = deps();
    const res = await installAddon(seed.ctxA, d, QUOTE);
    expect(res).toEqual({
      slug: QUOTE,
      outcome: "unchanged",
      page: { id: pageId, slug: QUOTE },
    });
    expect(await snapshot(seed.A.org)).toEqual(before);
    expect(d.approvals).toHaveLength(0);
    expect(d.invalidator.tags).toEqual([]);
  });

  it("uninstall disables and retains: page and block rows untouched, page hidden", async (t) => {
    if (!inst) return t.skip();
    const pageBefore = await pb.collection("pages").getOne(pageId);
    const blocksBefore = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: pageId }),
      sort: "id",
    });
    const d = deps();
    expect(await uninstallAddon(seed.ctxA, d, QUOTE)).toEqual({
      slug: QUOTE,
      outcome: "removed",
    });
    const r = await row(seed.A.org, QUOTE);
    expect(r.status).toBe("disabled");
    expect(r.disabled_reason).toBe("uninstalled");
    expect(r.disabled_at).not.toBe("");
    expect(await pb.collection("pages").getOne(pageId)).toEqual(pageBefore);
    expect(
      await pb.collection("page_sections").getFullList({
        filter: pb.filter("page = {:p}", { p: pageId }),
        sort: "id",
      }),
    ).toEqual(blocksBefore);

    const state = await readAddonSiteState(await site("a.example.com"));
    expect(state.hiddenPageIds).toContain(pageId);
    expect(state.active).not.toContain(QUOTE);
    expect(d.invalidator.tags).toContain(`org:${seed.A.org}:addons`);

    // A second uninstall writes nothing.
    const again = deps();
    expect((await uninstallAddon(seed.ctxA, again, QUOTE)).outcome).toBe(
      "unchanged",
    );
    expect(again.invalidator.tags).toEqual([]);
  });

  it("reinstall flips the row back and seeds nothing new", async (t) => {
    if (!inst) return t.skip();
    const pagesBefore = (await pagesOf(seed.A.org)).length;
    const d = deps();
    const res = await installAddon(seed.ctxA, d, QUOTE);
    expect(res.outcome).toBe("reinstalled");
    expect(res.page?.id).toBe(pageId);
    expect((await pagesOf(seed.A.org)).length).toBe(pagesBefore);
    expect((await row(seed.A.org, QUOTE)).status).toBe("active");
    const state = await readAddonSiteState(await site("a.example.com"));
    expect(state.hiddenPageIds).toEqual([]);
    expect(state.active).toContain(QUOTE);
    expect(d.approvals).toHaveLength(1);
  });

  it("a seeded page the owner deleted is not recreated on reinstall (D183)", async (t) => {
    if (!inst) return t.skip();
    await uninstallAddon(seed.ctxA, deps(), QUOTE);
    await pb
      .collection("page_sections")
      .delete(
        (
          await pb
            .collection("page_sections")
            .getFirstListItem(pb.filter("page = {:p}", { p: pageId }))
        ).id,
      );
    await pb.collection("pages").delete(pageId);
    const res = await installAddon(seed.ctxA, deps(), QUOTE);
    expect(res.outcome).toBe("reinstalled");
    const slugs = (await pagesOf(seed.A.org)).map((p) => p.slug);
    expect(slugs.filter((s) => s.startsWith(QUOTE))).toEqual([]);
  });
});

describe("slug fallback, requires and conflicts (ADDON-07, CONTEXT A5-Q3)", () => {
  it("install with a missing requirement -> AddonMissingRequirement", async (t) => {
    if (!inst) return t.skip();
    const err = await installAddon(seed.ctxB, deps(), "fixture-needs").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AddonMissingRequirement);
    expect((err as AddonMissingRequirement).missing).toEqual([QUOTE]);
    const rows = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:o} && addon = 'fixture-needs'", {
        o: seed.B.org,
      }),
    });
    expect(rows).toEqual([]);
  });

  it("a page already using the slug makes install seed fixture-quote-2", async (t) => {
    if (!inst) return t.skip();
    await createPage(seed.ctxB, { title: "Mine", slug: QUOTE }, store);
    const res = await installAddon(seed.ctxB, deps(), QUOTE);
    expect(res.outcome).toBe("installed");
    expect(res.page?.slug).toBe("fixture-quote-2");
    const slugs = (await pagesOf(seed.B.org)).map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining([QUOTE, "fixture-quote-2"]));
  });

  it("an active conflict refuses install, in both directions", async (t) => {
    if (!inst) return t.skip();
    const err = await installAddon(
      seed.ctxB,
      deps(),
      "fixture-conflicts",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonConflict);
    expect((err as AddonConflict).with).toBe(QUOTE);
    expect((err as Error).message).toMatch(/can't run alongside/);

    // Symmetric: in org A, remove quote, add conflicts, then quote is refused.
    await uninstallAddon(seed.ctxA, deps(), QUOTE);
    expect(
      (await installAddon(seed.ctxA, deps(), "fixture-conflicts")).outcome,
    ).toBe("installed");
    const back = await installAddon(seed.ctxA, deps(), QUOTE).catch(
      (e: unknown) => e,
    );
    expect(back).toBeInstanceOf(AddonConflict);
    expect((back as AddonConflict).with).toBe("fixture-conflicts");
    await uninstallAddon(seed.ctxA, deps(), "fixture-conflicts");
    expect((await installAddon(seed.ctxA, deps(), QUOTE)).outcome).toBe(
      "reinstalled",
    );
  });

  it("uninstall while an active add-on requires it -> AddonRequiredBy", async (t) => {
    if (!inst) return t.skip();
    expect(
      (await installAddon(seed.ctxB, deps(), "fixture-needs")).outcome,
    ).toBe("installed");
    const err = await uninstallAddon(seed.ctxB, deps(), QUOTE).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AddonRequiredBy);
    expect((err as AddonRequiredBy).dependents).toEqual(["fixture-needs"]);
    expect((await row(seed.B.org, QUOTE)).status).toBe("active");
  });
});

describe("private add-ons, staff path and permissions (ADDON-09, CONTEXT A2-Q4)", () => {
  it("a private add-on is NotFound on the hub path", async (t) => {
    if (!inst) return t.skip();
    await expect(
      installAddon(seed.ctxA, deps(), "fixture-private"),
    ).rejects.toThrow(NotFound);
    await expect(
      installAddon(seed.ctxA, deps(), "no-such-addon"),
    ).rejects.toThrow(NotFound);
  });

  it("staff install a private add-on with a reason; audited with the reason", async (t) => {
    if (!inst) return t.skip();
    const d = deps();
    const res = await installAddonAsStaff(superAdmin, d, {
      orgId: seed.A.org,
      slug: "fixture-private",
      reason: "  Pilot for the spring launch ",
    });
    expect(res.outcome).toBe("installed");
    const r = await row(seed.A.org, "fixture-private");
    expect(r.status).toBe("active");
    expect(r.source).toBe("staff");
    const audit = await pb
      .collection("audit_log")
      .getFirstListItem(
        pb.filter(
          "organization = {:o} && action = 'addon.install' && target_id = {:id}",
          { o: seed.A.org, id: r.id },
        ),
      );
    expect(audit.meta).toMatchObject({
      slug: "fixture-private",
      source: "staff",
      reason: "Pilot for the spring launch",
    });
    expect(audit.impersonator).toBe(superAdmin.actor);
    expect(d.approvals[0]?.source).toBe("staff");

    // Staff uninstall disables with its own audited reason.
    expect(
      (
        await uninstallAddonAsStaff(superAdmin, deps(), {
          orgId: seed.A.org,
          slug: "fixture-private",
          reason: "Pilot over",
        })
      ).outcome,
    ).toBe("removed");
    expect((await row(seed.A.org, "fixture-private")).status).toBe("disabled");
  });

  it("staff install refuses an empty reason, a support agent and an unknown org", async (t) => {
    if (!inst) return t.skip();
    const input = { orgId: seed.A.org, slug: "fixture-private" };
    await expect(
      installAddonAsStaff(superAdmin, deps(), { ...input, reason: "   " }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      installAddonAsStaff(supportAgent, deps(), { ...input, reason: "x" }),
    ).rejects.toThrow(Forbidden);
    await expect(
      installAddonAsStaff(superAdmin, deps(), {
        orgId: "zzzzzzzzzzzzzz9",
        slug: "fixture-private",
        reason: "x",
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      installAddonAsStaff(seed.ctxA as unknown as PlatformContext, deps(), {
        ...input,
        reason: "x",
      }),
    ).rejects.toThrow();
  });

  it("an admin is Forbidden; an impersonated owner view is ImpersonationDenied", async (t) => {
    if (!inst) return t.skip();
    const admin = ctxOf(seed.A.org, seed.A.owner, "admin");
    await expect(installAddon(admin, deps(), QUOTE)).rejects.toThrow(Forbidden);
    await expect(uninstallAddon(admin, deps(), QUOTE)).rejects.toThrow(
      Forbidden,
    );
    const imp = ctxOf(seed.A.org, seed.A.owner, "owner", superAdmin.actor);
    await expect(installAddon(imp, deps(), QUOTE)).rejects.toThrow(
      ImpersonationDenied,
    );
    await expect(uninstallAddon(imp, deps(), QUOTE)).rejects.toThrow(
      ImpersonationDenied,
    );
    // Admins may read the entitlement list; viewers may not.
    expect((await listOrgAddons(admin)).length).toBeGreaterThan(0);
  });
});

describe("cross-tenant isolation of org_addons (TEN-03, T-05-22)", () => {
  it("org B can neither read nor change org A's entitlement rows", async (t) => {
    if (!inst) return t.skip();
    const aRows = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:o}", { o: seed.A.org }),
      sort: "id",
    });
    const aIds = new Set(aRows.map((r) => r.id));

    // Read: B's list holds B's rows only.
    const bList = await listOrgAddons(seed.ctxB);
    expect(bList.length).toBeGreaterThan(0);
    for (const r of bList) expect(aIds.has(r.id)).toBe(false);
    expect(bList.map((r) => r.addon)).not.toContain("fixture-private");

    // Write: B's installer calls only ever touch B's rows.
    const d = deps();
    // A private add-on org B never had is NotFound, like an unknown slug (A-WR-08).
    await expect(
      uninstallAddon(seed.ctxB, d, "fixture-private"),
    ).rejects.toThrow(NotFound);
    expect((await installAddon(seed.ctxB, d, QUOTE)).outcome).toBe("unchanged");
    await expect(
      installAddon(seed.ctxB, d, QUOTE, {
        organization: seed.A.org,
      } as unknown as Parameters<typeof installAddon>[3]),
    ).resolves.toMatchObject({ outcome: "unchanged" });
    expect(
      await pb.collection("org_addons").getFullList({
        filter: pb.filter("organization = {:o}", { o: seed.A.org }),
        sort: "id",
      }),
    ).toEqual(aRows);

    // Visitor state: site B never sees A's hidden page or A's add-ons.
    const aState = await readAddonSiteState(await site("a.example.com"));
    const bState = await readAddonSiteState(await site("b.example.com"));
    for (const id of aState.hiddenPageIds) {
      expect(bState.hiddenPageIds).not.toContain(id);
    }
    expect(bState.active).toEqual(
      expect.arrayContaining([QUOTE, "fixture-needs"]),
    );
    expect(bState.active).not.toContain("fixture-private");
  });
});

describe("a failed page seed resumes and still invalidates (A-WR-01)", () => {
  it("a block failure leaves a pending page; the next install finishes it", async (t) => {
    if (!inst) return t.skip();
    const orgC = (
      await pb.collection("organizations").create({
        name: "Org C",
        slug: "org-c-resume",
        status: "active",
      })
    ).id;
    const ctxC = ctxOf(orgC, seed.A.owner, "owner");

    // A section registry without the add-on's block: saveSection throws after the
    // org_addons row and the page exist.
    const broken: SpyDeps = {
      ...deps(),
      sections: composeSectionRegistry(CORE_SECTIONS, []),
    };
    await expect(installAddon(ctxC, broken, QUOTE)).rejects.toThrow(
      InvalidInput,
    );
    const r1 = await row(orgC, QUOTE);
    expect(r1.status).toBe("active");
    const pending = r1.seeded as { page: { id: string; pending?: boolean } };
    expect(pending.page.pending).toBe(true);
    expect((await pb.collection("pages").getOne(pending.page.id)).status).toBe(
      "draft",
    );
    // The row changed, so the tags were invalidated despite the throw.
    expect(broken.invalidator.tags).toEqual(
      expect.arrayContaining([`org:${orgC}:addons`, `org:${orgC}:site`]),
    );

    // Retry with the real registry: same page, the block saved, published, complete.
    const d = deps();
    const res = await installAddon(ctxC, d, QUOTE);
    expect(res.outcome).toBe("unchanged");
    expect(res.page).toEqual({ id: pending.page.id, slug: QUOTE });
    expect((await row(orgC, QUOTE)).seeded).toEqual({
      page: { id: pending.page.id, slug: QUOTE },
    });
    const page = await pb.collection("pages").getOne(pending.page.id);
    expect(page.status).toBe("published");
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: pending.page.id }),
    });
    expect(blocks.map((b) => b.section_type)).toEqual([QUOTE]);
    expect(d.approvals).toHaveLength(0);
    expect(
      (await pagesOf(orgC)).filter((p) => p.slug.startsWith(QUOTE)),
    ).toHaveLength(1);

    // A third run changes nothing.
    const again = deps();
    expect((await installAddon(ctxC, again, QUOTE)).outcome).toBe("unchanged");
    expect(again.invalidator.tags).toEqual([]);
  });

  it("a pending page the owner deleted is marked complete, never recreated (D183)", async (t) => {
    if (!inst) return t.skip();
    const orgD = (
      await pb.collection("organizations").create({
        name: "Org D",
        slug: "org-d-resume",
        status: "active",
      })
    ).id;
    const ctxD = ctxOf(orgD, seed.A.owner, "owner");
    const broken: SpyDeps = {
      ...deps(),
      sections: composeSectionRegistry(CORE_SECTIONS, []),
    };
    await expect(installAddon(ctxD, broken, QUOTE)).rejects.toThrow();
    const pageId = ((await row(orgD, QUOTE)).seeded as { page: { id: string } })
      .page.id;
    await pb.collection("pages").delete(pageId);
    const res = await installAddon(ctxD, deps(), QUOTE);
    expect(res.page).toEqual({ id: pageId, slug: QUOTE });
    expect((await row(orgD, QUOTE)).seeded).toEqual({
      page: { id: pageId, slug: QUOTE },
    });
    expect(await pagesOf(orgD)).toEqual([]);
  });
});

describe("a pending page resumes only untouched, only on the owner's retry (R2-WR-02)", () => {
  // The recipe block is saved, then publish fails: a pending page holding the installer's
  // block, as a draft. `put` refusing is what fails the publish (nothing goes live).
  async function pendingAfterPublishFailure(slug: string) {
    const org = (
      await pb.collection("organizations").create({
        name: `Org ${slug}`,
        slug,
        status: "active",
      })
    ).id;
    const ctx = ctxOf(org, seed.A.owner, "owner");
    const failing: SpyDeps = {
      ...deps(),
      store: {
        put: () => Promise.reject(new Error("store down")),
        get: (key) => store.get(key),
        list: (prefix) => store.list(prefix),
        delete: (key) => store.delete(key),
      },
    };
    await expect(installAddon(ctx, failing, QUOTE)).rejects.toThrow();
    const r = await row(org, QUOTE);
    const marker = r.seeded as {
      page: { id: string; pending?: boolean; draft?: string };
    };
    expect(marker.page.pending).toBe(true);
    expect(marker.page.draft).toMatch(/^[0-9a-f]{64}$/);
    const pageId = marker.page.id;
    expect((await pb.collection("pages").getOne(pageId)).status).toBe("draft");
    return { org, ctx, pageId };
  }

  async function blocksOf(pageId: string) {
    return pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: pageId }),
      sort: "sort_order",
    });
  }

  it("an untouched pending page is finished by the owner's retry, without a second block", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx, pageId } = await pendingAfterPublishFailure("r2-clean");
    await installAddon(ctx, deps(), QUOTE);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe(
      "published",
    );
    expect((await blocksOf(pageId)).map((b) => b.section_type)).toEqual([
      QUOTE,
    ]);
    expect((await row(org, QUOTE)).seeded).toEqual({
      page: { id: pageId, slug: QUOTE },
    });
  });

  it("an owner-edited block is never published; the ledger is closed", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx, pageId } = await pendingAfterPublishFailure("r2-edit");
    const [block] = await blocksOf(pageId);
    await saveSection(
      ctx,
      sections,
      {
        id: block!.id,
        pageId,
        section_type: QUOTE,
        row_layout: "full",
        content: { text: "Owner draft, not ready" },
      },
      addons,
    );
    await installAddon(ctx, deps(), QUOTE);
    const page = await pb.collection("pages").getOne(pageId);
    expect(page.status).toBe("draft");
    expect(page.has_unpublished_changes).toBe(true);
    const blocks = await blocksOf(pageId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toEqual({ text: "Owner draft, not ready" });
    expect((await row(org, QUOTE)).seeded).toEqual({
      page: { id: pageId, slug: QUOTE },
    });
    // Closed: a later retry never touches the page either.
    await installAddon(ctx, deps(), QUOTE);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe("draft");
  });

  it("a recipe block the owner deleted is never re-added, and nothing is published", async (t) => {
    if (!inst) return t.skip();
    const { ctx, pageId } = await pendingAfterPublishFailure("r2-delete");
    const [block] = await blocksOf(pageId);
    await deleteSection(ctx, block!.id);
    await installAddon(ctx, deps(), QUOTE);
    expect(await blocksOf(pageId)).toEqual([]);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe("draft");
  });

  it("an owner rename of the pending page is never published", async (t) => {
    if (!inst) return t.skip();
    const { ctx, pageId } = await pendingAfterPublishFailure("r2-rename");
    await updatePage(ctx, pageId, { title: "Kind words" }, store);
    await installAddon(ctx, deps(), QUOTE);
    const page = await pb.collection("pages").getOne(pageId);
    expect(page.status).toBe("draft");
    expect(page.title).toBe("Kind words");
  });

  it("a staff run and a remove-then-add-back leave the pending page alone", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx, pageId } = await pendingAfterPublishFailure("r2-staff");
    const before = (await row(org, QUOTE)).seeded;

    // Staff run on the active add-on: no resume, ledger unchanged, nothing published.
    await installAddonAsStaff(superAdmin, deps(), {
      orgId: org,
      slug: QUOTE,
      reason: "Support check",
    });
    expect((await row(org, QUOTE)).seeded).toEqual(before);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe("draft");

    // Remove then add back from the hub: a reinstall, not the owner's retry.
    await uninstallAddon(ctx, deps(), QUOTE);
    const back = await installAddon(ctx, deps(), QUOTE);
    expect(back.outcome).toBe("reinstalled");
    expect((await row(org, QUOTE)).seeded).toEqual(before);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe("draft");
    expect(await blocksOf(pageId)).toHaveLength(1);

    // The owner's own retry on the still-untouched page then finishes it.
    await installAddon(ctx, deps(), QUOTE);
    expect((await pb.collection("pages").getOne(pageId)).status).toBe(
      "published",
    );
    expect(await blocksOf(pageId)).toHaveLength(1);
  });
});

describe("the add-on block gate is not opt-in (A-WR-04, ADDON-05)", () => {
  it("save and undo-delete refuse a block of an add-on that is off, with or without addons", async (t) => {
    if (!inst) return t.skip();
    const orgE = (
      await pb.collection("organizations").create({
        name: "Org E",
        slug: "org-e-gate",
        status: "active",
      })
    ).id;
    const ctxE = ctxOf(orgE, seed.A.owner, "owner");
    const res = await installAddon(ctxE, deps(), QUOTE);
    const pageId = res.page!.id;
    const block = (
      await pb
        .collection("page_sections")
        .getFirstListItem(pb.filter("page = {:p}", { p: pageId }))
    ).id;
    const deleted = await deleteSection(ctxE, block);
    await uninstallAddon(ctxE, deps(), QUOTE);

    // The registered owner lookup is what a caller without `addons` gets.
    registerSectionAddonOwners(addons);
    try {
      const input = {
        pageId,
        section_type: QUOTE,
        row_layout: "full",
        content: { text: "x" },
      };
      await expect(saveSection(ctxE, sections, input)).rejects.toThrow(
        AddonNotActive,
      );
      await expect(saveSection(ctxE, sections, input, addons)).rejects.toThrow(
        AddonNotActive,
      );
      await expect(
        undoDeleteSection(ctxE, sections, deleted, addons),
      ).rejects.toThrow(AddonNotActive);
      await expect(undoDeleteSection(ctxE, sections, deleted)).rejects.toThrow(
        AddonNotActive,
      );
      expect(
        await pb.collection("page_sections").getFullList({
          filter: pb.filter("page = {:p}", { p: pageId }),
        }),
      ).toEqual([]);

      // Back on: the undo succeeds.
      await installAddon(ctxE, deps(), QUOTE);
      const back = await undoDeleteSection(ctxE, sections, deleted);
      expect(back.id).toBe(block);
    } finally {
      registerSectionAddonOwners(ADDON_REGISTRY);
    }
  });
});

describe("hub uninstall never no-ops silently (A-WR-08, CONTEXT A3-Q3)", () => {
  it("unknown slug is NotFound; an installed private add-on is removable by the owner", async (t) => {
    if (!inst) return t.skip();
    const orgF = (
      await pb.collection("organizations").create({
        name: "Org F",
        slug: "org-f-private",
        status: "active",
      })
    ).id;
    const ctxF = ctxOf(orgF, seed.A.owner, "owner");
    await expect(uninstallAddon(ctxF, deps(), "no-such-addon")).rejects.toThrow(
      NotFound,
    );
    await expect(
      uninstallAddon(ctxF, deps(), "fixture-private"),
    ).rejects.toThrow(NotFound);

    await installAddonAsStaff(superAdmin, deps(), {
      orgId: orgF,
      slug: "fixture-private",
      reason: "Pilot",
    });
    const d = deps();
    expect(await uninstallAddon(ctxF, d, "fixture-private")).toEqual({
      slug: "fixture-private",
      outcome: "removed",
    });
    const r = await row(orgF, "fixture-private");
    expect(r.status).toBe("disabled");
    expect(r.disabled_reason).toBe("uninstalled");
    expect(d.invalidator.tags).toContain(`org:${orgF}:addons`);
    // Already off: a second remove is a real no-op, not NotFound.
    expect(
      (await uninstallAddon(ctxF, deps(), "fixture-private")).outcome,
    ).toBe("unchanged");
  });
});
