// Staff leads list against a real PocketBase (ONB-07; planner decision PD-7; T-06-48).
// Saved quotes (saved, reminded, expired) and organizations still in setup (stage intake
// with the intake not sent, or fit_review) are leads. Drafts without an email and submitted
// quotes are not. leads_list is super_admin + support_agent. P8 (08-18, RESEARCH R-6):
// ready_for_build and being_built orgs are listed too (status sent / being built) with the
// ASSEMBLED word from the assembly ledger.
import { Forbidden, InvalidContext } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import { mintOrgContext, type PlatformContext } from "../src/context";
import { leadsSummaryLine, listLeads, type Lead } from "../src/leads";
import { bootSeededPb, seedQuote, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let admin: PlatformContext;
let agent: PlatformContext;
const ids: Record<string, string> = {};
let n = 0;

async function setupOrg(opts: {
  stage: "intake" | "fit_review" | "ready_for_build" | "being_built";
  submitted?: boolean;
  assembly?: Record<string, unknown>;
  stagesSaved?: string[];
  route?: boolean;
}): Promise<{ orgId: string; ownerEmail: string }> {
  const pb = await superuser();
  n += 1;
  const ownerEmail = `lead-owner-${n}@cds.test`;
  const pw = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const user = await pb.collection("users").create({
    email: ownerEmail,
    password: pw,
    passwordConfirm: pw,
  });
  const org = await pb.collection("organizations").create({
    name: `Lead Org ${n}`,
    slug: `lead-org-${n}`,
    status: "active",
    path: "standard",
    stage: opts.stage,
  });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: org.id, role: "owner" });
  await pb.collection("business_profile").create({
    organization: org.id,
    business_type: "massage",
    public_email: ownerEmail,
  });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: {
      addons: ["testimonials", "appointments"],
      extras: ["logo"],
      carePlan: false,
      cadence: "monthly",
    },
    stages_saved: opts.stagesSaved ?? [],
    submitted_at: opts.submitted ? new Date().toISOString() : "",
    ...(opts.assembly ? { assembly: opts.assembly } : {}),
  });
  if (opts.route !== false) {
    await pb.collection("org_email_routes").create({
      organization: org.id,
      purpose: "default",
      address: `route-${n}@cds.test`,
      confirmed_at: new Date().toISOString(),
    });
  }
  return { orgId: org.id, ownerEmail };
}

function byId(leads: Lead[], id: string): Lead | undefined {
  return leads.find((l) => l.id === id);
}

