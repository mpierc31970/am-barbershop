// 13-10: the staff Sites read model (STAFF-02, D5; T-13-10-01..03). Every org with its state,
// path, plan + Care Plan, active add-ons, hosts and open tickets; site detail adds members
// (names and roles only, never an email) and a read-only billing summary; the audit log reads
// one org's rows. Staff only: a member context is refused, an unknown org id is NotFound.
import { InvalidContext, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import {
  staffGetSite,
  staffListAuditLog,
  staffListSites,
  staffSiteAddons,
} from "../src/staff/sites";
import { staffCaseOutcome, staffCreateCase } from "../src/staff/review/cases";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // Org A: a live Studio site with one active add-on, a preview host, Care Plan billing and an
  // open ticket (plus a closed one that must not count).
  await pb.collection("organizations").update(seed.A.org, {
    name: "Rivera Salon",
    path: "studio",
    stage: "live",
    billing_status: "active",
  });
  await pb.collection("users").update(seed.A.owner, { name: "Mara Rivera" });
  await pb.collection("org_hosts").create({
    hostname: "rivera.sites.localhost",
    organization: seed.A.org,
    kind: "preview",
    primary: false,
  });
  await pb.collection("org_addons").create({
    organization: seed.A.org,
    addon: "testimonials",
    status: "active",
    source: "staff",
    installed_at: "2026-10-01 10:00:00.000Z",
  });
  await pb.collection("org_addons").create({
    organization: seed.A.org,
    addon: "events",
    status: "disabled",
    disabled_reason: "uninstalled",
    source: "hub",
  });
  await pb.collection("billing_accounts").create({
    organization: seed.A.org,
    provider: "fake",
    status: "active",
    cadence: "monthly",
    care_plan: true,
    current_period_end: "2026-11-01 00:00:00.000Z",
  });
  for (const [n, status] of [
    [5001, "open"],
    [5002, "closed"],
  ] as const) {
    await pb.collection("support_threads").create({
      organization: seed.A.org,
      kind: "ticket",
      number: n,
      type: "problem",
      subject: "Broken form",
      status,
    });
  }
  // Org B: a live Standard site suspended by a direct field write.
  await pb.collection("organizations").update(seed.B.org, {
    name: "Bloom Bakery",
    path: "standard",
    stage: "live",
    suspended_at: "2026-10-14 15:00:00.000Z",
    suspension: { mode: "now", category: "scam", by: "staff" },
  });
  await pb.collection("audit_log").create({
    organization: seed.B.org,
    actor: seed.B.owner,
    action: "fixture.b_only",
    ip: "203.0.113.9",
  });

  superCtx = await staffContext(inst, "sites-super@cds.test", "super_admin");
  agentCtx = await staffContext(inst, "sites-agent@cds.test", "support_agent");
});

afterAll(async () => {
  await inst?.stop();
});

