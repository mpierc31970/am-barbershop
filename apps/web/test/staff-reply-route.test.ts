// 13-41 Task 2: POST /staff/api/tickets/<n>/reply (choice 4; STAFF-08, P13-P20; T-13-41-02,
// T-13-41-03). @cds/db and the staff session are mocked; the real same-origin check, capped
// body reader and matrix run.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  staffCan: vi.fn(),
}));
const db = vi.hoisted(() => ({
  SUPPORT_FILE_MAX_BYTES: 10 * 1024 * 1024,
  SUPPORT_FILES_PER_MESSAGE: 5,
  staffReplyToTicket: vi.fn(),
  staffSupportLabels: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const route =
  await import("../app/(platform)/staff/api/tickets/[number]/reply/route");

const ORG = "aaaaaaaaaaaaaaa";

function session(role: "super_admin" | "support_agent") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

function reply(
  opts: {
    origin?: string;
    body?: string;
    internal?: boolean;
    status?: string;
    files?: { name: string; bytes: Uint8Array<ArrayBuffer> }[];
  } = {},
): Request {
  const form = new FormData();
  form.set("body", opts.body ?? "See the attached quote.");
  form.set("internal", opts.internal ? "1" : "0");
  if (opts.status) form.set("status", opts.status);
  for (const f of opts.files ?? [
    { name: "quote.pdf", bytes: new TextEncoder().encode("%PDF-1.4 x") },
  ]) {
    form.append(
      "file",
      new File([f.bytes], f.name, { type: "application/pdf" }),
    );
  }
  return new Request("http://console.test/staff/api/tickets/1042/reply", {
    method: "POST",
    headers: {
      host: "console.test",
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body: form,
  });
}

const PARAMS = { params: Promise.resolve({ number: "1042" }) };

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
  db.staffReplyToTicket.mockResolvedValue({
    messageId: "m00000000000001",
    orgId: ORG,
    recipients: 2,
    raised: 2,
    emailed: 2,
    statusFrom: "in_progress",
    statusTo: "waiting_on_you",
  });
  db.staffSupportLabels.mockResolvedValue({ orgs: { [ORG]: "Rivera Bakery" } });
});

describe("POST /staff/api/tickets/<n>/reply", () => {
  it("cross-origin → 403, the session is never read", async () => {
    const res = await route.POST(
      reply({ origin: "https://evil.test" }),
      PARAMS,
    );
    expect(res.status).toBe(403);
    expect(sess.getStaffSession).not.toHaveBeenCalled();
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("no staff session → 401 SESSION-ENDED", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await route.POST(
      reply({ origin: "http://console.test" }),
      PARAMS,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: P13_COPY.SESSION_ENDED });
  });

  it("a role without support_reply → 403 REFUSED-ROLE before the body is read", async () => {
    sess.staffCan.mockReturnValue(false);
    const res = await route.POST(reply(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: P13_COPY.REFUSED_ROLE });
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("an oversized body → 413 error JSON, the db is never called", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const res = await route.POST(
      reply({
        files: Array.from({ length: 5 }, (_, i) => ({
          name: `big-${i}.pdf`,
          bytes: big,
        })),
      }),
      PARAMS,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/10 MB/);
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("WR-C01: three 8 MB files (24 MB, over the 22 MB middleware buffer) → 413 naming 20 MB", async () => {
    const eight = new Uint8Array(8 * 1024 * 1024);
    const res = await route.POST(
      reply({
        files: Array.from({ length: 3 }, (_, i) => ({
          name: `p-${i}.pdf`,
          bytes: eight,
        })),
      }),
      PARAMS,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/20 MB in one reply/);
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("WR-C01: two 9 MB files (18 MB) are within the reply total", async () => {
    const nine = new Uint8Array(9 * 1024 * 1024);
    const res = await route.POST(
      reply({
        files: Array.from({ length: 2 }, (_, i) => ({
          name: `p-${i}.pdf`,
          bytes: nine,
        })),
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    expect(db.staffReplyToTicket).toHaveBeenCalledTimes(1);
  });

  it("more than 5 files → 400", async () => {
    const tiny = new TextEncoder().encode("%PDF-1.4");
    const res = await route.POST(
      reply({
        files: Array.from({ length: 6 }, (_, i) => ({
          name: `f-${i}.pdf`,
          bytes: tiny,
        })),
      }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("junk ticket number → 404; unknown status → 400", async () => {
    let res = await route.POST(reply(), {
      params: Promise.resolve({ number: "abc" }),
    });
    expect(res.status).toBe(404);
    res = await route.POST(reply({ status: "lost" }), PARAMS);
    expect(res.status).toBe(400);
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("valid with one file → staffReplyToTicket gets the file; the CLI line comes back", async () => {
    const res = await route.POST(
      reply({ origin: "http://console.test", status: "waiting_on_you" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Sent. Rivera Bakery sees it in the hub; 2 alerts raised.",
      messageId: "m00000000000001",
      raised: 2,
      statusFrom: "in_progress",
      statusTo: "waiting_on_you",
    });
    const [ctx, input] = db.staffReplyToTicket.mock.calls[0]!;
    expect(ctx).toMatchObject({ kind: "platform", staffRole: "support_agent" });
    expect(input.number).toBe(1042);
    expect(input.body).toBe("See the attached quote.");
    expect(input.internal).toBe(false);
    expect(input.status).toBe("waiting_on_you");
    expect(input.files).toHaveLength(1);
    expect(input.files[0].name).toBe("quote.pdf");
    expect(new TextDecoder().decode(input.files[0].bytes)).toBe("%PDF-1.4 x");
  });

  it("an internal note with a file → the internal line, nobody named", async () => {
    db.staffReplyToTicket.mockResolvedValue({
      messageId: "m00000000000002",
      orgId: ORG,
      recipients: 0,
      raised: 0,
      emailed: 0,
      statusFrom: "in_progress",
      statusTo: "in_progress",
    });
    const res = await route.POST(reply({ internal: true }), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(
      "Saved as an internal note. The owner never sees it.",
    );
    expect(db.staffReplyToTicket.mock.calls[0]![1].internal).toBe(true);
    expect(db.staffSupportLabels).not.toHaveBeenCalled();
  });

  it("db refusals map to JSON copy (InvalidInput 400, NotFound 404)", async () => {
    db.staffReplyToTicket.mockRejectedValueOnce(
      new InvalidInput("this ticket is closed; open a new one"),
    );
    let res = await route.POST(reply(), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "this ticket is closed; open a new one",
    );
    db.staffReplyToTicket.mockRejectedValueOnce(new NotFound("ticket"));
    res = await route.POST(reply(), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("That ticket wasn't found.");
  });

  it("an unexpected failure → 500 ERR-SEND, class name logged only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.staffReplyToTicket.mockRejectedValueOnce(new TypeError("secret body"));
    const res = await route.POST(reply(), PARAMS);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(P13_COPY.ERR_SEND);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|quote\.pdf/);
    log.mockRestore();
  });
});
