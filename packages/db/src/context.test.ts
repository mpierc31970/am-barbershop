import { InvalidContext } from "@cds/core";
import { describe, expect, it } from "vitest";
import {
  assertOrgContext,
  assertPlatformContext,
  assertSystemContext,
  mintOrgContext,
  mintPlatformContext,
  mintSystemContext,
  type OrgContext,
} from "./context";
import { auditBody } from "./audit";

// TEN-02 / D5: contexts are minted only inside @cds/db; a cast or copied object is refused.
const orgInput = {
  orgId: "orgaaaaaaaaaaaa",
  actor: "useraaaaaaaaaaa",
  role: "owner" as const,
  grants: ["booking"],
  ip: "127.0.0.1",
};

describe("branded contexts", () => {
  it("mints a frozen OrgContext that passes the assert", () => {
    const ctx = mintOrgContext(orgInput);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => assertOrgContext(ctx)).not.toThrow();
    expect(ctx.orgId).toBe(orgInput.orgId);
  });

  it("rejects a spread copy of a minted context", () => {
    const ctx = mintOrgContext(orgInput);
    expect(() => assertOrgContext({ ...ctx })).toThrow(InvalidContext);
  });

  it("rejects a literal cast object", () => {
    const forged = { ...orgInput } as unknown as OrgContext;
    expect(() => assertOrgContext(forged)).toThrow(InvalidContext);
    expect(() => assertOrgContext(null)).toThrow(InvalidContext);
    expect(() => assertOrgContext("org")).toThrow(InvalidContext);
  });

  it("freezes grants", () => {
    const ctx = mintOrgContext(orgInput);
    expect(() => (ctx.grants as string[]).push("x")).toThrow();
  });

  it("does not let an input mutation reach the minted context", () => {
    const grants = ["a"];
    const ctx = mintOrgContext({ ...orgInput, grants });
    grants.push("b");
    expect(ctx.grants).toEqual(["a"]);
  });

  it("keeps org, platform and system contexts apart", () => {
    const org = mintOrgContext(orgInput);
    const platform = mintPlatformContext({
      actor: "staffaaaaaaaaaa",
      staffRole: "super_admin",
      ip: "127.0.0.1",
    });
    const system = mintSystemContext({ job: "backup" });
    expect(() => assertPlatformContext(org)).toThrow(InvalidContext);
    expect(() => assertOrgContext(platform)).toThrow(InvalidContext);
    expect(() => assertSystemContext(org)).toThrow(InvalidContext);
    expect(() => assertOrgContext(system)).toThrow(InvalidContext);
    expect(() => assertPlatformContext(platform)).not.toThrow();
    expect(() => assertSystemContext(system)).not.toThrow();
  });

  it("WR-A07: a system-job org context audits as CDS, never as its actor", () => {
    const ctx = mintOrgContext({
      ...orgInput,
      systemJob: "assembly",
      ip: "system:assembly",
    });
    expect(ctx.systemJob).toBe("assembly");
    const row = auditBody(ctx, { action: "page.publish", meta: { slug: "x" } });
    expect(row).toMatchObject({
      organization: orgInput.orgId,
      actor: "",
      impersonator: "",
      ip: "system:assembly",
      meta: { slug: "x", job: "assembly" },
    });
    // A plain owner context still names its actor.
    const owner = auditBody(mintOrgContext(orgInput), {
      action: "page.publish",
    });
    expect(owner.actor).toBe(orgInput.actor);
    expect("systemJob" in mintOrgContext(orgInput)).toBe(false);
  });
});
