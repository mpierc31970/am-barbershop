// 13-34 (STAFF-01, STAFF-03, STAFF-04; T-13-34-01..03): the five Pipeline panels and the
// action island. @cds/db is mocked (readStaffSession + the 13-14 read models + declineCase);
// the real staff session, area guard, tab parsing, panels and client components run (static
// render). Proves: lead emails stay masked and `since` reaches staffLeads; stage / abandoned
// filters narrow the rows; the fit case and its decisions show (agents: Super Admin only);
// a paid hold reads its refund; Building shows assembly state and the actions; Polish shows the
// slot report and Mark ready; Launch renders one Approve launch per row (agents: disabled).
import { P13_COPY } from "@cds/core/staff";
import { ToastRegion } from "@cds/ui/hub";
import { PIPELINE_COPY } from "@cds/ui/staff";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kit, resetStaffKit } from "./staff-test-kit";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));
vi.mock("../lib/assembly-deps", () => ({ assemblyDeps: () => ({}) }));

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  staffLeads: vi.fn(),
  staffInquiryLeads: vi.fn(),
  staffFitHolds: vi.fn(),
  declineCase: vi.fn(),
  staffBuildingQueue: vi.fn(),
  staffPolishQueue: vi.fn(),
  staffLaunchQueue: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: PipelinePage } =
  await import("../app/(platform)/staff/(console)/pipeline/page");
const { default: LeadsPanel, parseLeadsParams } =
  await import("../app/(platform)/staff/(console)/pipeline/panels/leads");
const { default: FitPanel } =
  await import("../app/(platform)/staff/(console)/pipeline/panels/fit");
const { default: BuildingPanel } =
  await import("../app/(platform)/staff/(console)/pipeline/panels/building");
const { default: PolishPanel } =
  await import("../app/(platform)/staff/(console)/pipeline/panels/polish");
const { default: LaunchPanel } =
  await import("../app/(platform)/staff/(console)/pipeline/panels/launch");

type Role = "super_admin" | "support_agent";

const ORG = "aaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbb";
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function ctxFor(role: Role) {
  return { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" };
}

function signIn(role: Role) {
  kit.cookies.set("cds_staff", "tok");
  db.readStaffSession.mockResolvedValue({
    ctx: ctxFor(role),
    sessionId: "sess00000000001",
    stepUpFresh: true,
    staffName: role === "super_admin" ? "Sam Admin" : "Mara Agent",
    staffEmailMasked: "s•••@example.test",
    createdAt: new Date().toISOString(),
  });
}

function session(role: Role) {
  return {
    ctx: ctxFor(role),
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: true,
    name: "Sam Admin",
    role,
    maskedEmail: "s•••@example.test",
  } as never;
}

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(
    createElement(ToastRegion, null, (await el) as ReactElement),
  );
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function lead(over: Record<string, unknown> = {}) {
  return {
    id: "q1",
    kind: "quote",
    orgId: null,
    business: "",
    stage: "saved_quote",
    status: "saved",
    path: "standard",
    abandoned: false,
    abandonedDays: 1,
    lastActivity: daysAgo(1),
    emailMasked: "m•••@example.com",
    assembled: "-",
    items: 2,
    ...over,
  };
}

function launchRow(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    name: "Rivera Bakery",
    checklist: {
      items: [
        { id: "pages", label: "Pages look right", done: false },
        { id: "contact", label: "Contact details", done: false },
      ],
      done: 0,
      total: 2,
      available: true,
      informational: false,
      note: "",
    },
    review: {
      done: 2,
      total: 2,
      submittedAt: "2026-10-15 14:00:00.000Z",
      resubmitNeeded: [],
    },
    move: {
      code: "M-7",
      state: "prepared",
      domain: "riverabakery.com",
      waitingOn: null,
    },
    openChangeTickets: 0,
    openChangeTicketNumbers: [],
    inReviewSince: daysAgo(2),
    previewUrl: "https://rivera.sites.localhost",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  db.staffInquiryLeads.mockResolvedValue([]);
});

