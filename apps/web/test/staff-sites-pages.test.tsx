// 13-33 (STAFF-02, D5; T-13-33-01..03): the Sites list and the site detail panels (Overview,
// Add-ons, Support, Audit) and the add-on install actions. @cds/db is mocked (readStaffSession
// + the staff reads and installer); the real staff session, STAFF_MATRIX check, step-up gate,
// filters and components run. Proves: URL filters reach staffListSites and narrow the rows;
// the overview shows member names and roles and no email; agents see "Super Admin only" and
// the action refuses them; a stale sign-in asks for a code before any install; the support
// and audit panels read that org only.
import { P13_COPY } from "@cds/core/staff";
import { ToastRegion } from "@cds/ui/hub";
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
vi.mock("../lib/addons", () => ({ addonDeps: () => ({ deps: 1 }) }));

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  staffListSites: vi.fn(),
  staffGetSite: vi.fn(),
  staffSiteAddons: vi.fn(),
  staffListTickets: vi.fn(),
  staffListAuditLog: vi.fn(),
  readPriceCatalog: vi.fn(async () => []),
  installAddonAsStaff: vi.fn(),
  uninstallAddonAsStaff: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: SitesPage } =
  await import("../app/(platform)/staff/(console)/sites/page");
const { sortSites } =
  await import("../app/(platform)/staff/(console)/sites/panels/list");
const { default: OverviewPanel } =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/overview");
const { default: AddonsPanel } =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/addons");
const { default: SupportPanel } =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/support");
const { default: AuditPanel } =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/audit");
const actions = await import("../app/actions/staff/sites");

type Role = "super_admin" | "support_agent";

const ORG = "aaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbb";

function ctxFor(role: Role) {
  return { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" };
}

function signIn(role: Role, fresh = true) {
  kit.cookies.set("cds_staff", "tok");
  const at = fresh
    ? new Date().toISOString()
    : new Date(Date.now() - 60 * 60_000).toISOString();
  db.readStaffSession.mockResolvedValue({
    ctx: ctxFor(role),
    sessionId: "sess00000000001",
    stepUpFresh: fresh,
    staffName: role === "super_admin" ? "Sam Admin" : "Mara Agent",
    staffEmailMasked: "s•••@example.test",
    createdAt: at,
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

function siteRow(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    name: "Rivera Bakery",
    slug: "rivera",
    state: "live",
    path: "standard",
    plan: "monthly",
    carePlan: false,
    addons: ["testimonials"],
    liveHost: "riverabakery.com",
    previewHost: "rivera.sites.localhost",
    created: "2026-09-01 10:00:00.000Z",
    lastOwnerActivity: null,
    openTickets: 0,
    demo: false,
    repeatInfringer: false,
    ...over,
  };
}

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(
    createElement(ToastRegion, null, (await el) as ReactElement),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
});

describe("Sites list (choice 2)", () => {
  it("status=suspended in the URL reaches staffListSites and narrows the rows", async () => {
    signIn("support_agent");
    db.staffListSites.mockImplementation(
      async (_ctx: unknown, f: { status?: string }) =>
        [
          siteRow({ orgId: ORG, name: "Bloom", state: "suspended" }),
          siteRow({ orgId: OTHER, name: "Rivera Bakery", state: "live" }),
        ].filter((r) => !f.status || r.state === f.status),
    );
    const out = await html(
      SitesPage({ searchParams: Promise.resolve({ status: "suspended" }) }),
    );
    expect(db.staffListSites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "suspended" }),
    );
    expect(out).toContain("Bloom");
    expect(out).toContain("Suspended");
    expect(out).not.toContain(`/staff/sites/${OTHER}`);
    expect(out).toContain("1 site");
  });

  it("demo and has-open-tickets filters apply in the panel; unknown values read as Any", async () => {
    signIn("support_agent");
    db.staffListSites.mockResolvedValue([
      siteRow({ orgId: ORG, name: "Demo Co", demo: true, openTickets: 0 }),
      siteRow({ orgId: OTHER, name: "Busy Co", openTickets: 3 }),
    ]);
    const demo = await html(
      SitesPage({ searchParams: Promise.resolve({ status: "demo" }) }),
    );
    expect(demo).toContain("Demo Co");
    expect(demo).not.toContain("Busy Co");
    const busy = await html(
      SitesPage({ searchParams: Promise.resolve({ open: "1" }) }),
    );
    expect(busy).toContain("Busy Co");
    expect(busy).not.toContain("Demo Co");
    await html(
      SitesPage({
        searchParams: Promise.resolve({ status: "bogus", path: "nope" }),
      }),
    );
    const last = db.staffListSites.mock.calls.at(-1)![1] as Record<
      string,
      unknown
    >;
    expect(last.status).toBeUndefined();
    expect(last.path).toBeUndefined();
  });

  it("empty filter shows 'No sites match.'; default order is status group then name", async () => {
    signIn("super_admin");
    db.staffListSites.mockResolvedValue([]);
    expect(await html(SitesPage({}))).toContain("No sites match.");
    expect(
      sortSites([
        { state: "live", name: "A" },
        { state: "suspended", name: "Z" },
        { state: "notice", name: "B" },
        { state: "intake", name: "C" },
      ] as never[]).map((r: { name: string }) => r.name),
    ).toEqual(["Z", "B", "A", "C"]);
  });
});

