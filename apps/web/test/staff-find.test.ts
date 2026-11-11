// 13-47 Task 2: Find and badge actions (STAFF-20; T-13-47-01, T-13-47-02). @cds/db and the staff
// session are mocked; the real runStaffAction (session + matrix), the real input cap, the
// sidebar badge mapping and the StaffChrome search adapter run.
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  requireStaff: vi.fn(),
  staffCan: (role: string | null | undefined, feature: string) =>
    role === "super_admin" ||
    (role === "support_agent" && feature !== "staff_roles"),
}));
const db = vi.hoisted(() => ({
  staffFind: vi.fn(),
  staffTodayCounts: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => [{ slug: "fixture" }], get: () => undefined },
}));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);

const actions = await import("../app/actions/staff/today");
const sections = await import("../app/(platform)/staff/sections");
const chrome = await import("../app/(platform)/staff/(console)/StaffChrome");

function session(role: "super_admin" | "support_agent") {
  return {
    ctx: {
      kind: "platform",
      actor: "me0000000000001",
      staffRole: role,
      ip: "203.0.113.47",
    },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

const T1042 = {
  number: 1042,
  subject: "Hours wrong",
  href: "/staff/tickets/1042",
  site: "Bella Rivera Studio",
};
const T1001 = {
  number: 1001,
  subject: "Ticket 1042 follow-up",
  href: "/staff/tickets/1001",
  site: "Rivera Bakery",
};
const SITE = {
  group: "Sites" as const,
  label: "Bella Rivera Studio",
  href: "/staff/sites/abcdefghijklmno",
};

beforeEach(() => {
  vi.clearAllMocks();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffFind.mockResolvedValue({
    tickets: [T1042, T1001],
    sites: [SITE],
    cases: [],
  });
});

describe("findAction", () => {
  it('"1042" returns ticket 1042 first, then the rest, then sites and cases', async () => {
    const res = await actions.findAction("1042");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toEqual(T1042);
    expect(res.data).toEqual([T1042, T1001, SITE]);
    expect(db.staffFind).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "support_agent" }),
      "1042",
    );
  });

  it("signed out → session_ended; staffFind never called", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await actions.findAction("1042");
    expect(res).toEqual({
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    });
    expect(db.staffFind).not.toHaveBeenCalled();
  });

  it("blank or non-string input returns nothing without a read; long input is capped", async () => {
    expect(await actions.findAction("   ")).toEqual({ ok: true, data: [] });
    expect(await actions.findAction({ q: 1 })).toEqual({ ok: true, data: [] });
    expect(db.staffFind).not.toHaveBeenCalled();
    await actions.findAction("x".repeat(5000));
    const sent = db.staffFind.mock.calls[0]?.[1] as string;
    expect(sent.length).toBeLessThanOrEqual(200);
  });

  it("a non-staff role is refused", async () => {
    sess.getStaffSession.mockResolvedValue({
      ...session("support_agent"),
      ctx: { ...session("support_agent").ctx, staffRole: "" },
      role: "",
    });
    const res = await actions.findAction("1042");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.staffFind).not.toHaveBeenCalled();
  });

  it("the StaffChrome adapter returns hits, and [] for a refused call", async () => {
    expect(await chrome.staffFindSearch("1042")).toEqual([T1042, T1001, SITE]);
    sess.getStaffSession.mockResolvedValue(null);
    expect(await chrome.staffFindSearch("1042")).toEqual([]);
  });
});

describe("badges", () => {
  it("todayBadgesAction returns the Today badges (registry manifests passed)", async () => {
    db.staffTodayCounts.mockResolvedValue({
      rows: [],
      status: { live: 1, building: 0, openTickets: 0, jobsLate: 0 },
      badges: { tickets: 4, pipeline: 0, review: null, health: 12 },
      failed: ["review"],
    });
    const res = await actions.todayBadgesAction();
    expect(res).toEqual({
      ok: true,
      data: { tickets: 4, pipeline: 0, review: null, health: 12 },
    });
    expect(db.staffTodayCounts.mock.calls[0]?.[1]).toEqual({
      manifests: [{ slug: "fixture" }],
    });
  });

  it("staffBadgeCounts and staffNav: only positive known counts become badges", () => {
    const counts = sections.staffBadgeCounts({
      tickets: 4,
      pipeline: 0,
      review: null,
      health: 12,
    });
    expect(counts).toEqual({ tickets: 4, health: 12 });
    expect(sections.staffBadgeCounts(null)).toEqual({});
    const nav = sections.staffNav("support_agent", "today", counts);
    const byKey = new Map(nav.map((n) => [n.key, n.badge]));
    expect(byKey.get("tickets")).toBe(4);
    expect(byKey.get("health")).toBe(12);
    expect(byKey.get("pipeline")).toBeUndefined();
    expect(byKey.get("review")).toBeUndefined();
    expect(byKey.get("today")).toBeUndefined();
  });

  it("withBadges patches fresh counts and clears a badge that dropped to 0 or failed", () => {
    const nav = sections.staffNav("support_agent", "today", {
      tickets: 4,
      review: 2,
    });
    const next = chrome.withBadges(nav, {
      tickets: 0,
      review: null,
      health: 3,
    });
    const byKey = new Map(next.map((n) => [n.key, n.badge]));
    expect(byKey.get("tickets")).toBeUndefined();
    expect(byKey.get("review")).toBeUndefined();
    expect(byKey.get("health")).toBe(3);
    expect(chrome.withBadges(nav, null)).toEqual(nav);
  });
});
