// 09-16: tenant site policy pages on the real PocketBase 0.39.11 binary (AGR-08, D217, D287;
// CONTEXT A5-Q1..Q4). The cases run in order on one instance: site_policy_acks rows are
// append-only (09-03 hook), so each step builds on the rows the previous one left behind.
import { createHash } from "node:crypto";
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied } from "@cds/core";
import {
  SITE_POLICY_TEMPLATES,
  type SitePolicyTemplate,
} from "@cds/core/legal";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { siteContextForHost } from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  acknowledgeSitePolicies,
  previewSitePolicy,
  readPublishedSitePolicy,
  recordSitePolicyReview,
  SitePolicyInputsMissing,
  sitePolicyState,
} from "../src/legal";
import { __setSitePolicyTemplatesForTests } from "../src/legal/site-policy-acks";
import { clearResolverCache } from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

const reg = ADDON_REGISTRY;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const T0 = new Date("2026-10-08T10:00:00.000Z");
const T1 = "2026-10-09 10:00:00.000Z";
const T2 = new Date("2026-10-10T10:00:00.000Z");
const T3 = new Date("2026-10-11T10:00:00.000Z");

/** The compiled templates plus a v2 of both pages. */
function withV2(): SitePolicyTemplate[] {
  const v2 = SITE_POLICY_TEMPLATES.filter((t) => t.version === 1).map((t) => {
    const bodyMd = `${t.bodyMd}\n\nVersion two wording.\n`;
    return {
      ...t,
      version: 2,
      changes: "Adds one line.",
      bodyMd,
      sha256: sha(bodyMd),
    };
  });
  return [...SITE_POLICY_TEMPLATES, ...v2];
}

function ctxWith(
  role: "owner" | "admin" | "editor" | "viewer",
  extra: { impersonator?: string } = {},
): OrgContext {
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
    ...extra,
  });
}

async function siteA() {
  const s = await siteContextForHost("a.example.com");
  if (!s) throw new Error("no site context for a.example.com");
  return s;
}

async function ackRows(org: string) {
  return pb.collection("site_policy_acks").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "acked_at,id",
  });
}

async function setProfile(org: string, values: Record<string, string>) {
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org }),
  });
  const row = res.items[0];
  if (row) await pb.collection("business_profile").update(row.id, values);
  else
    await pb
      .collection("business_profile")
      .create({ organization: org, ...values });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
}, 120_000);

afterAll(async () => {
  __setSitePolicyTemplatesForTests(null);
  await inst?.stop();
});

