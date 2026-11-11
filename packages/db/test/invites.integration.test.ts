// 11-38 (DASH-22, DASH-27, DASH-36; D285, D-UI-P11-21, D-UI-P11-28): owner-only people
// management and email invites on the real PocketBase 0.39.11 binary. Covers the hashed
// single-use token, the 7-day expiry, the invited-email binding, staff refusal (invariant 10),
// the 10-per-hour send limit and the owner checks (Pitfall 4).
import { createHash } from "node:crypto";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  RateLimited,
} from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import {
  acceptInvite,
  acceptInviteAsNewAccount,
  changeMemberRole,
  inviteMember,
  InviteExists,
  InviteRefused,
  listInvites,
  listPeople,
  readInvite,
  removePerson,
  resendInvite,
  revokeInvite,
  setMemberGrants,
} from "../src/people";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const DAY = 86_400_000;

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function ctx(
  orgId: string,
  actor: string,
  role: OrgContext["role"],
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

async function newUser(
  email: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return (
    await pb
      .collection("users")
      .create({ email, password, passwordConfirm: password, ...extra })
  ).id;
}

async function newOrgWithOwner(
  slug: string,
): Promise<{ org: string; owner: string; ctx: OrgContext }> {
  const org = (
    await pb
      .collection("organizations")
      .create({ name: `Org ${slug}`, slug, status: "active" })
  ).id;
  const owner = await newUser(`owner-${slug}@cds.test`, { name: "Maria" });
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  return { org, owner, ctx: ctx(org, owner, "owner") };
}

/** The raw token from the logged invite email's /invite/<token> link. */
function tokenFrom(text: string): string {
  const m = /\/invite\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error("no invite link in the email");
  return m[1]!;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
});

describe("inviteMember", () => {
  it("owner invites an editor: pending row, emailed link, only the sha256 stored", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-a");
    const transport = captureTransport();
    const { inviteId } = await inviteMember(
      o.ctx,
      { email: " Editor@X.test ", role: "editor", grants: [] },
      { transport },
    );
    const row = await pb.collection("member_invites").getOne(inviteId);
    expect(row.email).toBe("editor@x.test");
    expect(row.status).toBe("pending");
    expect(row.role).toBe("editor");
    expect(row.invited_by).toBe(o.owner);
    const exp = new Date(String(row.expires_at)).getTime();
    expect(exp - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect(exp - Date.now()).toBeLessThan(7.1 * DAY);

    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0]!;
    expect(mail.to).toBe("editor@x.test");
    const token = tokenFrom(mail.text);
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );

    const audit = await pb.collection("audit_log").getFirstListItem(
      pb.filter("action = 'member.invited' && target_id = {:id}", {
        id: inviteId,
      }),
    );
    expect(audit.organization).toBe(o.org);
    expect(JSON.stringify(audit.meta)).not.toContain(token);
  });

  it("admin invite is Forbidden; impersonating owner is ImpersonationDenied", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-b");
    const admin = await newUser("admin-inv-b@cds.test");
    const input = { email: "x@x.test", role: "viewer" as const, grants: [] };
    await expect(
      inviteMember(ctx(o.org, admin, "admin"), input, {
        transport: captureTransport(),
      }),
    ).rejects.toThrow(Forbidden);
    await expect(
      inviteMember(ctx(o.org, o.owner, "owner", "staffuser12345"), input, {
        transport: captureTransport(),
      }),
    ).rejects.toThrow(ImpersonationDenied);
  });

  it("refuses staff, an existing member, owner role, bad email and the 11th send in an hour", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-c");
    const transport = captureTransport();
    await newUser("staff-inv@cds.test", { staff_role: "support_agent" });
    await expect(
      inviteMember(
        o.ctx,
        { email: "staff-inv@cds.test", role: "editor", grants: [] },
        { transport },
      ),
    ).rejects.toThrow(InvalidInput);
    await expect(
      inviteMember(
        o.ctx,
        { email: "owner-inv-c@cds.test", role: "editor", grants: [] },
        { transport },
      ),
    ).rejects.toThrow(InviteExists);
    await expect(
      inviteMember(
        o.ctx,
        { email: "y@x.test", role: "owner" as never, grants: [] },
        { transport },
      ),
    ).rejects.toThrow(InvalidInput);
    await expect(
      inviteMember(
        o.ctx,
        { email: "not-an-email", role: "viewer", grants: [] },
        { transport },
      ),
    ).rejects.toThrow(InvalidInput);

    for (let i = 0; i < 10; i++) {
      await inviteMember(
        o.ctx,
        { email: `p${i}@x.test`, role: "viewer", grants: [] },
        { transport },
      );
    }
    await expect(
      inviteMember(
        o.ctx,
        { email: "p10@x.test", role: "viewer", grants: [] },
        { transport },
      ),
    ).rejects.toThrow(RateLimited);
    // A second pending invite to the same address is refused too.
    const o2 = await newOrgWithOwner("inv-c2");
    await inviteMember(
      o2.ctx,
      { email: "dup@x.test", role: "viewer", grants: [] },
      { transport },
    );
    await expect(
      inviteMember(
        o2.ctx,
        { email: "DUP@x.test", role: "viewer", grants: [] },
        { transport },
      ),
    ).rejects.toThrow(InviteExists);
  });
});

