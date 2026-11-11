// The two tenant-internal edge routes (14-18 choice 5): /.well-known/cds-host -> host proof,
// /<CDS_INDEXNOW_KEY>.txt -> the key on custom hosts only. @cds/db and the trust check mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  cdsHostProof: vi.fn(
    (host: string, orgId: string) => `proof:${host}:${orgId}`,
  ),
}));
vi.mock("@cds/db", () => db);

type Site = { orgId: string; host: string; hostKind: string };
const sites = vi.hoisted(() => new Map<string, Site>());
vi.mock("../lib/tenant", () => ({
  siteForRoute: vi.fn(async (h: string) => sites.get(h) ?? null),
}));

const cdsHost = await import("../app/tenant/[host]/%5Fedge/cds-host/route");
const indexNow = await import("../app/tenant/[host]/%5Fedge/indexnow/route");

const KEY = "0123456789abcdef0123456789abcdef";
const params = (host: string) => ({ params: Promise.resolve({ host }) });
const get = new Request("https://x/");

beforeEach(() => {
  sites.clear();
  sites.set("acme.com", {
    orgId: "orgaaaaaaaaaaaa",
    host: "acme.com",
    hostKind: "custom",
  });
  sites.set("acme.sites.localhost", {
    orgId: "orgaaaaaaaaaaaa",
    host: "acme.sites.localhost",
    hostKind: "preview",
  });
  sites.set("old-acme.com", {
    orgId: "orgaaaaaaaaaaaa",
    host: "old-acme.com",
    hostKind: "redirect",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/.well-known/cds-host", () => {
  it("returns the proof for a known host, text/plain, no-store", async () => {
    const res = await cdsHost.GET(get, params("acme.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("proof:acme.com:orgaaaaaaaaaaaa");
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers on preview and redirect hosts too", async () => {
    for (const h of ["acme.sites.localhost", "old-acme.com"]) {
      expect((await cdsHost.GET(get, params(h))).status, h).toBe(200);
    }
  });

  it("404s an unknown host", async () => {
    const res = await cdsHost.GET(get, params("nobody.com"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("HEAD has no body", async () => {
    const res = await cdsHost.HEAD(get, params("acme.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("500s without logging values when the proof throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.cdsHostProof.mockImplementationOnce(() => {
      throw new TypeError("no secret");
    });
    const res = await cdsHost.GET(get, params("acme.com"));
    expect(res.status).toBe(500);
    expect(err).toHaveBeenCalledWith(
      "[edge] cds-host proof failed",
      "TypeError",
    );
    err.mockRestore();
  });
});

describe("/<CDS_INDEXNOW_KEY>.txt", () => {
  it("serves the key on a custom host", async () => {
    vi.stubEnv("CDS_INDEXNOW_KEY", KEY);
    const res = await indexNow.GET(get, params("acme.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEY);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("404s on preview and redirect hosts and unknown hosts", async () => {
    vi.stubEnv("CDS_INDEXNOW_KEY", KEY);
    for (const h of ["acme.sites.localhost", "old-acme.com", "nobody.com"]) {
      expect((await indexNow.GET(get, params(h))).status, h).toBe(404);
    }
  });

  it("404s when the env key is unset or invalid", async () => {
    vi.stubEnv("CDS_INDEXNOW_KEY", "");
    expect((await indexNow.GET(get, params("acme.com"))).status).toBe(404);
    vi.stubEnv("CDS_INDEXNOW_KEY", "short");
    expect((await indexNow.GET(get, params("acme.com"))).status).toBe(404);
    vi.stubEnv("CDS_INDEXNOW_KEY", "bad key/../x");
    expect((await indexNow.GET(get, params("acme.com"))).status).toBe(404);
  });
});
