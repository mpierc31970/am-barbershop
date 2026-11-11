// 13-43 Task 1: site Actions tab server side (STAFF-06, STAFF-19, STAFF-22; T-13-43-01,
// T-13-43-03, T-13-43-04). @cds/db and the staff session are mocked; the real matrix, step-up
// gate, same-origin check, capped body reader and error mapping run.
import { authorizeStaff, InvalidInput } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  staffCan: vi.fn(),
}));
const db = vi.hoisted(() => ({
  SUSPENSION_TEXT_MAX: 1000,
  CDS_NOTE_BODY_MAX: 5000,
  CDS_NOTE_TITLE_MAX: 80,
  CDS_DOCUMENT_NOTE_MAX: 500,
  CDS_DOCUMENT_TITLE_MAX: 120,

  SUPPORT_FILE_MAX_BYTES: 10 * 1024 * 1024,
  installAddonAsStaff: vi.fn(),
  uninstallAddonAsStaff: vi.fn(),
  staffPostConversationMessage: vi.fn(),
  staffPostNote: vi.fn(),
  staffShareDocument: vi.fn(),
  staffSupportLabels: vi.fn(),
  staffSendSuspensionNotice: vi.fn(),
  staffSuspendNow: vi.fn(),
  staffMarkFixed: vi.fn(),
  staffLiftSuspension: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { get: () => undefined, list: () => [] },
}));
vi.mock("../lib/addons", () => ({ addonDeps: () => ({}) }));
vi.mock("../lib/invalidator", () => ({ nextInvalidator: { tag: "inv" } }));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const susp = await import("../app/actions/staff/suspension");
const sites = await import("../app/actions/staff/sites");
const route =
  await import("../app/(platform)/staff/api/sites/[org]/document/route");

const ORG = "abcdefghijklmno";

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  sess.staffCan.mockImplementation((role: string, feature: string) => {
    try {
      authorizeStaff(role as "super_admin", feature);
      return true;
    } catch {
      return false;
    }
  });
  db.staffSupportLabels.mockResolvedValue({ orgs: { [ORG]: "Rivera Bakery" } });
  db.staffSendSuspensionNotice.mockResolvedValue({
    orgId: ORG,
    fixBy: "2026-10-16T22:00:00.000Z",
    emailed: 1,
    alerted: 1,
  });
  db.staffSuspendNow.mockResolvedValue({
    orgId: ORG,
    suspendedAt: "2026-10-13T15:00:00.000Z",
    emailed: 1,
    alerted: 1,
  });
  db.staffMarkFixed.mockResolvedValue({ orgId: ORG, fixedAt: "x" });
  db.staffLiftSuspension.mockResolvedValue({
    orgId: ORG,
    liftedAt: "x",
    emailed: 1,
    alerted: 1,
  });
  db.staffPostNote.mockResolvedValue({ id: "note00000000001", raised: 3 });
  db.staffPostConversationMessage.mockResolvedValue({
    messageId: "m00000000000001",
    threadId: "t00000000000001",
    raised: 0,
  });
  db.staffShareDocument.mockResolvedValue({
    id: "doc000000000001",
    raised: 3,
  });
});

