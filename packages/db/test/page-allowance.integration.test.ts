// Page allowance on the real PocketBase 0.39.11 binary (11-26; DASH-08; D185, D273;
// invariant 9; T-11-26-01, T-11-26-02). createPage refuses past 10 + 5 x active page packs;
// only live, unprotected builder pages count; a lapse lowers the allowance and deletes
// nothing; two concurrent creates at the last free page cannot both win.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  countPagesTowardLimit,
  PageLimitReached,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  assertPageRoom,
  countCountedPages,
  pageAllowanceFor,
  pagesUsage,
} from "../src/content/allowance";
import { createPage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import { setPagePassword } from "../src/content/protected/password";
import { mintOrgContext, type OrgContext } from "../src/context";
import { LocalDiskStore } from "../src/storage/local-disk";
import type { ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

let n = 0;
async function bareOrg(role: "owner" | "viewer" = "owner"): Promise<{
  org: string;
  ctx: OrgContext;
}> {
  n += 1;
  const tag = `${n}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Allow ${tag}`,
      slug: `allow-${tag}`,
      status: "active",
    })
  ).id;
  const ctx = mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
  });
  return { org, ctx };
}

/** Raw page rows (fast fixture; createPage is what the tests exercise). */
async function rawPages(
  org: string,
  count: number,
  over: Record<string, unknown> = {},
  prefix = "p",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await pb.collection("pages").create({
      organization: org,
      title: `${prefix} ${i}`,
      slug: `${prefix}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      seo: {},
      status: "draft",
      kind: "builder",
      has_unpublished_changes: true,
      previous_slugs: [],
      password_protected: false,
      ...over,
    });
  }
}

async function account(
  org: string,
  status: string,
  pages5: number,
  draft: unknown = null,
): Promise<string> {
  const row = await pb.collection("billing_accounts").create({
    organization: org,
    provider: "fake",
    status,
    installments_paid: 0,
    pages_5_qty: pages5,
    checkout_draft: draft,
  });
  return row.id;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-page-allow-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = new LocalDiskStore(storageDir);
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

describe("createPage: the allowance (DASH-08)", () => {
  it("refuses the 11th builder page with PageLimitReached (allowance 10)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await rawPages(ctx.orgId, 10);
    const err = await createPage(
      ctx,
      { title: "Eleven", slug: "eleven" },
      store,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageLimitReached);
    expect((err as PageLimitReached).code).toBe("page_limit");
    expect((err as PageLimitReached).allowance).toBe(10);
    expect(await countCountedPages(pb, ctx.orgId)).toBe(10);
    expect(await pagesUsage(ctx)).toEqual({ used: 10, allowance: 10 });
  });

  it("does not count the 404 page, deleted or password-protected pages", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await rawPages(ctx.orgId, 9);
    await rawPages(ctx.orgId, 1, { kind: "system-404", slug: "system-404" });
    await rawPages(ctx.orgId, 1, { password_protected: true }, "locked");
    await rawPages(
      ctx.orgId,
      1,
      { password_protected: false, password_hash: "x$hash" },
      "hashed",
    );
    await rawPages(
      ctx.orgId,
      2,
      { deleted_at: new Date().toISOString() },
      "binned",
    );
    expect(await countCountedPages(pb, ctx.orgId)).toBe(9);

    // The bound count query and the pure rule agree on the same rows (choice 2).
    const rows = await pb.collection("pages").getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    });
    expect(
      countPagesTowardLimit(
        rows.map((r) => ({
          kind: String(r.kind),
          deleted_at: typeof r.deleted_at === "string" ? r.deleted_at : "",
          password_protected:
            r.password_protected === true ||
            (typeof r.password_hash === "string" && r.password_hash !== ""),
        })),
      ),
    ).toBe(9);

    const p = await createPage(ctx, { title: "Tenth", slug: "tenth" }, store);
    expect(p.slug).toBe("tenth");
    await expect(
      createPage(ctx, { title: "Eleventh", slug: "eleventh" }, store),
    ).rejects.toBeInstanceOf(PageLimitReached);
  });

  it("adds 5 per active page pack; a lapse drops to 10 and deletes nothing", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const acct = await account(ctx.orgId, "active", 1);
    expect(await pageAllowanceFor(ctx)).toBe(15);
    await rawPages(ctx.orgId, 12);
    const p = await createPage(
      ctx,
      { title: "Thirteen", slug: "thirteen" },
      store,
    );
    expect(p.kind).toBe("builder");
    expect(await pagesUsage(ctx)).toEqual({ used: 13, allowance: 15 });

    await pb.collection("billing_accounts").update(acct, { status: "lapsed" });
    expect(await pageAllowanceFor(ctx)).toBe(10);
    await expect(
      createPage(ctx, { title: "Fourteen", slug: "fourteen" }, store),
    ).rejects.toBeInstanceOf(PageLimitReached);
    expect(await pagesUsage(ctx)).toEqual({ used: 13, allowance: 10 });
    const stored = await pb.collection("billing_accounts").getOne(acct);
    expect(stored.pages_5_qty).toBe(1);

    await pb
      .collection("billing_accounts")
      .update(acct, { status: "canceled" });
    expect(await pageAllowanceFor(ctx)).toBe(10);
    await pb
      .collection("billing_accounts")
      .update(acct, { status: "past_due" });
    expect(await pageAllowanceFor(ctx)).toBe(15);
  });

  it("reads pending pre-checkout packs from the draft, 0 when absent", async (t) => {
    if (!inst) return t.skip();
    const none = await bareOrg();
    expect(await pageAllowanceFor(none.ctx)).toBe(10);
    const plain = await bareOrg();
    await account(plain.org, "none", 0, { cadence: "monthly" });
    expect(await pageAllowanceFor(plain.ctx)).toBe(10);
    const pending = await bareOrg();
    await account(pending.org, "none", 0, { pagePacks: 2 });
    expect(await pageAllowanceFor(pending.ctx)).toBe(20);
    const junk = await bareOrg();
    await account(junk.org, "none", 0, { pagePacks: "lots" });
    expect(await pageAllowanceFor(junk.ctx)).toBe(10);
  });

  it("two concurrent creates at 9 pages: exactly one succeeds", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await rawPages(ctx.orgId, 9);
    const results = await Promise.allSettled([
      createPage(ctx, { title: "Race A", slug: "race-a" }, store),
      createPage(ctx, { title: "Race B", slug: "race-b" }, store),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof PageLimitReached,
    );
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(await countCountedPages(pb, ctx.orgId)).toBe(10);
  });

  it("assertPageRoom never counts another org's pages", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    await rawPages(b.org, 10);
    await expect(assertPageRoom(pb, a.ctx)).resolves.toBeUndefined();
    await expect(assertPageRoom(pb, b.ctx)).rejects.toBeInstanceOf(
      PageLimitReached,
    );
  });

  it("pagesUsage: any member reads it; a forged context is refused", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("viewer");
    await expect(pagesUsage(ctx)).resolves.toEqual({ used: 0, allowance: 10 });
    const bad = { ...ctx, orgId: "" } as OrgContext;
    await expect(pagesUsage(bad)).rejects.toBeTruthy();
  });
});

describe("setPagePassword: clearing a password needs a free page (WR-B03, D185)", () => {
  it("refuses at the allowance and keeps the page protected; allowed once a page is free", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await rawPages(ctx.orgId, 10);
    const locked = (
      await pb.collection("pages").create({
        organization: ctx.orgId,
        title: "Members",
        slug: `members-${Math.random().toString(36).slice(2, 6)}`,
        seo: {},
        status: "draft",
        kind: "builder",
        has_unpublished_changes: true,
        previous_slugs: [],
        password_protected: true,
        password_hash: "x$hash",
      })
    ).id;
    const deps = {
      sections: composeSectionRegistry(CORE_SECTIONS, []),
      invalidator: recordingInvalidator(),
      store,
    };
    const err = await setPagePassword(
      ctx,
      locked,
      { password: null },
      deps,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageLimitReached);
    const row = await pb.collection("pages").getOne(locked);
    expect(row.password_protected).toBe(true);
    expect(row.password_hash).toBe("x$hash");
    expect(await countCountedPages(pb, ctx.orgId)).toBe(10);

    const one = await pb.collection("pages").getFirstListItem(
      pb.filter("organization = {:o} && id != {:id}", {
        o: ctx.orgId,
        id: locked,
      }),
    );
    await pb.collection("pages").delete(one.id);
    const summary = await setPagePassword(
      ctx,
      locked,
      { password: null },
      deps,
    );
    expect(summary.password_protected).toBe(false);
    expect(await countCountedPages(pb, ctx.orgId)).toBe(10);
  });
});
