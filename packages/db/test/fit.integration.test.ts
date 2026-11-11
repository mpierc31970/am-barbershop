// Staff fit review against a real PocketBase (ONB-12, D215; PD-23; T-06-40). Approve moves a
// held-for-review org back to intake (or ready_for_build when intake was sent); decline holds
// the org. Both are super_admin only, audited with the reason, and email the owner.
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import {
  approveFit,
  declineFit,
  describeFitCase,
  FIT_BLOCKED_COPY,
  FIT_CASE_CHANGED_COPY,
} from "../src/fit";
import {
  bootSeededPb,
  captureTransport,
  staffContext,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
let admin: PlatformContext;
let agent: PlatformContext;
let n = 0;

async function heldOrg(
  opts: { stage?: string; submitted?: boolean } = {},
): Promise<{ orgId: string; ownerEmail: string }> {
  const pb = await superuser();
  n += 1;
  const ownerEmail = `fit-owner-${n}@cds.test`;
  const pw = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const user = await pb.collection("users").create({
    email: ownerEmail,
    password: pw,
    passwordConfirm: pw,
  });
  const org = await pb.collection("organizations").create({
    name: `Fit Org ${n}`,
    slug: `fit-org-${n}`,
    status: "active",
    path: "standard",
    stage: opts.stage ?? "fit_review",
  });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: org.id, role: "owner" });
  await pb.collection("business_profile").create({
    organization: org.id,
    business_type: "cbd-shop",
    description: `Organic ${AUP_TEST_TERMS.review} tea`,
    public_email: ownerEmail,
  });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: {},
    submitted_at: opts.submitted ? new Date().toISOString() : "",
  });
  await pb.collection("org_email_routes").create({
    organization: org.id,
    purpose: "default",
    address: ownerEmail,
    confirmed_at: new Date().toISOString(),
  });
  return { orgId: org.id, ownerEmail };
}

async function org(id: string) {
  return (await superuser()).collection("organizations").getOne(id);
}

async function auditRows(orgId: string, action: string) {
  const pb = await superuser();
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action = {:a}", {
      o: orgId,
      a: action,
    }),
  });
}

