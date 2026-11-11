// 06-18 Task 2: setup actions (ONB-01, ONB-02; CONTEXT A3-Q4; 06-UI-SPEC "Setup overview"
// Send to CDS, "Stages" autosave; T-06-87, T-06-88, T-06-89). The session, @cds/db and the
// registry are mocked; the real runAction maps refusals to copy.
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  RateLimited,
} from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const REGISTRY = vi.hoisted(() => ({ registry: true }));
vi.mock("@cds/addon-registry/server", () => ({ ADDON_REGISTRY: REGISTRY }));

const db = vi.hoisted(() => ({
  saveBusinessProfile: vi.fn(),
  saveIntakeAnswers: vi.fn(),
  markStageSaved: vi.fn(),
  dismissFirstVisit: vi.fn(),
  sendToCds: vi.fn(),
  enqueueAssembly: vi.fn(),
}));
vi.mock("@cds/db", () => db);
const ASM_DEPS = vi.hoisted(() => ({ assembly: true }));
vi.mock("../lib/assembly-deps", () => ({ assemblyDeps: () => ASM_DEPS }));
// 13-52 (D270): the profile save passes contentDeps() for the live publish scan.
const CONTENT_DEPS = vi.hoisted(() => ({ content: true }));
vi.mock("../lib/content", () => ({ contentDeps: () => CONTENT_DEPS }));

const {
  saveProfileAction,
  saveAnswersAction,
  markStageSavedAction,
  dismissFirstVisitAction,
  sendToCdsAction,
} = await import("../app/actions/intake");
const { PROFILE_KEYS, ANSWER_KEYS, pickKeys } = await import("../lib/intake");
const { revalidatePath } = await import("next/cache");

class IntakeIncomplete extends InvalidInput {
  override readonly code: string = "intake_incomplete";
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  vi.mocked(revalidatePath).mockClear();
});

