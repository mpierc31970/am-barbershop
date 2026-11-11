// 11-24: sensitive-practice mode switch (DASH-37, D305; T-11-24-03). Owner and Admin set it
// (settings:write), always audited; Editors and impersonating staff are refused; an empty
// value falls back to the business type (therapy and health types on).
import { randomBytes } from "node:crypto";
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  readAlertProfileFacts,
  SENSITIVE_PRACTICE_AUDIT,
  setSensitivePractice,
} from "../src/intake/business-profile";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");
type Role = "owner" | "admin" | "editor" | "viewer";

async function newUser(): Promise<string> {
  const password = randomBytes(18).toString("hex");
  return (
    await pb.collection("users").create({
      email: `sens-${tag()}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
}

async function newOrg(profile?: Record<string, unknown>) {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Sensitive ${t}`,
      slug: `sens-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  const users = {} as Record<Role, string>;
  for (const role of ["owner", "admin", "editor", "viewer"] as const) {
    users[role] = await newUser();
    await pb
      .collection("memberships")
      .create({ user: users[role], organization: org, role });
  }
  if (profile) {
    await pb
      .collection("business_profile")
      .create({ organization: org, ...profile });
  }
  const ctx = (role: Role, impersonator?: string): OrgContext =>
    mintOrgContext({
      orgId: org,
      actor: users[role],
      role,
      grants: [],
      ...(impersonator ? { impersonator } : {}),
      ip: "127.0.0.1",
    });
  return { org, users, ctx };
}

async function stored(org: string): Promise<string> {
  const rows = await pb.collection("business_profile").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return String(rows[0]?.sensitive_practice ?? "");
}

async function audits(org: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org} && action = {:a}", {
      org,
      a: SENSITIVE_PRACTICE_AUDIT,
    }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("setSensitivePractice", () => {
  it("an Admin sets off: stored, audited with from/to, effective off", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ business_type: "therapist" });
    const facts = await setSensitivePractice(o.ctx("admin"), "off");
    expect(facts.sensitiveSetting).toBe("off");
    expect(facts.sensitiveOn).toBe(false);
    expect(await stored(o.org)).toBe("off");
    const rows = await audits(o.org);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(o.users.admin);
    expect(rows[0]?.meta).toMatchObject({ from: "", to: "off" });
  });

  it("the Owner turns it on for a bakery; the row is created when missing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const facts = await setSensitivePractice(o.ctx("owner"), "on");
    expect(facts.sensitiveOn).toBe(true);
    expect(await stored(o.org)).toBe("on");
    expect(await audits(o.org)).toHaveLength(1);
  });

  it("Editors and Viewers are refused (Forbidden); nothing written", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ business_type: "therapist" });
    await expect(setSensitivePractice(o.ctx("editor"), "off")).rejects.toThrow(
      Forbidden,
    );
    await expect(setSensitivePractice(o.ctx("viewer"), "off")).rejects.toThrow(
      Forbidden,
    );
    expect(await stored(o.org)).toBe("");
    expect(await audits(o.org)).toHaveLength(0);
  });

  it("impersonating staff are refused", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ business_type: "therapist" });
    await expect(
      setSensitivePractice(o.ctx("owner", "staffuser000001"), "off"),
    ).rejects.toThrow(ImpersonationDenied);
    expect(await stored(o.org)).toBe("");
  });

  it("refuses anything but on or off", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await expect(
      setSensitivePractice(o.ctx("owner"), "" as never),
    ).rejects.toThrow(InvalidInput);
  });
});

describe("readAlertProfileFacts", () => {
  it("a therapy business with an empty value reads effective on, in its time zone", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({
      business_type: "therapist",
      time_zone: "America/New_York",
    });
    const facts = await readAlertProfileFacts(o.ctx("viewer"));
    expect(facts).toEqual({
      sensitiveSetting: "",
      sensitiveOn: true,
      timeZone: "America/New_York",
    });
  });

  it("no profile row: off, default time zone", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const facts = await readAlertProfileFacts(o.ctx("editor"));
    expect(facts.sensitiveOn).toBe(false);
    expect(facts.sensitiveSetting).toBe("");
    expect(facts.timeZone).toBe("America/Chicago");
  });
});
