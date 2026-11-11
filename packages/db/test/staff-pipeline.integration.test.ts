// 13-14 (STAFF-01, STAFF-03, STAFF-04; D26, D28, D29; T-13-14-01..03): the Pipeline read
// models against a real PocketBase. Leads carry a stage chip, abandoned flag and a masked email
// (never an address); Reveal email returns the address and writes lead.email_revealed; Fit
// holds read the case; Polish lists assembled being_built orgs with their slot report and
// preview URL; Launch lists ready_for_review orgs with the informational checklist and open
// change tickets. A member context is refused everywhere.
import { InvalidContext, Forbidden } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import {
  revealLeadEmail,
  staffBuildingQueue,
  staffFitHolds,
  staffLaunchQueue,
  staffLeads,
  staffPolishQueue,
} from "../src/staff/pipeline";
import {
  bootSeededPb,
  orgAContextAs,
  seedQuote,
  staffContext,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
let admin: PlatformContext;
let agent: PlatformContext;
const ids: Record<string, string> = {};
const DAY = 86_400_000;
let n = 0;

async function makeOrg(opts: {
  name: string;
  stage: "intake" | "fit_review" | "being_built" | "ready_for_review";
  assembly?: Record<string, unknown>;
}): Promise<string> {
  const pb = await superuser();
  n += 1;
  const email = `pipe-owner-${n}@cds.test`;
  const pw = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const user = await pb
    .collection("users")
    .create({ email, password: pw, passwordConfirm: pw });
  const org = await pb.collection("organizations").create({
    name: opts.name,
    slug: `pipe-org-${n}`,
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
    description: "Relaxing massage studio",
    public_email: email,
  });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    stages_saved: ["business"],
    submitted_at: "",
    ...(opts.assembly ? { assembly: opts.assembly } : {}),
  });
  return org.id;
}

