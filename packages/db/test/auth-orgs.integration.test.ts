// 11-11: memberships with a role per org for the hub org switcher (DASH-01, DASH-18; D5,
// D286). A person who is Owner of A and Editor of B gets both, each with its own role; a
// disabled org is excluded; another person's orgs never appear.
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMemberOrganizations, signInMember } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const PASSWORD = "pw-auth-orgs-1234";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let closedOrg: string;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // Owner A is also an Editor of B, and a member of a disabled org C.
  await pb
    .collection("memberships")
    .create({ user: seed.A.owner, organization: seed.B.org, role: "editor" });
  closedOrg = (
    await pb.collection("organizations").create({
      name: "Org C",
      slug: "org-c",
      status: "disabled",
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: seed.A.owner, organization: closedOrg, role: "admin" });
  for (const id of [seed.A.owner, seed.B.owner]) {
    await pb
      .collection("users")
      .update(id, { password: PASSWORD, passwordConfirm: PASSWORD });
  }
});

afterAll(async () => {
  await inst?.stop();
});

describe("listMemberOrganizations roles (11-11)", () => {
  it("returns every active org with the person's role in it, in membership order", async (t) => {
    if (!inst) return t.skip();
    const { token } = await signInMember("owner-a@cds.test", PASSWORD, IP);
    const res = await listMemberOrganizations(token);
    expect(res.organizations).toEqual([
      {
        id: seed.A.org,
        name: "Org A",
        role: "owner",
        status: "active",
        primaryHost: "a.example.com",
      },
      {
        id: seed.B.org,
        name: "Org B",
        role: "editor",
        status: "active",
        primaryHost: "b.example.com",
      },
    ]);
    expect(res.organizations.some((o) => o.id === closedOrg)).toBe(false);
  });

  it("another person's orgs never appear", async (t) => {
    if (!inst) return t.skip();
    const { token } = await signInMember("owner-b@cds.test", PASSWORD, IP);
    const res = await listMemberOrganizations(token);
    expect(res.organizations.map((o) => [o.id, o.role])).toEqual([
      [seed.B.org, "owner"],
    ]);
  });
});