describe("site policy pages (09-16)", () => {
  it("nothing is published before an ack; missing inputs are listed", async (t) => {
    if (!inst) return t.skip();
    expect(
      await readPublishedSitePolicy(await siteA(), reg, "privacy"),
    ).toBeNull();
    const s = await sitePolicyState(seed.ctxA, reg);
    expect(s.published).toBe(false);
    expect(s.ack).toBeNull();
    expect(s.missingInputs).toEqual(["legal_name", "privacy_contact"]);
    expect(s.coveredLabels).toContain("Contact forms");
    expect(s.lastUpdated).toBeNull();
  });

  it("an ack with no privacy contact is refused and writes nothing", async (t) => {
    if (!inst) return t.skip();
    await setProfile(seed.A.org, { legal_name: "Rivera Wellness LLC" });
    expect((await sitePolicyState(seed.ctxA, reg)).missingInputs).toEqual([
      "privacy_contact",
    ]);
    await expect(
      acknowledgeSitePolicies(seed.ctxA, reg, { ip: "203.0.113.7" }),
    ).rejects.toThrow(SitePolicyInputsMissing);
    await expect(previewSitePolicy(seed.ctxA, reg, "privacy")).rejects.toThrow(
      SitePolicyInputsMissing,
    );
    expect(await ackRows(seed.A.org)).toHaveLength(0);
  });

  it("admins, impersonated owners and editors are refused", async (t) => {
    if (!inst) return t.skip();
    await setProfile(seed.A.org, { privacy_contact: "privacy@rivera.test" });
    await expect(
      acknowledgeSitePolicies(ctxWith("admin"), reg, { ip: "1.1.1.1" }),
    ).rejects.toThrow(Forbidden);
    await expect(
      acknowledgeSitePolicies(
        ctxWith("owner", { impersonator: seed.B.owner }),
        reg,
        { ip: "1.1.1.1" },
      ),
    ).rejects.toThrow(ImpersonationDenied);
    await expect(
      recordSitePolicyReview(ctxWith("admin"), reg, { ip: "1.1.1.1" }),
    ).rejects.toThrow(Forbidden);
    await expect(sitePolicyState(ctxWith("editor"), reg)).rejects.toThrow(
      Forbidden,
    );
    // Admins may read the state (agreements:read).
    expect((await sitePolicyState(ctxWith("admin"), reg)).published).toBe(
      false,
    );
    expect(await ackRows(seed.A.org)).toHaveLength(0);
  });

  it("the owner's ack writes one row and one audit row, and publishes", async (t) => {
    if (!inst) return t.skip();
    const res = await acknowledgeSitePolicies(
      seed.ctxA,
      reg,
      { ip: "203.0.113.7" },
      { now: () => T0 },
    );
    expect(res).toEqual({ templateVersion: 1, ackedAt: T0.toISOString() });

    const rows = await ackRows(seed.A.org);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("ack");
    expect(row.user).toBe(seed.A.owner);
    expect(row.template_version).toBe(1);
    expect(row.ip).toBe("203.0.113.7");
    expect(
      new Date(String(row.retain_until).replace(" ", "T")).toISOString(),
    ).toBe("2033-10-08T10:00:00.000Z");

    const privacy = await previewSitePolicy(seed.ctxA, reg, "privacy");
    const terms = await previewSitePolicy(seed.ctxA, reg, "terms");
    expect(row.privacy_sha256).toBe(sha(privacy.html));
    expect(row.terms_sha256).toBe(sha(terms.html));
    expect(row.clause_ids).toEqual([...privacy.clauseIds]);

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'site_policies.publish'",
        { org: seed.A.org },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.target_id).toBe(row.id);

    const pub = await readPublishedSitePolicy(await siteA(), reg, "privacy");
    expect(pub).not.toBeNull();
    expect(pub!.html).toContain("Rivera Wellness LLC");
    expect(pub!.templateVersion).toBe(1);
    expect(pub!.lastUpdated).toBe(T0.toISOString());
    expect(pub!.html).not.toContain("Credentials");

    const s = await sitePolicyState(seed.ctxA, reg);
    expect(s.published).toBe(true);
    expect(s.ack).toMatchObject({
      templateVersion: 1,
      ackedAt: T0.toISOString(),
    });
    expect(s.templateUpdateWaiting).toBe(false);
    expect(s.addedSinceReview).toEqual([]);
    expect(s.missingInputs).toEqual([]);
  });

  it("an add-on activated after the ack shows live and is flagged until reviewed", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("org_addons").create({
      organization: seed.A.org,
      addon: "credentials",
      status: "active",
      source: "hub",
      installed_at: T1,
    });
    const pub = await readPublishedSitePolicy(await siteA(), reg, "privacy");
    expect(pub!.html).toContain("Credentials");
    expect(pub!.clauseIds).toContain("credentials");
    expect(pub!.lastUpdated).toBe("2026-10-09T10:00:00.000Z");

    let s = await sitePolicyState(seed.ctxA, reg);
    expect(s.addedSinceReview.map((a) => a.slug)).toEqual(["credentials"]);
    expect(s.coveredLabels).toContain("Credentials");
    expect(s.lastUpdated).toBe("2026-10-09T10:00:00.000Z");

    await recordSitePolicyReview(
      seed.ctxA,
      reg,
      { ip: "203.0.113.7" },
      { now: () => T2 },
    );
    s = await sitePolicyState(seed.ctxA, reg);
    expect(s.addedSinceReview).toEqual([]);
    // A review never changes the acknowledged version or publish state.
    expect(s.ack?.ackedAt).toBe(T0.toISOString());
    const review = (await ackRows(seed.A.org)).filter(
      (r) => r.kind === "review",
    );
    expect(review).toHaveLength(1);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'site_policies.review'",
        { org: seed.A.org },
      ),
    });
    expect(audit).toHaveLength(1);
  });

  it("a new template version waits for a new ack", async (t) => {
    if (!inst) return t.skip();
    __setSitePolicyTemplatesForTests(withV2());
    let s = await sitePolicyState(seed.ctxA, reg);
    expect(s.latestTemplateVersion).toBe(2);
    expect(s.templateUpdateWaiting).toBe(true);
    let pub = await readPublishedSitePolicy(await siteA(), reg, "terms");
    expect(pub!.templateVersion).toBe(1);
    expect(pub!.html).not.toContain("Version two wording.");
    expect(
      (await previewSitePolicy(seed.ctxA, reg, "terms")).templateVersion,
    ).toBe(2);

    await acknowledgeSitePolicies(
      seed.ctxA,
      reg,
      { ip: "203.0.113.7" },
      { now: () => T3 },
    );
    s = await sitePolicyState(seed.ctxA, reg);
    expect(s.templateUpdateWaiting).toBe(false);
    expect(s.ack?.templateVersion).toBe(2);
    pub = await readPublishedSitePolicy(await siteA(), reg, "terms");
    expect(pub!.templateVersion).toBe(2);
    expect(pub!.html).toContain("Version two wording.");
    __setSitePolicyTemplatesForTests(null);
  });

  it("an acknowledged template version no longer in code still renders Settings > Legal (IN-A03)", async (t) => {
    if (!inst) return t.skip();
    // The ack above is at v2; the real templates only have v1.
    const s = await sitePolicyState(seed.ctxA, reg);
    expect(s.ack?.templateVersion).toBe(2);
    expect(s.latestTemplateVersion).toBe(1);
    expect(s.coveredLabels.length).toBeGreaterThan(0);
    expect(
      await readPublishedSitePolicy(await siteA(), reg, "terms"),
    ).toBeNull();
  });

  it("org B sees none of org A's acks", async (t) => {
    if (!inst) return t.skip();
    const b = await siteContextForHost("b.example.com");
    expect(await readPublishedSitePolicy(b!, reg, "privacy")).toBeNull();
    const s = await sitePolicyState(seed.ctxB, reg);
    expect(s.published).toBe(false);
    expect(await ackRows(seed.B.org)).toHaveLength(0);
  });
});
