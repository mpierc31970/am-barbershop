// 13-39 Task 1: indexing actions (STAFF-17, D190; T-13-39-01). @cds/db and the staff session
// are mocked; the real matrix (authorizeStaff inside runStaffAction), the input checks and the
// error mapping run. Source gates: POST-only (Server Actions), the panel reads staffIndexingStatus.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  staffIndexingStatus: vi.fn(),
  staffResubmit: vi.fn(),
  staffResubmitAllLive: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/indexing");
const { resetStaffKit } = await import("./staff-test-kit");

const ORG = "aaaaaaaaaaaaaaa";

function session(role: "super_admin" | "support_agent" | "") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Mara",
    role,
    maskedEmail: "m•••@example.test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffIndexingStatus.mockResolvedValue([
    { orgId: ORG, business: "Rivera Bakery" },
  ]);
  db.staffResubmit.mockResolvedValue({
    orgId: ORG,
    ping: "logged",
    sitemap: "ok",
    at: "2026-10-16T10:00:00.000Z",
  });
  db.staffResubmitAllLive.mockResolvedValue({ count: 14, errors: 0 });
});

describe("resubmitAction", () => {
  it("signed out → session_ended; nothing called", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await actions.resubmitAction(ORG);
    expect(res).toMatchObject({
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    });
    expect(db.staffResubmit).not.toHaveBeenCalled();
  });

  it("support agent (no step-up) → staffResubmit with the session ctx; 'Resubmitted Rivera Bakery.'", async () => {
    const res = await actions.resubmitAction(ORG);
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Resubmitted Rivera Bakery.",
        ping: "logged",
        sitemap: "ok",
      },
    });
    expect(db.staffResubmit).toHaveBeenCalledTimes(1);
    const [ctx, org] = db.staffResubmit.mock.calls[0]!;
    expect(ctx).toMatchObject({ kind: "platform", staffRole: "support_agent" });
    expect(org).toBe(ORG);
  });

  it("a failed sitemap check is named in the result line", async () => {
    db.staffResubmit.mockResolvedValue({
      orgId: ORG,
      ping: "logged",
      sitemap: "error",
      at: "2026-10-16T10:00:00.000Z",
    });
    const res = await actions.resubmitAction(ORG);
    expect(res.ok && res.data.message).toBe(
      "Resubmitted Rivera Bakery. The sitemap check failed.",
    );
  });

  it("bad org id → not_found without a call; unknown site → not_found", async () => {
    expect(await actions.resubmitAction("../x")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await actions.resubmitAction(42)).toMatchObject({
      code: "not_found",
    });
    expect(db.staffIndexingStatus).not.toHaveBeenCalled();
    db.staffIndexingStatus.mockRejectedValue(new NotFound("site not found"));
    expect(await actions.resubmitAction(ORG)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(db.staffResubmit).not.toHaveBeenCalled();
  });

  it("a role without `indexing` → REFUSED-ROLE", async () => {
    sess.getStaffSession.mockResolvedValue(session(""));
    const res = await actions.resubmitAction(ORG);
    expect(res).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.staffResubmit).not.toHaveBeenCalled();
  });
});

describe("resubmitAllAction", () => {
  it("calls staffResubmitAllLive; 'Resubmitted 14 live sites. 0 sitemap errors.'", async () => {
    const res = await actions.resubmitAllAction();
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Resubmitted 14 live sites. 0 sitemap errors.",
        count: 14,
        errors: 0,
      },
    });
    expect(db.staffResubmitAllLive).toHaveBeenCalledTimes(1);
  });

  it("singular wording", async () => {
    db.staffResubmitAllLive.mockResolvedValue({ count: 1, errors: 1 });
    const res = await actions.resubmitAllAction();
    expect(res.ok && res.data.message).toBe(
      "Resubmitted 1 live site. 1 sitemap error.",
    );
  });

  it("signed out → session_ended", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    expect(await actions.resubmitAllAction()).toMatchObject({
      code: "session_ended",
    });
    expect(db.staffResubmitAllLive).not.toHaveBeenCalled();
  });
});

describe("source gates", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("actions are Server Actions (POST only) calling the data layer", () => {
    const src = read("../app/actions/staff/indexing.ts");
    expect(src.startsWith('"use server";')).toBe(true);
    expect(src).toContain("staffResubmitAllLive");
    expect(src).toContain("staffResubmit(");
  });

  it("the Health panel reads staffIndexingStatus; no GET route resubmits", () => {
    const panel = read(
      "../app/(platform)/staff/(console)/health/panels/indexing.tsx",
    );
    expect(panel).toContain("staffIndexingStatus");
    expect(panel.split("\n")[0]).toBe(
      "// Panel health/indexing: filled by 13-39",
    );
    const site = read(
      "../app/(platform)/staff/(console)/sites/[org]/panels/indexing.tsx",
    );
    expect(site.split("\n")[0]).toBe(
      "// Panel sites/[org]/indexing: filled by 13-39",
    );
    expect(site).not.toContain("resubmitAll");
  });

  it("server panels pass IndexingTable (a client component) no function props (CR-D03)", () => {
    for (const rel of [
      "../app/(platform)/staff/(console)/health/panels/indexing.tsx",
      "../app/(platform)/staff/(console)/sites/[org]/panels/indexing.tsx",
    ]) {
      const src = read(rel);
      const jsx = src.slice(src.indexOf("<IndexingTable"));
      const props = jsx.slice(0, jsx.indexOf("/>"));
      expect(props).not.toMatch(/=\{\s*\(/);
      expect(props).not.toContain("siteHref");
    }
  });
});
