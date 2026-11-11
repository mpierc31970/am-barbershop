// 03-11 Task 1: session cookie, session -> OrgContext bridge, action wrapper and sign-in
// (CONTEXT A2-Q2, RESEARCH Pattern 6, T-03-42/43/45/46). next/headers, next/navigation and
// @cds/db are mocked; the real session, action and sign-in modules run against them.
import {
  Forbidden,
  InvalidInput,
  MfaRequired,
  NotFound,
  RateLimited,
} from "@cds/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieOpts = Record<string, unknown>;

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; opts: CookieOpts }[],
  deletes: [] as unknown[],
  headers: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string, opts: CookieOpts) => {
      state.sets.push({ name, value, opts });
      state.jar.set(name, value);
    },
    delete: (arg: unknown) => {
      state.deletes.push(arg);
      const name =
        typeof arg === "string" ? arg : (arg as { name: string }).name;
      state.jar.delete(name);
    },
  }),
  headers: async () => new Headers(state.headers),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
}));

const db = vi.hoisted(() => ({
  signInMember: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  requestMemberCode: vi.fn(),
  completeMemberCode: vi.fn(),
  agreementStatus: vi.fn(),
  forgetPushDeviceForSession: vi.fn(),
}));
const LINK_SECRET = vi.hoisted(() => "t".repeat(40));
const COPY = vi.hoisted(() => ({
  ERR_CODE:
    "That code didn't match. Check the six digits and try again, or request a new one.",
  ERR_CODE_EXPIRED:
    "That code has expired. Codes last 5 minutes. Request a new one.",
  SUBMIT_RATE_COPY:
    "We've sent several codes to this address. Wait a minute, then try again.",
}));
vi.mock("@cds/db", async () => {
  const { CdsError } = await import("@cds/core");
  class SlugTaken extends CdsError {
    override readonly code = "slug_taken";
  }
  class SubmitCodeInvalid extends CdsError {
    override readonly code = "submit_code_invalid";
  }
  class SubmitCodeExpired extends CdsError {
    override readonly code = "submit_code_expired";
  }
  return {
    ...db,
    ...COPY,
    linkSecret: () => LINK_SECRET,
    SlugTaken,
    SubmitCodeInvalid,
    SubmitCodeExpired,
  };
});

const session = await import("../lib/session");
const { runAction, SESSION_EXPIRED_COPY, SAVE_FAILED_COPY } =
  await import("../lib/action");
const { AGREEMENT_GATE_COPY } = await import("../lib/agreement-gate");
const {
  signInAction,
  signOutAction,
  requestMemberCodeAction,
  completeMemberCodeAction,
} = await import("../app/actions/session");
const { encodePendingCode, decodePendingCode } =
  await import("../lib/submit-cookie");
const SubmitCodeInvalid = (
  (await import("@cds/db")) as unknown as Record<string, new () => Error>
).SubmitCodeInvalid!;
const { SlugTaken } = (await import("@cds/db")) as unknown as {
  SlugTaken: new (m: string) => Error;
};

const ORG = {
  id: "org1",
  name: "Palm Science",
  role: "owner",
  status: "active",
  primaryHost: "palm.example",
};
const SITE = { id: "org1", name: "Palm Science", primaryHost: "palm.example" };
const ORG2 = {
  id: "org2",
  name: "Other",
  role: "editor",
  status: "active",
  primaryHost: null,
};
const CTX = { orgId: "org1", actor: "u1", role: "owner" };

