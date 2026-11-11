// 07-19 Task 2: Inbox actions (CONT-25; T-07-19-08, T-07-19-09). Session and @cds/db are
// mocked; the real runAction maps refusals to copy. No action takes a tenant id; only
// allow-listed keys reach the chokepoint.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const GONE = "This was removed or moved. Reload the page to see the latest.";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  getSubmission: vi.fn(),
  setSubmissionRead: vi.fn(),
  markNotSpam: vi.fn(),
  deleteSubmission: vi.fn(),
  exportSubmissionsCsv: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const a = await import("../app/actions/inbox");
const { revalidatePath } = await import("next/cache");

beforeEach(() => {
  vi.clearAllMocks();
  sess.getHubSession.mockResolvedValue({ ctx: CTX });
  db.listSubmissions.mockResolvedValue({
    items: [],
    page: 1,
    perPage: 50,
    totalItems: 0,
    totalPages: 0,
  });
  db.getSubmission.mockResolvedValue({ id: "m1", readAt: null, answers: [] });
});

describe("inbox actions", () => {
  it("lists with allow-listed keys and perPage 50", async () => {
    const res = await a.listMessagesAction({
      view: "filtered",
      form: "f1",
      q: "hi",
      page: 2,
      organization: "B",
    });
    expect(res.ok).toBe(true);
    expect(db.listSubmissions).toHaveBeenCalledWith(CTX, {
      view: "filtered",
      form: "f1",
      q: "hi",
      page: 2,
      perPage: 50,
    });
  });

  it("falls back to messages and caps q", async () => {
    await a.listMessagesAction({
      view: "spam",
      q: "x".repeat(300),
      form: "../x",
    });
    const opts = db.listSubmissions.mock.calls[0]![1];
    expect(opts.view).toBe("messages");
    expect(opts.q).toHaveLength(100);
    expect(opts.form).toBeUndefined();
  });

  it("opens a message and marks it read", async () => {
    const res = await a.openMessageAction("m1");
    expect(db.getSubmission).toHaveBeenCalledWith(CTX, "m1");
    expect(db.setSubmissionRead).toHaveBeenCalledWith(CTX, "m1", true);
    expect(res.ok && res.data.read).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/hub/inbox");
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("marks unread, not spam and deletes", async () => {
    await a.setMessageReadAction("m1", false);
    expect(db.setSubmissionRead).toHaveBeenCalledWith(CTX, "m1", false);
    await a.markNotSpamAction("m1");
    expect(db.markNotSpam).toHaveBeenCalledWith(CTX, "m1");
    await a.deleteMessageAction("m1");
    expect(db.deleteSubmission).toHaveBeenCalledWith(CTX, "m1");
  });

  it("exports one form's CSV", async () => {
    db.exportSubmissionsCsv.mockResolvedValue({ filename: "c.csv", csv: "a" });
    const res = await a.exportMessagesAction("f1");
    expect(res).toEqual({ ok: true, data: { filename: "c.csv", csv: "a" } });
  });

  it("refuses a bad id with the GONE copy before the chokepoint", async () => {
    const res = await a.deleteMessageAction("../x");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toBe(GONE);
    expect(db.deleteSubmission).not.toHaveBeenCalled();
    const ex = await a.exportMessagesAction({ id: "f1" });
    expect(ex.ok).toBe(false);
    expect(db.exportSubmissionsCsv).not.toHaveBeenCalled();
  });

  it("maps Forbidden (a Viewer deleting) to the forbidden result", async () => {
    db.deleteSubmission.mockRejectedValue(new Forbidden("no"));
    const res = await a.deleteMessageAction("m1");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("forbidden");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
