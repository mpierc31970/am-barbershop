// 11-21 (DASH-34, DASH-37; T-11-21-01, T-11-21-02): /hub/api/alerts is session-checked and
// never cached. The person and org come from the session only (query params are ignored);
// listBell / bellCounts scope to (org, actor) in @cds/db (alerts.integration.test.ts proves
// the per-person scoping). Failed Needs-you providers and the capped inbox never clear.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = {
  orgId: "orgaaaaaaaaaaa1",
  actor: "useraaaaaaaaaa1",
  role: "owner",
  grants: [],
  ip: "",
} as Record<string, unknown>;

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
  needsYou: { items: [], failed: [] } as {
    items: { key: string }[];
    failed: string[];
  },
  needsYouThrows: false,
  sessionThrows: false,
}));

const db = vi.hoisted(() => ({
  bellCounts: vi.fn(async () => ({ unread: 2, urgent: 1 })),
  listBell: vi.fn(async () => [
    {
      id: "alertaaaaaaaaa1",
      type: "form.message",
      level: "normal",
      title: "New message from Dana Lee",
      href: "/hub/inbox?tab=messages&message=subaaaaaaaaaaa1",
      section: "inbox",
      createdAt: "2026-10-12T14:00:00.000Z",
      read: false,
      cleared: false,
    },
  ]),
  statsTimeZone: vi.fn(async () => "America/Denver"),
}));

vi.mock("@cds/db", () => db);
vi.mock("../lib/session", () => ({
  getHubSession: async () => {
    if (state.sessionThrows) throw new Error("fetch failed");
    return state.session;
  },
}));
vi.mock("../lib/needs-you", () => ({
  getNeedsYou: async () => {
    if (state.needsYouThrows) throw new Error("boom");
    return state.needsYou;
  },
}));

const { GET } = await import("../app/(platform)/hub/api/alerts/route");

const get = (q = "") =>
  GET(new Request(`https://cds.example/hub/api/alerts${q}`));

type Keys = ReadonlySet<string>;
const keysPassed = (): Keys =>
  (db.bellCounts.mock.calls.at(-1) as unknown as [unknown, Keys])[1];

beforeEach(() => {
  state.session = { ctx: { ...CTX } };
  state.needsYou = { items: [], failed: [] };
  state.needsYouThrows = false;
  db.bellCounts.mockClear();
  db.listBell.mockClear();
  db.statsTimeZone.mockClear();
});

describe("/hub/api/alerts", () => {
  it("a session-read outage is 503 with the empty bell and no-store (IN-E03)", async () => {
    state.sessionThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("?view=count");
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.json()).toEqual({ count: 0, urgent: 0 });
      expect(db.bellCounts).not.toHaveBeenCalled();
    } finally {
      state.sessionThrows = false;
      spy.mockRestore();
    }
  });

  it("signed out: 401 with the empty bell, no-store, no reads", async () => {
    state.session = null;
    const res = await get();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ rows: [], count: 0, urgent: 0 });
    const count = await get("?view=count");
    expect(await count.json()).toEqual({ count: 0, urgent: 0 });
    expect(db.listBell).not.toHaveBeenCalled();
    expect(db.bellCounts).not.toHaveBeenCalled();
  });

  it("returns the session person's rows, counts and business time zone, never cached", async () => {
    state.needsYou = {
      items: [{ key: "inbox:subaaaaaaaaaaa1" }],
      failed: [],
    };
    // Query params naming another person or site are ignored.
    const res = await get("?user=someoneelse12&org=orgbbbbbbbbbbb2");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      count: 2,
      urgent: 1,
      timeZone: "America/Denver",
      hasMore: false,
    });
    expect(body.rows).toHaveLength(1);
    const [ctx, opts] = db.listBell.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { needsYouKeys: Keys; limit: number },
    ];
    expect(ctx).toMatchObject({
      orgId: "orgaaaaaaaaaaa1",
      actor: "useraaaaaaaaaa1",
    });
    expect(opts.limit).toBe(30);
    expect(opts.needsYouKeys.has("inbox:subaaaaaaaaaaa1")).toBe(true);
    expect(opts.needsYouKeys.has("inbox:subzzzzzzzzzzz9")).toBe(false);
  });

  it("view=count answers the count only; more=1 reads 100 rows", async () => {
    const res = await get("?view=count");
    expect(await res.json()).toEqual({ count: 2, urgent: 1 });
    expect(db.listBell).not.toHaveBeenCalled();
    await get("?more=1");
    expect(
      (db.listBell.mock.calls[0] as unknown as [unknown, { limit: number }])[1]
        .limit,
    ).toBe(100);
  });

  it("impersonating staff get the empty bell", async () => {
    state.session = { ctx: { ...CTX, impersonator: "staffaaaaaaaaa1" } };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rows: [], count: 0 });
    expect(db.listBell).not.toHaveBeenCalled();
  });

  it("a failed provider's alerts do not clear; the capped inbox does not clear", async () => {
    state.needsYou = {
      items: [{ key: "billing:fix_card" }],
      failed: ["inbox", "addon:studio-booking"],
    };
    await get("?view=count");
    let keys = keysPassed();
    expect(keys.has("inbox:subaaaaaaaaaaa1")).toBe(true);
    expect(keys.has("studio-booking:approve:x")).toBe(true);
    expect(keys.has("billing:finish_stripe")).toBe(false);
    expect(keys.has("appointments:x")).toBe(false);

    state.needsYou = {
      items: Array.from({ length: 20 }, (_, i) => ({
        key: `inbox:sub${String(i).padStart(12, "0")}`,
      })),
      failed: [],
    };
    await get("?view=count");
    keys = keysPassed();
    expect(keys.has("inbox:older00000000")).toBe(true);

    state.needsYou = { items: [], failed: ["addons"] };
    await get("?view=count");
    keys = keysPassed();
    expect(keys.has("appointments:x")).toBe(true);
    expect(keys.has("billing:fix_card")).toBe(false);
  });

  it("a thrown Needs-you read keeps every Needs-you alert; a failed bell read is 500", async () => {
    state.needsYouThrows = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await get("?view=count");
    expect(keysPassed().has("billing:fix_card")).toBe(true);
    db.bellCounts.mockRejectedValueOnce(new Error("pb down"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    err.mockRestore();
  });
});
