// 11-11 Task 2: switchOrgAction (DASH-18, D286; T-11-11-01, T-11-11-02). next/headers,
// next/cache, next/navigation and @cds/db are mocked the way session.test.ts does; the real
// action and session modules run against them.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      state.sets.push({ name, value });
      state.jar.set(name, value);
    },
    delete: (arg: unknown) => {
      const name =
        typeof arg === "string" ? arg : (arg as { name: string }).name;
      state.jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
}));
vi.mock("@cds/db", async () => {
  const { CdsError } = await import("@cds/core");
  class SubmitCodeInvalid extends CdsError {
    override readonly code = "submit_code_invalid";
  }
  class SubmitCodeExpired extends CdsError {
    override readonly code = "submit_code_expired";
  }
  return {
    ...db,
    signInMember: vi.fn(),
    requestMemberCode: vi.fn(),
    completeMemberCode: vi.fn(),
    linkSecret: () => "t".repeat(40),
    ERR_CODE: "code",
    ERR_CODE_EXPIRED: "expired",
    SUBMIT_RATE_COPY: "rate",
    SubmitCodeInvalid,
    SubmitCodeExpired,
  };
});

const { switchOrgAction } = await import("../app/actions/session");

const A = "aaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbb";
const FOREIGN = "fffffffffffffff";

function member(): void {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "a@b.c",
    organizations: [
      { id: A, name: "A", role: "owner", status: "active", primaryHost: null },
      { id: B, name: "B", role: "editor", status: "active", primaryHost: null },
    ],
  });
}

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  revalidatePath.mockReset();
  db.listMemberOrganizations.mockReset();
  db.orgContextFromToken.mockReset();
});

describe("switchOrgAction (DASH-18)", () => {
  it("switches to a member org: cookie set, hub layout revalidated, lands on Today", async () => {
    member();
    await expect(switchOrgAction(B)).rejects.toThrow(
      /^REDIRECT:\/hub\/today\?flash=switched$/,
    );
    expect(db.listMemberOrganizations).toHaveBeenCalledWith("tok");
    expect(state.jar.get("cds_org")).toBe(B);
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("refuses a foreign org with { ok: false } and leaves the cookie untouched", async () => {
    member();
    state.jar.set("cds_org", A);
    expect(await switchOrgAction(FOREIGN)).toEqual({ ok: false });
    expect(state.jar.get("cds_org")).toBe(A);
    expect(state.sets).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without calling the database", async () => {
    member();
    for (const bad of [
      "",
      "short",
      "AAAAAAAAAAAAAAA",
      `${A} `,
      "../aaaaaaaaaaaa",
      42,
      null,
      { id: A },
    ]) {
      expect(await switchOrgAction(bad), String(bad)).toEqual({ ok: false });
    }
    expect(db.listMemberOrganizations).not.toHaveBeenCalled();
    expect(state.sets).toHaveLength(0);
  });

  it("refuses without a session", async () => {
    expect(await switchOrgAction(A)).toEqual({ ok: false });
    expect(db.listMemberOrganizations).not.toHaveBeenCalled();
    expect(state.sets).toHaveLength(0);
  });

  it("refuses when the token is rejected or the lookup fails, with no detail", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockRejectedValueOnce(new Forbidden("invalid"));
    expect(await switchOrgAction(A)).toEqual({ ok: false });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listMemberOrganizations.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await switchOrgAction(A)).toEqual({ ok: false });
    spy.mockRestore();
    expect(state.sets).toHaveLength(0);
  });
});
