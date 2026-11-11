// 10-17: one entitlement read (BILL-03, BILL-04, BILL-13, BILL-14; CONTEXT A3; D225, D234;
// invariant 9). Active add-ons + $0 plan-included catalog rows for the org's path + Care Plan
// + media pack quantities; a lapsed billing account pauses Care Plan and packs without
// touching the stored values, and every read is scoped to the context's org (T-10-17-02).
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { entitlements, hasEntitlement } from "../src/payments/entitlements";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");

async function newOrg(path: "standard" | "studio"): Promise<OrgContext> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Ent ${t}`,
    slug: `ent-${t}`,
    status: "active",
    path,
  });
  return mintOrgContext({
    orgId: org.id,
    actor: `owner-${t}`,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

async function addAddon(
  ctx: OrgContext,
  addon: string,
  status: "active" | "disabled" = "active",
  reason = "",
): Promise<void> {
  await pb.collection("org_addons").create({
    organization: ctx.orgId,
    addon,
    status,
    disabled_reason: reason,
    source: "billing",
    installed_version: "1.0.0",
    installed_at: new Date().toISOString(),
  });
}

async function account(
  ctx: OrgContext,
  data: Record<string, unknown>,
): Promise<string> {
  const rec = await pb.collection("billing_accounts").create({
    organization: ctx.orgId,
    provider: "fake",
    customer_id: `cus_${tag()}`,
    status: "active",
    ...data,
  });
  return rec.id;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("entitlements(ctx)", () => {
  it("Standard org with active testimonials: just testimonials", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("standard");
    await addAddon(ctx, "testimonials");
    const set = await entitlements(ctx);
    expect([...set.keys].sort()).toEqual(["testimonials"]);
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(false);
  });

  it("Studio org gets the $0 rows (Builder Pro included) with nothing installed", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("studio");
    const set = await entitlements(ctx);
    expect(set.keys.has("builder-pro")).toBe(true);
    // WR-A02: no package behind them yet, so their $0 rows are inactive.
    expect(set.keys.has("newsletter")).toBe(false);
    expect(set.keys.has("landing-pages")).toBe(false);
    // Priced above $0 on Studio: not included.
    expect(set.keys.has("studio-booking-solo")).toBe(false);
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
  });

  it("Standard org has Builder Pro only with an active row", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("standard");
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(false);
    await addAddon(ctx, "builder-pro");
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
  });

  it("a billing_lapse add-on is out; care plan and packs come from the account", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("standard");
    await addAddon(ctx, "testimonials", "disabled", "billing_lapse");
    await account(ctx, {
      care_plan: true,
      media_5gb_qty: 2,
      media_25gb_qty: 1,
    });
    const set = await entitlements(ctx);
    expect(set.keys.has("testimonials")).toBe(false);
    expect(set.keys.has("care-plan")).toBe(true);
    expect(set.mediaPacks5).toBe(2);
    expect(set.mediaPacks25).toBe(1);
  });

  it("is scoped to the context's org (cross-tenant)", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg("standard");
    const b = await newOrg("standard");
    await addAddon(a, "testimonials");
    await account(a, { care_plan: true, media_5gb_qty: 3 });
    expect(await hasEntitlement(a, "testimonials")).toBe(true);
    expect(await hasEntitlement(b, "testimonials")).toBe(false);
    const setB = await entitlements(b);
    expect(setB.keys.has("care-plan")).toBe(false);
    expect(setB.mediaPacks5).toBe(0);
  });

  it("no billing account: no packs, no care plan", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("standard");
    const set = await entitlements(ctx);
    expect(set.mediaPacks5).toBe(0);
    expect(set.mediaPacks25).toBe(0);
    expect(set.keys.has("care-plan")).toBe(false);
  });

  it("lapsed / canceled pause care plan and packs; past_due keeps them; paying restores", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("standard");
    const id = await account(ctx, {
      care_plan: true,
      media_5gb_qty: 2,
      status: "lapsed",
    });

    for (const status of ["lapsed", "canceled"]) {
      await pb.collection("billing_accounts").update(id, { status });
      const set = await entitlements(ctx);
      expect(set.keys.has("care-plan")).toBe(false);
      expect(set.mediaPacks5).toBe(0);
    }

    await pb.collection("billing_accounts").update(id, { status: "past_due" });
    let set = await entitlements(ctx);
    expect(set.keys.has("care-plan")).toBe(true);
    expect(set.mediaPacks5).toBe(2);

    await pb.collection("billing_accounts").update(id, { status: "lapsed" });
    await pb.collection("billing_accounts").update(id, { status: "active" });
    set = await entitlements(ctx);
    expect(set.keys.has("care-plan")).toBe(true);
    expect(set.mediaPacks5).toBe(2);
    const stored = await pb.collection("billing_accounts").getOne(id);
    expect(stored.care_plan).toBe(true);
    expect(stored.media_5gb_qty).toBe(2);
  });

  it("WR-A02: Studio's plan-included Builder Pro pauses with a lapse, like a paid add-on", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("studio");
    // Before checkout (no account): on, like every pre-checkout install (D186).
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
    const id = await account(ctx, { status: "active" });
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
    for (const status of ["lapsed", "canceled"]) {
      await pb.collection("billing_accounts").update(id, { status });
      expect(await hasEntitlement(ctx, "builder-pro")).toBe(false);
    }
    await pb.collection("billing_accounts").update(id, { status: "past_due" });
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
    await pb.collection("billing_accounts").update(id, { status: "active" });
    expect(await hasEntitlement(ctx, "builder-pro")).toBe(true);
  });

  it("hasEntitlement refuses an empty key", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("studio");
    expect(await hasEntitlement(ctx, "")).toBe(false);
  });
});
