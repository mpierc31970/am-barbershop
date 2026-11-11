// getOrgStage + getSitePreviewUrl on the real PocketBase 0.39.11 binary (08-09; TMPL-04,
// D312, CONTEXT A2-Q5). The preview URL comes from the org in the context only; another
// org's host is never returned (T-08-09-01).
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { Forbidden, InvalidInput } from "@cds/core";
import {
  mintOrgContext,
  mintPlatformContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import {
  getOrgStage,
  getSitePreviewUrl,
  launchReviewProgress,
  orgIsLive,
  readOrgStatus,
  setBuildNote,
  setOrgStage,
} from "../src/org-stage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

async function freshOrg(
  stage: string,
): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name: "Rivera Bakery",
      slug: `os-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
      path: "standard",
      stage,
    })
  ).id;
  const ctx = mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
  return { org, ctx };
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
});

describe("getOrgStage (D312)", () => {
  it("reads being_built", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg("being_built");
    expect((await getOrgStage(ctx)).stage).toBe("being_built");
  });
});

describe("getSitePreviewUrl (08-09, CONTEXT A2-Q5)", () => {
  it("returns the org's primary host as https://<host>/", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg("being_built");
    await pb.collection("org_hosts").create({
      hostname: "rivera.sites.localhost",
      organization: org,
      kind: "preview",
      primary: true,
    });
    const url = await getSitePreviewUrl(ctx);
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.hostname).toBe("rivera.sites.localhost");
    expect(u.pathname).toBe("/");
  });

  it("an org with no host gets null, never another org's host (T-08-09-01)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg("being_built");
    expect(await getSitePreviewUrl(ctx)).toBeNull();
  });

  it("each seeded org sees only its own host", async (t) => {
    if (!inst) return t.skip();
    expect(await getSitePreviewUrl(seed.ctxA)).toBe("https://a.example.com/");
    expect(await getSitePreviewUrl(seed.ctxB)).toBe("https://b.example.com/");
  });

  it("an org id that doesn't exist yields null rather than throwing", async (t) => {
    if (!inst) return t.skip();
    const ctx = mintOrgContext({
      orgId: "zzzzzzzzzzzzzzz",
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    });
    expect(await getSitePreviewUrl(ctx)).toBeNull();
  });
});

// ---- 11-03: stage widen, setOrgStage, readOrgStatus, build note, launch review --------

function staff(role: "super_admin" | "support_agent" = "super_admin") {
  return mintPlatformContext({
    actor: seed.B.owner,
    staffRole: role,
    ip: "10.0.0.1",
  });
}

async function stageAudits(org: string): Promise<number> {
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org} && action = 'org.stage_changed'", {
      org,
    }),
  });
  return rows.length;
}

describe("stage widen (11-03, Pitfall 1)", () => {
  it("getOrgStage reads ready_for_review and live", async (t) => {
    if (!inst) return t.skip();
    expect((await getOrgStage((await freshOrg("live")).ctx)).stage).toBe(
      "live",
    );
    expect(
      (await getOrgStage((await freshOrg("ready_for_review")).ctx)).stage,
    ).toBe("ready_for_review");
  });
});

describe("setOrgStage (11-03; D312, T-11-03-01..03)", () => {
  it("moves forward once, audited in the same batch; a repeat is a no-op", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg("being_built");
    const first = await setOrgStage(staff(), org, "ready_for_review");
    expect(first.changed).toBe(true);
    expect((await getOrgStage(ctx)).stage).toBe("ready_for_review");
    expect(await stageAudits(org)).toBe(1);
    const audit = await pb.collection("audit_log").getFirstListItem(
      pb.filter("organization = {:org} && action = 'org.stage_changed'", {
        org,
      }),
    );
    expect(audit.meta).toEqual({ from: "being_built", to: "ready_for_review" });
    const again = await setOrgStage(staff(), org, "ready_for_review");
    expect(again.changed).toBe(false);
    expect(await stageAudits(org)).toBe(1);
  });

  it("refuses a backward move, and live is final", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("live");
    await expect(setOrgStage(staff(), org, "being_built")).rejects.toThrow(
      InvalidInput,
    );
    const { org: o2 } = await freshOrg("ready_for_review");
    await expect(setOrgStage(staff(), o2, "intake")).rejects.toThrow(
      InvalidInput,
    );
  });

  it("refuses an unknown stage", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    await expect(
      setOrgStage(staff(), org, "launched" as never),
    ).rejects.toThrow(InvalidInput);
  });

  it("live sets launched_at once; repeating keeps it", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg("ready_for_review");
    const first = await setOrgStage(ctx, org, "live");
    expect(first.changed).toBe(true);
    expect(first.launchedAt).toBeTruthy();
    const again = await setOrgStage(staff(), org, "live");
    expect(again.changed).toBe(false);
    expect(again.launchedAt).toBe(first.launchedAt);
    const row = await pb.collection("organizations").getOne(org);
    expect(new Date(row.launched_at).toISOString()).toBe(
      new Date(first.launchedAt!).toISOString(),
    );
    expect(await orgIsLive(org)).toBe(true);
  });

  it("an existing launched_at is kept when going live", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("ready_for_review");
    await pb
      .collection("organizations")
      .update(org, { launched_at: "2026-01-02 03:04:05.000Z" });
    const r = await setOrgStage(staff(), org, "live");
    expect(new Date(r.launchedAt!).toISOString()).toBe(
      "2026-01-02T03:04:05.000Z",
    );
  });

  it("an Editor is refused; the Owner passes (launch_approval:run)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    const editor = mintOrgContext({
      orgId: org,
      actor: seed.A.owner,
      role: "editor",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(setOrgStage(editor, org, "ready_for_review")).rejects.toThrow(
      Forbidden,
    );
    const { ctx } = await freshOrg("ready_for_review");
    const owner = await setOrgStage(ctx, ctx.orgId, "live");
    expect(owner.changed).toBe(true);
  });

  it("WR-B06: the Owner only approves the launch (ready_for_review -> live)", async (t) => {
    if (!inst) return t.skip();
    for (const [from, to] of [
      ["intake", "live"],
      ["ready_for_build", "live"],
      ["being_built", "ready_for_review"],
      ["being_built", "live"],
    ] as const) {
      const { org, ctx } = await freshOrg(from);
      await expect(
        setOrgStage(ctx, org, to),
        `${from} -> ${to}`,
      ).rejects.toThrow(Forbidden);
      const row = await pb.collection("organizations").getOne(org);
      expect(row.stage).toBe(from);
      expect(row.launched_at).toBe("");
    }
  });

  it("an org context cannot move another org", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg("being_built");
    const { org: other } = await freshOrg("being_built");
    await expect(setOrgStage(ctx, other, "ready_for_review")).rejects.toThrow(
      InvalidInput,
    );
  });

  it("a support agent may not change stage; a system job may", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    await expect(
      setOrgStage(staff("support_agent"), org, "ready_for_review"),
    ).rejects.toThrow(Forbidden);
    const sys = mintSystemContext({ job: "dev-seed" });
    expect((await setOrgStage(sys, org, "ready_for_review")).changed).toBe(
      true,
    );
  });

  it("never moves a site off fit_review; fit:review clears it (WR-A01)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("fit_review");
    for (const to of ["ready_for_build", "live"] as const) {
      await expect(setOrgStage(staff(), org, to)).rejects.toThrow(/fit:review/);
    }
    const sys = mintSystemContext({ job: "dev-seed" });
    await expect(setOrgStage(sys, org, "being_built")).rejects.toThrow(
      InvalidInput,
    );
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
    expect(await stageAudits(org)).toBe(0);
  });

  it("a held or closed site never moves (WR-A01)", async (t) => {
    if (!inst) return t.skip();
    for (const status of ["held", "disabled"]) {
      const { org } = await freshOrg("being_built");
      await pb.collection("organizations").update(org, { status });
      await expect(setOrgStage(staff(), org, "live")).rejects.toThrow(
        InvalidInput,
      );
      const row = await pb.collection("organizations").getOne(org);
      expect(row.stage).toBe("being_built");
      expect(row.launched_at).toBe("");
    }
  });

  it("two concurrent moves of one org run one after the other (WR-A01 lock)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    const [a, b] = await Promise.all([
      setOrgStage(staff(), org, "ready_for_review"),
      setOrgStage(staff(), org, "ready_for_review"),
    ]);
    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1);
    expect(await stageAudits(org)).toBe(1);
  });

  it("orgIsLive is false for a not-live org", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    expect(await orgIsLive(org)).toBe(false);
    expect(await orgIsLive("zzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("readOrgStatus + setBuildNote (11-03)", () => {
  it("reads stage, dates, build note and analytics", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg("being_built");
    const before = await readOrgStatus(ctx);
    expect(before.stage).toBe("being_built");
    expect(before.buildNote).toBe("");
    expect(before.buildNoteAt).toBeNull();
    expect(before.launchedAt).toBeNull();
    await setBuildNote(staff("support_agent"), org, "Photos go in Monday.");
    const after = await readOrgStatus(ctx);
    expect(after.buildNote).toBe("Photos go in Monday.");
    expect(after.buildNoteAt).toBeTruthy();
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'org.build_note_set'",
        { org },
      ),
    });
    expect(audits).toHaveLength(1);
  });

  it("a build note over 280 characters is refused", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg("being_built");
    await expect(setBuildNote(staff(), org, "x".repeat(281))).rejects.toThrow(
      InvalidInput,
    );
  });
});

describe("launchReviewProgress (11-03 seam; real store since 14-33, D172)", () => {
  it("a fresh ready_for_review org: six items, review available, nothing to review yet", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg("ready_for_review");
    const p = await launchReviewProgress(ctx);
    expect(p.total).toBe(6);
    expect(p.available).toBe(true);
    expect(p.items).toHaveLength(6);
    expect(p.items.every((i) => i.id && i.label)).toBe(true);
    // No pages, no email, no form, no tickets: only the vacuous items are done (14-33).
    expect(p.items.filter((i) => i.done).map((i) => i.id)).toEqual([
      "changes_sent",
      "test_form",
      "no_open_requests",
    ]);
  });

  it("is unavailable before ready_for_review", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg("being_built");
    expect((await launchReviewProgress(ctx)).available).toBe(false);
  });
});
