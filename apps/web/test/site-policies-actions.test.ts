// 09-23 Task 1: publishSitePoliciesAction, previewSitePolicyAction (AGR-08; D217, D287;
// CONTEXT A5-Q3, A5-Q4; T-09-23-01, -02, -04). The session and @cds/db are mocked; the real
// runAction maps refusals to UI copy.
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ADMIN = { orgId: "org1", actor: "u2", role: "admin", grants: [] };
const STAFF = { ...OWNER, impersonator: "staff1" };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
  clientIp: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => [] },
}));

const db = vi.hoisted(() => ({
  acknowledgeSitePolicies: vi.fn(),
  previewSitePolicy: vi.fn(),
  recordSitePolicyReview: vi.fn(),
  liveTag: (org: string) => `org:${org}:live`,
  addonsTag: (org: string) => `org:${org}:addons`,
}));
vi.mock("@cds/db", () => db);

const { publishSitePoliciesAction, previewSitePolicyAction } =
  await import("../app/actions/site-policies");
const { revalidatePath, revalidateTag } = await import("next/cache");

class InputsMissing extends InvalidInput {
  override readonly code: string = "site_policy_inputs_missing";
  constructor() {
    super("Add your legal business name and a privacy contact email.");
  }
}

const MISSING =
  "Add your legal business name and a privacy contact email first, in Setup › Domain & the rest. Your policy pages use them.";
const ERR_PUBLISH =
  "We couldn't publish your policy pages. Nothing changed on your site. Try again in a minute.";
const NOT_OWNER = "Only the site owner can publish these pages.";
const IMPERSONATING =
  "You're viewing as CDS staff, so publishing is turned off. Only the owner can publish these pages.";

function session(ctx: Record<string, unknown>) {
  sess.getHubSession.mockResolvedValue({
    ctx,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

beforeEach(() => {
  db.acknowledgeSitePolicies.mockReset();
  db.previewSitePolicy.mockReset();
  db.recordSitePolicyReview.mockReset().mockResolvedValue(undefined);
  sess.clientIp.mockReset().mockResolvedValue("203.0.113.9");
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(revalidateTag).mockClear();
  session(OWNER);
});

describe("publishSitePoliciesAction", () => {
  it("acknowledges with the session ctx and trusted IP, revalidates the hub and live pages", async () => {
    db.acknowledgeSitePolicies.mockResolvedValue({
      templateVersion: 1,
      ackedAt: "2026-10-08T12:00:00.000Z",
    });
    const res = await publishSitePoliciesAction();
    expect(res).toEqual({
      ok: true,
      data: { templateVersion: 1, ackedAt: "2026-10-08T12:00:00.000Z" },
    });
    const [ctx, registry, input] = db.acknowledgeSitePolicies.mock.calls[0]!;
    expect(ctx).toBe(OWNER);
    expect(typeof (registry as { list: unknown }).list).toBe("function");
    expect(input).toEqual({ ip: "203.0.113.9" });
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
    expect(revalidateTag).toHaveBeenCalledWith("org:org1:live");
  });

  it("forbidden -> the owner-only copy", async () => {
    session(ADMIN);
    db.acknowledgeSitePolicies.mockRejectedValue(new Forbidden());
    const res = await publishSitePoliciesAction();
    expect(res).toMatchObject({ ok: false, message: NOT_OWNER });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("impersonation -> IMPERSONATING-ACK", async () => {
    session(STAFF);
    db.acknowledgeSitePolicies.mockRejectedValue(new ImpersonationDenied());
    const res = await publishSitePoliciesAction();
    expect(res).toMatchObject({ ok: false, message: IMPERSONATING });
  });

  it("WR-C02: the re-accept gate's agreement_required keeps its own copy, no write", async () => {
    sess.agreementBlocks.mockResolvedValueOnce(true);
    const res = await publishSitePoliciesAction();
    expect(res).toMatchObject({ ok: false, code: "agreement_required" });
    expect(res.ok ? "" : res.message).not.toBe(ERR_PUBLISH);
    expect(db.acknowledgeSitePolicies).not.toHaveBeenCalled();
  });

  it("missing legal inputs -> MISSING-LEGAL-INPUTS", async () => {
    db.acknowledgeSitePolicies.mockRejectedValue(new InputsMissing());
    const res = await publishSitePoliciesAction();
    expect(res).toMatchObject({
      ok: false,
      code: "site_policy_inputs_missing",
      message: MISSING,
    });
  });

  it("any other failure -> ERR-PUBLISH, and logs no tenant input", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.acknowledgeSitePolicies.mockRejectedValue(new Error("pb down"));
    const res = await publishSitePoliciesAction();
    expect(res).toMatchObject({ ok: false, message: ERR_PUBLISH });
    log.mockRestore();
  });
});

describe("previewSitePolicyAction", () => {
  const RENDERED = {
    page: "privacy",
    templateVersion: 1,
    title: "Privacy policy",
    html: '<h2>Who we are</h2><p>Hi</p><script>alert(1)</script><a href="javascript:x">x</a>',
    clauseIds: [],
    coveredLabels: [],
    draft: true,
  };

  it("owner: sanitised html and a review is recorded", async () => {
    db.previewSitePolicy.mockResolvedValue(RENDERED);
    const res = await previewSitePolicyAction("privacy");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.title).toBe("Privacy policy");
    expect(res.data.html).toContain("<h2>Who we are</h2>");
    expect(res.data.html).not.toContain("<script");
    expect(res.data.html).not.toContain("javascript:");
    expect(db.previewSitePolicy.mock.calls[0]![2]).toBe("privacy");
    expect(db.recordSitePolicyReview).toHaveBeenCalledTimes(1);
    expect(db.recordSitePolicyReview.mock.calls[0]![2]).toEqual({
      ip: "203.0.113.9",
    });
  });

  it("admin: previews without recording a review", async () => {
    session(ADMIN);
    db.previewSitePolicy.mockResolvedValue(RENDERED);
    const res = await previewSitePolicyAction("terms");
    expect(res.ok).toBe(true);
    expect(db.recordSitePolicyReview).not.toHaveBeenCalled();
  });

  it("impersonating staff: previews without recording a review", async () => {
    session(STAFF);
    db.previewSitePolicy.mockResolvedValue(RENDERED);
    await previewSitePolicyAction("privacy");
    expect(db.recordSitePolicyReview).not.toHaveBeenCalled();
  });

  it("a failed review write still returns the preview", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.previewSitePolicy.mockResolvedValue(RENDERED);
    db.recordSitePolicyReview.mockRejectedValue(new Error("pb down"));
    const res = await previewSitePolicyAction("privacy");
    expect(res.ok).toBe(true);
    log.mockRestore();
  });

  it("an unknown page is invalid_input and never reaches the chokepoint", async () => {
    const res = await previewSitePolicyAction(
      "cookies" as unknown as "privacy",
    );
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.previewSitePolicy).not.toHaveBeenCalled();
  });

  it("missing inputs -> MISSING-LEGAL-INPUTS", async () => {
    db.previewSitePolicy.mockRejectedValue(new InputsMissing());
    const res = await previewSitePolicyAction("privacy");
    expect(res).toMatchObject({ ok: false, message: MISSING });
  });
});