describe("saveProfileAction", () => {
  it("forwards allow-listed keys only, then marks the step saved", async () => {
    db.saveBusinessProfile.mockResolvedValue({
      id: "bp1",
      orgName: "Rivera Bakery",
      phone: "512 555 0100",
    });
    const res = await saveProfileAction("contact", {
      phone: "512 555 0100",
      organization: "org2",
      orgId: "org2",
      __proto__: { polluted: true },
      role: "owner",
    } as Record<string, unknown>);
    expect(res).toEqual({
      ok: true,
      data: { id: "bp1", orgName: "Rivera Bakery", phone: "512 555 0100" },
    });
    expect(db.saveBusinessProfile).toHaveBeenCalledWith(
      CTX,
      { phone: "512 555 0100" },
      CONTENT_DEPS,
    );
    expect(db.markStageSaved).toHaveBeenCalledWith(CTX, "contact");
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("returns the field copy of an invalid value and does not mark the step", async () => {
    db.saveBusinessProfile.mockRejectedValue(
      new InvalidInput(
        "That doesn't look like a phone number. Check it and try again.",
      ),
    );
    const res = await saveProfileAction("contact", { phone: "abc" });
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      message: "That doesn't look like a phone number. Check it and try again.",
    });
    expect(db.markStageSaved).not.toHaveBeenCalled();
  });

  it("refuses an unknown step before touching the database", async () => {
    const res = await saveProfileAction("nope" as never, { phone: "1" });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("an editor gets the forbidden copy (business write is owner/admin)", async () => {
    db.saveBusinessProfile.mockRejectedValue(new Forbidden("x"));
    const res = await saveProfileAction("the-rest", { legal_name: "X LLC" });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("a signed-out session never reaches the database", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await saveProfileAction("contact", { phone: "1" });
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.saveBusinessProfile).not.toHaveBeenCalled();
  });
});

describe("saveAnswersAction / markStageSavedAction / dismissFirstVisitAction", () => {
  it("saves answers (allow-listed) and marks the step", async () => {
    db.saveIntakeAnswers.mockResolvedValue({ domain_choice: "have" });
    const res = await saveAnswersAction("the-rest", {
      domain_choice: "have",
      phone: "x",
      organization: "org2",
    });
    expect(res).toEqual({ ok: true, data: { domain_choice: "have" } });
    expect(db.saveIntakeAnswers).toHaveBeenCalledWith(CTX, {
      domain_choice: "have",
    });
    expect(db.markStageSaved).toHaveBeenCalledWith(CTX, "the-rest");
  });

  it("marks a step saved and dismisses the first visit", async () => {
    expect(await markStageSavedAction("email")).toEqual({
      ok: true,
      data: null,
    });
    expect(db.markStageSaved).toHaveBeenCalledWith(CTX, "email");
    expect(await dismissFirstVisitAction()).toEqual({ ok: true, data: null });
    expect(db.dismissFirstVisit).toHaveBeenCalledWith(CTX);
  });
});

describe("sendToCdsAction (T-06-87)", () => {
  it("sends with the registry and returns the time and stage", async () => {
    const at = new Date("2026-09-28T12:00:00Z");
    db.sendToCds.mockResolvedValue({
      submittedAt: at,
      stage: "ready_for_build",
    });
    db.enqueueAssembly.mockClear();
    const res = await sendToCdsAction();
    expect(db.sendToCds).toHaveBeenCalledWith(CTX, REGISTRY);
    expect(res).toEqual({
      ok: true,
      data: { submittedAt: at.toISOString(), stage: "ready_for_build" },
    });
    // 08-17: ready_for_build enqueues assembly once, with the session org id.
    expect(db.enqueueAssembly).toHaveBeenCalledTimes(1);
    expect(db.enqueueAssembly).toHaveBeenCalledWith(CTX.orgId, ASM_DEPS);
  });

  it("fit_review: no assembly is enqueued (the sweep runs after approval)", async () => {
    const at = new Date("2026-09-28T12:00:00Z");
    db.sendToCds.mockResolvedValue({ submittedAt: at, stage: "fit_review" });
    db.enqueueAssembly.mockClear();
    expect(await sendToCdsAction()).toEqual({
      ok: true,
      data: { submittedAt: at.toISOString(), stage: "fit_review" },
    });
    expect(db.enqueueAssembly).not.toHaveBeenCalled();
  });

  it("a failed send enqueues nothing", async () => {
    db.enqueueAssembly.mockClear();
    db.sendToCds.mockRejectedValueOnce(new IntakeIncomplete("x"));
    expect(await sendToCdsAction()).toMatchObject({ ok: false });
    expect(db.enqueueAssembly).not.toHaveBeenCalled();
  });

  it("not the owner: owner-only copy", async () => {
    db.sendToCds.mockRejectedValue(new Forbidden("x"));
    expect(await sendToCdsAction()).toEqual({
      ok: false,
      code: "forbidden",
      message: "Only the site owner can send this to CDS.",
    });
  });

  it("staff impersonating: the owner's-step copy", async () => {
    db.sendToCds.mockRejectedValue(new ImpersonationDenied("x"));
    expect(await sendToCdsAction()).toEqual({
      ok: false,
      code: "impersonation_denied",
      message: "Sending to CDS is the owner's step.",
    });
  });

  it("must-haves missing: the unlock hint", async () => {
    db.sendToCds.mockRejectedValue(new IntakeIncomplete("x"));
    expect(await sendToCdsAction()).toEqual({
      ok: false,
      code: "intake_incomplete",
      message: "Send to CDS unlocks when the must-haves are in.",
    });
  });

  it("anything else: ERR-SEND", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.sendToCds.mockRejectedValueOnce(new Error("down"));
    expect(await sendToCdsAction()).toMatchObject({
      ok: false,
      message:
        "Sending didn't finish. Your answers are saved. Try again in a minute.",
    });
    db.sendToCds.mockRejectedValueOnce(new RateLimited("x"));
    expect(await sendToCdsAction()).toMatchObject({
      ok: false,
      code: "rate_limited",
      message:
        "Sending didn't finish. Your answers are saved. Try again in a minute.",
    });
    err.mockRestore();
  });
});

describe("allow-lists (T-06-88)", () => {
  it("cover every profile and answer key, plus org_name", () => {
    expect(PROFILE_KEYS).toContain("org_name");
    expect(PROFILE_KEYS).toContain("ga4_id");
    expect(PROFILE_KEYS).not.toContain("organization");
    expect([...ANSWER_KEYS].sort()).toEqual(
      ["domain", "domain_choice", "domain_ideas", "gbp", "registrar"].sort(),
    );
  });

  it("pickKeys keeps own allowed keys only", () => {
    const raw = JSON.parse('{"gbp":"yes","__proto__":{"x":1},"id":"r1"}');
    expect(pickKeys(raw, ANSWER_KEYS)).toEqual({ gbp: "yes" });
    expect(pickKeys(null, ANSWER_KEYS)).toEqual({});
    expect(pickKeys(["gbp"], ANSWER_KEYS)).toEqual({});
  });
});
