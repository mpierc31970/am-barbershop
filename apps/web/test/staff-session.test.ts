// 13-21 Task 1: staff session reader, page guard and next validator (STAFF-06; P13-P1;
// Invariant 10; T-13-21-02, T-13-21-05). @cds/db readStaffSession is mocked; next/* come from
// the shared staff test kit.
import { Forbidden, NotFound } from "@cds/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kit, nextSignal, resetStaffKit } from "./staff-test-kit";

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

const db = vi.hoisted(() => ({ readStaffSession: vi.fn() }));
vi.mock("@cds/db", () => db);

const s = await import("../lib/staff-session");
const { sessionCookieName } = await import("../lib/session");
const { safeStaffNext, staffSignInHrefFor } = await import("../lib/staff-next");

function row(role: "super_admin" | "support_agent", fresh = true) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    sessionId: "sess00000000001",
    stepUpFresh: fresh,
    staffName: role === "super_admin" ? "Sam Admin" : "Mara Agent",
    staffEmailMasked: "s•••@example.test",
    createdAt: "2026-10-15T10:00:00.000Z",
  };
}

beforeEach(() => {
  resetStaffKit();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("staffCookieName", () => {
  it("is cds_staff in dev and __Host-cds_staff in production, never the member cookie", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(s.staffCookieName()).toBe("cds_staff");
    expect(s.staffCookieName()).not.toBe(sessionCookieName());
    vi.stubEnv("NODE_ENV", "production");
    expect(s.staffCookieName()).toBe("__Host-cds_staff");
    expect(s.staffCookieName()).not.toBe(sessionCookieName());
  });

  it("sets an httpOnly, SameSite=Strict, 12 h cookie (Secure in production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await s.setStaffCookie("tok");
    expect(kit.sets).toEqual([
      {
        name: "__Host-cds_staff",
        value: "tok",
        options: {
          httpOnly: true,
          sameSite: "strict",
          path: "/",
          secure: true,
          maxAge: 12 * 60 * 60,
        },
      },
    ]);
    await s.clearStaffCookie();
    expect(kit.deletes).toEqual(["__Host-cds_staff"]);
  });
});

describe("safeStaffNext", () => {
  it("accepts same-origin console paths only", () => {
    expect(safeStaffNext("/staff/tickets?tab=inbox")).toBe(
      "/staff/tickets?tab=inbox",
    );
    expect(safeStaffNext("/staff")).toBe("/staff");
    expect(safeStaffNext("/staff/sites/abc")).toBe("/staff/sites/abc");
  });

  it.each([
    "/hub",
    "//evil",
    "https://x",
    "/staff\\..",
    "/staff//evil.example",
    "/staffing",
    "/staff/%2f%2fevil",
    "/staff/../hub",
    "/staff/sign-in",
    "/staff/x\ny",
    "",
    null,
    42,
  ])("refuses %j", (v) => {
    expect(safeStaffNext(v)).toBeNull();
  });

  it("builds the sign-in link with next", () => {
    expect(staffSignInHrefFor("/staff/tickets/1042")).toBe(
      "/staff/sign-in?next=%2Fstaff%2Ftickets%2F1042",
    );
    expect(staffSignInHrefFor("/hub")).toBe("/staff/sign-in");
  });
});

describe("getStaffSession", () => {
  it("is null without a cookie and never reads the member cookie", async () => {
    kit.cookies.set("cds_session", "member-token");
    expect(await s.getStaffSession()).toBeNull();
    expect(db.readStaffSession).not.toHaveBeenCalled();
  });

  it("re-derives the session from the staff cookie with the client IP", async () => {
    kit.cookies.set("cds_staff", "staff-token");
    db.readStaffSession.mockResolvedValue(row("support_agent", false));
    const got = await s.getStaffSession();
    expect(db.readStaffSession).toHaveBeenCalledWith("staff-token", {
      ip: "203.0.113.21",
    });
    expect(got).toMatchObject({
      token: "staff-token",
      sessionId: "sess00000000001",
      stepUpFresh: false,
      name: "Mara Agent",
      role: "support_agent",
      maskedEmail: "s•••@example.test",
    });
  });

  it("treats Forbidden / NotFound as signed out and rethrows outages", async () => {
    kit.cookies.set("cds_staff", "staff-token");
    db.readStaffSession.mockRejectedValueOnce(new Forbidden("invalid session"));
    expect(await s.getStaffSession()).toBeNull();
    db.readStaffSession.mockRejectedValueOnce(new NotFound("gone"));
    expect(await s.getStaffSession()).toBeNull();
    db.readStaffSession.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(s.getStaffSession()).rejects.toThrow("fetch failed");
  });
});

describe("requireStaff / staffCan", () => {
  it("redirects a signed-out request to sign-in with next", async () => {
    kit.headers["x-cds-path"] = "/staff/tickets?tab=inbox";
    expect(await nextSignal(() => s.requireStaff("console"))).toBe(
      "NEXT_REDIRECT:/staff/sign-in?next=%2Fstaff%2Ftickets%3Ftab%3Dinbox",
    );
  });

  it("drops an unsafe path from next", async () => {
    kit.headers["x-cds-path"] = "//evil";
    expect(await nextSignal(() => s.requireStaff("console"))).toBe(
      "NEXT_REDIRECT:/staff/sign-in",
    );
  });

  it("404s an agent on a super-admin-only feature", async () => {
    kit.cookies.set("cds_staff", "staff-token");
    db.readStaffSession.mockResolvedValue(row("support_agent"));
    expect(await nextSignal(() => s.requireStaff("staff_roles"))).toBe(
      "NEXT_NOT_FOUND",
    );
  });

  it("returns the session when the role may use the feature", async () => {
    kit.cookies.set("cds_staff", "staff-token");
    db.readStaffSession.mockResolvedValue(row("super_admin"));
    await expect(s.requireStaff("staff_roles")).resolves.toMatchObject({
      role: "super_admin",
    });
  });

  it("staffCan follows STAFF_MATRIX and refuses unknown features and no role", () => {
    expect(s.staffCan("support_agent", "console")).toBe(true);
    expect(s.staffCan("support_agent", "prices_set")).toBe(false);
    expect(s.staffCan("super_admin", "prices_set")).toBe(true);
    expect(s.staffCan("super_admin", "no_such_feature")).toBe(false);
    expect(s.staffCan("", "console")).toBe(false);
    expect(s.staffCan(null, "console")).toBe(false);
  });
});
