// THEME-01 / THEME-02 / THEME-03 theme chokepoint on the real PocketBase 0.39.11 binary
// (invariants 1 and 10; CONTEXT A1-Q3; T-04-22..T-04-26). Staff contexts come from a real
// password + OTP sign-in (impersonation.integration.test.ts pattern). Proves:
//   - only CDS staff with theme_import write organization.design, every write audited
//   - member contexts, unknown orgs and invalid designs write nothing
//   - cross-tenant: org B's visitor and owner reads never see org A's design
import { InvalidContext, InvalidInput, NotFound } from "@cds/core";
import {
  NEUTRAL_DESIGN,
  validateOrganizationDesign,
  type OrganizationDesign,
  type PublicDesign,
  type RoleMap,
} from "@cds/core/theme";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/index";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { type PlatformContext } from "../src/context";
import { bootstrapDevTenant } from "../src/dev-seed";
import { restoreTenant } from "../src/export";
import { clearResolverCache } from "../src/resolve";
import {
  readOrganizationDesign,
  readPublicDesign,
  setOrganizationDesign,
  themeTag,
} from "../src/theme";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const STAFF_IP = "203.0.113.9";
const PUBLIC_KEYS = [
  "name",
  "roles",
  "rounded",
  "schemaVersion",
  "shadows",
  "sourceHash",
  "typography",
];

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
let superId: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function otpCode(otpId: string): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users (\\w+) ${otpId} (\\d{6})`);
  for (let i = 0; i < 100; i++) {
    const m = re.exec(inst!.stdout());
    if (m) return m[2]!;
    await sleep(50);
  }
  throw new Error(`no OTP_STANDIN line for ${otpId}`);
}

async function staff(
  email: string,
  role: "super_admin" | "support_agent",
): Promise<{ id: string; ctx: PlatformContext }> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const id = (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
      staff_role: role,
    })
  ).id;
  const started = await signInStaff(email, password, STAFF_IP);
  const code = await otpCode(started.otpId);
  const { ctx } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code,
    ip: STAFF_IP,
  });
  return { id, ctx };
}

async function themeAudits(org: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action = 'theme.import'", {
      o: org,
    }),
    sort: "created",
  });
}

async function storedDesign(org: string): Promise<unknown> {
  return (await pb.collection("organizations").getOne(org)).design ?? null;
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

function variant(name: string, hashChar: string): OrganizationDesign {
  const d = structuredClone(NEUTRAL_DESIGN);
  d.name = name;
  d.source.designMd.frontMatter = { name };
  d.sourceHash = hashChar.repeat(64);
  return d;
}

const ALMANAC_ROLES: RoleMap = {
  surface: "#f7f1e8",
  "surface-raised": "#ede3d3",
  text: "#2a211b",
  "text-muted": "#6a5a4c",
  primary: "#9a3b22",
  "primary-contrast": "#fff8f0",
  accent: "#56642a",
  border: "#d8cab4",
};

function almanac(): OrganizationDesign {
  const d = variant("Almanac", "a");
  d.roles = { ...ALMANAC_ROLES };
  d.typography = {
    headingFamily: "Fraunces",
    bodyFamily: "Source Serif 4",
    body: "18px",
    h3: "24px",
    h2: "40px",
    display: "clamp(2.75rem, 5vw + 1rem, 4.5rem)",
  };
  d.rounded = { button: "2px", media: "2px" };
  d.shadows = { overlay: "0 18px 48px rgb(42 33 27 / 0.20)" };
  return validateOrganizationDesign(d);
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  const s = await staff("super-theme@cds.test", "super_admin");
  superId = s.id;
  superCtx = s.ctx;
  agentCtx = (await staff("agent-theme@cds.test", "support_agent")).ctx;
});

afterAll(async () => {
  clearResolverCache();
  await inst?.stop();
});

describe("THEME-03 setOrganizationDesign (staff only, audited)", () => {
  it("super_admin sets org A's design: stored, audited (from null), tag invalidated", async (t) => {
    if (!inst) return t.skip();
    const inv = recordingInvalidator();
    const design = almanac();
    const r = await setOrganizationDesign(superCtx, seed.A.org, design, {
      invalidator: inv,
    });
    expect(r).toEqual({ from: null, to: design.sourceHash });
    expect(await storedDesign(seed.A.org)).toEqual(
      validateOrganizationDesign(design),
    );
    // WR-C06: the theme tag first, then the live tag from the icon regeneration it caused.
    expect(inv.tags).toEqual([themeTag(seed.A.org), `org:${seed.A.org}:live`]);
    const rows = await themeAudits(seed.A.org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(superId);
    expect(rows[0]!.target_collection).toBe("organizations");
    expect(rows[0]!.target_id).toBe(seed.A.org);
    expect(rows[0]!.meta).toEqual({
      from: null,
      to: design.sourceHash,
      name: "Almanac",
      adjustments: 0,
    });
  });

  it("support_agent can set it too; the second write records meta.from = the first hash", async (t) => {
    if (!inst) return t.skip();
    const first = (await storedDesign(seed.A.org)) as OrganizationDesign;
    const next = variant("Almanac Two", "b");
    const inv = recordingInvalidator();
    const r = await setOrganizationDesign(agentCtx, seed.A.org, next, {
      invalidator: inv,
    });
    expect(r).toEqual({ from: first.sourceHash, to: next.sourceHash });
    const rows = await themeAudits(seed.A.org);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.meta).toMatchObject({
      from: first.sourceHash,
      to: next.sourceHash,
    });
    expect(((await storedDesign(seed.A.org)) as OrganizationDesign).name).toBe(
      "Almanac Two",
    );
  });

  it("an org member context (cast as PlatformContext) is refused; nothing written", async (t) => {
    if (!inst) return t.skip();
    const before = await storedDesign(seed.B.org);
    const inv = recordingInvalidator();
    const asPlatform = seed.ctxB as unknown as PlatformContext;
    await expect(
      setOrganizationDesign(asPlatform, seed.B.org, variant("Hijack", "c"), {
        invalidator: inv,
      }),
    ).rejects.toThrow(InvalidContext);
    const forged = {
      actor: seed.B.owner,
      staffRole: "super_admin",
      ip: STAFF_IP,
    } as unknown as PlatformContext;
    await expect(
      setOrganizationDesign(forged, seed.B.org, variant("Hijack", "c"), {
        invalidator: inv,
      }),
    ).rejects.toThrow(InvalidContext);
    expect(await storedDesign(seed.B.org)).toEqual(before);
    expect(await themeAudits(seed.B.org)).toHaveLength(0);
    expect(inv.tags).toEqual([]);
  });

  it("unknown org id and a malformed id are NotFound", async (t) => {
    if (!inst) return t.skip();
    const inv = recordingInvalidator();
    for (const id of ["zzzzzzzzzzzzzzz", "../x", ""]) {
      await expect(
        setOrganizationDesign(superCtx, id, variant("Nowhere", "e"), {
          invalidator: inv,
        }),
      ).rejects.toThrow(NotFound);
    }
    expect(inv.tags).toEqual([]);
  });

  it("an invalid design is InvalidInput and the stored design is unchanged", async (t) => {
    if (!inst) return t.skip();
    const before = await storedDesign(seed.A.org);
    const auditsBefore = (await themeAudits(seed.A.org)).length;
    const v1 = { ...variant("Old", "f"), schemaVersion: 1 };
    await expect(
      setOrganizationDesign(superCtx, seed.A.org, v1, {
        invalidator: recordingInvalidator(),
      }),
    ).rejects.toThrow(InvalidInput);
    const lowContrast = variant("Faint", "f");
    lowContrast.roles = { ...lowContrast.roles, text: "#efefef" };
    await expect(
      setOrganizationDesign(superCtx, seed.A.org, lowContrast, {
        invalidator: recordingInvalidator(),
      }),
    ).rejects.toThrow(InvalidInput);
    expect(await storedDesign(seed.A.org)).toEqual(before);
    expect(await themeAudits(seed.A.org)).toHaveLength(auditsBefore);
  });

  it("has no OrgContext overload (type and runtime); the root exports no other design writer", async (t) => {
    if (!inst) return t.skip();
    // @ts-expect-error an OrgContext is not a PlatformContext
    const p = setOrganizationDesign(seed.ctxA, seed.A.org, almanac(), {
      invalidator: recordingInvalidator(),
    });
    await expect(p).rejects.toThrow(InvalidContext);
    // The public surface only. That no OTHER code writes organizations.design is proven by
    // the source scan in src/theme-writer.test.ts and the restore/dev-seed tests below.
    expect(Object.keys(db)).not.toContain("queueDesignWrite");
    const names = Object.keys(db).filter((n) => /design/i.test(n));
    expect(names.sort()).toEqual(
      [
        // 13-31 (STAFF-18): a pure value builder for the demo theme, not a writer; the demo
        // reset writes it through queueDesignWrite on the demo org only.
        "demoDesign",
        "readOrganizationDesign",
        "readPublicDesign",
        "setOrganizationDesign",
      ].sort(),
    );
  });
});

describe("THEME-02 cross-tenant reads (invariant 1)", () => {
  it("readPublicDesign returns only the PublicDesign keys (never source)", async (t) => {
    if (!inst) return t.skip();
    const pub = (await readPublicDesign(
      await site("a.example.com"),
    )) as PublicDesign;
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
    expect(pub.name).toBe("Almanac Two");
    expect(JSON.stringify(pub)).not.toContain("designMd");
  });

  it("cross-tenant: org B's visitor never sees org A's design", async (t) => {
    if (!inst) return t.skip();
    const a = (await storedDesign(seed.A.org)) as OrganizationDesign;
    const pubB = await readPublicDesign(await site("b.example.com"));
    expect(pubB).toBeNull();
    expect(JSON.stringify(pubB)).not.toContain(a.sourceHash);
  });

  it("cross-tenant: org B's owner never reads org A's design; A's owner reads A's", async (t) => {
    if (!inst) return t.skip();
    expect(await readOrganizationDesign(seed.ctxB)).toBeNull();
    const mine = await readOrganizationDesign(seed.ctxA);
    expect(mine?.name).toBe("Almanac Two");
    // Once B has its own design, B still reads its own, never A's.
    await setOrganizationDesign(superCtx, seed.B.org, variant("Bee", "9"), {
      invalidator: recordingInvalidator(),
    });
    expect((await readOrganizationDesign(seed.ctxB))?.name).toBe("Bee");
    expect((await readPublicDesign(await site("b.example.com")))?.name).toBe(
      "Bee",
    );
    expect((await readPublicDesign(await site("a.example.com")))?.name).toBe(
      "Almanac Two",
    );
  });

  it("readers refuse a plain object context", async (t) => {
    if (!inst) return t.skip();
    const fakeSite = { orgId: seed.A.org, host: "b.example.com" };
    await expect(
      readPublicDesign(fakeSite as unknown as SiteContext),
    ).rejects.toThrow(InvalidContext);
    const fakeOrg = { orgId: seed.A.org, actor: seed.B.owner, role: "owner" };
    await expect(
      readOrganizationDesign(fakeOrg as unknown as typeof seed.ctxA),
    ).rejects.toThrow(InvalidContext);
  });

  it("a stored design that no longer validates comes back as its projection; null stays null", async (t) => {
    if (!inst) return t.skip();
    const broken = { ...variant("Broken", "7"), schemaVersion: 1 };
    (broken.roles as Record<string, string>).text = "red; }";
    await pb.collection("organizations").update(seed.B.org, { design: broken });
    const got = await readOrganizationDesign(seed.ctxB);
    expect(got).not.toBeNull();
    expect(got!.name).toBe("Broken");
    expect(Object.keys(got!).sort()).toEqual(PUBLIC_KEYS);
    await pb.collection("organizations").update(seed.B.org, { design: null });
    expect(await readOrganizationDesign(seed.ctxB)).toBeNull();
    expect(await readPublicDesign(await site("b.example.com"))).toBeNull();
  });
});

describe("dev seed design option", () => {
  it("bootstrapDevTenant writes a validated design on create and update, and leaves it untouched without one", async (t) => {
    if (!inst) return t.skip();
    const saved = process.env.CDS_ENV;
    process.env.CDS_ENV = "dev";
    try {
      const input = {
        slug: "theme-seed",
        name: "Theme Seed",
        host: "theme-seed.example.com",
        ownerEmail: "owner-theme-seed@cds.test",
        ownerPassword: "a-long-enough-password",
      };
      const inv = recordingInvalidator();
      const first = await bootstrapDevTenant(
        { ...input, design: almanac() },
        { invalidator: inv },
      );
      expect(first.created).toBe(true);
      expect(
        ((await storedDesign(first.orgId)) as OrganizationDesign).name,
      ).toBe("Almanac");
      // WR-01: the seed goes through the one design writer (audited, tag dropped).
      expect(inv.tags).toEqual([themeTag(first.orgId)]);
      let rows = await themeAudits(first.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.meta).toMatchObject({
        from: null,
        to: "a".repeat(64),
        via: "dev-seed",
        job: "dev-seed",
      });
      await bootstrapDevTenant({ ...input, design: variant("Reseed", "3") });
      expect(
        ((await storedDesign(first.orgId)) as OrganizationDesign).name,
      ).toBe("Reseed");
      rows = await themeAudits(first.orgId);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.meta).toMatchObject({
        from: "a".repeat(64),
        to: "3".repeat(64),
      });
      await bootstrapDevTenant(input);
      expect(
        ((await storedDesign(first.orgId)) as OrganizationDesign).name,
      ).toBe("Reseed");
      expect(await themeAudits(first.orgId)).toHaveLength(2);
    } finally {
      if (saved === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved;
    }
  });
});

describe("restore writes the design only through the design writer (WR-01)", () => {
  function bundleFor(org: string, organization: Record<string, unknown>) {
    return {
      format: "cds-tenant-export",
      version: 1,
      orgId: org,
      createdAt: "2026-09-27T00:00:00.000Z",
      organization: { id: org, ...organization },
      collections: {},
    };
  }

  it("a valid bundle design is stored, audited (meta.via restore) and its theme tag dropped", async (t) => {
    if (!inst) return t.skip();
    const before = (await themeAudits(seed.B.org)).length;
    const inv = recordingInvalidator();
    const d = variant("Restored", "5");
    const res = await restoreTenant(
      superCtx,
      bundleFor(seed.B.org, { design: d }),
      {
        invalidator: inv,
      },
    );
    expect(res.skipped.filter((s) => s.collection === "organizations")).toEqual(
      [],
    );
    expect(await storedDesign(seed.B.org)).toEqual(
      validateOrganizationDesign(d),
    );
    const rows = await themeAudits(seed.B.org);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)!.actor).toBe(superId);
    expect(rows.at(-1)!.meta).toMatchObject({
      to: "5".repeat(64),
      name: "Restored",
      via: "restore",
    });
    expect(inv.tags).toEqual([themeTag(seed.B.org)]);
  });

  it("an invalid bundle design is never stored: skipped, current theme kept, no theme audit", async (t) => {
    if (!inst) return t.skip();
    const current = await storedDesign(seed.B.org);
    const before = (await themeAudits(seed.B.org)).length;
    const bad = variant("Faint", "6");
    bad.roles = { ...bad.roles, text: "#efefef" };
    const olderSchema = { ...variant("Older", "7"), schemaVersion: 1 };
    const injected = variant("Injected", "8");
    (injected.roles as Record<string, string>).text = "red; }";
    for (const design of [bad, olderSchema, injected, "not a design"]) {
      const inv = recordingInvalidator();
      const res = await restoreTenant(
        superCtx,
        bundleFor(seed.B.org, { design }),
        { invalidator: inv },
      );
      expect(res.skipped).toContainEqual({
        collection: "organizations",
        id: seed.B.org,
        reason: "design failed validation; the current theme is kept",
      });
      expect(inv.tags).toEqual([]);
    }
    expect(await storedDesign(seed.B.org)).toEqual(current);
    expect(await themeAudits(seed.B.org)).toHaveLength(before);
  });

  it("a bundle without the field leaves the theme alone; null clears it (audited)", async (t) => {
    if (!inst) return t.skip();
    const current = await storedDesign(seed.B.org);
    const before = (await themeAudits(seed.B.org)).length;
    await restoreTenant(superCtx, bundleFor(seed.B.org, {}));
    expect(await storedDesign(seed.B.org)).toEqual(current);
    expect(await themeAudits(seed.B.org)).toHaveLength(before);
    const inv = recordingInvalidator();
    await restoreTenant(superCtx, bundleFor(seed.B.org, { design: null }), {
      invalidator: inv,
    });
    expect(await storedDesign(seed.B.org)).toBeNull();
    const rows = await themeAudits(seed.B.org);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)!.meta).toMatchObject({ to: null, via: "restore" });
    expect(inv.tags).toEqual([themeTag(seed.B.org)]);
  });
});
