// 07-29 Task 2: site-part history actions (CONT-36; T-07-29-01..03). The session and @cds/db
// are mocked; the real runAction maps refusals to copy. The org comes only from the session,
// and only an allowlisted part and a stamp-shaped version id reach the chokepoint.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const DEPS = { sections: { marker: "registry" } };
const V = "2026-09-28T14-14-00-000Z";
const ERR =
  "The restore didn't finish, so nothing changed. Try again in a minute.";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/content", () => ({ contentDeps: () => DEPS }));

const db = vi.hoisted(() => {
  class NotFound extends Error {
    code = "not_found";
  }
  return {
    listSiteSettingsVersions: vi.fn(),
    restoreSiteSettingsVersion: vi.fn(),
    restorePageVersion: vi.fn(),
    getPage: vi.fn(),
    listSections: vi.fn(),
    NotFound,
  };
});
vi.mock("@cds/db", () => db);

const a = await import("../app/actions/history");

beforeEach(() => {
  db.listSiteSettingsVersions.mockReset();
  db.restoreSiteSettingsVersion.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
});

describe("listSiteHistoryAction", () => {
  it("lists with the session's context and the part only", async () => {
    const rows = [{ id: V, at: "x", who: { kind: "earlier" }, current: true }];
    db.listSiteSettingsVersions.mockResolvedValue(rows);
    for (const part of ["nav", "footer", "banner", "settings"]) {
      expect(await a.listSiteHistoryAction(part)).toEqual({
        ok: true,
        data: rows,
      });
      expect(db.listSiteSettingsVersions).toHaveBeenLastCalledWith(CTX, part);
    }
  });

  it("refuses an unknown part before @cds/db", async () => {
    for (const bad of ["pages", "../x", 1, null, { part: "nav" }]) {
      expect(await a.listSiteHistoryAction(bad)).toEqual({
        ok: false,
        code: "invalid_input",
        message: ERR,
      });
    }
    expect(db.listSiteSettingsVersions).not.toHaveBeenCalled();
  });
});

describe("restoreSiteHistoryAction", () => {
  it("restores with the session's context and returns the result", async () => {
    const out = { part: "nav", value: { items: [] }, at: "x", dropped: 0 };
    db.restoreSiteSettingsVersion.mockResolvedValue(out);
    expect(await a.restoreSiteHistoryAction("nav", V)).toEqual({
      ok: true,
      data: out,
    });
    expect(db.restoreSiteSettingsVersion).toHaveBeenCalledWith(
      CTX,
      DEPS,
      "nav",
      V,
    );
  });

  it("refuses a bad part or version before @cds/db", async () => {
    for (const [part, v] of [
      ["pages", V],
      ["nav", "../x"],
      ["nav", "dev/tenants/org2/versions/site/nav/" + V + ".json"],
      ["nav", 5],
      ["nav", { id: V }],
    ] as const) {
      expect(await a.restoreSiteHistoryAction(part, v)).toEqual({
        ok: false,
        code: "invalid_input",
        message: ERR,
      });
    }
    expect(db.restoreSiteSettingsVersion).not.toHaveBeenCalled();
  });

  it("maps a db refusal through runAction", async () => {
    db.restoreSiteSettingsVersion.mockRejectedValue(new Error("boom"));
    const res = await a.restoreSiteHistoryAction("footer", V);
    expect(res.ok).toBe(false);
  });

  it("a signed-out caller never reaches @cds/db", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await a.restoreSiteHistoryAction("nav", V);
    expect(res.ok).toBe(false);
    expect(db.restoreSiteSettingsVersion).not.toHaveBeenCalled();
  });
});

describe("restorePageVersionAction refusals (review 11 WR-E04)", () => {
  const PAGE = "pageaaaaaaaaaa1";

  beforeEach(() => {
    db.restorePageVersion.mockReset();
    sess.agreementBlocks.mockReset();
  });

  it("an outdated Owner gets the re-accept copy, not 'try again'", async () => {
    sess.agreementBlocks.mockResolvedValue(true);
    const { AGREEMENT_GATE_COPY } = await import("../lib/agreement-gate");
    expect(await a.restorePageVersionAction(PAGE, V)).toEqual({
      ok: false,
      code: "agreement_required",
      message: AGREEMENT_GATE_COPY,
    });
    expect(db.restorePageVersion).not.toHaveBeenCalled();
  });

  it("a pruned version is not_found with its own copy", async () => {
    const { NotFound } = await import("@cds/core");
    db.restorePageVersion.mockRejectedValue(new NotFound());
    const res = await a.restorePageVersionAction(PAGE, V);
    expect(res).toMatchObject({ ok: false, code: "not_found" });
    expect((res as { message: string }).message).not.toBe(ERR);
  });

  it("a generic failure is still the short retry message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.restorePageVersion.mockRejectedValue(new Error("pb down"));
    expect(await a.restorePageVersionAction(PAGE, V)).toEqual({
      ok: false,
      code: "save_failed",
      message: ERR,
    });
    spy.mockRestore();
  });
});