describe("readInvite / acceptInvite", () => {
  it("readInvite shows only org name, inviter, role, email; unknown token is null", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-d");
    const transport = captureTransport();
    await inviteMember(
      o.ctx,
      { email: "read@x.test", role: "editor", grants: [] },
      { transport },
    );
    const token = tokenFrom(transport.sent[0]!.text);
    const info = await readInvite(token);
    expect(info).toEqual({
      orgName: "Org inv-d",
      inviterName: "Maria",
      role: "editor",
      email: "read@x.test",
      expired: false,
      status: "pending",
      hasAccount: false,
    });
    expect(await readInvite("nope")).toBeNull();
    expect(await readInvite("A".repeat(43))).toBeNull();
  });

  it("matching user joins as editor once; second accept, wrong email and expired are refused", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-e");
    const transport = captureTransport();
    const joiner = await newUser("joiner@x.test");
    const other = await newUser("other@x.test");
    await inviteMember(
      o.ctx,
      { email: "joiner@x.test", role: "editor", grants: ["events"] },
      { transport },
    );
    const token = tokenFrom(transport.sent[0]!.text);
    expect((await readInvite(token))?.hasAccount).toBe(true);

    await expect(
      acceptInvite(token, { id: other, email: "other@x.test" }),
    ).rejects.toThrow(Forbidden);

    const res = await acceptInvite(token, {
      id: joiner,
      email: "JOINER@x.test",
    });
    expect(res.orgId).toBe(o.org);
    const m = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: joiner,
        o: o.org,
      }),
    );
    expect(m.role).toBe("editor");
    expect(m.addon_grants).toEqual(["events"]);
    const inv = await pb
      .collection("member_invites")
      .getFirstListItem(pb.filter("email = 'joiner@x.test'"));
    expect(inv.status).toBe("accepted");
    expect(inv.accepted_by).toBe(joiner);
    await pb.collection("audit_log").getFirstListItem(
      pb.filter("action = 'member.joined' && organization = {:o}", {
        o: o.org,
      }),
    );

    await expect(
      acceptInvite(token, { id: joiner, email: "joiner@x.test" }),
    ).rejects.toThrow(InvalidInput);
    expect((await readInvite(token))?.status).toBe("accepted");

    // Expired: an invite whose expires_at is 8 days old.
    await inviteMember(
      o.ctx,
      { email: "late@x.test", role: "viewer", grants: [] },
      { transport },
    );
    const late = await newUser("late@x.test");
    const lateToken = tokenFrom(transport.sent[1]!.text);
    const lateRow = await pb
      .collection("member_invites")
      .getFirstListItem(pb.filter("email = 'late@x.test'"));
    await pb.collection("member_invites").update(lateRow.id, {
      expires_at: new Date(Date.now() - 1 * DAY).toISOString(),
      created: new Date(Date.now() - 8 * DAY).toISOString(),
    });
    expect((await readInvite(lateToken))?.expired).toBe(true);
    await expect(
      acceptInvite(lateToken, { id: late, email: "late@x.test" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("a staff account cannot accept even if the email matches", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-f");
    const transport = captureTransport();
    await inviteMember(
      o.ctx,
      { email: "later-staff@x.test", role: "viewer", grants: [] },
      { transport },
    );
    const staff = await newUser("later-staff@x.test", {
      staff_role: "support_agent",
    });
    const err = await acceptInvite(tokenFrom(transport.sent[0]!.text), {
      id: staff,
      email: "later-staff@x.test",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as InviteRefused).reason).toBe("staff");
  });

  it("refusals with a good invite say why: already a member, account exists, field limits (WR-E03)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-e03");
    const transport = captureTransport();
    const member = await newUser("already@x.test");
    await pb
      .collection("memberships")
      .create({ user: member, organization: o.org, role: "viewer" });
    // Invited before they were added by other means (e.g. staff).
    await pb.collection("member_invites").create({
      organization: o.org,
      email: "already@x.test",
      role: "editor",
      grants: [],
      token_hash: "a".repeat(64),
      expires_at: new Date(Date.now() + DAY).toISOString(),
      status: "pending",
    });
    await inviteMember(
      o.ctx,
      { email: "has-account@x.test", role: "viewer", grants: [] },
      { transport },
    );
    const token = tokenFrom(transport.sent[0]!.text);
    // The account appears after the page said "no account" (another tab, a sign-up).
    await newUser("has-account@x.test");
    const exists = await acceptInviteAsNewAccount(
      token,
      { name: "Sam", password: "long-enough-pw" },
      IP,
    ).catch((e: unknown) => e);
    expect(exists).toBeInstanceOf(InviteRefused);
    expect((exists as InviteRefused).reason).toBe("account_exists");
    for (const [input, reason] of [
      [{ name: "x".repeat(81), password: "long-enough-pw" }, "name_too_long"],
      [{ name: "Sam", password: "x".repeat(73) }, "password_too_long"],
      [{ name: "Sam", password: "short" }, "password_too_short"],
    ] as const) {
      const e = await acceptInviteAsNewAccount(token, input, IP).catch(
        (x: unknown) => x,
      );
      expect((e as InviteRefused).reason).toBe(reason);
    }

    // Already a member: refused with the org id so the page can just go there.
    const created = await pb
      .collection("member_invites")
      .getFirstListItem(pb.filter("email = 'already@x.test'"));
    const { createHash } = await import("node:crypto");
    const raw = "B".repeat(43);
    await pb.collection("member_invites").update(created.id, {
      token_hash: createHash("sha256").update(raw).digest("hex"),
    });
    const already = await acceptInvite(raw, {
      id: member,
      email: "already@x.test",
    }).catch((e: unknown) => e);
    expect(already).toBeInstanceOf(InviteRefused);
    expect((already as InviteRefused).reason).toBe("already_member");
    expect((already as InviteRefused).orgId).toBe(o.org);
  });

  it("a new person creates an account (password >= 10) and joins", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-g");
    const transport = captureTransport();
    await inviteMember(
      o.ctx,
      { email: "fresh@x.test", role: "viewer", grants: [] },
      { transport },
    );
    const token = tokenFrom(transport.sent[0]!.text);
    await expect(
      acceptInviteAsNewAccount(token, { name: "Sam", password: "short" }, IP),
    ).rejects.toThrow(InvalidInput);
    const res = await acceptInviteAsNewAccount(
      token,
      { name: "Sam", password: "long-enough-pw" },
      IP,
    );
    expect(res.orgId).toBe(o.org);
    expect(res.email).toBe("fresh@x.test");
    const u = await pb
      .collection("users")
      .getFirstListItem(pb.filter("email = 'fresh@x.test'"));
    expect(u.name).toBe("Sam");
    expect(u.verified).toBe(true);
    const m = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: u.id,
        o: o.org,
      }),
    );
    expect(m.role).toBe("viewer");
  });
});

