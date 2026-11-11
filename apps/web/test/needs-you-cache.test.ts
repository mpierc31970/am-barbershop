// 11-13 Task 2: getNeedsYou is the one per-request Needs-you computation (DASH-27). React's
// `cache` is replaced by a request-scoped memo (the RSC build memoizes per request; the
// test build would not), so two calls in one "request" must run listNeedsYou once.
import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ memos: [] as Map<string, unknown>[] }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
      const memo = new Map<string, unknown>();
      req.memos.push(memo);
      return (...a: A): R => {
        const k = JSON.stringify(a);
        if (!memo.has(k)) memo.set(k, fn(...a));
        return memo.get(k) as R;
      };
    },
  };
});

const newRequest = () => req.memos.forEach((m) => m.clear());

const db = vi.hoisted(() => ({
  listNeedsYou: vi.fn(),
  activeAddons: vi.fn(),
  pausedAddons: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const session = vi.hoisted(() => ({ getHubSession: vi.fn() }));
vi.mock("../lib/session", () => session);

const registry = vi.hoisted(() => ({
  ADDON_REGISTRY: { list: () => [], get: () => undefined },
  ADDON_SERVER: {},
  activeTodayProviders: vi.fn(),
}));
vi.mock("@cds/addon-registry/server", () => registry);

const { getNeedsYou } = await import("../lib/needs-you");

const ctx = { orgId: "org000000000001", role: "owner" };
const items = [
  {
    key: "inbox:m1",
    kind: "inbox.message",
    level: "normal",
    title: "Dana Lee",
    actionLabel: "Reply",
    href: "/hub/inbox?tab=messages&message=m1",
    section: "inbox",
    at: "2026-10-11T12:00:00.000Z",
  },
];

beforeEach(() => {
  newRequest();
  vi.clearAllMocks();
  session.getHubSession.mockResolvedValue({ ctx });
  db.activeAddons.mockResolvedValue(["testimonials"]);
  db.pausedAddons.mockResolvedValue([]);
  db.listNeedsYou.mockResolvedValue({ items, failed: [] });
  registry.activeTodayProviders.mockReturnValue([]);
});

describe("getNeedsYou (DASH-27)", () => {
  it("runs listNeedsYou once per request, however many callers", async () => {
    const [a, b] = await Promise.all([getNeedsYou(), getNeedsYou()]);
    const c = await getNeedsYou();
    expect(db.listNeedsYou).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a.items).toEqual(items);
    newRequest();
    await getNeedsYou();
    expect(db.listNeedsYou).toHaveBeenCalledTimes(2);
  });

  it("passes the session ctx, the registry and active minus paused add-on providers", async () => {
    await getNeedsYou();
    expect(registry.activeTodayProviders).toHaveBeenCalledWith(
      registry.ADDON_REGISTRY,
      registry.ADDON_SERVER,
      ["testimonials"],
      [],
    );
    const [c, deps] = db.listNeedsYou.mock.calls[0]!;
    expect(c).toBe(ctx);
    expect(deps.registry).toBe(registry.ADDON_REGISTRY);
    expect(deps.today).toEqual([]);
    expect(deps.now).toBeInstanceOf(Date);
  });

  it("no session: an empty list, nothing read", async () => {
    session.getHubSession.mockResolvedValue(null);
    expect(await getNeedsYou()).toEqual({ items: [], failed: [] });
    expect(db.listNeedsYou).not.toHaveBeenCalled();
  });

  it("an add-on state outage skips add-on providers and reports 'addons'", async () => {
    db.pausedAddons.mockRejectedValue(new Error("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await getNeedsYou();
    expect(out.failed).toEqual(["addons"]);
    expect(db.listNeedsYou.mock.calls[0]![1].today).toEqual([]);
    expect(registry.activeTodayProviders).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
