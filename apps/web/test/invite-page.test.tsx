// 11-38 Task 2: the /invite/<token> page states and the join action (UI-SPEC "Invite page",
// D-UI-P11-28; T-11-38-01, T-11-38-05). next/headers, next/cache, next/navigation and @cds/db
// are mocked; the real page, form, action and session modules run against them.
import { Forbidden, InvalidInput } from "@cds/core";
import { renderToStaticMarkup } from "react-dom/server";
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
  readInvite: vi.fn(),
  acceptInvite: vi.fn(),
  acceptInviteAsNewAccount: vi.fn(),
  listMemberOrganizations: vi.fn(),
  signInMember: vi.fn(),
  forgetPushDeviceForSession: vi.fn(),
}));
vi.mock("@cds/db", async () => {
  const { InvalidInput } = await import("@cds/core");
  class InviteRefused extends InvalidInput {
    readonly reason: string;
    readonly orgId: string | undefined;
    constructor(reason: string, message: string, orgId?: string) {
      super(message);
      this.reason = reason;
      this.orgId = orgId;
    }
  }
  return { ...db, linkSecret: () => "t".repeat(40), InviteRefused };
});
const { InviteRefused } = (await import("@cds/db")) as unknown as {
  InviteRefused: new (reason: string, message: string, orgId?: string) => Error;
};

const { default: InvitePage } =
  await import("../app/(platform)/invite/[token]/page");
const { joinInviteAction, signOutForInviteAction } =
  await import("../app/actions/invite");

const TOKEN = "A".repeat(43);
const ORG = "orgaaaaaaaaaaaa";

const PENDING = {
  orgName: "Rivera Bakery",
  inviterName: "Maria Rivera",
  role: "editor",
  email: "sam@example.com",
  expired: false,
  status: "pending",
  hasAccount: false,
};

async function render(token = TOKEN): Promise<string> {
  const el = await InvitePage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(el);
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1]!;
    throw err;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  revalidatePath.mockReset();
  for (const f of Object.values(db)) f.mockReset();
});

describe("invite page states", () => {
  it("unknown token: the link-doesn't-work state with no org name", async () => {
    db.readInvite.mockResolvedValue(null);
    const html = await render("nope");
    expect(html).toContain("This invite link doesn");
    expect(html).not.toContain("Rivera");
    expect(html).not.toContain("<form");
  });

  it("expired or used: INVITE-EXPIRED, no form", async () => {
    db.readInvite.mockResolvedValue({ ...PENDING, expired: true });
    let html = await render();
    expect(html).toContain("This invite has expired or was cancelled.");
    expect(html).toContain("Ask Maria Rivera to send a new one.");
    expect(html).not.toContain("<form");
    db.readInvite.mockResolvedValue({ ...PENDING, status: "accepted" });
    html = await render();
    expect(html).not.toContain("<form");
  });

  it("valid, signed out, no account: create-account form, email not a field", async () => {
    db.readInvite.mockResolvedValue(PENDING);
    const html = await render();
    expect(html).toContain("Join Rivera Bakery");
    expect(html).toContain(
      "Maria Rivera invited you to help with Rivera Bakery&#x27;s website as an Editor.",
    );
    expect(html).toContain("Your name");
    expect(html).toContain("At least 10 characters.");
    expect(html).toContain('value="create"');
    expect(html).not.toContain('name="email"');
  });

  it("valid, signed out, has account: sign in as the invited email", async () => {
    db.readInvite.mockResolvedValue({ ...PENDING, hasAccount: true });
    const html = await render();
    expect(html).toContain("Sign in as sam@example.com to accept.");
    expect(html).toContain("Sign in and join");
    expect(html).toContain('value="signin"');
    // WR-E02: an account with no password signs in by emailed code and comes back here.
    expect(html).toContain("Sign in with an emailed code");
    expect(html).toContain(
      `href="/sign-in?method=code&amp;next=${encodeURIComponent(`/invite/${TOKEN}`)}"`,
    );
  });

  it("signed in as the invited email: Join button", async () => {
    state.jar.set("cds_session", "tok");
    db.readInvite.mockResolvedValue({ ...PENDING, hasAccount: true });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "Sam@Example.com",
      organizations: [],
    });
    const html = await render();
    expect(html).toContain('value="join"');
    expect(html).not.toContain('name="password"');
  });

  it("signed in as someone else: wrong-account state with Sign out", async () => {
    state.jar.set("cds_session", "tok");
    db.readInvite.mockResolvedValue({ ...PENDING, hasAccount: true });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u2",
      email: "other@example.com",
      organizations: [],
    });
    const html = await render();
    expect(html).toContain("signed in as other@example.com");
    expect(html).toContain("Sign out");
    expect(html).not.toContain('value="join"');
  });
});

