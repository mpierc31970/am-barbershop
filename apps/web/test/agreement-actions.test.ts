// 09-17 Task 1: signAgreementAction (AGR-03, AGR-07; CONTEXT A2-Q2; RESEARCH Pitfall 12;
// T-09-17-01, -02, -03, -06). The session, request facts and @cds/db are mocked; the real
// runAction maps refusals to UI copy.
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const SHA = "a".repeat(64);

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
  clientIp: vi.fn(),
  readAuthMethod: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const hdrs = vi.hoisted(() => ({ ua: "Mozilla/5.0" as string | null }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(hdrs.ua === null ? {} : { "user-agent": hdrs.ua }),
  cookies: async () => ({ get: () => undefined }),
}));

const db = vi.hoisted(() => ({
  signAgreement: vi.fn(),
  agreementStatus: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { signAgreementAction } = await import("../app/actions/agreement");
const { revalidatePath } = await import("next/cache");

class Stale extends InvalidInput {
  override readonly code: string = "agreement_stale";
  constructor() {
    super(
      "One of these policies was updated while you were reading. We've loaded the new version; please review it and tick it again.",
    );
  }
}
class Already extends InvalidInput {
  override readonly code: string = "agreement_already";
  constructor() {
    super("You've already signed these versions.");
  }
}

function payload(extra: Record<string, unknown> = {}) {
  return {
    policies: [{ key: "terms-of-service", version: 2, sha256: SHA }],
    consent: { version: 1, sha256: "b".repeat(64) },
    signerName: "Ana Rivera",
    ...extra,
  };
}

type Payload = Parameters<typeof signAgreementAction>[0];

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  sess.clientIp.mockReset().mockResolvedValue("203.0.113.9");
  sess.readAuthMethod.mockReset().mockResolvedValue("otp");
  hdrs.ua = "Mozilla/5.0";
  vi.mocked(revalidatePath).mockClear();
  db.signAgreement.mockResolvedValue({ signatureId: "sig1" });
});

describe("signAgreementAction", () => {
  it("signs with the session ctx, the trusted IP, UA and auth method; returns a safe next", async () => {
    const res = await signAgreementAction(
      payload({
        organization: "org2",
        orgId: "org2",
        ip: "1.2.3.4",
        next: "/hub/checkout",
      }) as Payload,
    );
    expect(res).toEqual({
      ok: true,
      data: { signatureId: "sig1", next: "/hub/checkout" },
    });
    expect(db.signAgreement).toHaveBeenCalledTimes(1);
    expect(db.signAgreement).toHaveBeenCalledWith(CTX, {
      policies: [{ key: "terms-of-service", version: 2, sha256: SHA }],
      consent: { version: 1, sha256: "b".repeat(64) },
      signerName: "Ana Rivera",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
      authMethod: "otp",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("drops extra keys on posted policies", async () => {
    await signAgreementAction(
      payload({
        policies: [
          { key: "dpa", version: 1, sha256: SHA, organization: "org2" },
        ],
      }) as Payload,
    );
    expect(db.signAgreement.mock.calls[0]![1].policies).toEqual([
      { key: "dpa", version: 1, sha256: SHA },
    ]);
  });

  it("refuses an unsafe next (open redirect) by falling back to /hub", async () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/hub/../admin",
      "/sign-in",
    ]) {
      const res = await signAgreementAction(payload({ next }) as Payload);
      expect(res).toEqual({
        ok: true,
        data: { signatureId: "sig1", next: "/hub" },
      });
    }
  });

  it("truncates the user agent to 512 characters and handles a missing one", async () => {
    hdrs.ua = "x".repeat(900);
    await signAgreementAction(payload() as Payload);
    expect(db.signAgreement.mock.calls[0]![1].userAgent).toHaveLength(512);
    hdrs.ua = null;
    await signAgreementAction(payload() as Payload);
    expect(db.signAgreement.mock.calls[1]![1].userAgent).toBe("");
  });

  it.each([
    ["no policies", { policies: [] }],
    [
      "more than 10 policies",
      {
        policies: Array.from({ length: 11 }, (_, i) => ({
          key: `k${i}`,
          version: 1,
          sha256: SHA,
        })),
      },
    ],
    [
      "a non-integer version",
      { policies: [{ key: "dpa", version: 1.5, sha256: SHA }] },
    ],
    [
      "a non-hex sha",
      { policies: [{ key: "dpa", version: 1, sha256: "z".repeat(64) }] },
    ],
    ["a bad consent sha", { consent: { version: 1, sha256: "abc" } }],
    ["a missing consent", { consent: undefined }],
    ["a name over 120 characters", { signerName: "A".repeat(121) }],
    ["a non-string name", { signerName: 42 }],
    ["a non-string next", { next: 5 }],
  ])("refuses %s with invalid_input and never signs", async (_n, extra) => {
    const res = await signAgreementAction(payload(extra) as Payload);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_input");
    expect(db.signAgreement).not.toHaveBeenCalled();
    expect(sess.clientIp).not.toHaveBeenCalled();
  });

  it("refuses a non-object payload", async () => {
    const res = await signAgreementAction(null as unknown as Payload);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_input");
    expect(db.signAgreement).not.toHaveBeenCalled();
  });

  it("maps agreement_stale to ERR-STALE", async () => {
    db.signAgreement.mockRejectedValue(new Stale());
    const res = await signAgreementAction(payload() as Payload);
    expect(res).toEqual({
      ok: false,
      code: "agreement_stale",
      message:
        "One of these policies was updated while you were reading. We've loaded the new version; please review it and tick it again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps agreement_already to ERR-ALREADY", async () => {
    db.signAgreement.mockRejectedValue(new Already());
    const res = await signAgreementAction(payload() as Payload);
    expect(res).toEqual({
      ok: false,
      code: "agreement_already",
      message: "You've already signed these versions.",
    });
  });

  it("maps a store or database failure to ERR-SIGN", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.signAgreement.mockRejectedValue(new Error("pb down"));
    const res = await signAgreementAction(payload() as Payload);
    expect(res).toEqual({
      ok: false,
      code: "save_failed",
      message:
        "We couldn't record your signature, so nothing was signed. Try again in a minute. If it keeps happening, contact CDS Support.",
    });
    // Never logs the typed name, the email or the IP (T-09-17-06).
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain("Ana Rivera");
    expect(logged).not.toContain("ana@example.com");
    expect(logged).not.toContain("203.0.113.9");
    err.mockRestore();
  });

  it("maps forbidden to NOT-OWNER-SIGN", async () => {
    db.signAgreement.mockRejectedValue(new Forbidden("nope"));
    const res = await signAgreementAction(payload() as Payload);
    expect(res).toEqual({
      ok: false,
      code: "forbidden",
      message: "Only the site owner can sign this agreement.",
    });
  });

  it("maps impersonation to IMPERSONATING-SIGN", async () => {
    db.signAgreement.mockRejectedValue(new ImpersonationDenied("nope"));
    const res = await signAgreementAction(payload() as Payload);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe(
        "You're viewing as CDS staff, so signing is turned off. Only the owner can sign.",
      );
    }
  });

  it("signed out: no sign", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await signAgreementAction(payload() as Payload);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("signed_out");
    expect(db.signAgreement).not.toHaveBeenCalled();
  });
});
