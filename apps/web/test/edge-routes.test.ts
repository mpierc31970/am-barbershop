// GET /api/edge/routes (14-17; DOM-06, P14-P7; T-14-17-02, T-14-17-03; a copy of the job-route
// tests): bearer CDS_EDGE_TOKEN, 404 on any miss, fail closed when the token is unset, the
// Traefik JSON with no-store, a 500 (never an empty 200) when edgeRoutes throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = {
  http: {
    routers: {
      "cds-h-0123abcd": {
        rule: "Host(`rivera-bakery.com`)",
        entryPoints: ["https"],
        service: "https-0-app@docker",
        tls: { certResolver: "letsencrypt" },
      },
    },
  },
};
const edgeRoutes = vi.fn(() => Promise.resolve(config));

vi.mock("@cds/db", () => ({
  edgeRoutes: () => edgeRoutes(),
}));

const route = await import("../app/api/edge/routes/route");
const { GET, dynamic, runtime } = route;

const TOKEN = "edge-token-for-tests-0123456789";

function get(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://cds-platform:3000/api/edge/routes", { headers });
}

describe("GET /api/edge/routes", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_EDGE_TOKEN", TOKEN);
    edgeRoutes.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a force-dynamic nodejs route", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s without an Authorization header", async () => {
    expect((await GET(get())).status).toBe(404);
    expect(edgeRoutes).not.toHaveBeenCalled();
  });

  it("404s with a wrong bearer or a non-bearer scheme", async () => {
    for (const auth of [
      `Bearer ${TOKEN}x`,
      "Bearer nope",
      `Basic ${TOKEN}`,
      TOKEN,
      "Bearer ",
    ]) {
      expect((await GET(get(auth))).status, auth).toBe(404);
    }
    expect(edgeRoutes).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_EDGE_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_EDGE_TOKEN", "");
    expect((await GET(get("Bearer "))).status).toBe(404);
    expect((await GET(get(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(edgeRoutes).not.toHaveBeenCalled();
  });

  it("answers the Traefik config with the right bearer, not cached", async () => {
    const res = await GET(get(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(await res.text())).toEqual(config);
    expect(edgeRoutes).toHaveBeenCalledTimes(1);
  });

  it("answers 500, never an empty 200, when edgeRoutes throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    edgeRoutes.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await GET(get(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret-host");
    expect(JSON.parse(body)).toEqual({ error: "routes unavailable" });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret-host");
    spy.mockRestore();
  });

  it("other methods read as absent", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect((route[m] as () => Response)().status, m).toBe(404);
    }
  });
});