describe("resend, revoke, list", () => {
  it("resend rotates the token; revoke ends it; admin lists, editor cannot", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("inv-h");
    const transport = captureTransport();
    const { inviteId } = await inviteMember(
      o.ctx,
      { email: "r@x.test", role: "viewer", grants: [] },
      { transport },
    );
    const first = tokenFrom(transport.sent[0]!.text);
    await resendInvite(o.ctx, inviteId, { transport });
    const second = tokenFrom(transport.sent[1]!.text);
    expect(second).not.toBe(first);
    expect(await readInvite(first)).toBeNull();
    expect((await readInvite(second))?.status).toBe("pending");

    const admin = await newUser("admin-inv-h@cds.test");
    await pb
      .collection("memberships")
      .create({ user: admin, organization: o.org, role: "admin" });
    const listed = await listInvites(ctx(o.org, admin, "admin"));
    expect(listed.map((i) => i.email)).toEqual(["r@x.test"]);
    expect(JSON.stringify(listed)).not.toContain("token_hash");
    await expect(
      revokeInvite(ctx(o.org, admin, "admin"), inviteId),
    ).rejects.toThrow(Forbidden);
    await expect(listInvites(ctx(o.org, admin, "editor"))).rejects.toThrow(
      Forbidden,
    );

    await revokeInvite(o.ctx, inviteId);
    expect((await readInvite(second))?.status).toBe("revoked");
    expect(await listInvites(o.ctx)).toEqual([]);

    // Cross-org: org A's owner cannot touch org inv-h's invite.
    await expect(
      resendInvite(seed.ctxA, inviteId, { transport }),
    ).rejects.toThrow();
  });
});