function form(email: string, password: string): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
}

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  state.deletes.length = 0;
  state.headers = {};
  db.signInMember.mockReset();
  db.forgetPushDeviceForSession.mockReset();
  db.listMemberOrganizations.mockReset();
  db.orgContextFromToken.mockReset();
  db.requestMemberCode.mockReset();
  db.completeMemberCode.mockReset();
  db.agreementStatus.mockReset();
  db.agreementStatus.mockResolvedValue({ state: "current" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session cookie (T-03-43)", () => {
  it("is cds_session outside production", () => {
    expect(session.sessionCookieName()).toBe("cds_session");
  });

  it("is __Host-cds_session in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(session.sessionCookieName()).toBe("__Host-cds_session");
  });

  it("is set httpOnly, SameSite=Lax, path /, not Secure in dev", async () => {
    await session.setSessionCookie("tok");
    expect(state.sets).toHaveLength(1);
    const { name, value, opts } = state.sets[0]!;
    expect(name).toBe("cds_session");
    expect(value).toBe("tok");
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(opts).not.toHaveProperty("domain");
  });

  it("is Secure and __Host- prefixed in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await session.setSessionCookie("tok");
    const { name, opts } = state.sets[0]!;
    expect(name).toBe("__Host-cds_session");
    expect(opts).toMatchObject({ httpOnly: true, secure: true, path: "/" });
  });

  it("clears the cookie", async () => {
    state.jar.set("cds_session", "tok");
    await session.clearSessionCookie();
    expect(state.jar.has("cds_session")).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the rightmost x-forwarded-for entry (1 trusted hop by default)", async () => {
    state.headers = { "x-forwarded-for": "203.0.113.9" };
    expect(await session.clientIp()).toBe("203.0.113.9");
  });

  it("ignores a spoofed leftmost entry (WR-B07)", async () => {
    state.headers = { "x-forwarded-for": " 6.6.6.6 , 203.0.113.9 " };
    expect(await session.clientIp()).toBe("203.0.113.9");
    state.headers = { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" };
    expect(await session.clientIp()).toBe("203.0.113.9");
  });

  it("honours TRUSTED_PROXY_HOPS for a longer proxy chain (WR-B07)", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    state.headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" };
    expect(await session.clientIp()).toBe("203.0.113.9");
  });

  it("treats a bad TRUSTED_PROXY_HOPS as 1 (WR-B07)", async () => {
    for (const v of ["0", "-1", "abc", "1.5"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", v);
      state.headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.9" };
      expect(await session.clientIp(), v).toBe("203.0.113.9");
    }
  });

  it("falls back to x-real-ip when the chain is shorter than the hops (WR-B07)", () => {
    const h = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "198.51.100.4",
    });
    expect(session.clientIpFrom(h, 2)).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip, then empty", async () => {
    state.headers = { "x-real-ip": "198.51.100.4" };
    expect(await session.clientIp()).toBe("198.51.100.4");
    state.headers = {};
    expect(await session.clientIp()).toBe("");
  });
});

