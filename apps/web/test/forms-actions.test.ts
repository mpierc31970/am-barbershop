// 07-18 Task 1: forms actions (CONT-25; T-07-18-01..04). The session and @cds/db are
// mocked; the real runAction maps refusals to copy. The org always comes from the session,
// only allowlisted keys reach the chokepoint, and bad shapes or ids never reach it.
import { Forbidden } from "@cds/core";
import { FormErrors, PRO_SETTINGS_COPY } from "@cds/core/forms";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const DEPS = { sections: { marker: "registry" } };
const GONE = "This was removed or moved. Reload the page to see the latest.";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/content", () => ({ contentDeps: () => DEPS }));

const db = vi.hoisted(() => ({
  createForm: vi.fn(),
  saveForm: vi.fn(),
  duplicateForm: vi.fn(),
  deleteForm: vi.fn(),
  formUsedOn: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const a = await import("../app/actions/forms");
const { revalidatePath } = await import("next/cache");

const FORM = { id: "f1", name: "Contact" };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  vi.mocked(revalidatePath).mockClear();
});

const body = {
  name: "Contact",
  layout: "2",
  fields: [{ id: "a", type: "email", label: "Email" }],
  after_submit: { kind: "message", message: "Thanks", button_text: "Send" },
  notify_route: "inquiries",
  newsletter_checkbox: true,
  newsletter_wording: "Yes please",
};

describe("saveFormAction", () => {
  it("forwards only the allowlisted keys plus id with the session context", async () => {
    db.saveForm.mockResolvedValue({ form: FORM, held: false });
    const res = await a.saveFormAction({
      id: "f1",
      ...body,
      template: "x",
      organization: "B",
      deleted_at: "2026-01-01",
      inReview: false,
    });
    expect(res).toEqual({
      ok: true,
      data: { saved: { form: FORM, held: false } },
    });
    expect(db.saveForm).toHaveBeenCalledWith(CTX, DEPS, { id: "f1", ...body });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("a held save is a success with held: true", async () => {
    db.saveForm.mockResolvedValue({ form: FORM, held: true });
    const res = await a.saveFormAction({ id: "f1", ...body });
    expect(res).toEqual({
      ok: true,
      data: { saved: { form: FORM, held: true } },
    });
  });

  it("FormErrors come back as data keyed by field", async () => {
    db.saveForm.mockRejectedValue(
      new FormErrors({ a: "Add a label.", name: "Add a name for this form." }),
    );
    const res = await a.saveFormAction({ id: "f1", ...body });
    expect(res).toEqual({
      ok: true,
      data: {
        invalid: {
          errors: { a: "Add a label.", name: "Add a name for this form." },
          message: "2 fields need attention",
        },
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["fields not an array", { ...body, fields: "x" }],
    ["fields missing", { name: "x" }],
    [
      "over 40 fields",
      {
        ...body,
        fields: Array.from({ length: 41 }, (_, i) => ({ id: `f${i}` })),
      },
    ],
    ["over 256 KB", { ...body, name: "x".repeat(300 * 1024) }],
  ])("refuses %s before the chokepoint", async (_, input) => {
    const res = await a.saveFormAction({ id: "f1", ...input });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveForm).not.toHaveBeenCalled();
  });

  // 10-39: Forms Pro settings ride the save; the chokepoint decides with the entitlement.
  const pro = {
    rules: [
      {
        target: "b",
        action: "show",
        when: { field: "a", op: "is", value: "x@y.z" },
      },
    ],
    steps: [{ id: "s1", title: "Step 1", fields: ["a", "b"] }],
    auto_reply: { enabled: true, subject: "Thanks", body: "Hi {name}" },
    routing: [{ field: "a", value: "x", route: "default" }],
    save_resume: true,
  };

  it("forwards a well-formed pro, rebuilt with only its known keys", async () => {
    db.saveForm.mockResolvedValue({ form: FORM, held: false });
    const res = await a.saveFormAction({
      id: "f1",
      ...body,
      pro: {
        ...pro,
        evil: true,
        rules: [{ ...pro.rules[0], __proto__x: 1 }],
        auto_reply: { ...pro.auto_reply, to: "attacker@example.com" },
      },
    });
    expect(res).toMatchObject({ ok: true });
    expect(db.saveForm).toHaveBeenCalledWith(CTX, DEPS, {
      id: "f1",
      ...body,
      pro,
    });
  });

  it("omits pro when it is absent or null (server keeps the stored settings)", async () => {
    db.saveForm.mockResolvedValue({ form: FORM, held: false });
    await a.saveFormAction({ id: "f1", ...body, pro: null });
    expect(db.saveForm).toHaveBeenLastCalledWith(CTX, DEPS, {
      id: "f1",
      ...body,
    });
  });

  it("a chokepoint PRO_SETTINGS refusal comes back as editor data", async () => {
    db.saveForm.mockRejectedValue(new FormErrors({ pro: PRO_SETTINGS_COPY }));
    const res = await a.saveFormAction({ id: "f1", ...body, pro });
    expect(res).toEqual({
      ok: true,
      data: {
        invalid: {
          errors: { pro: PRO_SETTINGS_COPY },
          message: "1 field needs attention",
        },
      },
    });
  });

  it.each([
    ["pro an array", []],
    ["pro a string", "x"],
    ["rules not an array", { ...pro, rules: {} }],
    [
      "over 50 rules",
      { ...pro, rules: Array.from({ length: 51 }, () => pro.rules[0]) },
    ],
    [
      "over 10 steps",
      {
        ...pro,
        steps: Array.from({ length: 11 }, (_, i) => ({
          id: `s${i}`,
          title: "T",
          fields: [],
        })),
      },
    ],
    [
      "over 10 routes",
      { ...pro, routing: Array.from({ length: 11 }, () => pro.routing[0]) },
    ],
    [
      "a rule op that is not text",
      {
        ...pro,
        rules: [{ ...pro.rules[0], when: { field: "a", op: 3, value: "" } }],
      },
    ],
    [
      "a step title over 60",
      { ...pro, steps: [{ id: "s1", title: "x".repeat(61), fields: ["a"] }] },
    ],
    [
      "step fields not text",
      { ...pro, steps: [{ id: "s1", title: "T", fields: [1] }] },
    ],
    [
      "an auto-reply body over 2000",
      {
        ...pro,
        auto_reply: { enabled: true, subject: "s", body: "x".repeat(2001) },
      },
    ],
    [
      "auto_reply enabled not boolean",
      { ...pro, auto_reply: { enabled: "yes", subject: "", body: "" } },
    ],
    ["save_resume not boolean", { ...pro, save_resume: "true" }],
    [
      "a route value over 120",
      {
        ...pro,
        routing: [{ field: "a", value: "x".repeat(121), route: "default" }],
      },
    ],
  ])("refuses malformed pro (%s) before the chokepoint", async (_, bad) => {
    const res = await a.saveFormAction({ id: "f1", ...body, pro: bad });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveForm).not.toHaveBeenCalled();
  });

  it("a bad id is the GONE copy with no chokepoint call", async () => {
    const res = await a.saveFormAction({ id: "../x", ...body });
    expect(res).toEqual({ ok: false, code: "invalid_input", message: GONE });
    expect(db.saveForm).not.toHaveBeenCalled();
  });

  it("Forbidden (Viewer) surfaces as the forbidden copy", async () => {
    db.saveForm.mockRejectedValue(new Forbidden("no"));
    const res = await a.saveFormAction({ id: "f1", ...body });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("signed out never reaches the chokepoint", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await a.saveFormAction({ id: "f1", ...body });
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.saveForm).not.toHaveBeenCalled();
  });
});

describe("createFormAction", () => {
  it("passes only the template (and a name) and returns id and name", async () => {
    db.createForm.mockResolvedValue({ form: FORM, held: false });
    const res = await a.createFormAction({
      template: "contact",
      organization: "B",
    });
    expect(res).toEqual({ ok: true, data: { id: "f1", name: "Contact" } });
    expect(db.createForm).toHaveBeenCalledWith(CTX, DEPS, {
      template: "contact",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("forwards a name", async () => {
    db.createForm.mockResolvedValue({ form: FORM, held: false });
    await a.createFormAction({ template: "blank", name: "Mine" });
    expect(db.createForm).toHaveBeenCalledWith(CTX, DEPS, {
      template: "blank",
      name: "Mine",
    });
  });

  it.each([
    { template: "evil" },
    {},
    null,
    { template: "contact", name: "x".repeat(81) },
  ])("refuses %j before the chokepoint", async (input) => {
    const res = await a.createFormAction(input);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.createForm).not.toHaveBeenCalled();
  });
});

describe("duplicate, delete and usedOn", () => {
  it("duplicateFormAction returns the copy", async () => {
    db.duplicateForm.mockResolvedValue({
      form: { id: "f2", name: "Copy of Contact" },
      held: false,
    });
    const res = await a.duplicateFormAction("f1");
    expect(res).toEqual({
      ok: true,
      data: { id: "f2", name: "Copy of Contact" },
    });
    expect(db.duplicateForm).toHaveBeenCalledWith(CTX, DEPS, "f1");
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("deleteFormAction soft-deletes through the chokepoint", async () => {
    db.deleteForm.mockResolvedValue(undefined);
    const res = await a.deleteFormAction("f1");
    expect(res).toEqual({ ok: true, data: null });
    expect(db.deleteForm).toHaveBeenCalledWith(CTX, DEPS, "f1");
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("formUsedOnAction passes the section registry", async () => {
    const used = {
      pages: [{ id: "p1", title: "Home" }],
      inVersions: false,
      inPopups: 0,
    };
    db.formUsedOn.mockResolvedValue(used);
    const res = await a.formUsedOnAction("f1");
    expect(res).toEqual({ ok: true, data: used });
    expect(db.formUsedOn).toHaveBeenCalledWith(CTX, DEPS.sections, "f1");
  });

  it.each([
    ["duplicateFormAction", "duplicateForm"],
    ["deleteFormAction", "deleteForm"],
    ["formUsedOnAction", "formUsedOn"],
  ] as const)("%s refuses a bad id with GONE", async (action, dbFn) => {
    for (const bad of ["", "a/b", 7, "x".repeat(33), { id: "f1" }]) {
      const res = await a[action](bad);
      expect(res).toEqual({ ok: false, code: "invalid_input", message: GONE });
    }
    expect(db[dbFn]).not.toHaveBeenCalled();
  });

  it("revalidate failures never fail the write", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("outside a request");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.deleteForm.mockResolvedValue(undefined);
    const res = await a.deleteFormAction("f1");
    expect(res).toEqual({ ok: true, data: null });
    spy.mockRestore();
  });
});
