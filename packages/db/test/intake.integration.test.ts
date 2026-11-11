// Intake chokepoint on the real PocketBase 0.39.11 binary: business_profile upsert and
// org_intake answers / stages / first visit (ONB-01, ONB-02, ONB-13; D257; CONTEXT A3-Q1;
// invariant 1, TEN-03, PD-21; T-06-52, T-06-54, T-06-56).
import { Forbidden, InvalidInput } from "@cds/core";
import { emptyWeeklyHours } from "@cds/core/intake";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  dismissFirstVisit,
  getBusinessProfile,
  getOrgIntake,
  markStageSaved,
  saveBusinessProfile,
  saveIntakeAnswers,
} from "../src/intake";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function ctxAs(
  orgId: string,
  actor: string,
  role: OrgContext["role"],
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

/** A fresh org with an owner membership and no business_profile / org_intake row. */
async function bareOrg(
  name: string,
): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `bare-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  return { org, ctx: ctxAs(org, seed.A.owner, "owner") };
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

describe("business profile (ONB-01, ONB-13)", () => {
  it("returns defaults for an org with no row, without writing", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Bare Bakery");
    const p = await getBusinessProfile(ctx);
    expect(p.id).toBe("");
    expect(p.orgName).toBe("Bare Bakery");
    expect(p.tagline).toBe("");
    expect(p.hours).toBeNull();
    expect(p.font_pairing).toBe("cds-choose");
    expect(p.socials).toEqual([]);
    const rows = await pb.collection("business_profile").getFullList({
      filter: pb.filter("organization = {:o}", { o: org }),
    });
    expect(rows).toHaveLength(0);
  });

  it("creates the row, then updates only the given keys; unknown keys are ignored", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Rivera");
    const first = await saveBusinessProfile(ctx, {
      tagline: "Fresh bread daily",
      phone: "(512) 555-0100",
      favourite_colour: "blue",
    });
    expect(first.id).not.toBe("");
    expect(first.tagline).toBe("Fresh bread daily");
    const second = await saveBusinessProfile(ctx, { about: "Since 2012." });
    expect(second.id).toBe(first.id);
    expect(second.tagline).toBe("Fresh bread daily");
    expect(second.phone).toBe("(512) 555-0100");
    expect(second.about).toBe("Since 2012.");
    const row = await pb.collection("business_profile").getOne(first.id);
    expect(row.organization).toBe(org);
    expect(row.favourite_colour).toBeUndefined();
    expect(await getBusinessProfile(ctx)).toEqual(second);
  });

  it("org_name updates organizations.name in the same save", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Old Name");
    const p = await saveBusinessProfile(ctx, {
      org_name: "  Rivera Bakery ",
      tagline: "Bread",
    });
    expect(p.orgName).toBe("Rivera Bakery");
    expect((await pb.collection("organizations").getOne(org)).name).toBe(
      "Rivera Bakery",
    );
  });

  it("an empty org_name is InvalidInput and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Keep Me");
    await expect(
      saveBusinessProfile(ctx, { org_name: "  ", tagline: "x" }),
    ).rejects.toThrow(InvalidInput);
    expect((await pb.collection("organizations").getOne(org)).name).toBe(
      "Keep Me",
    );
    expect((await getBusinessProfile(ctx)).id).toBe("");
  });

  it("hours round-trip through validateHours", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("Hours Co");
    const hours = emptyWeeklyHours();
    hours.mon = {
      open: true,
      ranges: [
        { start: "13:00", end: "17:00" },
        { start: "09:00", end: "12:00" },
      ],
    };
    const p = await saveBusinessProfile(ctx, {
      hours,
      time_zone: "America/Chicago",
    });
    expect(p.hours?.mon.ranges).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    expect(p.hours?.tue).toEqual({ open: false, ranges: [] });
    expect(p.time_zone).toBe("America/Chicago");
    expect((await getBusinessProfile(ctx)).hours).toEqual(p.hours);
  });

  it("invalid hours are InvalidInput with UI copy and nothing is written", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg("Bad Hours");
    const hours = emptyWeeklyHours();
    hours.mon = { open: true, ranges: [{ start: "17:00", end: "09:00" }] };
    await expect(
      saveBusinessProfile(ctx, { hours, tagline: "never saved" }),
    ).rejects.toThrow(
      "Monday's closing time is before its opening time. Pick a later closing time.",
    );
    expect((await getBusinessProfile(ctx)).id).toBe("");
  });

  it("an unknown time zone is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    await expect(
      saveBusinessProfile(seed.ctxA, { time_zone: "Mars/Base" }),
    ).rejects.toThrow("Pick a time zone from the list.");
  });

  it("a patch naming another organization is rejected", async (t) => {
    if (!inst) return t.skip();
    await expect(
      saveBusinessProfile(seed.ctxB, {
        organization: seed.A.org,
        tagline: "Evil",
      }),
    ).rejects.toThrow(InvalidInput);
    const a = await pb
      .collection("business_profile")
      .getOne(seed.A.businessProfile);
    expect(a.tagline).toBe("Org A tagline");
  });

  it("writes only the caller's own org row", async (t) => {
    if (!inst) return t.skip();
    await saveBusinessProfile(seed.ctxB, { tagline: "B only" });
    expect(
      (await pb.collection("business_profile").getOne(seed.A.businessProfile))
        .tagline,
    ).toBe("Org A tagline");
    expect(
      (await pb.collection("business_profile").getOne(seed.B.businessProfile))
        .tagline,
    ).toBe("B only");
  });
});
describe("intake social links write social_accounts (11-35, DASH-14)", () => {
  const accounts = (org: string) =>
    pb.collection("social_accounts").getFullList({
      filter: pb.filter("organization = {:o}", { o: org }),
      sort: "order",
    });

  it("saving an Instagram link creates a row; resaving keeps it; dropping removes it", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Socials Co");
    const ig = { platform: "instagram", url: "https://instagram.com/socco" };
    const p = await saveBusinessProfile(ctx, {
      socials: [ig],
      tagline: "Hi",
    });
    expect(p.socials).toEqual([ig]);
    const first = await accounts(org);
    expect(first.map((r) => [r.platform, r.short_code, r.order])).toEqual([
      ["instagram", "ig", 0],
    ]);
    // business_profile has no socials field any more (migration 830).
    const row = await pb.collection("business_profile").getOne(p.id);
    expect(Object.hasOwn(row, "socials")).toBe(false);

    const other = { platform: "other", url: "https://www.etsy.com/shop/socco" };
    const p2 = await saveBusinessProfile(ctx, { socials: [other, ig] });
    expect(p2.socials).toEqual([{ ...other, label: "etsy.com" }, ig]);
    const second = await accounts(org);
    expect(second.map((r) => [r.platform, r.short_code, r.order])).toEqual([
      ["custom", "etsy-com", 0],
      ["instagram", "ig", 1],
    ]);
    expect(second[1]!.id).toBe(first[0]!.id);
    expect((await getBusinessProfile(ctx)).socials).toEqual(p2.socials);

    await saveBusinessProfile(ctx, { socials: [] });
    expect(await accounts(org)).toHaveLength(0);
  });

  it("http links, wrong hosts and a repeated preset are refused; nothing is written", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Socials Two");
    await expect(
      saveBusinessProfile(ctx, {
        socials: [{ platform: "instagram", url: "http://instagram.com/a" }],
        tagline: "never",
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveBusinessProfile(ctx, {
        socials: [{ platform: "facebook", url: "https://instagram.com/a" }],
      }),
    ).rejects.toThrow("That isn't a Facebook address");
    await expect(
      saveBusinessProfile(ctx, {
        socials: [
          { platform: "x", url: "https://x.com/a" },
          { platform: "x", url: "https://x.com/b" },
        ],
      }),
    ).rejects.toThrow(InvalidInput);
    expect(await accounts(org)).toHaveLength(0);
    expect((await getBusinessProfile(ctx)).tagline).toBe("");
  });
});

describe("fit re-screen on profile saves (A-CR-01, ONB-12, D215)", () => {
  /** An org as a clear Submit leaves it: stage intake, a benign profile. */
  async function clearedOrg(
    stage = "intake",
  ): Promise<{ org: string; ctx: OrgContext }> {
    const org = (
      await pb.collection("organizations").create({
        name: "Sunny Bakery",
        slug: `fit-${Math.random().toString(36).slice(2, 10)}`,
        status: "active",
        path: "standard",
        stage,
      })
    ).id;
    await pb.collection("business_profile").create({
      organization: org,
      business_type: "bakery",
      description: "Fresh bread every morning.",
    });
    return { org, ctx: ctxAs(org, seed.A.owner, "owner") };
  }

  async function holds(org: string) {
    return pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'fit.hold'", {
        o: org,
      }),
    });
  }

  it("switching to a never-hosted business moves the org to fit_review, audited", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await clearedOrg();
    await saveBusinessProfile(ctx, {
      business_type: "other",
      business_type_other: `${AUP_TEST_TERMS.blocked} goods`,
    });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
    const rows = await holds(org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toMatchObject({
      verdict: "blocked",
      trigger: "profile",
    });
    // The save itself still lands.
    expect((await getBusinessProfile(ctx)).business_type_other).toBe(
      `${AUP_TEST_TERMS.blocked} goods`,
    );
  });

  it("a reviewed-first word in the org name or the About text holds it too", async (t) => {
    if (!inst) return t.skip();
    const a = await clearedOrg();
    await saveBusinessProfile(a.ctx, {
      org_name: `Sunny ${AUP_TEST_TERMS.review}`,
    });
    const orgA = await pb.collection("organizations").getOne(a.org);
    expect(orgA.stage).toBe("fit_review");
    expect(orgA.name).toBe(`Sunny ${AUP_TEST_TERMS.review}`);

    const b = await clearedOrg("ready_for_build");
    await saveBusinessProfile(b.ctx, {
      about: `We also sell ${AUP_TEST_TERMS.review}.`,
    });
    expect((await pb.collection("organizations").getOne(b.org)).stage).toBe(
      "fit_review",
    );
  });

  it("a benign edit keeps the stage and writes no hold", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await clearedOrg();
    await saveBusinessProfile(ctx, { description: "Sourdough and rye." });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "intake",
    );
    expect(await holds(org)).toHaveLength(0);
  });

  it("reasons staff already approved do not hold again; a new reason does", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await clearedOrg();
    await saveBusinessProfile(ctx, { business_type: "cbd-shop" });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
    // Staff approve (as fit.ts decide records it), clearing the reasons seen now.
    await pb.collection("organizations").update(org, { stage: "intake" });
    await pb.collection("audit_log").create({
      organization: org,
      actor: seed.A.owner,
      action: "fit.approve",
      meta: { reason: "ok", reasons: ["business type: cbd-shop"] },
    });
    await saveBusinessProfile(ctx, { description: "Balms and oils." });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "intake",
    );
    await saveBusinessProfile(ctx, {
      description: `Now with ${AUP_TEST_TERMS.review}.`,
    });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
  });

  it("an edit while held records a hold row for a new reason only (R2-CR-01)", async (t) => {
    if (!inst) return t.skip();
    const held = await clearedOrg("fit_review");
    await saveBusinessProfile(held.ctx, {
      about: `We also sell ${AUP_TEST_TERMS.blocked}.`,
    });
    const rows = await holds(held.org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toMatchObject({
      verdict: "blocked",
      reasons: [`keyword: ${AUP_TEST_TERMS.blocked}`],
    });
    expect((await pb.collection("organizations").getOne(held.org)).stage).toBe(
      "fit_review",
    );
    // The same reasons again: the current hold already lists them.
    await saveBusinessProfile(held.ctx, {
      mission: `Still ${AUP_TEST_TERMS.blocked}.`,
    });
    expect(await holds(held.org)).toHaveLength(1);
  });

  it("an org not in setup is left alone", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("Not In Setup");
    await saveBusinessProfile(ctx, { description: "Plain words." });
    expect((await pb.collection("organizations").getOne(org)).stage).toBe("");
  });
});

describe("roles (PD-21, T-06-52, T-06-56)", () => {
  it("Editor can read but not write", async (t) => {
    if (!inst) return t.skip();
    const editor = ctxAs(seed.A.org, seed.A.owner, "editor");
    expect((await getBusinessProfile(editor)).id).toBe(seed.A.businessProfile);
    expect((await getOrgIntake(editor)).stagesSaved).toBeInstanceOf(Array);
    await expect(
      saveBusinessProfile(editor, { tagline: "Editor" }),
    ).rejects.toThrow(Forbidden);
    await expect(markStageSaved(editor, "business")).rejects.toThrow(Forbidden);
    await expect(saveIntakeAnswers(editor, { gbp: "yes" })).rejects.toThrow(
      Forbidden,
    );
  });

  it("Viewer cannot read", async (t) => {
    if (!inst) return t.skip();
    const viewer = ctxAs(seed.A.org, seed.A.owner, "viewer");
    await expect(getBusinessProfile(viewer)).rejects.toThrow(Forbidden);
    await expect(getOrgIntake(viewer)).rejects.toThrow(Forbidden);
  });

  it("Admin can write", async (t) => {
    if (!inst) return t.skip();
    const admin = ctxAs(seed.A.org, seed.A.owner, "admin");
    const p = await saveBusinessProfile(admin, { mission: "Good bread." });
    expect(p.mission).toBe("Good bread.");
  });

  it("impersonating staff can write, with an impersonation audit row", async (t) => {
    if (!inst) return t.skip();
    const imp = ctxAs(seed.A.org, seed.A.owner, "owner", seed.B.owner);
    const p = await saveBusinessProfile(imp, { headline: "Staff wrote this" });
    expect(p.headline).toBe("Staff wrote this");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'business_profile.update' && impersonator = {:i}",
        { o: seed.A.org, i: seed.B.owner },
      ),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.target_id).toBe(seed.A.businessProfile);
  });
});

describe("org intake (ONB-02)", () => {
  it("normalises the domain answer", async (t) => {
    if (!inst) return t.skip();
    const answers = await saveIntakeAnswers(seed.ctxA, {
      domain_choice: "have",
      domain: "https://www.RiveraBakery.com/",
    });
    expect(answers.domain).toBe("riverabakery.com");
    expect(answers.domain_choice).toBe("have");
    const stored = await pb.collection("org_intake").getOne(seed.A.intake);
    expect(stored.answers.domain).toBe("riverabakery.com");
    expect((await getOrgIntake(seed.ctxA)).answers.domain).toBe(
      "riverabakery.com",
    );
  });

  it("a later answer keeps earlier keys; a bad answer is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    const answers = await saveIntakeAnswers(seed.ctxA, { gbp: "not_sure" });
    expect(answers.domain).toBe("riverabakery.com");
    expect(answers.gbp).toBe("not_sure");
    await expect(
      saveIntakeAnswers(seed.ctxA, { domain_choice: "maybe" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveIntakeAnswers(seed.ctxB, { organization: seed.A.org, gbp: "no" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("markStageSaved is idempotent and keeps stage order", async (t) => {
    if (!inst) return t.skip();
    await markStageSaved(seed.ctxA, "contact");
    await markStageSaved(seed.ctxA, "business");
    await markStageSaved(seed.ctxA, "contact");
    expect((await getOrgIntake(seed.ctxA)).stagesSaved).toEqual([
      "business",
      "contact",
    ]);
    await expect(markStageSaved(seed.ctxA, "nope" as never)).rejects.toThrow(
      InvalidInput,
    );
    // B is untouched.
    expect((await getOrgIntake(seed.ctxB)).stagesSaved).toEqual([]);
  });

  it("dismissFirstVisit sets the timestamp once", async (t) => {
    if (!inst) return t.skip();
    expect((await getOrgIntake(seed.ctxA)).firstVisitDismissed).toBe(false);
    await dismissFirstVisit(seed.ctxA);
    const first = (await pb.collection("org_intake").getOne(seed.A.intake))
      .first_visit_dismissed_at;
    expect(first).not.toBe("");
    await dismissFirstVisit(seed.ctxA);
    expect(
      (await pb.collection("org_intake").getOne(seed.A.intake))
        .first_visit_dismissed_at,
    ).toBe(first);
    expect((await getOrgIntake(seed.ctxA)).firstVisitDismissed).toBe(true);
  });

  it("an org with no intake row reads defaults and is created on first save", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg("No Intake");
    const i = await getOrgIntake(ctx);
    expect(i.answers.domain_choice).toBe("later");
    expect(i.selections.addons).toEqual([]);
    expect(i.submittedAt).toBeNull();
    expect(i.moodboardProposal).toBeNull();
    await markStageSaved(ctx, "email");
    const rows = await pb.collection("org_intake").getFullList({
      filter: pb.filter("organization = {:o}", { o: org }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stages_saved).toEqual(["email"]);
  });
});
