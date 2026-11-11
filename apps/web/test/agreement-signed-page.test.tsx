// Review IN-C03: the signed confirmation shows ERR-LOAD (Try again + Settings › Legal) when the
// documents read fails, never the error boundary. Session and @cds/db are mocked.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({ requireHubSession: vi.fn() }));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  listAgreementDocuments: vi.fn(),
  // WR-D06: the Legal screens never read the combined list (it also reads the invoice
  // mirror); an outage there must not break them.
  listDocuments: vi.fn(async () => {
    throw new Error("invoice mirror down");
  }),
  getBusinessProfile: vi.fn(),
  getOrgStage: vi.fn(),
  agreementStatus: vi.fn(),
}));
vi.mock("@cds/db", () => db);

// ProofCode is a client component that needs the hub's ToastRegion; not under test here.
vi.mock("../app/(platform)/hub/agreement/signed/[id]/ProofCode", () => ({
  ProofCode: () => null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { default: SignedPage } =
  await import("../app/(platform)/hub/agreement/signed/[id]/page");

const ID = "aaaaaaaaaa11111";

async function render(next?: string): Promise<string> {
  const el = await SignedPage({
    params: Promise.resolve({ id: ID }),
    searchParams: Promise.resolve(next ? { next } : {}),
  });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  sess.requireHubSession.mockReset().mockResolvedValue({
    ctx: CTX,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.listAgreementDocuments.mockReset();
  db.getBusinessProfile.mockReset().mockResolvedValue(null);
  db.getOrgStage.mockReset().mockResolvedValue({
    stage: "ready_for_build",
    path: "standard",
    slug: "rivera",
  });
});

const DOC = {
  kind: "agreement",
  id: ID,
  title: "Signed agreement",
  versions: [
    { key: "service-agreement", title: "Service Agreement", version: 1 },
  ],
  signedAt: "2026-10-08T19:14:00.000Z",
  signerName: "Ana Rivera",
  signerEmail: "ana@rivera.test",
  signingKind: "signup",
  evidenceSha256: "a".repeat(64),
  downloadUrl: `/hub/agreement/download/${ID}`,
};

describe("signed confirmation secondary action (IN-C07)", () => {
  it("in setup: Back to setting up your site", async () => {
    db.listAgreementDocuments.mockResolvedValue([DOC]);
    const html = await render();
    expect(html).toContain("Back to setting up your site");
    expect(html).toContain('href="/hub/setup"');
  });

  it("past setup (live site): Continue to your hub", async () => {
    db.listAgreementDocuments.mockResolvedValue([DOC]);
    db.getOrgStage.mockResolvedValue({
      stage: "",
      path: "standard",
      slug: "r",
    });
    const html = await render();
    expect(html).toContain("Continue to your hub");
    expect(html).not.toContain("Back to setting up your site");
  });

  it("a failed stage read keeps the setup default", async () => {
    db.listAgreementDocuments.mockResolvedValue([DOC]);
    db.getOrgStage.mockRejectedValue(new Error("down"));
    expect(await render()).toContain("Back to setting up your site");
  });
});

describe("signed confirmation load failure (IN-C03)", () => {
  it("renders ERR-LOAD with Try again and Settings › Legal, no secret detail", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listAgreementDocuments.mockRejectedValue(new Error("pb down: secret"));
    const html = await render("/hub/setup");
    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t load this.");
    expect(html).toContain(
      `href="/hub/agreement/signed/${ID}?next=%2Fhub%2Fsetup"`,
    );
    expect(html).toContain('href="/hub/settings?tab=legal"');
    expect(html).not.toContain("secret");
    expect(sess.requireHubSession).toHaveBeenCalledWith({
      agreementGate: false,
    });
    err.mockRestore();
  });

  it("an id not in the org's list still goes to /hub", async () => {
    db.listAgreementDocuments.mockResolvedValue([]);
    await expect(render()).rejects.toThrow("REDIRECT:/hub");
  });
});