describe("suspension actions", () => {
  it("suspendNowAction as an agent is REFUSED-ROLE and never reaches @cds/db", async () => {
    const res = await susp.suspendNowAction(ORG, {
      category: "illegal",
      note: "Phishing kit",
    });
    expect(res).toMatchObject({ ok: false, message: P13_COPY.REFUSED_ROLE });
    expect(db.staffSuspendNow).not.toHaveBeenCalled();
  });

  it("suspendNowAction as a super admin with a stale sign-in asks for step-up", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await susp.suspendNowAction(ORG, {
      category: "illegal",
      note: "Phishing kit",
    });
    expect(res).toEqual({ ok: false, code: "step_up_needed", message: "" });
    expect(db.staffSuspendNow).not.toHaveBeenCalled();
  });

  it("suspendNowAction fresh calls staffSuspendNow with the note, category and invalidator", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await susp.suspendNowAction(ORG, {
      category: "legal_demand",
      note: "Court order 12",
      message: "A court ordered this page removed.",
    });
    expect(res).toEqual({
      ok: true,
      data: { message: "Rivera Bakery is offline. The owner was told." },
    });
    expect(db.staffSuspendNow).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "super_admin" }),
      {
        orgId: ORG,
        category: "legal_demand",
        note: "Court order 12",
        message: "A court ordered this page removed.",
      },
      { invalidator: { tag: "inv" } },
    );
  });

  it("suspendNowAction needs a staff note and an immediate category", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(
      await susp.suspendNowAction(ORG, { category: "illegal", note: "  " }),
    ).toMatchObject({ ok: false, field: "note" });
    expect(
      await susp.suspendNowAction(ORG, { category: "guideline", note: "x" }),
    ).toMatchObject({ ok: false, field: "category" });
    expect(db.staffSuspendNow).not.toHaveBeenCalled();
  });

  it("sendNoticeAction as an agent calls staffSendSuspensionNotice (no step-up)", async () => {
    const res = await susp.sendNoticeAction(ORG, {
      category: "guideline",
      message: "Remove the fake discount codes.",
      note: "Spot check R-40",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Notice sent to Rivera Bakery. Fix by Fri 16 Oct.",
        fixBy: "2026-10-16T22:00:00.000Z",
      },
    });
    expect(db.staffSendSuspensionNotice).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "support_agent" }),
      {
        orgId: ORG,
        category: "guideline",
        message: "Remove the fake discount codes.",
        note: "Spot check R-40",
      },
      { invalidator: { tag: "inv" } },
    );
  });

  it("sendNoticeAction needs what to fix and refuses a bad org id", async () => {
    expect(
      await susp.sendNoticeAction(ORG, { category: "guideline", message: "" }),
    ).toMatchObject({ ok: false, field: "message" });
    expect(
      await susp.sendNoticeAction("../x", {
        category: "guideline",
        message: "x",
      }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(db.staffSendSuspensionNotice).not.toHaveBeenCalled();
  });

  it("a refusal from @cds/db comes back as its message", async () => {
    db.staffSendSuspensionNotice.mockRejectedValue(
      new InvalidInput("This site already has an open notice."),
    );
    const res = await susp.sendNoticeAction(ORG, {
      category: "guideline",
      message: "Fix it",
    });
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "This site already has an open notice.",
    });
  });

  it("markFixedAction runs for an agent; liftSuspensionAction is super_admin + step-up", async () => {
    expect(await susp.markFixedAction(ORG)).toMatchObject({ ok: true });
    expect(db.staffMarkFixed).toHaveBeenCalledWith(expect.anything(), ORG);

    expect(await susp.liftSuspensionAction(ORG)).toMatchObject({
      ok: false,
      message: P13_COPY.REFUSED_ROLE,
    });
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await susp.liftSuspensionAction(ORG)).toMatchObject({
      code: "step_up_needed",
    });
    expect(db.staffLiftSuspension).not.toHaveBeenCalled();
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(await susp.liftSuspensionAction(ORG)).toEqual({
      ok: true,
      data: { message: "Rivera Bakery is back online. The owner was told." },
    });
    expect(db.staffLiftSuspension).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      { invalidator: { tag: "inv" } },
    );
  });
});

describe("postToSiteAction", () => {
  it("a pinned note goes to staffPostNote with pinned true and the CLI result line", async () => {
    const res = await sites.postToSiteAction({
      orgId: ORG,
      kind: "note",
      title: "  Holiday   hours ",
      body: "We are closed on the 24th.",
      pinned: true,
    });
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Posted. Bell and email (logged) for 3 people.",
        raised: 3,
      },
    });
    expect(db.staffPostNote).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      title: "Holiday hours",
      body: "We are closed on the 24th.",
      pinned: true,
    });
    expect(db.staffPostConversationMessage).not.toHaveBeenCalled();
  });

  it("an internal message sets the internal flag and alerts nobody", async () => {
    const res = await sites.postToSiteAction({
      orgId: ORG,
      kind: "internal_message",
      body: "Owner prefers phone.",
    });
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Saved as an internal note. The owner never sees it." },
    });
    expect(db.staffPostConversationMessage).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: ORG, body: "Owner prefers phone.", internal: true },
    );
  });

  it("a public message is not internal; pinned is ignored outside notes", async () => {
    db.staffPostConversationMessage.mockResolvedValue({
      messageId: "m",
      threadId: "t",
      raised: 1,
    });
    const res = await sites.postToSiteAction({
      orgId: ORG,
      kind: "message",
      body: "Your new page is ready.",
      pinned: true,
    });
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Posted. Bell and email (logged) for 1 person." },
    });
    expect(db.staffPostConversationMessage).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: ORG, body: "Your new page is ready.", internal: false },
    );
  });

  it("refuses an unknown kind, an empty body and a note without a title", async () => {
    expect(
      await sites.postToSiteAction({ orgId: ORG, kind: "document", body: "x" }),
    ).toMatchObject({ ok: false, field: "kind" });
    expect(
      await sites.postToSiteAction({ orgId: ORG, kind: "message", body: " " }),
    ).toMatchObject({ ok: false, field: "body" });
    expect(
      await sites.postToSiteAction({ orgId: ORG, kind: "note", body: "x" }),
    ).toMatchObject({ ok: false, field: "title" });
    expect(db.staffPostNote).not.toHaveBeenCalled();
    expect(db.staffPostConversationMessage).not.toHaveBeenCalled();
  });

  it("a signed-out caller gets SESSION-ENDED", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    expect(
      await sites.postToSiteAction({ orgId: ORG, kind: "message", body: "x" }),
    ).toMatchObject({ ok: false, code: "session_ended" });
  });
});

