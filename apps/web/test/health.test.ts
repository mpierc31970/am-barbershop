import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic } from "../app/api/health/route";

describe("GET /api/health", () => {
  const original = process.env.APP_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = original;
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("SOURCE_COMMIT", "");
  });

  it("is force-dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 200 {status, version} with version 'dev' by default", async () => {
    delete process.env.APP_VERSION;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "dev" });
    expect(Object.keys(body).sort()).toEqual(["status", "version"]);
  });

  it("reports APP_VERSION when set", async () => {
    process.env.APP_VERSION = "abc123";
    const res = await GET();
    expect(await res.json()).toEqual({ status: "ok", version: "abc123" });
  });

  it("prefers Coolify's SOURCE_COMMIT over a stale APP_VERSION", async () => {
    process.env.APP_VERSION = "abc123";
    vi.stubEnv("SOURCE_COMMIT", "1f4ee5f1");
    const res = await GET();
    expect(await res.json()).toEqual({ status: "ok", version: "1f4ee5f1" });
  });

  it("returns 503 misconfigured when PLATFORM_HOSTS is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_HOSTS", "");
    delete process.env.APP_VERSION;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    // No reason leaks: only status + version.
    expect(body).toEqual({ status: "misconfigured", version: "dev" });
  });

  it("returns 200 in production when PLATFORM_HOSTS is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_HOSTS", "cds.example.com");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
