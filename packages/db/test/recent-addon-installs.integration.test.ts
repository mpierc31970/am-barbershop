// 11-19: recentAddonInstalls (From CDS "new add-on training", DASH-23). Active add-ons installed
// at or after `since`, newest first, for the context's org only; disabled rows never count.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recentAddonInstalls } from "../src/addons/entitlements";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");

async function newOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Recent ${t}`,
      slug: `recent-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  const password = randomBytes(18).toString("hex");
  const user = (
    await pb.collection("users").create({
      email: `recent-${t}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user, organization: org, role: "editor" });
  return {
    org,
    ctx: mintOrgContext({
      orgId: org,
      actor: user,
      role: "editor",
      grants: [],
      ip: "127.0.0.1",
    }),
  };
}

async function install(
  org: string,
  addon: string,
  installedAt: string,
  status: "active" | "disabled" = "active",
): Promise<void> {
  await pb.collection("org_addons").create({
    organization: org,
    addon,
    status,
    source: "hub",
    installed_at: installedAt,
    ...(status === "disabled" ? { disabled_reason: "uninstalled" } : {}),
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

describe("recentAddonInstalls", () => {
  it("active installs since the date, newest first, own org only", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    await install(a.org, "testimonials", "2026-10-05 10:00:00.000Z");
    await install(a.org, "credentials", "2026-10-07 10:00:00.000Z");
    await install(a.org, "builder-pro", "2026-09-01 10:00:00.000Z");
    await install(a.org, "old-gone", "2026-10-06 10:00:00.000Z", "disabled");
    await install(b.org, "testimonials", "2026-10-08 10:00:00.000Z");

    const since = new Date("2026-09-24T15:00:00.000Z");
    const rows = await recentAddonInstalls(a.ctx, since);
    expect(rows.map((r) => r.slug)).toEqual(["credentials", "testimonials"]);
    expect(rows[0]!.installedAt).toContain("2026-10-07");
    expect(
      (await recentAddonInstalls(b.ctx, since)).map((r) => r.slug),
    ).toEqual(["testimonials"]);
    expect(await recentAddonInstalls(a.ctx, new Date("bad"))).toEqual([]);
  });
});
