// 12-12 (COMM-01, COMM-07; T-12-12-01, T-12-12-02): /hub/api/support polls one thread for
// public messages newer than a cursor. Session-checked, never cached; a foreign or missing
// thread is the same 404. listThreadMessages scopes to the org and filters internal notes in
// the query (support-threads.integration.test.ts proves it on PocketBase).
import { NotFound } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWN = "threadaaaaaaaa1";
const FOREIGN = "threadbbbbbbbb1";

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
  sessionThrows: false,
}));

const MSG = {
  id: "msgaaaaaaaaaaa1",
  authorKind: "staff",
  authorName: "Mara",
  body: "Your menu page is live.",
  event: null,
  attachments: [],
  created: "2026-10-12 15:00:01.000Z",
};

const db = vi.hoisted(() => ({
  listThreadMessages: vi.fn(),
}));

vi.mock("@cds/db", () => db);
vi.mock("../lib/session", () => ({
  getHubSession: async () => {
    if (state.sessionThrows) throw new Error("fetch failed");
    return state.session;
  },
}));

const { GET } = await import("../app/(platform)/hub/api/support/route");

const get = (q: string) =>
  GET(new Request(`https://cds.example/hub/api/support${q}`));

function ctx(role: string): Record<string, unknown> {
  return {
    orgId: "orgaaaaaaaaaaa1",
    actor: "useraaaaaaaaaa1",
    role,
    grants: [],
    ip: "",
  };
}

beforeEach(() => {
  state.session = { ctx: ctx("viewer") };
  state.sessionThrows = false;
  db.listThreadMessages.mockReset();
  db.listThreadMessages.mockImplementation(async (_c, thread: string) => {
    if (thread !== OWN) throw new NotFound();
    return { messages: [MSG], hasEarlier: false };
  });
});

function expectNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(res.headers.get("Content-Type")).toBe("application/json");
}

describe("/hub/api/support", () => {
  it("signed out is 401 json, no-store, and reads nothing", async () => {
    state.session = null;
    const res = await get(`?thread=${OWN}`);
    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "signed_out" });
    expect(db.listThreadMessages).not.toHaveBeenCalled();
  });

  it("a session outage is 503 json", async () => {
    state.sessionThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get(`?thread=${OWN}`);
      expect(res.status).toBe(503);
      expectNoStore(res);
    } finally {
      spy.mockRestore();
    }
  });

  it("a viewer gets 200 with the delta and a cursor at the newest message", async () => {
    const res = await get(`?thread=${OWN}&since=2026-10-12T15:00:00.000Z`);
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = (await res.json()) as {
      messages: unknown[];
      now: string;
      cursor: string;
    };
    expect(body.messages).toEqual([MSG]);
    expect(body.cursor).toBe("2026-10-12T15:00:01.000Z");
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
    const [passedCtx, thread, opts] = db.listThreadMessages.mock.calls[0]!;
    expect(passedCtx).toEqual(ctx("viewer"));
    expect(thread).toBe(OWN);
    expect((opts as { since: Date }).since.toISOString()).toBe(
      "2026-10-12T15:00:00.000Z",
    );
  });

  it("no new messages keeps the cursor at since", async () => {
    db.listThreadMessages.mockImplementation(async () => ({
      messages: [],
      hasEarlier: false,
    }));
    const res = await get(`?thread=${OWN}&since=2026-10-12T15:00:00.000Z`);
    expect(((await res.json()) as { cursor: string }).cursor).toBe(
      "2026-10-12T15:00:00.000Z",
    );
  });

  it("a foreign thread and a malformed id are the same 404", async () => {
    const a = await get(`?thread=${FOREIGN}`);
    const b = await get(`?thread=..%2Fetc`);
    const c = await get("");
    for (const res of [a, b, c]) {
      expect(res.status).toBe(404);
      expectNoStore(res);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("a malformed since is 400 json", async () => {
    const res = await get(`?thread=${OWN}&since=yesterday-ish`);
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "bad_since" });
    expect(db.listThreadMessages).not.toHaveBeenCalled();
  });

  it("a grants-only role without support:read is 403", async () => {
    state.session = { ctx: ctx("staff") };
    const res = await get(`?thread=${OWN}`);
    expect(res.status).toBe(403);
    expectNoStore(res);
  });

  it("a read failure is 500 and logs the class name only", async () => {
    db.listThreadMessages.mockImplementation(async () => {
      throw new TypeError("secret body text");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get(`?thread=${OWN}`);
      expect(res.status).toBe(500);
      expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
      expect(spy.mock.calls.flat().join(" ")).toContain("TypeError");
    } finally {
      spy.mockRestore();
    }
  });
});
