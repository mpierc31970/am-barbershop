// Media usage and the per-org allowance on the real PocketBase 0.39.11 binary (07-10, 10-33;
// CONT-19, BILL-13, D225, D278; invariant 1, T-07-10-05, T-10-33-01): usage is counted by asset
// from media_assets.bytes, for the caller's org only; soft-deleted rows still count,
// hard-deleted ones do not. The allowance is 2 GB + storage packs from billing_accounts.
import { Forbidden, InvalidContext } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { MediaAlertData } from "../src/media/ops/alerts";
import { alertOverAllowance } from "../src/media/ops/alerts";
import { listMediaUsage } from "../src/media/ops/usage-report";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import {
  AllowanceExceeded,
  MEDIA_ALLOWANCE_BYTES,
  USAGE_COPY,
  assertAllowance,
  mediaAllowance,
  mediaUsage,
  mediaUsageByOrg,
} from "../src/media/cdn";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let orgA = "";
let orgB = "";

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<string> {
  return (
    await pb.collection("organizations").create({
      name: "Usage Co",
      slug: `usage-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
}

async function row(
  org: string,
  kind: string,
  bytes: number,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const rec = await pb.collection("media_assets").create({
    organization: org,
    kind,
    bytes,
    status: "ready",
    source: "library",
    original_ext: "webp",
    storage_dir: `tenants/${org}/media/u${Math.random().toString(36).slice(2, 8)}`,
    sort_order: 1,
    ...extra,
  });
  return rec.id;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  orgA = await bareOrg();
  orgB = await bareOrg();
  const now = new Date().toISOString();
  await row(orgA, "library", 100 * MB);
  await row(orgA, "video", 300 * MB);
  await row(orgA, "audio", 20 * MB);
  await row(orgA, "gallery", 50 * MB, { deleted_at: now });
  await row(orgA, "library", 10 * MB, { removed_at: now });
  const gone = await row(orgA, "library", 999 * MB);
  await pb.collection("media_assets").delete(gone);
  await row(orgB, "library", 1024 * MB);
});

afterAll(async () => {
  await inst?.stop();
});

describe("mediaUsage (by asset, org-scoped)", () => {
  it("sums bytes per asset incl. soft-deleted, excludes hard-deleted and org B", async (t) => {
    if (!inst) return t.skip();
    const u = await mediaUsage(ctxAs(orgA, "owner"));
    expect(u.usedBytes).toBe(480 * MB);
    expect(u.byKind).toEqual({
      image: 160 * MB,
      video: 300 * MB,
      audio: 20 * MB,
    });
    expect(u.assets).toBe(5);
    expect(u.allowanceBytes).toBe(MEDIA_ALLOWANCE_BYTES);
    expect(u.level).toBe("ok");
    expect(u.label).toBe("0.5 GB of 2 GB used");
  });

  it("an Editor may read; a role without content read is refused", async (t) => {
    if (!inst) return t.skip();
    const ed = await mediaUsage(ctxAs(orgA, "editor"));
    expect(ed.usedBytes).toBe(480 * MB);
    await expect(mediaUsage(ctxAs(orgA, "renter"))).rejects.toThrow(Forbidden);
    await expect(mediaUsage(ctxAs(orgA, "staff"))).rejects.toThrow(Forbidden);
  });

  it("refuses a non-minted context", async (t) => {
    if (!inst) return t.skip();
    await expect(
      mediaUsage({ orgId: orgA, role: "owner" } as never),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("assertAllowance (2 GB, no packs)", () => {
  it("refuses past 2 GB with the exact full copy", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(orgA, "owner");
    const room = MEDIA_ALLOWANCE_BYTES - 480 * MB;
    let err: unknown;
    try {
      await assertAllowance(ctx, room + 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AllowanceExceeded);
    expect((err as Error).message).toBe(USAGE_COPY.full(MEDIA_ALLOWANCE_BYTES));
  });

  it("returns the 80 % warning between 80 % and 100 %", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(orgA, "owner");
    const r = await assertAllowance(ctx, 1300 * MB);
    expect(r.level).toBe("warn");
    expect(r.warning).toBe(USAGE_COPY.warn(1780 * MB, MEDIA_ALLOWANCE_BYTES));
    const ok = await assertAllowance(ctx, 10 * MB);
    expect(ok.warning).toBeNull();
  });
});

describe("mediaUsageByOrg (staff / jobs)", () => {
  it("groups totals per org for a SystemContext", async (t) => {
    if (!inst) return t.skip();
    const all = await mediaUsageByOrg(mintSystemContext({ job: "test" }));
    expect(all.get(orgA)?.usedBytes).toBe(480 * MB);
    expect(all.get(orgB)?.usedBytes).toBe(1024 * MB);
    expect(all.get(orgB)?.assets).toBe(1);
  });

  it("refuses an OrgContext", async (t) => {
    if (!inst) return t.skip();
    await expect(
      mediaUsageByOrg(ctxAs(orgA, "owner") as never),
    ).rejects.toThrow(Forbidden);
  });
});

describe("storage packs raise the allowance (BILL-13, D225, CONTEXT A3)", () => {
  let orgC = "";
  let orgD = "";
  let accountC = "";

  beforeAll(async () => {
    if (!inst) return;
    // Org C sits exactly at 2 GB; org D is over 2 GB with no packs.
    orgC = await bareOrg();
    orgD = await bareOrg();
    await row(orgC, "video", 2 * GB);
    await row(orgD, "video", 3 * GB);
  });

  async function setPacks(
    q5: number,
    q25: number,
    status = "active",
  ): Promise<void> {
    const body = {
      status,
      media_5gb_qty: q5,
      media_25gb_qty: q25,
    };
    if (accountC === "") {
      accountC = (
        await pb.collection("billing_accounts").create({
          organization: orgC,
          provider: "fake",
          installments_paid: 0,
          ...body,
        })
      ).id;
    } else {
      await pb.collection("billing_accounts").update(accountC, body);
    }
  }

  it("no billing account: 2 GB, and a 100 MB upload at 2 GB is refused", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(orgC, "owner");
    expect(await mediaAllowance(ctx)).toBe(2 * GB);
    await expect(assertAllowance(ctx, 100 * MB)).rejects.toThrow(
      AllowanceExceeded,
    );
  });

  it("one 5 GB pack: the same upload passes and usage reads 7 GB", async (t) => {
    if (!inst) return t.skip();
    await setPacks(1, 0);
    const ctx = ctxAs(orgC, "owner");
    expect(await mediaAllowance(ctx)).toBe(7 * GB);
    const r = await assertAllowance(ctx, 100 * MB);
    expect(r.level).toBe("ok");
    const u = await mediaUsage(ctxAs(orgC, "editor"));
    expect(u.allowanceBytes).toBe(7 * GB);
    expect(u.label).toBe("2 GB of 7 GB used");
    expect(u.level).toBe("ok");
  });

  it("packs stack (2 x 5 GB + 1 x 25 GB = 37 GB)", async (t) => {
    if (!inst) return t.skip();
    await setPacks(2, 1);
    expect(await mediaAllowance(ctxAs(orgC, "viewer"))).toBe(37 * GB);
  });

  it("removing the pack, or a lapse, re-applies 2 GB", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(orgC, "owner");
    await setPacks(0, 0);
    await expect(assertAllowance(ctx, 100 * MB)).rejects.toThrow(
      AllowanceExceeded,
    );
    await setPacks(1, 0, "lapsed");
    expect(await mediaAllowance(ctx)).toBe(2 * GB);
    await expect(assertAllowance(ctx, 100 * MB)).rejects.toThrow(
      USAGE_COPY.full(2 * GB),
    );
    await setPacks(1, 0, "past_due");
    expect(await mediaAllowance(ctx)).toBe(7 * GB);
  });

  it("an org's allowance never leaks to another org", async (t) => {
    if (!inst) return t.skip();
    expect(await mediaAllowance(ctxAs(orgD, "owner"))).toBe(2 * GB);
    expect(await mediaAllowance(ctxAs(orgA, "owner"))).toBe(2 * GB);
  });

  it("mediaUsageByOrg and the over-allowance alert use each org's own allowance", async (t) => {
    if (!inst) return t.skip();
    await setPacks(1, 0);
    const sys = mintSystemContext({ job: "test" });
    const all = await mediaUsageByOrg(sys);
    expect(all.get(orgC)?.allowanceBytes).toBe(7 * GB);
    expect(all.get(orgC)?.level).toBe("ok");
    expect(all.get(orgD)?.allowanceBytes).toBe(2 * GB);
    expect(all.get(orgD)?.level).toBe("full");

    const sent: MediaAlertData[] = [];
    const res = await alertOverAllowance(sys, new Date(), {
      read: async () => "",
      write: async () => {},
      orgNames: async (ids) => new Map(ids.map((id) => [id, id])),
      send: async (_c, d) => {
        sent.push(d);
        return { status: "sent" };
      },
    });
    const alerted = sent.map((d) => d.orgName);
    expect(alerted).toContain(orgD);
    expect(alerted).not.toContain(orgC);
    expect(res.alerted).toBe(sent.length);
    const d = sent.find((x) => x.orgName === orgD)!;
    expect(d.detail).toBe("Using 3 GB of its 2 GB of media.");
  });

  it("the staff usage report lists each org's own allowance", async (t) => {
    if (!inst) return t.skip();
    const staff = await staffContext(
      inst!,
      "media-usage-agent@cds.test",
      "support_agent",
    );
    const rows = await listMediaUsage(
      staff,
      {},
      {
        delivery: { deliveryBytes: async () => null } as never,
      },
    );
    const c = rows.find((r) => r.orgId === orgC)!;
    const dRow = rows.find((r) => r.orgId === orgD)!;
    expect(c.allowanceBytes).toBe(7 * GB);
    expect(c.label).toBe("2 GB of 7 GB used");
    expect(dRow.allowanceBytes).toBe(2 * GB);
    expect(dRow.level).toBe("full");
  });
});
