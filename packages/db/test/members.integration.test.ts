// TEN-06 / TEN-09 membership management on the real PocketBase 0.39.11 binary (D286,
// RESEARCH Pattern 6): roles, add-on grants, the last-owner guard, atomic ownership
// transfer, the one-owned-org partial index and audited impersonated member writes.
import { Forbidden, InvalidInput, LastOwner, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  addMember,
  changeRole,
  removeMember,
  setAddonGrants,
  transferOwnership,
} from "../src/members";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

// Org C: owner OC plus member U, used by the transfer tests so ctxA stays an owner.
let orgC: string;
let ownerC: string;
let ownerCMembership: string;
let userU: string;
let ctxC: OrgContext;
// Org D: two owners, for the serialized last-owner race.
let orgD: string;

let editorE: string;
let editorEMembership: string;

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

async function newUser(email: string): Promise<string> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return (
    await pb
      .collection("users")
      .create({ email, password, passwordConfirm: password })
  ).id;
}

async function newOrg(slug: string): Promise<string> {
  return (
    await pb
      .collection("organizations")
      .create({ name: slug, slug, status: "active" })
  ).id;
}

async function owners(orgId: string) {
  return pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  editorE = await newUser("editor-e@cds.test");

  orgC = await newOrg("org-c");
  ownerC = await newUser("owner-c@cds.test");
  ownerCMembership = (
    await pb
      .collection("memberships")
      .create({ user: ownerC, organization: orgC, role: "owner" })
  ).id;
  userU = await newUser("user-u@cds.test");
  ctxC = ctx(orgC, ownerC, "owner");
});

afterAll(async () => {
  await inst?.stop();
});