async function fingerprint(orgId: string): Promise<string> {
  return (await describeFitCase(admin, orgId)).fingerprint;
}

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("fit review (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    admin = await staffContext(
      booted.inst,
      "fit-admin@cds.test",
      "super_admin",
    );
    agent = await staffContext(
      booted.inst,
      "fit-agent@cds.test",
      "support_agent",
    );
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("describeFitCase lists the org and the matched reasons", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    const c = await describeFitCase(admin, orgId);
    expect(c.orgId).toBe(orgId);
    expect(c.stage).toBe("fit_review");
    expect(c.businessType).toBe("cbd-shop");
    expect(c.reasons).toContain("business type: cbd-shop");
    expect(c.reasons).toContain(`keyword: ${AUP_TEST_TERMS.review}`);
  });

  it("approve: stage -> intake, audited with the reason, owner emailed", async (t) => {
    if (!booted) return t.skip();
    const { orgId, ownerEmail } = await heldOrg();
    const transport = captureTransport();
    const reviewed = (await describeFitCase(admin, orgId)).fingerprint;
    await approveFit(admin, orgId, "Legal hemp tea only", {
      transport,
      reviewed,
    });
    expect((await org(orgId)).stage).toBe("intake");
    const rows = await auditRows(orgId, "fit.approve");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(admin.actor);
    expect((rows[0]!.meta as { reason?: string }).reason).toBe(
      "Legal hemp tea only",
    );
    // The reasons this approval cleared, so a later re-screen holds only for new ones (A-CR-01).
    expect((rows[0]!.meta as { reasons?: string[] }).reasons).toEqual(
      expect.arrayContaining([
        "business type: cbd-shop",
        `keyword: ${AUP_TEST_TERMS.review}`,
      ]),
    );
    expect(transport.sent.map((m) => [m.type, m.to])).toEqual([
      ["fit.approved", ownerEmail],
    ]);
  });

  it("describeFitCase shows every screened field that has text (R2-CR-01)", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    const pb = await superuser();
    const bp = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
    await pb
      .collection("business_profile")
      .update(bp.id, { about: "About text", mission: "Mission text" });
    const c = await describeFitCase(admin, orgId);
    expect(c.fields).toEqual(
      expect.arrayContaining([
        { field: "org_name", text: expect.stringContaining("Fit Org") },
        { field: "business_type", text: "cbd-shop" },
        { field: "about", text: "About text" },
        { field: "mission", text: "Mission text" },
      ]),
    );
    expect(c.fields.map((f) => f.field)).not.toContain("tagline");
  });

  it("an approve is refused when the case changed after staff read it (R2-CR-01)", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    const reviewed = await fingerprint(orgId);
    // The owner adds a never-hosted keyword while staff are reviewing.
    const pb = await superuser();
    const bp = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
    await pb
      .collection("business_profile")
      .update(bp.id, { about: `We sell ${AUP_TEST_TERMS.blocked}.` });
    const err = await rejects(
      approveFit(admin, orgId, "ok", {
        transport: captureTransport(),
        reviewed,
      }),
    );
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(FIT_CASE_CHANGED_COPY);
    expect((await org(orgId)).stage).toBe("fit_review");
    expect(await auditRows(orgId, "fit.approve")).toHaveLength(0);
  });

  it("a blocked case needs an explicit override to approve (R2-CR-01)", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    const pb = await superuser();
    const bp = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
    await pb
      .collection("business_profile")
      .update(bp.id, { mission: `${AUP_TEST_TERMS.blocked} for all` });
    const c = await describeFitCase(admin, orgId);
    expect(c.verdict).toBe("blocked");
    const err = await rejects(
      approveFit(admin, orgId, "ok", {
        transport: captureTransport(),
        reviewed: c.fingerprint,
      }),
    );
    expect((err as Error).message).toBe(FIT_BLOCKED_COPY);
    expect((await org(orgId)).stage).toBe("fit_review");
    await approveFit(admin, orgId, "Reviewed by a person", {
      transport: captureTransport(),
      reviewed: c.fingerprint,
      overrideBlocked: true,
    });
    expect((await org(orgId)).stage).toBe("intake");
  });

  it("an approve without a fingerprint is refused", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    expect(
      await rejects(approveFit(admin, orgId, "ok", { reviewed: "" })),
    ).toBeInstanceOf(InvalidInput);
    expect((await org(orgId)).stage).toBe("fit_review");
  });

  it("an intake sent while an approve is being written still ends at ready_for_build (A-WR-07)", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    const pb = await superuser();
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
    // The checker runs after the org is read and before the stage is written: stand in
    // for a Send to CDS from the web app (another process) landing in that window. The
    // first call is the staff read of the case; the second is the approve.
    let calls = 0;
    const racingChecker = {
      async check() {
        calls += 1;
        if (calls === 2) {
          await pb
            .collection("org_intake")
            .update(intake.id, { submitted_at: new Date().toISOString() });
        }
        return { verdict: "review" as const, reasons: ["keyword: x"] };
      },
    };
    const reviewed = (
      await describeFitCase(admin, orgId, { checker: racingChecker })
    ).fingerprint;
    await approveFit(admin, orgId, "ok", {
      transport: captureTransport(),
      checker: racingChecker,
      reviewed,
    });
    expect((await org(orgId)).stage).toBe("ready_for_build");
    expect(await auditRows(orgId, "fit.reconcile")).toHaveLength(1);
  });

  it("the decision email skips a pending (unconfirmed) default change (A-WR-08)", async (t) => {
    if (!booted) return t.skip();
    const { orgId, ownerEmail } = await heldOrg();
    const pb = await superuser();
    await pb.collection("org_email_routes").create({
      organization: orgId,
      purpose: "default",
      address: "typo-pending@cds.test",
      confirmed_at: "",
    });
    const transport = captureTransport();
    await approveFit(admin, orgId, "ok", {
      transport,
      reviewed: await fingerprint(orgId),
    });
    expect(transport.sent.map((m) => m.to)).toEqual([ownerEmail]);
  });

  it("with no confirmed default, the decision email goes to the owner's sign-in address", async (t) => {
    if (!booted) return t.skip();
    const { orgId, ownerEmail } = await heldOrg();
    const pb = await superuser();
    const routes = await pb.collection("org_email_routes").getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
    });
    for (const r of routes) {
      await pb
        .collection("org_email_routes")
        .update(r.id, { bounced_at: new Date().toISOString() });
    }
    const transport = captureTransport();
    await declineFit(admin, orgId, "no", { transport });
    expect(transport.sent.map((m) => [m.type, m.to])).toEqual([
      ["fit.declined", ownerEmail],
    ]);
  });

  it("approve after intake was sent: stage -> ready_for_build", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg({ submitted: true });
    await approveFit(admin, orgId, "ok", {
      transport: captureTransport(),
      reviewed: await fingerprint(orgId),
    });
    expect((await org(orgId)).stage).toBe("ready_for_build");
  });

  it("decline: status held, stage stays fit_review, audited, owner emailed", async (t) => {
    if (!booted) return t.skip();
    const { orgId, ownerEmail } = await heldOrg();
    const transport = captureTransport();
    await declineFit(admin, orgId, "Sells restricted goods", { transport });
    const o = await org(orgId);
    expect(o.status).toBe("held");
    expect(o.stage).toBe("fit_review");
    expect(await auditRows(orgId, "fit.decline")).toHaveLength(1);
    expect(transport.sent.map((m) => [m.type, m.to])).toEqual([
      ["fit.declined", ownerEmail],
    ]);
  });

  it("approve after a decline re-activates the held org", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    await declineFit(admin, orgId, "first look", {
      transport: captureTransport(),
    });
    await approveFit(admin, orgId, "second look", {
      transport: captureTransport(),
      reviewed: await fingerprint(orgId),
    });
    const o = await org(orgId);
    expect(o.status).toBe("active");
    expect(o.stage).toBe("intake");
  });

  it("an org not in fit_review is InvalidInput", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg({ stage: "intake" });
    expect(
      await rejects(approveFit(admin, orgId, "x", { reviewed: "x" })),
    ).toBeInstanceOf(InvalidInput);
    expect(await rejects(declineFit(admin, orgId, "x"))).toBeInstanceOf(
      InvalidInput,
    );
  });

  it("support_agent is Forbidden and nothing changes", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    expect(
      await rejects(approveFit(agent, orgId, "x", { reviewed: "x" })),
    ).toBeInstanceOf(Forbidden);
    expect(await rejects(declineFit(agent, orgId, "x"))).toBeInstanceOf(
      Forbidden,
    );
    expect(await rejects(describeFitCase(agent, orgId))).toBeInstanceOf(
      Forbidden,
    );
    expect((await org(orgId)).stage).toBe("fit_review");
  });

  it("an empty or over-long reason is InvalidInput", async (t) => {
    if (!booted) return t.skip();
    const { orgId } = await heldOrg();
    expect(
      await rejects(approveFit(admin, orgId, "  ", { reviewed: "x" })),
    ).toBeInstanceOf(InvalidInput);
    expect(
      await rejects(declineFit(admin, orgId, "x".repeat(501))),
    ).toBeInstanceOf(InvalidInput);
  });

  it("an unknown org is NotFound", async (t) => {
    if (!booted) return t.skip();
    expect(
      await rejects(
        approveFit(admin, "zzzzzzzzzzzzzzz", "x", { reviewed: "x" }),
      ),
    ).toBeInstanceOf(NotFound);
    expect(
      await rejects(describeFitCase(admin, "zzzzzzzzzzzzzzz")),
    ).toBeInstanceOf(NotFound);
  });
});