describe("staff Pipeline read models (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    admin = await staffContext(
      booted.inst,
      "pipe-admin@cds.test",
      "super_admin",
    );
    agent = await staffContext(
      booted.inst,
      "pipe-agent@cds.test",
      "support_agent",
    );
    const pb = await superuser();

    ids.quote = (
      await seedQuote({
        status: "saved",
        email: "maria@rivera.com",
        savedAt: new Date(),
      })
    ).id;
    await pb
      .collection("quotes")
      .update(ids.quote, { business_name: "Rivera Bakery" });

    ids.intake = await makeOrg({ name: "Intake Studio", stage: "intake" });
    await pb.collection("org_email_routes").create({
      organization: ids.intake,
      purpose: "default",
      address: "owner@intake.test",
      confirmed_at: new Date().toISOString(),
    });

    ids.fit = await makeOrg({ name: "Held Signup", stage: "fit_review" });

    ids.built = await makeOrg({
      name: "Polish Me",
      stage: "being_built",
      assembly: {
        template_id: "practitioner",
        template_version: 1,
        status: "done",
        attempts: 1,
        started_at: "2026-10-14T10:00:00.000Z",
        assembled_at: "2026-10-14T10:01:00.000Z",
        pages: {},
        report: {
          templateId: "practitioner",
          templateVersion: 1,
          slots: [
            { page: "home", slot: "hero.headline", source: "provided" },
            {
              page: "home",
              slot: "hero.image",
              source: "fallback",
              note: "No photo yet",
            },
          ],
          polish: ["Theme: import the impeccable theme (D45)"],
          pages: [
            { key: "home", label: "Home", outcome: "created", path: "/" },
          ],
        },
      },
    });
    await pb.collection("org_hosts").create({
      hostname: "polish-me.sites.localhost",
      organization: ids.built,
      kind: "preview",
      primary: true,
    });

    ids.review = await makeOrg({
      name: "Review Ready",
      stage: "ready_for_review",
    });
    for (const [num, type, status] of [
      [7101, "change", "open"],
      [7102, "change", "closed"],
      [7103, "problem", "open"],
    ] as const) {
      await pb.collection("support_threads").create({
        organization: ids.review,
        kind: "ticket",
        number: num,
        type,
        subject: "Please change the hero",
        status,
      });
    }
  });

  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("staffLeads lists the quote (abandoned 9) and the intake, with masked emails only", async (t) => {
    if (!booted) return t.skip();
    const later = new Date(Date.now() + 9 * DAY + 60_000);
    const leads = await staffLeads(admin, { since: "all", now: later });
    const quote = leads.find((l) => l.id === ids.quote);
    const intake = leads.find((l) => l.id === ids.intake);
    expect(quote).toMatchObject({
      kind: "quote",
      orgId: null,
      business: "Rivera Bakery",
      stage: "saved_quote",
      abandoned: true,
      abandonedDays: 9,
      emailMasked: "m•••@rivera.com",
    });
    expect(intake).toMatchObject({
      kind: "org",
      orgId: ids.intake,
      business: "Intake Studio",
      stage: "intake_started",
      emailMasked: "o•••@intake.test",
    });
    // An intake 2 days idle is not abandoned yet.
    const soon = await staffLeads(agent, {
      since: "all",
      now: new Date(Date.now() + 2 * DAY),
    });
    expect(soon.find((l) => l.id === ids.intake)).toMatchObject({
      abandoned: false,
      abandonedDays: 2,
    });
    // No address anywhere: only emailMasked has "@", and it is masked.
    for (const row of leads) {
      for (const [key, value] of Object.entries(row)) {
        if (key === "emailMasked") {
          if (String(value).includes("@"))
            expect(String(value)).toContain("•••");
        } else {
          expect(String(value)).not.toContain("@");
        }
      }
    }
    // Fit holds and being_built orgs are listed with their chips.
    expect(leads.find((l) => l.id === ids.fit)?.stage).toBe("fit_review");
    expect(leads.find((l) => l.id === ids.built)?.stage).toBe("building");
  });

  it("revealLeadEmail returns the address and writes one lead.email_revealed row", async (t) => {
    if (!booted) return t.skip();
    const pb = await superuser();
    const count = async (target: string) =>
      (
        await pb.collection("audit_log").getFullList({
          filter: pb.filter(
            "action = 'lead.email_revealed' && target_id = {:t}",
            { t: target },
          ),
        })
      ).length;
    expect(await count(ids.quote)).toBe(0);
    expect(await revealLeadEmail(agent, ids.quote)).toBe("maria@rivera.com");
    expect(await count(ids.quote)).toBe(1);
    expect(await revealLeadEmail(admin, ids.intake)).toBe("owner@intake.test");
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'lead.email_revealed' && target_id = {:t}", {
        t: ids.intake,
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organization).toBe(ids.intake);
    expect(rows[0]?.meta).toEqual({ leadId: ids.intake });
    expect(rows[0]?.ip).toBe("203.0.113.14");
    await expect(revealLeadEmail(admin, "zzzzzzzzzzzzzzz")).rejects.toThrow();
  });

  it("staffFitHolds returns the fit_review org's case for staff (agents included)", async (t) => {
    if (!booted) return t.skip();
    const holds = await staffFitHolds(agent);
    const hold = holds.find((h) => h.orgId === ids.fit);
    expect(hold).toBeDefined();
    expect(hold?.name).toBe("Held Signup");
    expect(typeof hold?.fingerprint).toBe("string");
    expect(hold?.blocked).toBe(hold?.verdict === "blocked");
  });

  it("staffBuildingQueue and staffPolishQueue read the assembly ledger", async (t) => {
    if (!booted) return t.skip();
    const building = await staffBuildingQueue(admin);
    expect(building.find((b) => b.orgId === ids.built)).toMatchObject({
      stage: "being_built",
      assembly: { state: "done", attempts: 1, unfilled: 1 },
    });
    const polish = await staffPolishQueue(agent);
    const row = polish.find((p) => p.orgId === ids.built);
    expect(row).toBeDefined();
    expect(row?.unfilled).toBe(1);
    expect(row?.previewUrl).toContain("polish-me.sites.localhost");
    expect(row?.slots[0]?.filled).toBe(false);
    expect(row?.toPolish).toBe(2);
    expect(polish.some((p) => p.orgId === ids.review)).toBe(false);
  });

  it("staffLaunchQueue lists ready_for_review with one open change ticket, the owner review and the move (14-36)", async (t) => {
    if (!booted) return t.skip();
    const launch = await staffLaunchQueue(admin);
    const row = launch.find((l) => l.orgId === ids.review);
    expect(row).toMatchObject({
      openChangeTickets: 1,
      openChangeTicketNumbers: [7101],
      checklist: { informational: false, total: 6 },
      review: { total: 6, submittedAt: null },
      move: { code: null, state: "none" },
    });
    expect(row?.checklist.note).toBe("");
  });

  it("a member context is refused by every function", async (t) => {
    if (!booted) return t.skip();
    const member = orgAContextAs(
      booted.seed,
      "owner",
    ) as unknown as PlatformContext;
    const calls: (() => Promise<unknown>)[] = [
      () => staffLeads(member),
      () => revealLeadEmail(member, ids.quote),
      () => staffFitHolds(member),
      () => staffBuildingQueue(member),
      () => staffPolishQueue(member),
      () => staffLaunchQueue(member),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toSatisfy(
        (e: unknown) => e instanceof InvalidContext || e instanceof Forbidden,
      );
    }
  });
});
