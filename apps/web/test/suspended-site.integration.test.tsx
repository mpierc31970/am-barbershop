// 13-22: the suspended-site 503 on the real PocketBase binary (STAFF-22, D215, D218, P13-P3;
// T-13-22-01, T-13-22-02). A super_admin suspends a site with staffSuspendNow; the middleware
// (driven directly with NextRequest objects, as middleware.test.ts does, real @cds/db read)
// answers the neutral 503 on every path class with no tenant text; lifting serves the site
// again on the next request; a platform host never reads suspension.
import "@cds/addon-registry/server";
import {
  captureTransport,
  clearResolverCache,
  recordingInvalidator,
  staffLiftSuspension,
  staffSuspendNow,
} from "@cds/db";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootPb } from "../../../packages/db/test/pb-harness";
import { seedSuspendableSite } from "../../../packages/db/test/suspension-seed";
import type { SupportSeed } from "../../../packages/db/test/support-seed";
import { middleware } from "../middleware";

const AT = new Date("2026-10-12T22:00:00.000Z");
const BUSINESS = "Rivera Bakery";

let inst: PbInstance | null = null;
let s: SupportSeed;
let host: string;

function req(path: string, h: string) {
  return new NextRequest(`http://${h}${path}`, { headers: { host: h } });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  clearResolverCache();
  ({ s, host } = await seedSuspendableSite({ now: AT, business: BUSINESS }));
});

afterAll(async () => {
  await inst?.stop();
});

const PATHS = [
  "/",
  "/about",
  "/_media/x/y",
  "/api/forms/abc123",
  "/api/gate",
  "/api/m",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
];

describe("suspended site (13-22)", () => {
  it("serves, goes 503 on every path when suspended, and serves again when lifted", async (t) => {
    if (!inst) return t.skip();
    // Before: the site is served (rewritten to the tenant tree).
    const before = await middleware(req("/", host));
    expect(before.headers.get("x-middleware-rewrite")).toBeTruthy();

    const transport = captureTransport();
    await staffSuspendNow(
      s.staff.superAdmin,
      {
        orgId: s.B.org,
        category: "illegal",
        note: "Counterfeit goods, staff only",
        message: "Remove the listings",
        now: AT,
      },
      { transport, invalidator: recordingInvalidator() },
    );

    for (const path of PATHS) {
      const res = await middleware(req(path, host));
      expect(res.status, path).toBe(503);
      expect(res.headers.get("retry-after"), path).toBe("86400");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("x-middleware-rewrite"), path).toBeNull();
      const body = await res.text();
      expect(body).toContain("This site is temporarily unavailable.");
      expect(body).not.toContain(BUSINESS);
      expect(body).not.toContain("Counterfeit");
      expect(body).not.toContain("Remove the listings");
      expect(body).not.toContain(host);
      expect(body).not.toContain("<script");
    }

    await staffLiftSuspension(s.staff.superAdmin, s.B.org, {
      now: new Date(AT.getTime() + 3_600_000),
      transport,
      invalidator: recordingInvalidator(),
    });
    clearResolverCache();
    const after = await middleware(req("/", host));
    expect(after.status).toBe(200);
    expect(after.headers.get("x-middleware-rewrite")).toBeTruthy();
  });

  it("a platform host never calls the suspension read", async (t) => {
    if (!inst) return t.skip();
    const db = await import("@cds/db");
    const spy = vi.spyOn(db, "isHostSuspended");
    await middleware(req("/hub", "localhost:3000"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