describe("Site detail panels (choice 3)", () => {
  it("overview renders member names and roles and no email address", async () => {
    db.staffGetSite.mockResolvedValue({
      ...siteRow(),
      members: [
        { name: "Mara Rivera", role: "owner" },
        { name: "Lee Park", role: "editor" },
      ],
      billing: {
        state: "active",
        plan: "monthly",
        carePlan: false,
        nextRenewal: "2026-11-01 00:00:00.000Z",
      },
      suspension: null,
    });
    db.staffListAuditLog.mockResolvedValue({
      items: [
        {
          id: "a1",
          action: "impersonation.start",
          actorName: "Mara Rivera",
          byStaff: true,
          impersonated: true,
          impersonatorName: "Sam Admin",
          targetCollection: "",
          targetId: "",
          meta: null,
          created: "2026-10-14 10:00:00.000Z",
        },
      ],
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    });
    const out = await html(
      OverviewPanel({
        session: session("support_agent"),
        params: {},
        orgId: ORG,
      }),
    );
    expect(out).toContain("Mara Rivera");
    expect(out).toContain("Owner");
    expect(out).toContain("Editor");
    expect(out).toContain("CDS · Sam Admin");
    expect(out).not.toContain("@");
    expect(db.staffListAuditLog).toHaveBeenCalledWith(expect.anything(), ORG, {
      perPage: 10,
    });
  });

  it("addons panel as support_agent shows Install disabled with 'Super Admin only'", async () => {
    db.staffGetSite.mockResolvedValue({
      ...siteRow(),
      members: [],
      billing: { state: "none", plan: "", carePlan: false, nextRenewal: null },
      suspension: null,
    });
    db.staffSiteAddons.mockResolvedValue([
      {
        slug: "testimonials",
        status: "active",
        since: "2026-10-01 10:00:00.000Z",
        source: "staff",
      },
    ]);
    const out = await html(
      AddonsPanel({
        session: session("support_agent"),
        params: {},
        orgId: ORG,
      }),
    );
    expect(out).toContain("Uninstall add-on");
    expect(out).toContain("Install add-on");
    expect(out).toContain(P13_COPY.SUPER_ONLY);
    expect(out).toMatch(/<button[^>]*disabled[^>]*><span>Install add-on/);
    const superOut = await html(
      AddonsPanel({ session: session("super_admin"), params: {}, orgId: ORG }),
    );
    expect(superOut).not.toContain(P13_COPY.SUPER_ONLY);
  });

  it("support panel lists only that org's tickets", async () => {
    db.staffListTickets.mockResolvedValue([
      {
        id: "t1",
        number: 1042,
        orgId: ORG,
        orgName: "Rivera Bakery",
        type: "problem",
        subject: "Form broken",
        status: "open",
        priority: "normal",
        ageMs: 1000,
        sla: "on_track",
        dueAt: "2026-10-16T20:00:00.000Z",
        assignee: null,
        assigneeId: null,
        paid: null,
        openedByCds: false,
      },
      {
        id: "t2",
        number: 2001,
        orgId: OTHER,
        orgName: "Other",
        type: "question",
        subject: "Leak",
        status: "open",
        priority: "normal",
        ageMs: 1000,
        sla: "on_track",
        dueAt: null,
        assignee: null,
        assigneeId: null,
        paid: null,
        openedByCds: false,
      },
    ]);
    const out = await html(
      SupportPanel({
        session: session("support_agent"),
        params: {},
        orgId: ORG,
      }),
    );
    expect(db.staffListTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, status: "all" }),
    );
    expect(out).toContain('href="/staff/tickets/1042"');
    expect(out).not.toContain("2001");
    expect(out).toContain(`/staff/sites/${ORG}?tab=actions`);
  });

  it("audit panel lists that org's audit rows with the who filter and paging", async () => {
    db.staffListAuditLog.mockResolvedValue({
      items: [
        {
          id: "a1",
          action: "page.published",
          actorName: "Mara Rivera",
          byStaff: false,
          impersonated: false,
          impersonatorName: "",
          targetCollection: "pages",
          targetId: "ppppppppppppppp",
          meta: null,
          created: "2026-10-14 10:00:00.000Z",
        },
      ],
      page: 2,
      perPage: 50,
      totalItems: 120,
      totalPages: 3,
    });
    const out = await html(
      AuditPanel({
        session: session("support_agent"),
        params: { who: "cds", page: "2" },
        orgId: ORG,
      }),
    );
    expect(db.staffListAuditLog).toHaveBeenCalledWith(expect.anything(), ORG, {
      page: 2,
      perPage: 50,
      who: "cds",
    });
    expect(out).toContain("page.published");
    expect(out).toContain("Mara Rivera");
    expect(out).toContain("Page 2 of 3");
    expect(out).toContain("who=cds&amp;page=3");
  });
});