describe("joinInviteAction", () => {
  it("join: accepts as the session user, sets cds_org, lands on /hub/today", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "sam@example.com",
      organizations: [],
    });
    db.acceptInvite.mockResolvedValue({
      orgId: ORG,
      orgName: "Rivera Bakery",
      email: "sam@example.com",
    });
    const to = await redirectOf(
      joinInviteAction({ error: null }, form({ token: TOKEN, mode: "join" })),
    );
    expect(to).toBe("/hub/today?flash=joined");
    expect(db.acceptInvite).toHaveBeenCalledWith(
      TOKEN,
      { id: "u1", email: "sam@example.com" },
      expect.any(String),
    );
    expect(state.sets).toContainEqual({ name: "cds_org", value: ORG });
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("create: new account, signed in, cds_org set", async () => {
    db.acceptInviteAsNewAccount.mockResolvedValue({
      orgId: ORG,
      orgName: "Rivera Bakery",
      email: "sam@example.com",
    });
    db.signInMember.mockResolvedValue({ token: "fresh" });
    const to = await redirectOf(
      joinInviteAction(
        { error: null },
        form({
          token: TOKEN,
          mode: "create",
          name: "Sam",
          password: "long-enough-pw",
        }),
      ),
    );
    expect(to).toBe("/hub/today?flash=joined");
    expect(db.signInMember).toHaveBeenCalledWith(
      "sam@example.com",
      "long-enough-pw",
      expect.any(String),
    );
    expect(state.jar.get("cds_session")).toBe("fresh");
    expect(state.jar.get("cds_org")).toBe(ORG);
  });

  it("create: short password refused before any call", async () => {
    const res = await joinInviteAction(
      { error: null },
      form({ token: TOKEN, mode: "create", name: "Sam", password: "short" }),
    );
    expect(res.error).toMatch(/10 characters/);
    expect(db.acceptInviteAsNewAccount).not.toHaveBeenCalled();
  });

  it("refusals map to plain copy and write no cookie", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "x@example.com",
      organizations: [],
    });
    db.acceptInvite.mockRejectedValueOnce(new Forbidden("other email"));
    let res = await joinInviteAction(
      { error: null },
      form({ token: TOKEN, mode: "join" }),
    );
    expect(res.error).toMatch(/different email/);
    db.acceptInvite.mockRejectedValueOnce(new InvalidInput("used"));
    res = await joinInviteAction(
      { error: null },
      form({ token: TOKEN, mode: "join" }),
    );
    expect(res.error).toMatch(/expired or was cancelled/);
    res = await joinInviteAction(
      { error: null },
      form({ token: "bad", mode: "join" }),
    );
    expect(res.error).toMatch(/expired or was cancelled/);
    expect(state.sets.find((s) => s.name === "cds_org")).toBeUndefined();
  });

  it("refusals with a still-good invite get their own copy, not 'expired' (WR-E03)", async () => {
    const create = (name = "Sam", password = "long-enough-pw") =>
      joinInviteAction(
        { error: null },
        form({ token: TOKEN, mode: "create", name, password }),
      );
    db.acceptInviteAsNewAccount.mockRejectedValueOnce(
      new InviteRefused("account_exists", "exists"),
    );
    expect((await create()).error).toBe(
      "You already have an account. Reload this page and sign in to accept.",
    );
    db.acceptInviteAsNewAccount.mockRejectedValueOnce(
      new InviteRefused("name_too_long", "long"),
    );
    expect((await create()).error).toBe(
      "Use at most 80 characters for your name.",
    );
    db.acceptInviteAsNewAccount.mockRejectedValueOnce(
      new InviteRefused("password_too_long", "long"),
    );
    expect((await create()).error).toBe(
      "Use at most 72 characters for your password.",
    );
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "sam@example.com",
      organizations: [],
    });
    db.acceptInvite.mockRejectedValueOnce(new InviteRefused("staff", "staff"));
    const res = await joinInviteAction(
      { error: null },
      form({ token: TOKEN, mode: "join" }),
    );
    expect(res.error).toMatch(/CDS staff accounts can't join a site/);
    // A plain InvalidInput (used, revoked) is still the expired copy.
    db.acceptInvite.mockRejectedValueOnce(new InvalidInput("used"));
    expect(
      (
        await joinInviteAction(
          { error: null },
          form({ token: TOKEN, mode: "join" }),
        )
      ).error,
    ).toMatch(/expired or was cancelled/);
  });

  it("already a member: join and sign-in land in the site instead of an error (WR-E03)", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "sam@example.com",
      organizations: [],
    });
    db.acceptInvite.mockRejectedValueOnce(
      new InviteRefused("already_member", "member", ORG),
    );
    expect(
      await redirectOf(
        joinInviteAction({ error: null }, form({ token: TOKEN, mode: "join" })),
      ),
    ).toBe("/hub/today?flash=joined");
    expect(state.jar.get("cds_org")).toBe(ORG);

    state.jar.clear();
    db.readInvite.mockResolvedValue({ ...PENDING, hasAccount: true });
    db.signInMember.mockResolvedValue({ token: "fresh" });
    db.acceptInvite.mockRejectedValueOnce(
      new InviteRefused("already_member", "member", ORG),
    );
    expect(
      await redirectOf(
        joinInviteAction(
          { error: null },
          form({ token: TOKEN, mode: "signin", password: "long-enough-pw" }),
        ),
      ),
    ).toBe("/hub/today?flash=joined");
    expect(state.jar.get("cds_session")).toBe("fresh");
    expect(state.jar.get("cds_org")).toBe(ORG);
  });

  it("signin: wrong password is the sign-in copy", async () => {
    db.readInvite.mockResolvedValue({ ...PENDING, hasAccount: true });
    db.signInMember.mockRejectedValue(new Forbidden("invalid credentials"));
    const res = await joinInviteAction(
      { error: null },
      form({ token: TOKEN, mode: "signin", password: "nope-nope-nope" }),
    );
    expect(res.error).toMatch(/don't match/);
    expect(db.acceptInvite).not.toHaveBeenCalled();
  });

  it("sign out for invite returns to the same invite", async () => {
    state.jar.set("cds_session", "tok");
    const to = await redirectOf(signOutForInviteAction(form({ token: TOKEN })));
    expect(to).toBe(`/invite/${TOKEN}`);
    expect(state.jar.has("cds_session")).toBe(false);
  });

  it("sign out for invite forgets this browser's push device for the old session (WR-E01)", async () => {
    const EP = "https://fcm.googleapis.com/fcm/send/abc";
    state.jar.set("cds_session", "tok");
    db.forgetPushDeviceForSession.mockReset();
    db.forgetPushDeviceForSession.mockResolvedValue(1);
    const to = await redirectOf(
      signOutForInviteAction(form({ token: TOKEN, endpoint: EP })),
    );
    expect(to).toBe(`/invite/${TOKEN}`);
    expect(db.forgetPushDeviceForSession).toHaveBeenCalledWith("tok", EP);
  });
});
