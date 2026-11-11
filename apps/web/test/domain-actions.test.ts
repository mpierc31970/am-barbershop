// 14-31: Settings › Domain server actions (choice 5; T-14-31-01, T-14-31-02, T-14-31-04). Each
// action narrows bad input before any @cds/db call, calls the right owner function with the
// session ctx only (never an org id from the browser), maps an OwnerDomainRefused to its UI
// code + P14_COPY message, an Admin's Forbidden to DOMAIN-ADMIN-READ, and revalidates Settings.
import { Forbidden, InvalidInput, RateLimited } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
  requireHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("../lib/agreement-gate", () => ({ AGREEMENT_GATE_COPY: "gate" }));

const db = vi.hoisted(() => {
  class OwnerDomainRefused extends Error {
    readonly code = "invalid_input";
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    OwnerDomainRefused,
    ownerConnectDomain: vi.fn(),
    ownerUploadZoneFile: vi.fn(),
    ownerAcknowledge: vi.fn(),
    ownerCheckNameservers: vi.fn(),
    ownerSendNameserverSteps: vi.fn(),
    ownerUseDifferentDomain: vi.fn(),
    ownerSetPrimaryChoice: vi.fn(),
    ownerDomainView: vi.fn(),
  };
});
vi.mock("@cds/db", () => db);

const A = await import("../app/actions/domain");

const VIEW = {
  state: "checking",
  records: [],
  findings: [],
  registrar: null,
  nsSlow: false,
};

