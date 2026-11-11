// /hub index redirect (06-18 CONTEXT Area 3, RESEARCH Pitfall 15; 11-14 DASH-30, D312):
// intake and fit_review go to the setup overview; every other stage (ready_for_build,
// being_built, ready_for_review, live, an empty or unreadable stage) lands on Today.
// Moved here from hub-nav.test.ts by 11-14.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  agreementStatus: vi.fn(),
  orgContextFromToken: vi.fn(),
  listMemberOrganizations: vi.fn(),
}));
vi.mock("@cds/db", () => db);

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
}));

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const { default: HubIndex } = await import("../app/(platform)/hub/page");

describe("/hub index redirect (DASH-30, D312)", () => {
  const session = { ctx: { orgId: "org1", role: "owner", grants: [] } };
  async function go(
    stage: string,
    q: Record<string, string> = {},
    role = "owner",
  ) {
    sess.requireHubSession.mockResolvedValue({
      ctx: { ...session.ctx, role },
    });
    db.getOrgStage.mockResolvedValue({ stage, path: "standard" });
    await HubIndex({ searchParams: Promise.resolve(q) });
  }

  it("intake and fit_review go to /hub/setup", async () => {
    await expect(go("intake")).rejects.toThrow(/^REDIRECT:\/hub\/setup$/);
    await expect(go("fit_review")).rejects.toThrow(/^REDIRECT:\/hub\/setup$/);
  });

  it("C-WR-06: a Viewer (no business:read) goes to /hub/alerts during setup; an Editor to setup", async () => {
    await expect(go("intake", {}, "viewer")).rejects.toThrow(
      /^REDIRECT:\/hub\/alerts$/,
    );
    await expect(go("fit_review", {}, "viewer")).rejects.toThrow(
      /^REDIRECT:\/hub\/alerts$/,
    );
    await expect(go("intake", {}, "editor")).rejects.toThrow(
      /^REDIRECT:\/hub\/setup$/,
    );
  });

  it("every stage past fit_review, and an empty stage, goes to /hub/alerts", async () => {
    for (const stage of [
      "ready_for_build",
      "being_built",
      "ready_for_review",
      "live",
      "",
    ]) {
      await expect(go(stage)).rejects.toThrow(/^REDIRECT:\/hub\/alerts$/);
    }
  });

  it("keeps the query string", async () => {
    await expect(go("intake", { notice: "existing-owner" })).rejects.toThrow(
      "REDIRECT:/hub/setup?notice=existing-owner",
    );
    await expect(go("live", { notice: "existing-owner" })).rejects.toThrow(
      "REDIRECT:/hub/alerts?notice=existing-owner",
    );
  });

  it("09-19: an Admin with outdated terms lands with the terms-updated notice; nobody else", async () => {
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(go("live", {}, "admin")).rejects.toThrow(
      /^REDIRECT:\/hub\/alerts\?notice=terms-updated$/,
    );
    for (const role of ["editor", "viewer"]) {
      await expect(go("live", {}, role)).rejects.toThrow(
        /^REDIRECT:\/hub\/alerts$/,
      );
    }
    // A notice already in the query wins.
    await expect(
      go("live", { notice: "existing-owner" }, "admin"),
    ).rejects.toThrow("REDIRECT:/hub/alerts?notice=existing-owner");
    db.agreementStatus.mockResolvedValue({ state: "current" });
    await expect(go("live", {}, "admin")).rejects.toThrow(
      /^REDIRECT:\/hub\/alerts$/,
    );
  });

  it("09-19: a failed status read adds no notice and still lands", async () => {
    db.agreementStatus.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(go("live", {}, "admin")).rejects.toThrow(
      /^REDIRECT:\/hub\/alerts$/,
    );
    err.mockRestore();
  });

  it("an unreadable stage falls back to /hub/alerts", async () => {
    sess.requireHubSession.mockResolvedValue(session);
    db.getOrgStage.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      HubIndex({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/^REDIRECT:\/hub\/alerts$/);
    err.mockRestore();
  });
});