describe("getHubSession (T-03-42)", () => {
  it("is null without a cookie and never calls the database", async () => {
    expect(await session.getHubSession()).toBeNull();
    expect(db.listMemberOrganizations).not.toHaveBeenCalled();
  });

  it("derives the OrgContext from the cookie and the first active site", async () => {
    state.jar.set("cds_session", "tok");
    state.headers = { "x-forwarded-for": "203.0.113.9" };
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "owner@palm.example",
      organizations: [ORG, ORG2],
    });
    db.orgContextFromToken.mockResolvedValue(CTX);
    const s = await session.getHubSession();
    expect(db.orgContextFromToken).toHaveBeenCalledWith(
      "tok",
      "org1",
      "203.0.113.9",
    );
    expect(s).toEqual({
      ctx: CTX,
      email: "owner@palm.example",
      org: SITE,
      orgs: [
        { id: "org1", name: "Palm Science", role: "owner" },
        { id: "org2", name: "Other", role: "editor" },
      ],
      staleOrg: false,
    });
  });

  it("11-11: a cds_org cookie naming one of the person's orgs selects it", async () => {
    state.jar.set("cds_session", "tok");
    state.jar.set("cds_org", "org2");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG, ORG2],
    });
    const ctx2 = { orgId: "org2", actor: "u1", role: "editor" };
    db.orgContextFromToken.mockResolvedValue(ctx2);
    const s = await session.getHubSession();
    expect(db.orgContextFromToken).toHaveBeenCalledTimes(1);
    expect(db.orgContextFromToken).toHaveBeenCalledWith("tok", "org2", "");
    expect(s?.ctx).toEqual(ctx2);
    expect(s?.org).toEqual({ id: "org2", name: "Other", primaryHost: null });
    expect(s?.staleOrg).toBe(false);
  });

  it("11-11: a foreign or stale cds_org falls back to the first org (staleOrg) and never reaches the foreign org", async () => {
    for (const bad of ["foreignorg12345", "", "../org2", "org1 "]) {
      state.jar.set("cds_session", "tok");
      state.jar.set("cds_org", bad);
      db.orgContextFromToken.mockReset();
      db.listMemberOrganizations.mockResolvedValue({
        userId: "u1",
        email: "a@b.c",
        organizations: [ORG, ORG2],
      });
      db.orgContextFromToken.mockResolvedValue(CTX);
      const s = await session.getHubSession();
      expect(db.orgContextFromToken, bad).toHaveBeenCalledTimes(1);
      expect(db.orgContextFromToken, bad).toHaveBeenCalledWith(
        "tok",
        "org1",
        "",
      );
      expect(s?.org.id, bad).toBe("org1");
      expect(s?.staleOrg, bad).toBe(bad !== "");
    }
    // No cookie write during render (choice 3).
    expect(state.sets).toHaveLength(0);
  });

  it("11-11: the org cookie is __Host-cds_org in production with the session cookie's flags", async () => {
    expect(session.orgCookieName()).toBe("cds_org");
    await session.setOrgCookie("org2");
    expect(state.sets[0]).toMatchObject({
      name: "cds_org",
      value: "org2",
      opts: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
        maxAge: 7 * 24 * 60 * 60,
      },
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(session.orgCookieName()).toBe("__Host-cds_org");
    await session.setOrgCookie("org2");
    expect(state.sets[1]).toMatchObject({
      name: "__Host-cds_org",
      opts: { httpOnly: true, secure: true, path: "/", sameSite: "lax" },
    });
    await session.clearOrgCookie();
    expect(state.jar.has("__Host-cds_org")).toBe(false);
  });

  it("is null when the database rejects the token (NotFound), without throwing", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockRejectedValue(new NotFound("not found"));
    expect(await session.getHubSession()).toBeNull();
  });

  it("is null when the membership check fails", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    db.orgContextFromToken.mockRejectedValue(new Forbidden("invalid session"));
    expect(await session.getHubSession()).toBeNull();
  });

  it("is null when the account has no active site", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [],
    });
    expect(await session.getHubSession()).toBeNull();
    expect(db.orgContextFromToken).not.toHaveBeenCalled();
  });

  it("rethrows an outage instead of treating it as a sign-out (WR-B01)", async () => {
    state.jar.set("cds_session", "tok");
    const outage = Object.assign(new Error("fetch failed"), { status: 0 });
    db.listMemberOrganizations.mockRejectedValue(outage);
    await expect(session.getHubSession()).rejects.toBe(outage);
  });

  it("rethrows a 5xx during the membership check (WR-B01)", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    const fivexx = Object.assign(new Error("Something went wrong."), {
      status: 503,
    });
    db.orgContextFromToken.mockRejectedValue(fivexx);
    await expect(session.getHubSession()).rejects.toBe(fivexx);
  });

  it("rethrows a CdsError that is not a token refusal (WR-B01)", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockRejectedValue(new RateLimited("slow"));
    await expect(session.getHubSession()).rejects.toBeInstanceOf(RateLimited);
  });

  it("requireHubSession redirects to /sign-in without a session", async () => {
    await expect(session.requireHubSession()).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });
});

