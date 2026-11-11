// GET /api/monitor/status (13-40; STAFF-16, D175; T-13-40-02..04): bearer MONITOR_TOKEN, 404 on
// any miss (missing, wrong, unset), every other method 404 (never 405), JSON with no-store, a
// 15 s memo (two GETs, one monitorStatus call), generic 500 with the error class only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doc = { generated_at: "2026-10-16T12:00:00.000Z", overall: "ok" };
const monitorStatus = vi.fn<(opts: unknown) => Promise<typeof doc>>(() =>
  Promise.resolve(doc),
);
const list = vi.fn(() => [{ slug: "fixture" }]);

vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => list() },
}));
vi.mock("@cds/db", () => ({
  monitorStatus: (opts: unknown) => monitorStatus(opts),
}));

const route = await import("../app/api/monitor/status/route");
const { resetMonitorMemoForTests, MONITOR_MEMO_MS } =
  await import("../lib/monitor-memo");

const TOKEN = "monitor-token-for-tests-0123456789";

function req(method: string, auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://cds.example.test/api/monitor/status", {
    method,
    headers,
  });
}

describe("GET /api/monitor/status", () => {
  beforeEach(() => {
    vi.stubEnv("MONITOR_TOKEN", TOKEN);
    monitorStatus.mockClear();
    resetMonitorMemoForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is a force-dynamic nodejs route", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
  });

  it("404s without a header, with a wrong token, or a non-Bearer scheme", async () => {
    for (const auth of [
      undefined,
      "Bearer nope",
      `Basic ${TOKEN}`,
      `Bearer  ${TOKEN}`,
    ]) {
      const res = await route.GET(req("GET", auth));
      expect(res.status, String(auth)).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(monitorStatus).not.toHaveBeenCalled();
  });

  it("fails closed when MONITOR_TOKEN is unset or blank", async () => {
    vi.stubEnv("MONITOR_TOKEN", "");
    expect((await route.GET(req("GET", `Bearer ${TOKEN}`))).status).toBe(404);
    vi.stubEnv("MONITOR_TOKEN", "   ");
    expect((await route.GET(req("GET", "Bearer x"))).status).toBe(404);
    expect(monitorStatus).not.toHaveBeenCalled();
  });

  it("every other method answers 404 even with the right token (never 405)", () => {
    for (const m of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ] as const) {
      const handler = route[m] as () => Response;
      const res = handler();
      expect(res.status, m).toBe(404);
    }
    expect(monitorStatus).not.toHaveBeenCalled();
  });

  it("serves the document with no-store and passes the registry manifests", async () => {
    const res = await route.GET(req("GET", `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(doc);
    expect(monitorStatus).toHaveBeenCalledWith({
      manifests: [{ slug: "fixture" }],
    });
  });

  it("accepts a token pasted with surrounding whitespace in the env", async () => {
    vi.stubEnv("MONITOR_TOKEN", `${TOKEN}\n`);
    expect((await route.GET(req("GET", `Bearer ${TOKEN}`))).status).toBe(200);
  });

  it("memoises for 15 s: two GETs, one read; a read after the window refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    await route.GET(req("GET", `Bearer ${TOKEN}`));
    vi.setSystemTime(new Date(Date.now() + MONITOR_MEMO_MS - 1));
    await route.GET(req("GET", `Bearer ${TOKEN}`));
    expect(monitorStatus).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + 2));
    await route.GET(req("GET", `Bearer ${TOKEN}`));
    expect(monitorStatus).toHaveBeenCalledTimes(2);
  });

  it("answers a generic 500 and logs only the error class; failures are not cached", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    monitorStatus.mockImplementationOnce(() =>
      Promise.reject(new RangeError("secret detail")),
    );
    const res = await route.GET(req("GET", `Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "status unavailable" });
    expect(String(spy.mock.calls[0]?.[0])).toContain("RangeError");
    expect(String(spy.mock.calls[0]?.[0])).not.toContain("secret detail");
    spy.mockRestore();
    expect((await route.GET(req("GET", `Bearer ${TOKEN}`))).status).toBe(200);
  });
});
