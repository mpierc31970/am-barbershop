// 13-47 Task 2: the Today page and the sidebar badges (STAFF-20, STAFF-26; D-UI-P13-5,
// D-UI-P13-20; 13-UI-SPEC "Today", "Sidebar"). readStaffSession and staffTodayCounts are
// mocked; the real staff session, page, panel, layout, StaffChrome and @cds/ui/staff render.
import { P13_COPY } from "@cds/core/staff";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
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

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  staffTodayCounts: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const page = await import("../app/(platform)/staff/(console)/page");
const { default: Layout } =
  await import("../app/(platform)/staff/(console)/layout");

const EMPTY = {
  rows: [],
  status: { live: 14, building: 3, openTickets: 9, jobsLate: 0 },
  badges: { tickets: 0, pipeline: 0, review: 0, health: 0 },
  failed: [],
};

const BUSY = {
  rows: [
    {
      id: "sla_missed",
      kind: "ticket_inbox",
      count: 2,
      severity: "critical",
      label: "2 tickets missed SLA",
      href: "/staff/tickets?sla=missed",
      oldestMs: 3 * 86_400_000,
    },
    {
      id: "unassigned",
      kind: "ticket_inbox",
      count: 1,
      severity: "info",
      label: "1 unassigned ticket",
      href: "/staff/tickets?assignee=none",
    },
    {
      id: "fit_holds",
      kind: "review_queue",
      count: null,
      severity: "info",
      label: "Fit holds",
      href: "/staff/pipeline?tab=fit",
    },
  ],
  status: { live: 14, building: 3, openTickets: 9, jobsLate: 1 },
  badges: { tickets: 12, pipeline: null, review: 2, health: 0 },
  failed: ["fit"],
};

function signIn(role: "super_admin" | "support_agent" = "support_agent") {
  kit.cookies.set("cds_staff", "tok");
  db.readStaffSession.mockResolvedValue({
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    sessionId: "sess00000000001",
    stepUpFresh: true,
    staffName: "Mara Agent",
    staffEmailMasked: "m•••@example.test",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
}

async function html(el: Promise<ReactElement> | ReactElement): Promise<string> {
  return renderToStaticMarkup(await el);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  kit.headers["x-cds-path"] = "/staff";
  signIn();
});

describe("Today page", () => {
  it("nothing needs attention: TODAY-EMPTY and the status line", async () => {
    db.staffTodayCounts.mockResolvedValue(EMPTY);
    const out = await html(page.default({}));
    expect(out).toContain("<h1");
    expect(out).toContain(P13_COPY.TODAY_EMPTY_H);
    expect(out).toContain("Nothing needs you.");
    expect(out).toContain("Go do something nice.");
    expect(out).toContain("See all open tickets");
    expect(out).toContain("14 live");
    expect(out).toContain("3 building");
    expect(out).toContain("9 open tickets");
    expect(out).toContain("Jobs OK");
    // One read, scoped to the signed-in staff member, with the registry manifests.
    expect(db.staffTodayCounts.mock.calls[0]?.[0]).toMatchObject({
      staffRole: "support_agent",
    });
    expect(
      Array.isArray(db.staffTodayCounts.mock.calls[0]?.[1]?.manifests),
    ).toBe(true);
  });

  it("rows render in the read model's order, linking into the queues; a failed source says so", async () => {
    db.staffTodayCounts.mockResolvedValue(BUSY);
    const out = await html(page.default({}));
    const missed = out.indexOf("/staff/tickets?sla=missed");
    const unassigned = out.indexOf("/staff/tickets?assignee=none");
    const fit = out.indexOf("/staff/pipeline?tab=fit");
    expect(missed).toBeGreaterThan(-1);
    expect(missed).toBeLessThan(unassigned);
    expect(unassigned).toBeLessThan(fit);
    expect(out).toContain("2 tickets missed SLA, oldest 3 days. Open.");
    expect(out).toContain("oldest 3d");
    expect(out).toContain("Couldn&#x27;t count");
    expect(out).toContain("1 job late");
    // 13-50: the "?" help drawer (staff-today.md) quotes the empty state; check the page only.
    const body = out.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
    expect(body).not.toContain(P13_COPY.TODAY_EMPTY_H);
  });

  it("a failed read shows ERR-LOAD, never a page error", async () => {
    db.staffTodayCounts.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html(page.default({}));
    expect(out).toContain(SUPPORT_UI_COPY.ERR_LOAD.replace(/'/g, "&#x27;"));
    expect(spy.mock.calls.flat().join(" ")).not.toContain("down");
    spy.mockRestore();
  });

  it("the title gains (n) from the same counts", async () => {
    db.staffTodayCounts.mockResolvedValue(BUSY);
    expect((await page.generateMetadata()).title).toBe("(2) Today");
    db.staffTodayCounts.mockResolvedValue(EMPTY);
    expect((await page.generateMetadata()).title).toBe("Today");
  });

  it("signed out redirects to sign-in", async () => {
    kit.cookies.clear();
    await expect(page.default({})).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("sidebar badges", () => {
  it("come from staffTodayCounts: 12 → 9+, neutral; a failed badge source shows none", async () => {
    db.staffTodayCounts.mockResolvedValue(BUSY);
    const out = await html(Layout({ children: createElement("p", null, "x") }));
    const chips = [...out.matchAll(/data-nav-badge=""[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    // The sidebar renders in the rail and in the mobile drawer.
    expect([...new Set(chips)]).toEqual(["9+", "2"]);
    expect(out).toContain("12 need attention");
    expect(out).not.toMatch(/data-nav-badge=""[^>]*(danger|critical)/);
  });

  it("a failed read renders the nav with no badges", async () => {
    db.staffTodayCounts.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html(Layout({ children: createElement("p", null, "x") }));
    expect(out).toContain("Tickets");
    expect(out).not.toContain("data-nav-badge");
    spy.mockRestore();
  });
});