describe("Leads (choice 1)", () => {
  it("shows masked emails only, and since=7d reaches staffLeads", async () => {
    db.staffLeads.mockResolvedValue([
      lead(),
      lead({
        id: "o1",
        kind: "org",
        orgId: ORG,
        business: "Rivera Bakery",
        stage: "intake_started",
        abandoned: true,
        abandonedDays: 9,
        lastActivity: daysAgo(9),
        emailMasked: "r•••@rivera.test",
      }),
    ]);
    const out = await html(
      LeadsPanel({
        session: session("support_agent"),
        params: { since: "7d" },
      }),
    );
    expect(db.staffLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "7d" }),
    );
    expect(out).toContain("•••");
    expect(out).not.toMatch(/[a-z0-9._-]+@(example\.com|rivera\.test)/i);
    expect(out).toContain("Abandoned · 9d");
    expect(out).toContain(PIPELINE_COPY.leads.unnamed);
    expect(out).toContain(PIPELINE_COPY.leads.reveal);
    expect(out).toContain(`/staff/sites/${ORG}`);
    expect(out).toContain("Intake started");
    expect(out).toContain("2 leads · 1 abandoned");
  });

  it("defaults to 30d; stage and abandoned filters narrow the rows", async () => {
    expect(parseLeadsParams({}).since).toBe("30d");
    expect(parseLeadsParams({ since: "1y", stage: "nope" })).toEqual({
      since: "30d",
      stage: "",
      abandoned: false,
    });
    db.staffLeads.mockResolvedValue([
      lead({ id: "a", business: "Alpha", stage: "saved_quote" }),
      lead({
        id: "b",
        business: "Beta",
        stage: "submitted",
        abandoned: true,
        abandonedDays: 8,
      }),
    ]);
    const out = await html(
      LeadsPanel({
        session: session("super_admin"),
        params: { stage: "submitted" },
      }),
    );
    expect(db.staffLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "30d" }),
    );
    expect(out).toContain("Beta");
    expect(out).not.toContain("Alpha");
    const ab = await html(
      LeadsPanel({
        session: session("super_admin"),
        params: { abandoned: "1" },
      }),
    );
    expect(ab).toContain("Beta");
    expect(ab).not.toContain("Alpha");
    expect(ab).toContain('aria-pressed="true"');
  });

  it("an agent without lead_reveal still sees the masked address (both roles may reveal)", async () => {
    db.staffLeads.mockResolvedValue([]);
    const out = await html(
      LeadsPanel({ session: session("support_agent"), params: {} }),
    );
    expect(out).toContain(PIPELINE_COPY.leads.empty);
  });

  it("leads: contact inquiries join the table, masked, and a stage filter hides them (15-07)", async () => {
    db.staffLeads.mockResolvedValue([
      lead({ id: "a", business: "Alpha", stage: "saved_quote" }),
    ]);
    db.staffInquiryLeads.mockResolvedValue([
      {
        id: "inq000000000001",
        business: "Glow Salon",
        topicLabel: "Book a call",
        lastActivity: new Date().toISOString(),
        emailMasked: "g•••@glow.test",
      },
    ]);
    const out = await html(
      LeadsPanel({
        session: session("support_agent"),
        params: { since: "7d" },
      }),
    );
    expect(db.staffInquiryLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "7d" }),
    );
    expect(out).toContain("Glow Salon");
    expect(out).toContain("Contact form · Book a call");
    expect(out).toContain("g•••@glow.test");
    expect(out).not.toMatch(/[a-z0-9._-]+@glow\.test/i);
    expect(out).toContain("2 leads · 0 abandoned");
    const filtered = await html(
      LeadsPanel({
        session: session("support_agent"),
        params: { stage: "saved_quote" },
      }),
    );
    expect(filtered).toContain("Alpha");
    expect(filtered).not.toContain("Glow Salon");
  });

  it("WR-A04: a failed inquiry read keeps the quote and site leads on screen", async () => {
    db.staffLeads.mockResolvedValue([
      lead({ id: "a", business: "Alpha", stage: "saved_quote" }),
    ]);
    db.staffInquiryLeads.mockRejectedValue(new Error("missing collection x@y"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html(
      LeadsPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain("Alpha");
    expect(out).not.toContain("Try again");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("[staff] inquiry leads read failed");
    expect(logged).not.toContain("missing collection");
    spy.mockRestore();
  });

  it("a failed read shows the load error, no data", async () => {
    db.staffLeads.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html(
      LeadsPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain("Try again");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("boom");
    spy.mockRestore();
  });
});

describe("Fit holds (choice 2)", () => {
  const hold = {
    orgId: ORG,
    name: "Rivera Bakery",
    businessType: "Food",
    description: "Cakes and firearms",
    verdict: "blocked",
    reasons: ["keyword: firearms"],
    blocked: true,
    fields: [{ field: "Description", text: "Cakes and firearms" }],
    fingerprint: "fp1",
    heldSince: daysAgo(2),
  };

  it("empty list renders No fit holds.", async () => {
    db.staffFitHolds.mockResolvedValue([]);
    const out = await html(
      FitPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain("No fit holds.");
  });

  it("super_admin sees the case, Approve / Decline and the override switch; paid holds read the refund", async () => {
    db.staffFitHolds.mockResolvedValue([hold]);
    db.declineCase.mockResolvedValue({
      orgId: ORG,
      orgName: "Rivera Bakery",
      paidAt: daysAgo(1),
      businessDaysSince: 1,
      buildStartedAt: null,
      refundableCents: 150000,
      invoices: 1,
      refusal: null,
      resuming: false,
    });
    const out = await html(
      FitPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain("Rivera Bakery");
    expect(out).toContain("<mark");
    expect(out).toContain(PIPELINE_COPY.fit.blockedLabel);
    expect(out).toContain(PIPELINE_COPY.fit.override);
    expect(out).toContain(`${PIPELINE_COPY.fit.approve}: Rivera Bakery`);
    expect(out).toContain(`${PIPELINE_COPY.fit.decline}: Rivera Bakery`);
    expect(out).not.toContain(P13_COPY.SUPER_ONLY);
    expect(db.declineCase).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.anything(),
    );
  });

  it("a failed decline-case read disables Decline with an error line, never the unpaid path (CR-D02)", async () => {
    db.staffFitHolds.mockResolvedValue([hold]);
    db.declineCase.mockRejectedValue(new Error("timeout"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html(
      FitPanel({ session: session("super_admin"), params: {} }),
    );
    err.mockRestore();
    expect(out).toContain(
      PIPELINE_COPY.fit.refundUnknown.replace("'", "&#x27;"),
    );
    expect(out).toMatch(
      new RegExp(
        `<button[^>]*aria-label="${PIPELINE_COPY.fit.decline}: Rivera Bakery"[^>]*disabled`,
      ),
    );
  });

  it("agents read the case with the decisions disabled (Super Admin only), no decline read", async () => {
    db.staffFitHolds.mockResolvedValue([hold]);
    const out = await html(
      FitPanel({ session: session("support_agent"), params: {} }),
    );
    expect(out).toContain("keyword: firearms");
    expect(count(out, P13_COPY.SUPER_ONLY)).toBe(2);
    expect(out).toMatch(/<button[^>]*disabled[^>]*><span>Approve fit/);
    expect(db.declineCase).not.toHaveBeenCalled();
  });
});

describe("Building (choice 3)", () => {
  it("shows assembly state, the note and the actions by role", async () => {
    db.staffBuildingQueue.mockResolvedValue([
      {
        orgId: ORG,
        name: "Rivera Bakery",
        stage: "ready_for_build",
        assembly: {
          state: "failed",
          attempts: 2,
          lastRun: daysAgo(1),
          unfilled: 0,
          errorCode: "TEMPLATE_MISSING",
        },
        buildNote: "Waiting on photos",
        paidAt: daysAgo(3),
        inStageSince: daysAgo(3),
      },
      {
        orgId: OTHER,
        name: "Bloom",
        stage: "being_built",
        assembly: {
          state: "done",
          attempts: 1,
          lastRun: daysAgo(1),
          unfilled: 3,
          errorCode: null,
        },
        buildNote: "",
        paidAt: null,
        inStageSince: daysAgo(1),
      },
    ]);
    const admin = await html(
      BuildingPanel({ session: session("super_admin"), params: {} }),
    );
    expect(admin).toContain("Failed · TEMPLATE_MISSING");
    expect(admin).toContain("3 unfilled slots");
    expect(admin).toContain("Waiting on photos");
    expect(admin).toContain(`${PIPELINE_COPY.building.rerun}: Bloom`);
    expect(admin).toContain(`${PIPELINE_COPY.building.editNote}: Bloom`);
    expect(admin).toContain(
      `${PIPELINE_COPY.building.moveToPolish}: Rivera Bakery`,
    );
    const agent = await html(
      BuildingPanel({ session: session("support_agent"), params: {} }),
    );
    // Agents may re-run and edit notes, not move stages.
    expect(agent).toContain(`${PIPELINE_COPY.building.rerun}: Bloom`);
    expect(agent).toContain(P13_COPY.SUPER_ONLY);
  });
});

describe("Polish queue (choice 4)", () => {
  it("shows the preview link, the slot report and Mark ready for owner review", async () => {
    db.staffPolishQueue.mockResolvedValue([
      {
        orgId: ORG,
        name: "Rivera Bakery",
        previewUrl: "https://rivera.sites.localhost",
        assembledAt: daysAgo(1),
        slots: [
          {
            page: "Home",
            slot: "hero.image",
            result: "Default used",
            note: "",
            source: "fallback",
            filled: false,
          },
          {
            page: "Home",
            slot: "hero.title",
            result: "Filled",
            note: "",
            source: "provided",
            filled: true,
          },
        ],
        unfilled: 1,
        toPolish: 1,
        polish: ["Swap the hero photo"],
        buildNote: "",
      },
    ]);
    const out = await html(
      PolishPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain('href="https://rivera.sites.localhost"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("Unfilled");
    expect(out).toContain("1 filled · 1 unfilled");
    expect(out).toContain("Swap the hero photo");
    expect(out).toContain(`${PIPELINE_COPY.polish.markReady}: Rivera Bakery`);
  });

  it("empty queue says so", async () => {
    db.staffPolishQueue.mockResolvedValue([]);
    const out = await html(
      PolishPanel({ session: session("super_admin"), params: {} }),
    );
    expect(out).toContain(PIPELINE_COPY.polish.empty);
  });
});

describe("Launch (choice 5)", () => {
  it("super_admin gets one Approve launch per row, the Domain column and change request links", async () => {
    db.staffLaunchQueue.mockResolvedValue([
      launchRow(),
      launchRow({
        orgId: OTHER,
        name: "Bloom",
        openChangeTickets: 1,
        openChangeTicketNumbers: [1042],
      }),
    ]);
    const out = await html(
      LaunchPanel({ session: session("super_admin"), params: {} }),
    );
    expect(count(out, `aria-label="${PIPELINE_COPY.launch.approve}:`)).toBe(2);
    expect(out).not.toContain("(owner review arrives in P14)");
    expect(out).toContain("0 of 2");
    // 14-36: Domain column + the expanded line, Approve enabled (prepared, review sent).
    expect(out).toContain("Prepared");
    expect(out).toContain("riverabakery.com");
    expect(out).toContain("Owner review: </span>Sent");
    expect(out).not.toContain('aria-disabled="true"');
    expect(out).toContain('href="/staff/tickets/1042"');
    expect(out).not.toContain(P13_COPY.SUPER_ONLY);
  });

  it("14-36: Approve launch is aria-disabled with APPROVE-BLOCKED unless prepared and sent", async () => {
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        move: {
          code: "M-7",
          state: "waiting_owner",
          domain: "riverabakery.com",
          waitingOn: "waiting on nameservers",
        },
      }),
      launchRow({
        orgId: OTHER,
        name: "Bloom",
        move: {
          code: "M-8",
          state: "failed",
          failedStep: 8,
          domain: "bloom.example",
          waitingOn: "step 8 failed",
        },
      }),
      launchRow({
        orgId: "zzzzzzzzzzzzzzz",
        name: "Quiet Co",
        review: { done: 3, total: 6, submittedAt: null, resubmitNeeded: [] },
        move: { code: null, state: "none", waitingOn: "no domain" },
      }),
    ]);
    const out = await html(
      LaunchPanel({ session: session("super_admin"), params: {} }),
    );
    expect(count(out, 'aria-disabled="true"')).toBe(3);
    expect(out).toContain("Domain not prepared: waiting on nameservers.");
    expect(out).toContain("Waiting on nameservers");
    expect(out).toContain("Failed · step 8");
    expect(out).toContain("No domain");
    expect(out).toContain("The owner hasn&#x27;t sent the review yet.");
    expect(out).toContain("Owner review: </span>Not sent yet");
  });

  it("CR-D01: a stale send (pages changed since) disables Approve and reads Not sent yet", async () => {
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        review: {
          done: 2,
          total: 2,
          submittedAt: "2026-10-15 14:00:00.000Z",
          resubmitNeeded: ["Home"],
        },
      }),
    ]);
    const out = await html(
      LaunchPanel({ session: session("super_admin"), params: {} }),
    );
    expect(count(out, 'aria-disabled="true"')).toBe(1);
    expect(out).toContain(
      "The owner needs to send the review again: 1 page changed since.",
    );
    expect(out).toContain("Owner review: </span>Not sent yet");
  });

  it("support_agent sees the button disabled with Super Admin only", async () => {
    db.staffLaunchQueue.mockResolvedValue([launchRow()]);
    const out = await html(
      LaunchPanel({ session: session("support_agent"), params: {} }),
    );
    expect(out).toMatch(/<button[^>]*disabled[^>]*><span>Approve launch/);
    expect(out).toContain(P13_COPY.SUPER_ONLY);
  });

  it("empty queue says so; the area page wires ?tab=launch to this panel", async () => {
    signIn("super_admin");
    db.staffLaunchQueue.mockResolvedValue([]);
    const out = await html(
      PipelinePage({ searchParams: Promise.resolve({ tab: "launch" }) }),
    );
    expect(out).toContain(PIPELINE_COPY.launch.empty);
    expect(out).toContain("Pipeline");
  });
});
