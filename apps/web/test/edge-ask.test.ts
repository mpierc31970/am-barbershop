// GET /api/edge/ask (14-17; DOM-06, D13; T-14-17-01): the Caddy on_demand_tls ask contract.
// 200 only when edgeAskAllowed says so, 404 otherwise (exact normalised host, bad input), 429
// when a not-allowed name's domain is over its limit (known hosts never limited, WR-A11), 503
// on a database error, no-store, no network call, other methods 404.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeRateLimited extends Error {
  override name = "RateLimited";
}

const allowed = new Set(["rivera-bakery.com", "demo.sites.localhost"]);
const edgeAllowed = vi.fn((h: string) => Promise.resolve(allowed.has(h)));
let limited = false;
const beginEdgeAsk = vi.fn((host: string) => {
  void host;
  if (limited) throw new FakeRateLimited("too many edge asks");
});

vi.mock("@cds/db", () => ({
  edgeAskAllowed: (h: string) => edgeAllowed(h),
  beginEdgeAskMiss: (h: string) => beginEdgeAsk(h),
}));

const route = await import("../app/api/edge/ask/route");
const { GET, dynamic, runtime } = route;

function ask(domain?: string): Request {
  const url = new URL("http://127.0.0.1:3000/api/edge/ask");
  if (domain !== undefined) url.searchParams.set("domain", domain);
  return new Request(url);
}

describe("GET /api/edge/ask", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    limited = false;
    edgeAllowed.mockClear();
    beginEdgeAsk.mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is a force-dynamic nodejs route", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("answers 200 ok for an allowed host, not cached", async () => {
    const res = await GET(ask("rivera-bakery.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("cache-control")).toContain("no-store");
    // A known host never counts against a limit (WR-A11).
    expect(beginEdgeAsk).not.toHaveBeenCalled();
  });

  it("normalises case, port and a trailing dot before asking", async () => {
    expect((await GET(ask("Rivera-Bakery.COM."))).status).toBe(200);
    expect(edgeAllowed).toHaveBeenLastCalledWith("rivera-bakery.com");
  });

  it("answers 404 for anything not allowed (exact match only)", async () => {
    for (const d of [
      "www.rivera-bakery.com",
      "x.demo.sites.localhost",
      "evil.example",
    ]) {
      const res = await GET(ask(d));
      expect(res.status, d).toBe(404);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("answers 404 without asking for a missing, empty or over-long domain", async () => {
    for (const r of [
      ask(),
      ask(""),
      ask("   "),
      ask(`${"a".repeat(250)}.com`),
    ]) {
      expect((await GET(r)).status).toBe(404);
    }
    expect(edgeAllowed).not.toHaveBeenCalled();
  });

  it("a full miss bucket answers 429 for unknown names but known hosts still get 200 (WR-A11)", async () => {
    limited = true;
    const miss = await GET(ask("random-sni.attacker.example"));
    expect(miss.status).toBe(429);
    expect(beginEdgeAsk).toHaveBeenCalledWith("random-sni.attacker.example");
    expect((await GET(ask("rivera-bakery.com"))).status).toBe(200);
  });

  it("answers 503 (deny) when the database read fails, logging only the class name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    edgeAllowed.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await GET(ask("rivera-bakery.com"));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret-host");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret-host");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("rivera-bakery");
    spy.mockRestore();
  });

  it("other methods read as absent", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect((route[m] as () => Response)().status, m).toBe(404);
    }
  });
});
