// 13-36 Task 1: service-window actions (STAFF-10, D100; T-13-36-01, T-13-36-02). @cds/db and
// the staff session are mocked; the real matrix (authorizeStaff inside runStaffAction), the
// real core range rules and the real error mapping run.
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  staffCreateServiceWindow: vi.fn(),
  staffClearServiceWindow: vi.fn(),
  staffListServiceWindows: vi.fn(),
  staffListIncidents: vi.fn(),
  staffSupportLabels: vi.fn(),
  staffWindowTargets: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry", () => ({
  ADDON_REGISTRY: { list: () => [{ slug: "events", name: "Events" }] },
}));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/windows");
const { resetStaffKit } = await import("./staff-test-kit");

const ORG = "abcdefghijklmno";
const PAGE = "pagepagepage001";
const INC = "incidentid00001";

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

const HOUR = 3_600_000;
function input(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    scope: "page",
    orgId: ORG,
    pageId: PAGE,
    startsAt: new Date(now - 1000).toISOString(),
    endsAt: new Date(now + 4 * HOUR).toISOString(),
    message: "Moving the booking page.",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffCreateServiceWindow.mockResolvedValue({
    id: "win000000000001",
    code: "W-12",
    alerted: 0,
  });
  db.staffSupportLabels.mockResolvedValue({
    orgs: { [ORG]: "Rivera Bakery" },
    pages: { [PAGE]: "About us" },
  });
  db.staffListIncidents.mockResolvedValue([
    { id: INC, code: "I-3", title: "Uploads", status: "open" },
  ]);
});

describe("createWindowAction", () => {
  it("agent, platform scope → REFUSED-ROLE, nothing created", async () => {
    const res = await actions.createWindowAction(
      input({ scope: "platform", orgId: undefined, pageId: undefined }),
    );
    expect(res).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.staffCreateServiceWindow).not.toHaveBeenCalled();
  });

  it("agent, add-on scope → REFUSED-ROLE", async () => {
    const res = await actions.createWindowAction(
      input({
        scope: "addon",
        addon: "events",
        orgId: undefined,
        pageId: undefined,
      }),
    );
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.staffCreateServiceWindow).not.toHaveBeenCalled();
  });

  it("agent, page scope → created; the CLI result line names the site, page and W-12", async () => {
    const res = await actions.createWindowAction(input({ incident: "I-3" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.code).toBe("W-12");
    expect(res.data.message).toMatch(
      /^Window W-12 · Rivera Bakery · page "About us" · now → .+ Central · editing paused for the owner\.$/,
    );
    const [, win, opts] = db.staffCreateServiceWindow.mock.calls[0]!;
    expect(win).toMatchObject({
      scope: "page",
      orgId: ORG,
      pageId: PAGE,
      message: "Moving the booking page.",
      incident: INC,
    });
    expect(opts.addons).toEqual([{ slug: "events", name: "Events" }]);
  });

  it("super_admin, platform scope, stale step-up → step_up_needed, nothing created", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await actions.createWindowAction(
      input({ scope: "platform", orgId: undefined, pageId: undefined }),
    );
    expect(res).toEqual({ ok: false, code: "step_up_needed", message: "" });
    expect(db.staffCreateServiceWindow).not.toHaveBeenCalled();
  });

  it("super_admin, platform scope, fresh step-up → created for every site", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffCreateServiceWindow.mockResolvedValue({
      id: "win000000000002",
      code: "W-13",
      alerted: 4,
    });
    const res = await actions.createWindowAction(
      input({ scope: "platform", orgId: undefined, pageId: undefined }),
    );
    expect(res.ok && res.data.message).toMatch(
      /^Window W-13 · all sites · now → .+ · editing paused for the owners\. 4 alerts raised\.$/,
    );
  });

  it("end before start, or more than 7 days → WINDOW-RANGE on the range field", async () => {
    const now = Date.now();
    for (const bad of [
      {
        startsAt: new Date(now + 2 * HOUR).toISOString(),
        endsAt: new Date(now + HOUR).toISOString(),
      },
      { endsAt: new Date(now + 8 * 24 * HOUR).toISOString() },
    ]) {
      const res = await actions.createWindowAction(input(bad));
      expect(res).toMatchObject({
        ok: false,
        message: P13_COPY.WINDOW_RANGE,
        field: "range",
      });
    }
    expect(db.staffCreateServiceWindow).not.toHaveBeenCalled();
  });

  it("161-character message, unknown scope, junk ids → refused before any call", async () => {
    expect(
      await actions.createWindowAction(input({ message: "x".repeat(161) })),
    ).toMatchObject({ ok: false, field: "message" });
    expect(
      await actions.createWindowAction(input({ scope: "everything" })),
    ).toMatchObject({ ok: false, field: "scope" });
    expect(
      await actions.createWindowAction(input({ orgId: "../x" })),
    ).toMatchObject({ ok: false, field: "target" });
    expect(sess.getStaffSession).not.toHaveBeenCalled();
  });
});

describe("endWindowAction", () => {
  it("agent ends a page window", async () => {
    db.staffListServiceWindows.mockResolvedValue([
      { code: "W-12", scope: "page" },
    ]);
    db.staffClearServiceWindow.mockResolvedValue({
      id: "win000000000001",
      code: "W-12",
      cleared: true,
    });
    const res = await actions.endWindowAction("W-12");
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Cleared W-12. Editing is back on; the notice is gone.",
        code: "W-12",
        cleared: true,
      },
    });
  });

  it("agent cannot end a platform window; a super_admin needs a fresh step-up", async () => {
    db.staffListServiceWindows.mockResolvedValue([
      { code: "W-9", scope: "platform" },
    ]);
    expect(await actions.endWindowAction("W-9")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await actions.endWindowAction("W-9")).toMatchObject({
      ok: false,
      code: "step_up_needed",
    });
    expect(db.staffClearServiceWindow).not.toHaveBeenCalled();
  });

  it("an unknown code is not found", async () => {
    db.staffListServiceWindows.mockResolvedValue([]);
    expect(await actions.endWindowAction("W-404")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await actions.endWindowAction("nope")).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("windowTargetsAction", () => {
  it("maps active add-on slugs to names", async () => {
    db.staffWindowTargets.mockResolvedValue({
      pages: [{ id: PAGE, title: "About us", status: "published" }],
      activeAddons: ["events"],
    });
    expect(await actions.windowTargetsAction(ORG)).toEqual({
      ok: true,
      data: {
        pages: [{ id: PAGE, title: "About us" }],
        addons: [{ slug: "events", name: "Events" }],
      },
    });
  });
});