describe("POST /staff/api/sites/<org>/document", () => {
  const PARAMS = { params: Promise.resolve({ org: ORG }) };

  function upload(
    opts: {
      origin?: string;
      title?: string;
      bytes?: Uint8Array<ArrayBuffer>;
      files?: number;
    } = {},
  ): Request {
    const form = new FormData();
    form.set("title", opts.title ?? "Your launch checklist");
    form.set("note", "Read before Friday.");
    const n = opts.files ?? 1;
    for (let i = 0; i < n; i++) {
      form.append(
        "file",
        new File(
          [opts.bytes ?? new TextEncoder().encode("%PDF-1.4 x")],
          `checklist-${i}.pdf`,
          { type: "application/pdf" },
        ),
      );
    }
    return new Request(`http://console.test/staff/api/sites/${ORG}/document`, {
      method: "POST",
      headers: {
        host: "console.test",
        ...(opts.origin ? { origin: opts.origin } : {}),
      },
      body: form,
    });
  }

  it("cross-origin → 403, the session is never read", async () => {
    const res = await route.POST(
      upload({ origin: "https://evil.test" }),
      PARAMS,
    );
    expect(res.status).toBe(403);
    expect(sess.getStaffSession).not.toHaveBeenCalled();
    expect(db.staffShareDocument).not.toHaveBeenCalled();
  });

  it("no staff session → 401", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await route.POST(upload(), PARAMS);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: P13_COPY.SESSION_ENDED });
  });

  it("an 11 MB file → 413 error JSON, the db is never called", async () => {
    const res = await route.POST(
      upload({ bytes: new Uint8Array(11 * 1024 * 1024) }),
      PARAMS,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/10 MB/);
    expect(db.staffShareDocument).not.toHaveBeenCalled();
  });

  it("two files or no title are refused", async () => {
    expect((await route.POST(upload({ files: 2 }), PARAMS)).status).toBe(400);
    expect((await route.POST(upload({ title: " " }), PARAMS)).status).toBe(400);
    expect((await route.POST(upload({ files: 0 }), PARAMS)).status).toBe(400);
    expect(db.staffShareDocument).not.toHaveBeenCalled();
  });

  it("a bad org id → 404", async () => {
    const res = await route.POST(upload(), {
      params: Promise.resolve({ org: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("same origin → staffShareDocument with the bytes, the CLI result line", async () => {
    const res = await route.POST(
      upload({ origin: "http://console.test" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Posted. Bell and email (logged) for 3 people.",
      id: "doc000000000001",
      raised: 3,
    });
    const [, input] = db.staffShareDocument.mock.calls[0]!;
    expect(input).toMatchObject({
      orgId: ORG,
      title: "Your launch checklist",
      note: "Read before Friday.",
      filename: "checklist-0.pdf",
    });
    expect(input.bytes).toBeInstanceOf(Uint8Array);
  });

  it("a type refusal from @cds/db is a 400 with its message", async () => {
    db.staffShareDocument.mockRejectedValue(
      new InvalidInput("That file type isn't allowed."),
    );
    const res = await route.POST(upload(), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That file type isn't allowed.");
  });
});