describe("re-acceptance gate (AGR-07, CONTEXT A3-Q1, D216, D287)", () => {
  function signedInAs(ctx: Record<string, unknown>, path?: string) {
    state.jar.set("cds_session", "tok");
    if (path !== undefined) state.headers = { "x-cds-path": path };
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    db.orgContextFromToken.mockResolvedValue(ctx);
  }

  it("redirects an outdated owner to re-accept, keeping where they were going", async () => {
    signedInAs(CTX, "/hub/settings");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(session.requireHubSession()).rejects.toThrow(
      "REDIRECT:/hub/agreement?mode=reaccept&next=%2Fhub%2Fsettings",
    );
    expect(db.agreementStatus).toHaveBeenCalledWith(CTX);
  });

  it("uses /hub as next when the path header is missing", async () => {
    signedInAs(CTX);
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(session.requireHubSession()).rejects.toThrow(
      "REDIRECT:/hub/agreement?mode=reaccept&next=%2Fhub",
    );
  });

  it("lets a current or never-signed owner through", async () => {
    for (const st of ["current", "unsigned"]) {
      signedInAs(CTX, "/hub/settings");
      db.agreementStatus.mockResolvedValue({ state: st });
      const s = await session.requireHubSession();
      expect(s.ctx).toEqual(CTX);
    }
  });

  it("never redirects admins, editors or viewers", async () => {
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    for (const role of ["admin", "editor", "viewer"]) {
      signedInAs({ ...CTX, role }, "/hub/settings");
      await expect(session.requireHubSession()).resolves.toBeTruthy();
    }
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });

  it("never redirects impersonating staff (D287)", async () => {
    signedInAs({ ...CTX, impersonator: "staff1" }, "/hub/settings");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(session.requireHubSession()).resolves.toBeTruthy();
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });

  it("skips the gate with { agreementGate: false } and never reads the status", async () => {
    signedInAs(CTX, "/hub/settings");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(
      session.requireHubSession({ agreementGate: false }),
    ).resolves.toBeTruthy();
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });

  it("skips exempt paths (the agreement pages and download route)", async () => {
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    for (const p of [
      "/hub/agreement?mode=reaccept&next=%2Fhub",
      "/hub/agreement/signed/abc",
      "/hub/agreement/download/abc",
    ]) {
      signedInAs(CTX, p);
      await expect(session.requireHubSession()).resolves.toBeTruthy();
    }
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });

  it("only gates /hub paths", async () => {
    signedInAs(CTX, "/start/quote");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(session.requireHubSession()).resolves.toBeTruthy();
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });

  it("never locks the owner out when the status read fails (choice 4)", async () => {
    signedInAs(CTX, "/hub/settings");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.agreementStatus.mockRejectedValue(new Error("pb down"));
    await expect(session.requireHubSession()).resolves.toBeTruthy();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("WR-C02: gates hub Server Actions with a typed result, never a redirect", async () => {
    signedInAs(CTX, "/hub/website");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    const fn = vi.fn();
    const r = await runAction(fn);
    expect(r).toEqual({
      ok: false,
      code: "agreement_required",
      message: AGREEMENT_GATE_COPY,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("runAction on an exempt path (the signing screen) and for a current Owner runs fn", async () => {
    signedInAs(CTX, "/hub/agreement?mode=reaccept");
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    expect(await runAction(async () => 1)).toEqual({ ok: true, data: 1 });
    signedInAs(CTX, "/hub/website");
    db.agreementStatus.mockResolvedValue({ state: "current" });
    expect(await runAction(async () => 2)).toEqual({ ok: true, data: 2 });
  });

  it("runAction lets a non-owner and impersonating staff through", async () => {
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    signedInAs({ ...CTX, role: "editor" }, "/hub/website");
    expect(await runAction(async () => 1)).toEqual({ ok: true, data: 1 });
    signedInAs({ ...CTX, impersonator: "staff1" }, "/hub/website");
    expect(await runAction(async () => 2)).toEqual({ ok: true, data: 2 });
  });
});

describe("runAction (T-03-46)", () => {
  function signedIn() {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    db.orgContextFromToken.mockResolvedValue(CTX);
  }

  it("returns signed_out with the Session expired copy and never runs fn", async () => {
    const fn = vi.fn();
    const r = await runAction(fn);
    expect(r).toEqual({
      ok: false,
      code: "signed_out",
      message: SESSION_EXPIRED_COPY,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes the cookie-derived session to fn", async () => {
    signedIn();
    const r = await runAction(async (s) => s.ctx);
    expect(r).toEqual({ ok: true, data: CTX });
  });

  it("maps SlugTaken to slug_taken with the UI-SPEC copy on the slug field", async () => {
    signedIn();
    const r = await runAction(async () => {
      throw new SlugTaken("Another page already uses /about. Try /about-2.");
    });
    expect(r).toEqual({
      ok: false,
      code: "slug_taken",
      message: "Another page already uses /about. Try /about-2.",
      field: "slug",
    });
  });

  it("never returns raw database error text", async () => {
    signedIn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAction(async () => {
      throw new Error("ClientResponseError 400: Failed to create record.");
    });
    spy.mockRestore();
    expect(r).toEqual({
      ok: false,
      code: "save_failed",
      message: SAVE_FAILED_COPY,
    });
    expect(JSON.stringify(r)).not.toContain("ClientResponseError");
  });

  it("maps forbidden and not_found to fixed copy", async () => {
    signedIn();
    const f = await runAction(async () => {
      throw new Forbidden("forbidden: content write");
    });
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.code).toBe("forbidden");
      expect(f.message).not.toContain("content write");
    }
    const n = await runAction(async () => {
      throw new NotFound("not found");
    });
    expect(n.ok === false && n.code).toBe("not_found");
  });

  it("returns save_failed, not a rejection or signed_out, on a session outage (WR-B02)", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockRejectedValue(new Error("fetch failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn();
    const r = await runAction(fn);
    spy.mockRestore();
    expect(r).toEqual({
      ok: false,
      code: "save_failed",
      message: SAVE_FAILED_COPY,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("rethrows Next redirects instead of swallowing them", async () => {
    signedIn();
    await expect(
      runAction(async () => {
        throw Object.assign(new Error("r"), { digest: "NEXT_REDIRECT;x" });
      }),
    ).rejects.toThrow("r");
  });
});

describe("signInAction (T-03-45, T-03-47)", () => {
  const initial = { error: null };

  it("maps Forbidden to the wrong-credentials copy", async () => {
    db.signInMember.mockRejectedValue(new Forbidden("invalid credentials"));
    const r = await signInAction(initial, form("a@b.c", "nope"));
    expect(r.error).toBe(
      "That email and password don't match. Check both and try again.",
    );
    expect(state.sets).toHaveLength(0);
  });

  it("maps RateLimited to the wait copy", async () => {
    db.signInMember.mockRejectedValue(new RateLimited("slow down"));
    const r = await signInAction(initial, form("a@b.c", "x"));
    expect(r.error).toBe("Too many attempts. Wait 15 minutes, then try again.");
  });

  it("shows the no-site copy for staff (MfaRequired) and sets no cookie", async () => {
    db.signInMember.mockRejectedValue(new MfaRequired("staff"));
    const r = await signInAction(initial, form("staff@cds", "x"));
    expect(r.error).toBe(
      "This account isn't linked to an active site. Ask the site owner to invite you.",
    );
    expect(state.sets).toHaveLength(0);
  });

  it("shows the no-site copy when the account has no active site, no cookie", async () => {
    db.signInMember.mockResolvedValue({ token: "tok" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [],
    });
    const r = await signInAction(initial, form("a@b.c", "pw"));
    expect(r.error).toBe(
      "This account isn't linked to an active site. Ask the site owner to invite you.",
    );
    expect(state.sets).toHaveLength(0);
  });

  it("passes the real client IP to signInMember (rate limits)", async () => {
    state.headers = { "x-forwarded-for": "203.0.113.9" };
    db.signInMember.mockRejectedValue(new Forbidden("x"));
    await signInAction(initial, form(" a@b.c ", "pw"));
    expect(db.signInMember).toHaveBeenCalledWith("a@b.c", "pw", "203.0.113.9");
  });

  it("shows the unavailable copy, not no-site, when the site lookup has an outage (WR-B01)", async () => {
    db.signInMember.mockResolvedValue({ token: "tok" });
    db.listMemberOrganizations.mockRejectedValue(new Error("fetch failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await signInAction(initial, form("a@b.c", "pw"));
    spy.mockRestore();
    expect(r.error).toBe(
      "We couldn't sign you in just now. Wait a minute, then try again.",
    );
    expect(state.sets).toHaveLength(0);
  });

  it("rejects a missing password without calling the database", async () => {
    const r = await signInAction(initial, form("a@b.c", ""));
    expect(r.error).toBe(
      "That email and password don't match. Check both and try again.",
    );
    expect(db.signInMember).not.toHaveBeenCalled();
  });

  it("returns to a validated invite after sign-in, never anywhere else (WR-E02)", async () => {
    const INVITE = `/invite/${"A".repeat(43)}`;
    db.signInMember.mockResolvedValue({ token: "tok" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    const withNext = (next: string) => {
      const f = form("a@b.c", "pw");
      f.set("next", next);
      return f;
    };
    await expect(signInAction(initial, withNext(INVITE))).rejects.toThrow(
      `REDIRECT:${INVITE}`,
    );
    for (const bad of [
      "https://evil.example/invite/x",
      "//evil.example",
      "/hub/settings",
      `/invite/${"A".repeat(42)}`,
      `${INVITE}?x=1`,
    ]) {
      await expect(signInAction(initial, withNext(bad))).rejects.toThrow(
        /^REDIRECT:\/hub$/,
      );
    }
  });

  it("sets the cookie and redirects to /hub on success (06-18 routes by stage)", async () => {
    db.signInMember.mockResolvedValue({ token: "tok" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    await expect(signInAction(initial, form("a@b.c", "pw"))).rejects.toThrow(
      /^REDIRECT:\/hub$/,
    );
    const sessionSets = state.sets.filter((s) => s.name === "cds_session");
    expect(sessionSets).toHaveLength(1);
    expect(sessionSets[0]!.value).toBe("tok");
    // AGR-03 evidence: how the signer authenticated (Pitfall 9).
    expect(state.jar.get("cds_auth_method")).toMatch(/^password[.]/);
    expect(await session.readAuthMethod()).toBe("password");
  });

  it("signOutAction clears the cookies (cds_org too, 11-11) and redirects to /sign-in", async () => {
    state.jar.set("cds_session", "tok");
    state.jar.set("cds_auth_method", "password");
    state.jar.set("cds_org", "org2");
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/sign-in");
    expect(state.jar.has("cds_session")).toBe(false);
    expect(state.jar.has("cds_auth_method")).toBe(false);
    expect(state.jar.has("cds_org")).toBe(false);
  });

  it("signOutAction forgets this browser's push device for the session first (WR-E01)", async () => {
    const EP = "https://fcm.googleapis.com/fcm/send/abc";
    state.jar.set("cds_session", "tok");
    db.forgetPushDeviceForSession.mockImplementation(async () => {
      // The session cookie is still there while the device is forgotten.
      expect(state.jar.get("cds_session")).toBe("tok");
      return 1;
    });
    await expect(signOutAction(EP)).rejects.toThrow("REDIRECT:/sign-in");
    expect(db.forgetPushDeviceForSession).toHaveBeenCalledWith("tok", EP);
    expect(state.jar.has("cds_session")).toBe(false);
  });

  it("signOutAction still signs out when forgetting the device fails, or there is none (WR-E01)", async () => {
    state.jar.set("cds_session", "tok");
    db.forgetPushDeviceForSession.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      signOutAction("https://fcm.googleapis.com/fcm/send/x"),
    ).rejects.toThrow("REDIRECT:/sign-in");
    expect(state.jar.has("cds_session")).toBe(false);
    expect(err).toHaveBeenCalledWith(
      "[sign-out] push device not forgotten",
      "Error",
    );
    err.mockRestore();
    db.forgetPushDeviceForSession.mockClear();
    state.jar.set("cds_session", "tok");
    // A plain form post (FormData with no endpoint) and no endpoint at all: nothing to do.
    await expect(signOutAction(new FormData())).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/sign-in");
    expect(db.forgetPushDeviceForSession).not.toHaveBeenCalled();
  });

  it("signOutAction is not gated by the re-accept gate", async () => {
    state.jar.set("cds_session", "tok");
    state.jar.set("cds_auth_method", "otp");
    state.headers = { "x-cds-path": "/hub/settings" };
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    db.orgContextFromToken.mockResolvedValue(CTX);
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    await expect(signOutAction()).rejects.toThrow(/^REDIRECT:\/sign-in$/);
    expect(state.jar.has("cds_session")).toBe(false);
    expect(state.jar.has("cds_auth_method")).toBe(false);
    expect(db.agreementStatus).not.toHaveBeenCalled();
  });
});

describe("auth-method cookie (AGR-03 evidence, RESEARCH Pitfall 9)", () => {
  it("mirrors the session cookie's flags in dev and is signed", async () => {
    await session.setAuthMethodCookie("otp", "tok");
    const { name, value, opts } = state.sets[0]!;
    expect(name).toBe("cds_auth_method");
    expect(value).toMatch(/^otp\.[A-Za-z0-9_-]{43}$/);
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 7 * 24 * 60 * 60,
    });
  });

  it("is __Host- prefixed and Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await session.setAuthMethodCookie("password", "tok");
    const { name, opts } = state.sets[0]!;
    expect(name).toBe("__Host-cds_auth_method");
    expect(opts).toMatchObject({ httpOnly: true, secure: true, path: "/" });
  });

  it("reads a value signed for this session, else unknown", async () => {
    expect(await session.readAuthMethod()).toBe("unknown");
    state.jar.set("cds_session", "tok");
    await session.setAuthMethodCookie("otp", "tok");
    expect(await session.readAuthMethod()).toBe("otp");
    await session.setAuthMethodCookie("password", "tok");
    expect(await session.readAuthMethod()).toBe("password");
  });

  it("CR-C01: a forged, unsigned or edited value reads as unknown", async () => {
    state.jar.set("cds_session", "tok");
    // The pre-fix plain values a signer could type in devtools.
    state.jar.set("cds_auth_method", "otp");
    expect(await session.readAuthMethod()).toBe("unknown");
    state.jar.set("cds_auth_method", "password");
    expect(await session.readAuthMethod()).toBe("unknown");
    state.jar.set("cds_auth_method", "sso");
    expect(await session.readAuthMethod()).toBe("unknown");
    // Swapping the method on a real signed value breaks the MAC.
    await session.setAuthMethodCookie("password", "tok");
    const sig = state.jar.get("cds_auth_method")!.split(".")[1];
    state.jar.set("cds_auth_method", `otp.${sig}`);
    expect(await session.readAuthMethod()).toBe("unknown");
  });

  it("CR-C01: a value from another session (or a left-over login) reads as unknown", async () => {
    await session.setAuthMethodCookie("otp", "old-token");
    state.jar.set("cds_session", "new-token");
    expect(await session.readAuthMethod()).toBe("unknown");
  });

  it("a missing session token reads as unknown even with a signed value", async () => {
    await session.setAuthMethodCookie("otp", "tok");
    expect(await session.readAuthMethod()).toBe("unknown");
  });

  it("clears", async () => {
    state.jar.set("cds_auth_method", "otp");
    await session.clearAuthMethodCookie();
    expect(state.jar.has("cds_auth_method")).toBe(false);
  });
});

describe("sign in with an emailed code (D-UI-P6-3, T-06-82)", () => {
  const EMAIL_STEP = { step: "email" as const, email: "", error: null };
  const CODE_STEP = { step: "code" as const, email: "a@b.c", error: null };

  function emailForm(email: string): FormData {
    const f = new FormData();
    f.set("email", email);
    f.set("organization", "orgX"); // ignored: allow-listed fields only
    return f;
  }
  function codeForm(code: string): FormData {
    const f = new FormData();
    f.set("code", code);
    return f;
  }
  function pending(otpId = "otp1", email = "a@b.c") {
    state.jar.set("cds_signin_code", encodePendingCode({ otpId, email }));
  }

  it("requests a code without creating a user and stores the otpId", async () => {
    state.headers = { "x-forwarded-for": "198.51.100.7" };
    db.requestMemberCode.mockResolvedValue({ otpId: "otp42" });
    const r = await requestMemberCodeAction(EMAIL_STEP, emailForm(" a@b.c "));
    expect(r).toEqual({ step: "code", email: "a@b.c", error: null });
    expect(db.requestMemberCode).toHaveBeenCalledWith("a@b.c", "198.51.100.7");
    expect(db.signInMember).not.toHaveBeenCalled();
    const set = state.sets.find((s) => s.name === "cds_signin_code")!;
    expect(set.opts).toMatchObject({ httpOnly: true, sameSite: "strict" });
    expect(decodePendingCode(set.value)).toEqual({
      otpId: "otp42",
      email: "a@b.c",
    });
  });

  it("maps a bad address to ERR-EMAIL and RateLimited to ERR-CODE-RATE", async () => {
    db.requestMemberCode.mockRejectedValueOnce(
      new InvalidInput(
        "That doesn't look like an email address. Check it and try again.",
      ),
    );
    const bad = await requestMemberCodeAction(EMAIL_STEP, emailForm("nope"));
    expect(bad.step).toBe("email");
    expect(bad.error).toBe(
      "That doesn't look like an email address. Check it and try again.",
    );
    db.requestMemberCode.mockRejectedValue(
      new RateLimited(COPY.SUBMIT_RATE_COPY),
    );
    const limited = await requestMemberCodeAction(
      EMAIL_STEP,
      emailForm("a@b.c"),
    );
    expect(limited.error).toBe(COPY.SUBMIT_RATE_COPY);
  });

  it("signs in with a good code: session cookie, then /hub", async () => {
    pending();
    db.completeMemberCode.mockResolvedValue({ token: "codetok" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [ORG],
    });
    await expect(
      completeMemberCodeAction(CODE_STEP, codeForm("123456")),
    ).rejects.toThrow("REDIRECT:/hub");
    expect(db.completeMemberCode).toHaveBeenCalledWith({
      otpId: "otp1",
      code: "123456",
      ip: "",
    });
    expect(state.jar.get("cds_session")).toBe("codetok");
    expect(state.jar.has("cds_signin_code")).toBe(false);
    expect(state.jar.get("cds_auth_method")).toMatch(/^otp[.]/);
    expect(await session.readAuthMethod()).toBe("otp");
  });

  it("maps SubmitCodeInvalid to ERR-CODE and RateLimited to ERR-CODE-RATE", async () => {
    pending();
    db.completeMemberCode.mockRejectedValueOnce(new SubmitCodeInvalid());
    const wrong = await completeMemberCodeAction(CODE_STEP, codeForm("123456"));
    expect(wrong).toEqual({
      step: "code",
      email: "a@b.c",
      error: COPY.ERR_CODE,
    });
    db.completeMemberCode.mockRejectedValueOnce(
      new RateLimited(COPY.SUBMIT_RATE_COPY),
    );
    const limited = await completeMemberCodeAction(
      CODE_STEP,
      codeForm("123456"),
    );
    expect(limited.error).toBe(COPY.SUBMIT_RATE_COPY);
    expect(state.jar.has("cds_session")).toBe(false);
  });

  it("sets no cookie for an account with no active site", async () => {
    pending();
    db.completeMemberCode.mockResolvedValue({ token: "t" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [],
    });
    const r = await completeMemberCodeAction(CODE_STEP, codeForm("123456"));
    expect(r.error).toBe(
      "This account isn't linked to an active site. Ask the site owner to invite you.",
    );
    expect(state.jar.has("cds_session")).toBe(false);
    expect(state.jar.has("cds_auth_method")).toBe(false);
  });

  it("treats a missing pending cookie as expired, never calling the database", async () => {
    const r = await completeMemberCodeAction(CODE_STEP, codeForm("123456"));
    expect(r.error).toBe(COPY.ERR_CODE_EXPIRED);
    expect(db.completeMemberCode).not.toHaveBeenCalled();
  });
});