describe("staffListSites (STAFF-02)", () => {
  it("a support_agent lists every org with state, path, add-ons and open tickets", async (t) => {
    if (!inst) return t.skip();
    const rows = await staffListSites(agentCtx);
    expect(rows.map((r) => r.name)).toEqual(["Bloom Bakery", "Rivera Salon"]);
    const a = rows.find((r) => r.orgId === seed.A.org)!;
    expect(a).toMatchObject({
      slug: "org-a",
      state: "live",
      path: "studio",
      plan: "monthly",
      carePlan: true,
      // seedTwoOrgs installs "fixture-seed" on both orgs; "events" is disabled, so absent.
      addons: ["fixture-seed", "testimonials"],
      liveHost: "a.example.com",
      previewHost: "rivera.sites.localhost",
      openTickets: 1,
      demo: false,
      repeatInfringer: false,
    });
    expect(a.created).not.toBe("");
    // The fixture's audit row was written by the owner, so it counts as owner activity.
    expect(a.lastOwnerActivity).not.toBeNull();
    const b = rows.find((r) => r.orgId === seed.B.org)!;
    expect(b).toMatchObject({
      state: "suspended",
      path: "standard",
      plan: "",
      carePlan: false,
      addons: ["fixture-seed"],
      openTickets: 0,
    });
  });

  it("filters by business name, host, state, path and add-on", async (t) => {
    if (!inst) return t.skip();
    const ids = async (f: Parameters<typeof staffListSites>[1]) =>
      (await staffListSites(superCtx, f)).map((r) => r.orgId);
    expect(await ids({ q: "rivera" })).toEqual([seed.A.org]);
    expect(await ids({ q: "B.EXAMPLE.com" })).toEqual([seed.B.org]);
    expect(await ids({ q: "sites.localhost" })).toEqual([seed.A.org]);
    // 13-33: the org id is searchable too (UI-SPEC "search (name, host, org id)").
    expect(await ids({ q: seed.A.org.toUpperCase() })).toEqual([seed.A.org]);
    expect(await ids({ status: "suspended" })).toEqual([seed.B.org]);
    expect(await ids({ status: "live" })).toEqual([seed.A.org]);
    expect(await ids({ path: "standard" })).toEqual([seed.B.org]);
    expect(await ids({ addon: "testimonials" })).toEqual([seed.A.org]);
    expect(await ids({ addon: "fixture-seed" })).toHaveLength(2);
    expect(await ids({ addon: "events" })).toEqual([]);
  });

  it("refuses a member context and no context", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffListSites(seed.ctxA as unknown as PlatformContext),
    ).rejects.toThrow(InvalidContext);
    await expect(
      staffListSites(undefined as unknown as PlatformContext),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("staffGetSite (STAFF-02)", () => {
  it("adds members by name and role and a read-only billing summary, never an email", async (t) => {
    if (!inst) return t.skip();
    const site = await staffGetSite(agentCtx, seed.A.org);
    expect(site.name).toBe("Rivera Salon");
    expect(site.members).toContainEqual({ name: "Mara Rivera", role: "owner" });
    expect(site.members[0]).toEqual({ name: "Mara Rivera", role: "owner" });
    expect(site.billing).toEqual({
      state: "active",
      plan: "monthly",
      carePlan: true,
      nextRenewal: "2026-11-01 00:00:00.000Z",
    });
    expect(site.suspension).toBeNull();
    const json = JSON.stringify(site);
    expect(json).not.toMatch(/email/i);
    expect(json).not.toContain("@cds.test");
  });

  it("shows the staff suspension summary", async (t) => {
    if (!inst) return t.skip();
    const site = await staffGetSite(superCtx, seed.B.org);
    expect(site.state).toBe("suspended");
    expect(site.suspension).toMatchObject({
      mode: "now",
      category: "scam",
      suspendedAt: "2026-10-14 15:00:00.000Z",
    });
  });

  it("an unknown or malformed org id is NotFound; a member context is refused", async (t) => {
    if (!inst) return t.skip();
    await expect(staffGetSite(superCtx, "zzzzzzzzzzzzzzz")).rejects.toThrow(
      NotFound,
    );
    await expect(staffGetSite(superCtx, "../organizations")).rejects.toThrow(
      NotFound,
    );
    await expect(
      staffGetSite(seed.ctxA as unknown as PlatformContext, seed.A.org),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("staffListAuditLog (STAFF-02)", () => {
  it("returns only that org's rows, newest first, with actor names", async (t) => {
    if (!inst) return t.skip();
    const a = await staffListAuditLog(agentCtx, seed.A.org, { perPage: 50 });
    expect(a.items.length).toBeGreaterThan(0);
    expect(a.items.map((r) => r.action)).not.toContain("fixture.b_only");
    const b = await staffListAuditLog(agentCtx, seed.B.org);
    expect(b.items[0]!.action).toBe("fixture.b_only");
    expect(JSON.stringify(b)).not.toContain("203.0.113.9");
    expect(JSON.stringify(b)).not.toContain("@cds.test");
  });

  it("caps perPage at 50 and refuses a member context", async (t) => {
    if (!inst) return t.skip();
    const r = await staffListAuditLog(superCtx, seed.A.org, { perPage: 500 });
    expect(r.perPage).toBe(50);
    await expect(
      staffListAuditLog(seed.ctxA as unknown as PlatformContext, seed.A.org),
    ).rejects.toThrow(InvalidContext);
    await expect(
      staffListAuditLog(superCtx, "zzzzzzzzzzzzzzz"),
    ).rejects.toThrow(NotFound);
  });
});

// 13-33: the Audit tab filter (All · CDS actions · Impersonation).
describe("staffListAuditLog who filter (13-33)", () => {
  it("cds = console + impersonation rows; impersonation = member rows written by staff", async (t) => {
    if (!inst) return t.skip();
    const staff = superCtx.actor;
    await pb.collection("audit_log").create({
      organization: seed.A.org,
      actor: staff,
      impersonator: staff,
      action: "fixture.console",
    });
    await pb.collection("audit_log").create({
      organization: seed.A.org,
      actor: seed.A.owner,
      impersonator: staff,
      action: "fixture.impersonated",
    });
    const actions = async (who: "all" | "cds" | "impersonation") =>
      (await staffListAuditLog(agentCtx, seed.A.org, { who })).items.map(
        (r) => r.action,
      );
    const all = await actions("all");
    expect(all).toContain("fixture.console");
    expect(all).toContain("fixture.impersonated");
    expect((await actions("cds")).sort()).toEqual([
      "fixture.console",
      "fixture.impersonated",
    ]);
    expect(await actions("impersonation")).toEqual(["fixture.impersonated"]);
    const rows = (await staffListAuditLog(agentCtx, seed.A.org)).items;
    expect(rows.find((r) => r.action === "fixture.console")).toMatchObject({
      byStaff: true,
      impersonated: false,
    });
    expect(rows.find((r) => r.action === "fixture.impersonated")).toMatchObject(
      { byStaff: true, impersonated: true },
    );
  });
});

// 13-33: add-on entitlements for the site detail, and the repeat-infringer join (P13-P25).
describe("staffSiteAddons (STAFF-02, 13-33)", () => {
  it("lists active add-ons first with their install date, then removed ones", async (t) => {
    if (!inst) return t.skip();
    const rows = await staffSiteAddons(agentCtx, seed.A.org);
    expect(rows.map((r) => [r.slug, r.status])).toEqual([
      ["fixture-seed", "active"],
      ["testimonials", "active"],
      ["events", "disabled"],
    ]);
    expect(rows.find((r) => r.slug === "testimonials")).toMatchObject({
      since: "2026-10-01 10:00:00.000Z",
      source: "staff",
    });
    await expect(staffSiteAddons(superCtx, "zzzzzzzzzzzzzzz")).rejects.toThrow(
      NotFound,
    );
    await expect(
      staffSiteAddons(seed.ctxA as unknown as PlatformContext, seed.A.org),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("repeatInfringer join (P13-P25, 13-33)", () => {
  it("3 upheld DMCA cases flag the site in the list and the detail", async (t) => {
    if (!inst) return t.skip();
    for (let i = 0; i < 3; i++) {
      const c = await staffCreateCase(
        agentCtx,
        {
          kind: "dmca",
          orgId: seed.B.org,
          targetUrl: `https://b.example.com/gallery-${i}`,
          category: "copyright",
          description: "My photo is used without permission.",
          reporter: { name: "Pat Lens", email: "pat@example.org" },
          dmcaStatement: {
            goodFaith: true,
            accuracy: true,
            signature: "Pat Lens",
          },
        },
        {},
      );
      await staffCaseOutcome(agentCtx, c.ref, "upheld", {});
    }
    const rows = await staffListSites(agentCtx);
    expect(rows.find((r) => r.orgId === seed.B.org)!.repeatInfringer).toBe(
      true,
    );
    expect(rows.find((r) => r.orgId === seed.A.org)!.repeatInfringer).toBe(
      false,
    );
    expect((await staffGetSite(agentCtx, seed.B.org)).repeatInfringer).toBe(
      true,
    );
  });
});