describe("installAddonAction / uninstallAddonAction (T-13-33-01)", () => {
  const input = { slug: "testimonials", reason: "Owner asked by phone" };

  it("support_agent gets REFUSED-ROLE and the installer is not called", async () => {
    signIn("support_agent");
    expect(await actions.installAddonAction(ORG, input)).toEqual({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.installAddonAsStaff).not.toHaveBeenCalled();
  });

  it("super_admin with a stale step-up gets step_up_needed first", async () => {
    signIn("super_admin", false);
    expect(await actions.installAddonAction(ORG, input)).toEqual({
      ok: false,
      code: "step_up_needed",
      message: "",
    });
    expect(db.installAddonAsStaff).not.toHaveBeenCalled();
  });

  it("fresh super_admin calls the CLI's functions with the reason", async () => {
    signIn("super_admin", true);
    db.installAddonAsStaff.mockResolvedValue({
      slug: "testimonials",
      outcome: "installed",
    });
    const res = await actions.installAddonAction(ORG, input);
    expect(res).toMatchObject({
      ok: true,
      data: { slug: "testimonials", message: "Testimonials installed." },
    });
    expect(db.installAddonAsStaff).toHaveBeenCalledWith(
      ctxFor("super_admin"),
      { deps: 1 },
      { orgId: ORG, slug: "testimonials", reason: "Owner asked by phone" },
    );
    expect(kit.revalidated).toContain(`/staff/sites/${ORG}`);

    db.uninstallAddonAsStaff.mockResolvedValue({
      slug: "testimonials",
      outcome: "disabled",
    });
    const un = await actions.uninstallAddonAction(ORG, input);
    expect(un).toMatchObject({ ok: true });
    expect(db.uninstallAddonAsStaff).toHaveBeenCalledTimes(1);
  });

  it("bad org, unknown add-on and a short reason are refused before the session", async () => {
    signIn("super_admin", true);
    expect(await actions.installAddonAction("nope", input)).toMatchObject({
      code: "not_found",
    });
    expect(
      await actions.installAddonAction(ORG, { ...input, slug: "no-such" }),
    ).toMatchObject({ code: "not_found" });
    expect(
      await actions.installAddonAction(ORG, { ...input, reason: "x" }),
    ).toMatchObject({ code: "invalid_input", field: "reason" });
    expect(db.installAddonAsStaff).not.toHaveBeenCalled();
  });
});