describe("TEN-06 member management", () => {
  it("owner adds an editor, changes the role and sets add-on grants", async (t) => {
    if (!inst) return t.skip();
    editorEMembership = await addMember(seed.ctxA, {
      userId: editorE,
      role: "editor",
    });
    let row = await pb.collection("memberships").getOne(editorEMembership);
    expect(row.organization).toBe(seed.A.org);
    expect(row.role).toBe("editor");

    await changeRole(seed.ctxA, editorEMembership, "viewer");
    await setAddonGrants(seed.ctxA, editorEMembership, ["events", "events"]);
    row = await pb.collection("memberships").getOne(editorEMembership);
    expect(row.role).toBe("viewer");
    expect(row.addon_grants).toEqual(["events"]);
  });

  it("an admin may add members; an editor is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const admin = await newUser("admin-a@cds.test");
    await pb
      .collection("memberships")
      .create({ user: admin, organization: seed.A.org, role: "admin" });
    const other = await newUser("added-by-admin@cds.test");
    const id = await addMember(ctx(seed.A.org, admin, "admin"), {
      userId: other,
      role: "viewer",
    });
    expect((await pb.collection("memberships").getOne(id)).role).toBe("viewer");
    const nobody = await newUser("editor-add@cds.test");
    await expect(
      addMember(ctx(seed.A.org, editorE, "editor"), {
        userId: nobody,
        role: "viewer",
      }),
    ).rejects.toThrow(Forbidden);
  });

  it("rejects the owner role, bad grants and bad input on add", async (t) => {
    if (!inst) return t.skip();
    const u = await newUser("would-be-owner@cds.test");
    await expect(
      addMember(seed.ctxA, { userId: u, role: "owner" as unknown as "viewer" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      addMember(seed.ctxA, {
        userId: u,
        role: "viewer",
        addonGrants: ["Bad Slug"],
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      addMember(seed.ctxA, {
        userId: u,
        role: "god" as unknown as "viewer",
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      changeRole(seed.ctxA, editorEMembership, "owner"),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setAddonGrants(seed.ctxA, editorEMembership, ["../x"]),
    ).rejects.toThrow(InvalidInput);
  });

  it("the sole owner can be neither removed nor demoted (LastOwner)", async (t) => {
    if (!inst) return t.skip();
    await expect(removeMember(seed.ctxA, seed.A.membership)).rejects.toThrow(
      LastOwner,
    );
    await expect(
      changeRole(seed.ctxA, seed.A.membership, "admin"),
    ).rejects.toThrow(LastOwner);
    const row = await pb.collection("memberships").getOne(seed.A.membership);
    expect(row.role).toBe("owner");
  });

  it("an admin cannot demote or remove an owner", async (t) => {
    if (!inst) return t.skip();
    const admin = await newUser("admin-a2@cds.test");
    await pb
      .collection("memberships")
      .create({ user: admin, organization: seed.A.org, role: "admin" });
    const adminCtx = ctx(seed.A.org, admin, "admin");
    await expect(
      changeRole(adminCtx, seed.A.membership, "viewer"),
    ).rejects.toThrow(Forbidden);
    await expect(removeMember(adminCtx, seed.A.membership)).rejects.toThrow(
      Forbidden,
    );
  });

  it("removes an ordinary member", async (t) => {
    if (!inst) return t.skip();
    const u = await newUser("temp@cds.test");
    const id = await addMember(seed.ctxA, { userId: u, role: "viewer" });
    await removeMember(seed.ctxA, id);
    await expect(pb.collection("memberships").getOne(id)).rejects.toThrow();
  });

  it("removing a member deletes their prefs, alerts and devices in that org, and the user can then be deleted (CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const u = await newUser("personal-rows@cds.test");
    const idA = await addMember(seed.ctxA, { userId: u, role: "viewer" });
    // A second org keeps a membership and its own personal rows for U.
    const idC = await addMember(ctxC, { userId: u, role: "viewer" });
    const personal = async (org: string) => {
      await pb
        .collection("member_prefs")
        .create({ organization: org, user: u });
      await pb.collection("alerts").create({
        organization: org,
        user: u,
        type: "site.stage",
        level: "normal",
        title: "t",
        source_key: `k-${org}`,
      });
      await pb.collection("push_subscriptions").create({
        organization: org,
        user: u,
        endpoint: `https://push.example/${org}/${u}`,
        p256dh: "p",
        auth: "a",
      });
    };
    await personal(seed.A.org);
    await personal(orgC);
    const count = async (col: string, org: string) =>
      (
        await pb.collection(col).getFullList({
          filter: pb.filter("organization = {:org} && user = {:u}", {
            org,
            u,
          }),
        })
      ).length;

    await removeMember(seed.ctxA, idA);
    for (const col of ["member_prefs", "alerts", "push_subscriptions"]) {
      expect(await count(col, seed.A.org)).toBe(0);
      expect(await count(col, orgC)).toBe(1);
    }

    // The leftover org-C rows no longer block deleting the account (cascade, 1790000840).
    await pb.collection("memberships").delete(idC);
    const exp = await pb.collection("data_exports").create({
      organization: orgC,
      requested_by: u,
      status: "ready",
      requested_at: new Date().toISOString(),
    });
    await pb.collection("users").delete(u);
    for (const col of ["member_prefs", "alerts", "push_subscriptions"]) {
      expect(await count(col, orgC)).toBe(0);
    }
    const kept = await pb.collection("data_exports").getOne(exp.id);
    expect(kept.requested_by).toBe("");
  });

  it("serializes concurrent owner removals so one owner always remains", async (t) => {
    if (!inst) return t.skip();
    orgD = await newOrg("org-d");
    const x = await newUser("owner-dx@cds.test");
    const y = await newUser("owner-dy@cds.test");
    const mx = (
      await pb
        .collection("memberships")
        .create({ user: x, organization: orgD, role: "owner" })
    ).id;
    const my = (
      await pb
        .collection("memberships")
        .create({ user: y, organization: orgD, role: "owner" })
    ).id;
    const results = await Promise.allSettled([
      removeMember(ctx(orgD, x, "owner"), my),
      removeMember(ctx(orgD, y, "owner"), mx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      LastOwner,
    );
    expect(await owners(orgD)).toHaveLength(1);
  });
});

describe("TEN-09 one owned org, roles elsewhere (D286)", () => {
  it("the owner of org B may be staff in A and renter in C", async (t) => {
    if (!inst) return t.skip();
    const inA = await addMember(seed.ctxA, {
      userId: seed.B.owner,
      role: "staff",
    });
    const inC = await addMember(ctxC, { userId: seed.B.owner, role: "renter" });
    expect((await pb.collection("memberships").getOne(inA)).role).toBe("staff");
    expect((await pb.collection("memberships").getOne(inC)).role).toBe(
      "renter",
    );
  });

  it("transfer to a user who already owns another org is rejected and rolled back", async (t) => {
    if (!inst) return t.skip();
    const target = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: seed.B.owner,
        o: orgC,
      }),
    );
    await expect(transferOwnership(ctxC, target.id)).rejects.toThrow(
      InvalidInput,
    );
    expect(
      (await pb.collection("memberships").getOne(ownerCMembership)).role,
    ).toBe("owner");
    expect((await pb.collection("memberships").getOne(target.id)).role).toBe(
      "renter",
    );
    expect(
      await pb.collection("audit_log").getFullList({
        filter: pb.filter(
          "organization = {:o} && action = 'ownership.transfer'",
          {
            o: orgC,
          },
        ),
      }),
    ).toHaveLength(0);
  });
});

describe("TEN-06 ownership transfer", () => {
  it("only the owner may transfer, and not to themselves", async (t) => {
    if (!inst) return t.skip();
    const uMembership = await addMember(ctxC, { userId: userU, role: "admin" });
    await expect(
      transferOwnership(ctx(orgC, userU, "admin"), ownerCMembership),
    ).rejects.toThrow(Forbidden);
    await expect(transferOwnership(ctxC, ownerCMembership)).rejects.toThrow(
      InvalidInput,
    );
    expect((await pb.collection("memberships").getOne(uMembership)).role).toBe(
      "admin",
    );
  });

  it("promotes the new owner and demotes the old one atomically, audited once", async (t) => {
    if (!inst) return t.skip();
    const target = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: userU,
        o: orgC,
      }),
    );
    await transferOwnership(ctxC, target.id);
    expect((await pb.collection("memberships").getOne(target.id)).role).toBe(
      "owner",
    );
    expect(
      (await pb.collection("memberships").getOne(ownerCMembership)).role,
    ).toBe("admin");
    const own = await owners(orgC);
    expect(own.map((r) => r.user)).toEqual([userU]);
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'ownership.transfer'",
        {
          o: orgC,
        },
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(ownerC);
    expect(rows[0]!.target_id).toBe(target.id);
  });

  it("an unknown or foreign membership id is NotFound", async (t) => {
    if (!inst) return t.skip();
    await expect(
      transferOwnership(seed.ctxA, "zzzzzzzzzzzzzzz"),
    ).rejects.toThrow(NotFound);
    await expect(
      transferOwnership(seed.ctxA, seed.B.membership),
    ).rejects.toThrow(NotFound);
  });
});

describe("TEN-08 impersonated member writes are audited", () => {
  it("an impersonated addMember writes one audit row with the impersonator", async (t) => {
    if (!inst) return t.skip();
    const staff = await newUser("staff-imp@cds.test");
    const u = await newUser("imp-added@cds.test");
    const imp = ctx(seed.A.org, staff, "admin", staff);
    const id = await addMember(imp, { userId: u, role: "viewer" });
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("target_id = {:id}", { id }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("memberships.create");
    expect(rows[0]!.impersonator).toBe(staff);
    expect(rows[0]!.organization).toBe(seed.A.org);
    expect(rows[0]!.ip).toBe(IP);
  });
});