beforeEach(() => {
  for (const f of Object.values(db)) {
    if (typeof f === "function" && "mockReset" in f) {
      (f as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  sess.getHubSession.mockResolvedValue({ ctx: CTX });
  cache.revalidatePath.mockReset();
});

describe("connectDomainAction", () => {
  it("refuses non-strings and over-long input before any call", async () => {
    for (const bad of [null, 42, "", " ", "a".repeat(300), { d: 1 }]) {
      const r = await A.connectDomainAction(bad);
      expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(db.ownerConnectDomain).not.toHaveBeenCalled();
  });

  it("calls ownerConnectDomain with the session ctx and revalidates", async () => {
    db.ownerConnectDomain.mockResolvedValue({ ...VIEW, state: "checking" });
    const r = await A.connectDomainAction(" riverabakery.com ");
    expect(r).toEqual({ ok: true, data: { state: "checking" } });
    expect(db.ownerConnectDomain).toHaveBeenCalledWith(CTX, "riverabakery.com");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub/settings");
  });

  it("maps a refusal to its UI code and copy (DOM-TAKEN, DOM-CF-REGISTRAR)", async () => {
    db.ownerConnectDomain.mockRejectedValue(
      new db.OwnerDomainRefused("taken", P14_COPY.DOM_TAKEN),
    );
    expect(await A.connectDomainAction("riverabakery.com")).toEqual({
      ok: false,
      code: "DOM-TAKEN",
      message: P14_COPY.DOM_TAKEN,
      field: "domain",
    });
    db.ownerConnectDomain.mockRejectedValue(
      new db.OwnerDomainRefused("cf_registrar", "cf"),
    );
    expect(await A.connectDomainAction("x.com")).toMatchObject({
      code: "DOM-CF-REGISTRAR",
    });
  });

  it("an Admin is refused with DOMAIN-ADMIN-READ (T-14-31-01)", async () => {
    db.ownerConnectDomain.mockRejectedValue(new Forbidden("no"));
    expect(await A.connectDomainAction("riverabakery.com")).toEqual({
      ok: false,
      code: "forbidden",
      message: P14_COPY.DOM_ADMIN_READ,
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("signed out never calls @cds/db", async () => {
    sess.getHubSession.mockResolvedValue(null);
    expect(await A.connectDomainAction("riverabakery.com")).toMatchObject({
      ok: false,
      code: "signed_out",
    });
    expect(db.ownerConnectDomain).not.toHaveBeenCalled();
  });
});

describe("uploadZoneFileAction (T-14-31-02)", () => {
  it("refuses a non-FormData, a missing file and a file over 256 KiB unread", async () => {
    expect(await A.uploadZoneFileAction("text")).toMatchObject({ ok: false });
    expect(await A.uploadZoneFileAction(new FormData())).toMatchObject({
      ok: false,
    });
    const big = new File(["x".repeat(256 * 1024 + 1)], "zone.txt", {
      type: "text/plain",
    });
    const textSpy = vi.spyOn(big, "text");
    const form = new FormData();
    form.append("file", big);
    expect(await A.uploadZoneFileAction(form)).toEqual({
      ok: false,
      code: "ZONE-TOO-BIG",
      message: P14_COPY.ZONE_TOO_BIG,
    });
    expect(textSpy).not.toHaveBeenCalled();
    expect(db.ownerUploadZoneFile).not.toHaveBeenCalled();
  });

  it("reads the file as text and calls ownerUploadZoneFile", async () => {
    db.ownerUploadZoneFile.mockResolvedValue({
      added: 3,
      message: P14_COPY.ZONE_ADDED({ count: 3 }),
      view: VIEW,
    });
    const form = new FormData();
    form.append(
      "file",
      new File(["$ORIGIN riverabakery.com.\n"], "zone.txt", {
        type: "text/plain",
      }),
    );
    expect(await A.uploadZoneFileAction(form)).toEqual({
      ok: true,
      data: { added: 3, message: P14_COPY.ZONE_ADDED({ count: 3 }) },
    });
    expect(db.ownerUploadZoneFile).toHaveBeenCalledWith(
      CTX,
      "$ORIGIN riverabakery.com.\n",
    );
  });

  it("a wrong-domain refusal comes back as ZONE-WRONG-DOMAIN", async () => {
    db.ownerUploadZoneFile.mockRejectedValue(
      new db.OwnerDomainRefused("zone_wrong_domain", "other"),
    );
    const form = new FormData();
    form.append("file", new File(["x"], "z.txt"));
    expect(await A.uploadZoneFileAction(form)).toMatchObject({
      code: "ZONE-WRONG-DOMAIN",
      message: "other",
    });
  });
});

describe("acknowledgeFindingAction", () => {
  it("accepts only ^G5:[a-z_]+$ keys", async () => {
    for (const bad of ["G1:x", "G5:", "G5:Email", "G5:a b", 5, null]) {
      expect(await A.acknowledgeFindingAction(bad)).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(db.ownerAcknowledge).not.toHaveBeenCalled();
    db.ownerAcknowledge.mockResolvedValue({ ...VIEW, state: "nameservers" });
    expect(await A.acknowledgeFindingAction("G5:email_forwarding")).toEqual({
      ok: true,
      data: { state: "nameservers" },
    });
    expect(db.ownerAcknowledge).toHaveBeenCalledWith(
      CTX,
      "G5:email_forwarding",
    );
  });
});

describe("checkNameserversAction", () => {
  it("returns state + notYet; a rate limit is a typed refusal", async () => {
    db.ownerCheckNameservers.mockResolvedValue({
      state: "waiting",
      notYet: true,
      view: VIEW,
    });
    expect(await A.checkNameserversAction()).toEqual({
      ok: true,
      data: { state: "waiting", notYet: true },
    });
    expect(db.ownerCheckNameservers).toHaveBeenCalledWith(CTX);
    db.ownerCheckNameservers.mockRejectedValue(new RateLimited("slow"));
    expect(await A.checkNameserversAction()).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });
});

describe("sendStepsAction", () => {
  it("narrows the address and note, then calls ownerSendNameserverSteps", async () => {
    expect(await A.sendStepsAction({ email: "" })).toMatchObject({
      ok: false,
      field: "email",
    });
    expect(
      await A.sendStepsAction({ email: "a@b.co", note: "x".repeat(501) }),
    ).toMatchObject({ ok: false, field: "note" });
    expect(db.ownerSendNameserverSteps).not.toHaveBeenCalled();
    db.ownerSendNameserverSteps.mockResolvedValue({ sent: true });
    expect(
      await A.sendStepsAction({ email: " Sam@Example.com ", note: " hi " }),
    ).toEqual({ ok: true, data: { sent: true } });
    expect(db.ownerSendNameserverSteps).toHaveBeenCalledWith(CTX, {
      to: "sam@example.com",
      note: "hi",
    });
  });

  it("the chokepoint's email refusal keeps its copy on the email field", async () => {
    db.ownerSendNameserverSteps.mockRejectedValue(
      new db.OwnerDomainRefused(
        "email_invalid",
        "Enter an email address like name@example.com.",
      ),
    );
    expect(await A.sendStepsAction({ email: "x@y" })).toMatchObject({
      ok: false,
      code: "DOM-EMAIL-INVALID",
      field: "email",
    });
  });
});

describe("useDifferentDomainAction / setPrimaryChoiceAction", () => {
  it("different domain calls ownerUseDifferentDomain; too late keeps its copy", async () => {
    db.ownerUseDifferentDomain.mockResolvedValue({ ...VIEW, state: "none" });
    expect(await A.useDifferentDomainAction()).toEqual({
      ok: true,
      data: { state: "none" },
    });
    db.ownerUseDifferentDomain.mockRejectedValue(
      new db.OwnerDomainRefused("too_late", "late"),
    );
    expect(await A.useDifferentDomainAction()).toMatchObject({
      code: "DOM-TOO-LATE",
      message: "late",
    });
  });

  it("primary choice accepts apex|www only", async () => {
    for (const bad of ["APEX", "", null, "root"]) {
      expect(await A.setPrimaryChoiceAction(bad)).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
    expect(db.ownerSetPrimaryChoice).not.toHaveBeenCalled();
    db.ownerSetPrimaryChoice.mockResolvedValue({
      choice: "www",
      swapped: false,
      primary: null,
    });
    expect(await A.setPrimaryChoiceAction("www")).toEqual({
      ok: true,
      data: { choice: "www", swapped: false },
    });
    expect(db.ownerSetPrimaryChoice).toHaveBeenCalledWith(CTX, "www");
  });

  it("a plain InvalidInput (closed feature) passes its copy through", async () => {
    db.ownerSetPrimaryChoice.mockRejectedValue(
      new InvalidInput(P14_COPY.DOM_CLOSED),
    );
    expect(await A.setPrimaryChoiceAction("apex")).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: P14_COPY.DOM_CLOSED,
    });
  });
});

describe("domainStatusAction", () => {
  it("returns the state and the fingerprint, with no revalidation", async () => {
    db.ownerDomainView.mockResolvedValue(VIEW);
    expect(await A.domainStatusAction()).toEqual({
      ok: true,
      data: { state: "checking", mark: "checking:0:0::0" },
    });
    expect(db.ownerDomainView).toHaveBeenCalledWith(CTX);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