describe("listLeads (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    admin = await staffContext(
      booted.inst,
      "leads-admin@cds.test",
      "super_admin",
    );
    agent = await staffContext(
      booted.inst,
      "leads-agent@cds.test",
      "support_agent",
    );
    const pb = await superuser();
    ids.draft = (await seedQuote({ status: "draft" })).id;
    ids.saved = (
      await seedQuote({
        status: "saved",
        email: "saved@cds.test",
        businessType: "coach",
        savedAt: new Date(),
        selections: {
          addons: ["testimonials"],
          extras: ["logo", "copywriting"],
          carePlan: false,
          cadence: "monthly",
        },
      })
    ).id;
    ids.reminded = (
      await seedQuote({
        status: "saved",
        email: "reminded@cds.test",
        savedAt: new Date(),
      })
    ).id;
    await pb.collection("quotes").update(ids.reminded, { reminders_sent: 2 });
    ids.expired = (
      await seedQuote({ status: "expired", email: "expired@cds.test" })
    ).id;
    ids.submitted = (
      await seedQuote({ status: "submitted", email: "submitted@cds.test" })
    ).id;
    ids.intake = (
      await setupOrg({
        stage: "intake",
        stagesSaved: ["business", "contact", "email", "business", "bogus"],
      })
    ).orgId;
    const noRoute = await setupOrg({ stage: "intake", route: false });
    ids.noRoute = noRoute.orgId;
    ids.noRouteEmail = noRoute.ownerEmail;
    ids.ready = (
      await setupOrg({ stage: "ready_for_build", submitted: true })
    ).orgId;
    ids.fit = (await setupOrg({ stage: "fit_review" })).orgId;
    const ledger = (extra: Record<string, unknown>) => ({
      template_id: "standard-v1",
      template_version: 1,
      attempts: 1,
      pages: {},
      ...extra,
    });
    ids.running = (
      await setupOrg({
        stage: "ready_for_build",
        submitted: true,
        assembly: ledger({
          status: "running",
          started_at: new Date().toISOString(),
        }),
      })
    ).orgId;
    ids.queued = (
      await setupOrg({
        stage: "ready_for_build",
        submitted: true,
        assembly: ledger({ status: "queued", attempts: 0 }),
      })
    ).orgId;
    ids.failed = (
      await setupOrg({
        stage: "ready_for_build",
        submitted: true,
        assembly: ledger({
          status: "failed",
          attempts: 3,
          error: { code: "PUBLISH_FAILED" },
        }),
      })
    ).orgId;
    ids.built = (
      await setupOrg({
        stage: "being_built",
        submitted: true,
        assembly: ledger({
          status: "done",
          assembled_at: "2026-10-07T10:00:00.000Z",
        }),
      })
    ).orgId;
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("lists saved, reminded and expired quotes, never drafts or submitted ones", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    const saved = byId(leads, ids.saved!);
    expect(saved).toMatchObject({
      kind: "quote",
      email: "saved@cds.test",
      path: "standard",
      businessType: "coach",
      items: 3,
      status: "saved",
    });
    expect(saved!.lastChange).toBeInstanceOf(Date);
    expect(byId(leads, ids.reminded!)?.status).toBe("reminded 2");
    expect(byId(leads, ids.expired!)?.status).toBe("expired");
    expect(byId(leads, ids.draft!)).toBeUndefined();
    expect(byId(leads, ids.submitted!)).toBeUndefined();
  });

  it("lists orgs in setup (intake N/7, fit_review) with ASSEMBLED -", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    const intake = byId(leads, ids.intake!);
    expect(intake).toMatchObject({
      kind: "org",
      path: "standard",
      businessType: "massage",
      items: 3,
      status: "intake 3/7",
    });
    expect(intake!.email).toMatch(/^route-\d+@cds\.test$/);
    expect(intake!.assembled).toBe("-");
    expect(byId(leads, ids.fit!)).toMatchObject({
      status: "fit_review",
      assembled: "-",
    });
    // Fixture orgs (no stage) are not in setup.
    expect(byId(leads, booted.seed.A.org)).toBeUndefined();
  });

  it("lists sent and being-built orgs with their assembly progress (R-6)", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    expect(byId(leads, ids.ready!)).toMatchObject({
      kind: "org",
      status: "sent",
      assembled: "-",
    });
    expect(byId(leads, ids.queued!)?.assembled).toBe("queued");
    expect(byId(leads, ids.running!)).toMatchObject({
      status: "sent",
      assembled: "running",
    });
    expect(byId(leads, ids.failed!)).toMatchObject({
      status: "sent",
      assembled: "failed 3/3",
    });
    expect(byId(leads, ids.built!)).toMatchObject({
      status: "being built",
      assembled: "done 7 Oct",
    });
    // Quotes never carry an assembly.
    expect(byId(leads, ids.saved!)?.assembled).toBe("-");
  });

  it("summary line adds the assembled count only when any", () => {
    const lead = (kind: "quote" | "org", assembled = "-"): Lead => ({
      kind,
      id: "x",
      email: "",
      path: "",
      businessType: "",
      items: 0,
      status: "saved",
      assembled,
      lastChange: new Date(0),
    });
    const quotes = Array.from({ length: 8 }, () => lead("quote"));
    const orgs = [
      lead("org", "done 7 Oct"),
      lead("org", "done 1 Oct"),
      lead("org", "running"),
      lead("org", "failed 3/3"),
      lead("org"),
      lead("org"),
    ];
    expect(leadsSummaryLine([...quotes, ...orgs])).toBe(
      "14 leads: 8 saved quotes, 6 sites in setup, 2 assembled.",
    );
    expect(leadsSummaryLine([...quotes, lead("org")])).toBe(
      "9 leads: 8 saved quotes, 1 site in setup.",
    );
  });

  it("falls back to the owner's email when there is no default route", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    expect(byId(leads, ids.noRoute!)?.email).toBe(ids.noRouteEmail);
  });

  it("sorts newest first", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    for (let i = 1; i < leads.length; i++) {
      expect(leads[i - 1]!.lastChange.getTime()).toBeGreaterThanOrEqual(
        leads[i]!.lastChange.getTime(),
      );
    }
  });

  it("support_agent may list; an org context and an empty staff role may not", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(agent);
    expect(byId(leads, ids.saved!)).toBeDefined();
    const orgCtx = mintOrgContext({
      orgId: booted.seed.A.org,
      actor: "x",
      role: "owner",
      grants: [],
      ip: "203.0.113.9",
    });
    await expect(
      listLeads(orgCtx as unknown as PlatformContext),
    ).rejects.toBeInstanceOf(InvalidContext);
    const { mintPlatformContext } = await import("../src/context");
    const nobody = mintPlatformContext({
      actor: "x",
      staffRole: "" as never,
      ip: "203.0.113.9",
    });
    await expect(listLeads(nobody)).rejects.toBeInstanceOf(Forbidden);
  });

  it("since excludes leads last changed before it", async (t) => {
    if (!booted) return t.skip();
    const future = await listLeads(admin, {
      since: new Date(Date.now() + 60_000),
    });
    expect(future).toEqual([]);
    const recent = await listLeads(admin, {
      since: new Date(Date.now() - 3_600_000),
    });
    expect(byId(recent, ids.saved!)).toBeDefined();
    expect(byId(recent, ids.intake!)).toBeDefined();
  });
});