describe("people wrappers", () => {
  it("owner changes role and grants and removes; cannot touch themself; admin lists", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrgWithOwner("ppl-a");
    const ed = await newUser("ed-ppl@x.test", { name: "Ed" });
    const edM = (
      await pb
        .collection("memberships")
        .create({ user: ed, organization: o.org, role: "editor" })
    ).id;
    const admin = await newUser("ad-ppl@x.test", { name: "Ada" });
    await pb
      .collection("memberships")
      .create({ user: admin, organization: o.org, role: "admin" });
    const ownerM = (
      await pb.collection("memberships").getFirstListItem(
        pb.filter("user = {:u} && organization = {:o}", {
          u: o.owner,
          o: o.org,
        }),
      )
    ).id;
    const adminCtx = ctx(o.org, admin, "admin");

    const people = await listPeople(adminCtx);
    expect(people.map((p) => p.role)).toEqual(["owner", "admin", "editor"]);
    expect(people.find((p) => p.userId === admin)?.isYou).toBe(true);
    expect(people.find((p) => p.userId === ed)?.email).toBe("ed-ppl@x.test");

    await expect(changeMemberRole(adminCtx, edM, "viewer")).rejects.toThrow(
      Forbidden,
    );
    await expect(
      changeMemberRole(
        ctx(o.org, o.owner, "owner", "staffuser12345"),
        edM,
        "viewer",
      ),
    ).rejects.toThrow(ImpersonationDenied);
    await changeMemberRole(o.ctx, edM, "viewer");
    await setMemberGrants(o.ctx, edM, ["events"]);
    const row = await pb.collection("memberships").getOne(edM);
    expect(row.role).toBe("viewer");
    expect(row.addon_grants).toEqual(["events"]);
    await expect(
      changeMemberRole(o.ctx, edM, "owner" as never),
    ).rejects.toThrow(InvalidInput);

    await expect(removePerson(o.ctx, ownerM)).rejects.toThrow(InvalidInput);
    await expect(changeMemberRole(o.ctx, ownerM, "admin")).rejects.toThrow(
      InvalidInput,
    );
    await removePerson(o.ctx, edM);
    await expect(pb.collection("memberships").getOne(edM)).rejects.toThrow();
  });
});
