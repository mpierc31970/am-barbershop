// 13-41 Task 2: canned reply actions (choice 5; STAFF-09, D96). @cds/db and the staff session are
// mocked; the real matrix (authorizeStaff inside runStaffAction), input checks and error mapping
// run. Archive then restore toggles `archived`; no delete action exists.
import { InvalidInput, NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  staffSaveCanned: vi.fn(),
  staffArchiveCanned: vi.fn(),
  staffRestoreCanned: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/canned");
const { kit, resetStaffKit } = await import("./staff-test-kit");

const ID = "c00000000000001";

function session(role: "super_admin" | "support_agent") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Lee Agent",
    role,
    maskedEmail: "l•••@example.test",
  };
}

function replyRow(archivedAt: string | null) {
  return {
    id: ID,
    title: "Need more detail",
    body: "Hi {first_name}, can you send a screenshot?",
    archivedAt,
    created: "2026-10-01 10:00:00.000Z",
    updated: "2026-10-03 10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  let archived: string | null = null;
  db.staffArchiveCanned.mockImplementation(async () => {
    archived ??= "2026-10-16T10:00:00.000Z";
    return replyRow(archived);
  });
  db.staffRestoreCanned.mockImplementation(async () => {
    archived = null;
    return replyRow(archived);
  });
  db.staffSaveCanned.mockImplementation(async (_ctx, input) => ({
    ...replyRow(null),
    title: String(input.title).trim(),
    body: input.body,
  }));
});

describe("canned actions", () => {
  it("exports save, archive and restore only (no delete)", () => {
    expect(Object.keys(actions).sort()).toEqual([
      "archiveCannedAction",
      "restoreCannedAction",
      "saveCannedAction",
    ]);
  });

  it("archive then restore toggles archived (support_agent, no step-up)", async () => {
    const a = await actions.archiveCannedAction(ID);
    expect(a).toEqual({
      ok: true,
      data: {
        message: "Archived “Need more detail”.",
        reply: replyRow(a.ok ? a.data.reply.archivedAt : null),
      },
    });
    expect(a.ok && a.data.reply.archivedAt).toBeTruthy();
    const r = await actions.restoreCannedAction(ID);
    expect(r.ok && r.data.reply.archivedAt).toBeNull();
    expect(r.ok && r.data.message).toBe("Restored “Need more detail”.");
    expect(db.staffArchiveCanned).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "platform" }),
      ID,
    );
    expect(kit.revalidated.length).toBeGreaterThan(0);
  });

  it("save creates (no id) and edits (id); db refusals carry the field", async () => {
    const created = await actions.saveCannedAction({
      title: "Thanks",
      body: "Thanks {first_name}!",
    });
    expect(created.ok && created.data.message).toBe("Saved “Thanks”.");
    expect(db.staffSaveCanned.mock.calls[0]![1]).toEqual({
      title: "Thanks",
      body: "Thanks {first_name}!",
    });
    await actions.saveCannedAction({ id: ID, title: "T", body: "B" });
    expect(db.staffSaveCanned.mock.calls[1]![1]).toEqual({
      id: ID,
      title: "T",
      body: "B",
    });
    db.staffSaveCanned.mockRejectedValueOnce(
      new InvalidInput(
        "{price} isn't a placeholder. Use {first_name}, {business}, {ticket} or {agent}.",
      ),
    );
    const bad = await actions.saveCannedAction({ title: "Q", body: "{price}" });
    expect(bad).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "body",
    });
    db.staffSaveCanned.mockRejectedValueOnce(
      new InvalidInput("Give the reply a title."),
    );
    const noTitle = await actions.saveCannedAction({ title: " ", body: "x" });
    expect(noTitle).toMatchObject({ ok: false, field: "title" });
  });

  it("junk ids and payloads are refused before the db", async () => {
    expect(await actions.archiveCannedAction("../x")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await actions.restoreCannedAction(42)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await actions.saveCannedAction({ title: 1, body: "x" }),
    ).toMatchObject({ ok: false, field: "title" });
    expect(
      await actions.saveCannedAction({ title: "t", body: "x".repeat(20_000) }),
    ).toMatchObject({ ok: false, field: "body" });
    expect(db.staffArchiveCanned).not.toHaveBeenCalled();
    expect(db.staffSaveCanned).not.toHaveBeenCalled();
  });

  it("signed out → session_ended; NotFound → not_found copy", async () => {
    sess.getStaffSession.mockResolvedValueOnce(null);
    expect(await actions.archiveCannedAction(ID)).toEqual({
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    });
    db.staffRestoreCanned.mockRejectedValueOnce(new NotFound("canned"));
    expect(await actions.restoreCannedAction(ID)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
