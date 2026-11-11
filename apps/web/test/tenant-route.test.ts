// siteForRoute: the non-throwing tenant trust check for route handlers (07-02, Finding 7;
// WR-02, IN-11, TEN-04; T-07-02-02). siteForRequest delegates to it and still 404s.
import { TENANT_HOST_HEADER } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_NOT_FOUND";
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound }));

const state = vi.hoisted(() => ({ header: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
}));

const db = vi.hoisted(() => ({ siteContextForHost: vi.fn() }));
vi.mock("@cds/db", () => db);

const { siteForRoute, siteForRequest } = await import("../lib/tenant");

const SITE = { orgId: "org1", host: "acme.test" };

beforeEach(() => {
  state.header = null;
  notFound.mockClear();
  db.siteContextForHost.mockReset();
  db.siteContextForHost.mockImplementation(async (h: string) =>
    h === "acme.test" || h === "acme.test:3000" ? SITE : null,
  );
});

describe("siteForRoute (07-02)", () => {
  it("uses the middleware header name", () => {
    expect(TENANT_HOST_HEADER).toBe("x-cds-tenant-host");
  });

  it("returns the site when the header and param match", async () => {
    state.header = "acme.test";
    await expect(siteForRoute("acme.test")).resolves.toBe(SITE);
    expect(db.siteContextForHost).toHaveBeenCalledWith("acme.test");
  });

  it("returns null without the header", async () => {
    await expect(siteForRoute("acme.test")).resolves.toBeNull();
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });

  it("returns null when the param differs from the header", async () => {
    state.header = "acme.test";
    await expect(siteForRoute("evil.test")).resolves.toBeNull();
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });

  it("accepts the percent-encoded param of the header", async () => {
    state.header = "acme.test:3000";
    await expect(
      siteForRoute(encodeURIComponent("acme.test:3000")),
    ).resolves.toBe(SITE);
  });

  it("returns null for an unknown host", async () => {
    state.header = "nobody.test";
    await expect(siteForRoute("nobody.test")).resolves.toBeNull();
  });

  it("never calls notFound()", async () => {
    await siteForRoute("acme.test");
    state.header = "nobody.test";
    await siteForRoute("nobody.test");
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("siteForRequest still 404s (behaviour unchanged)", () => {
  it("returns the site on a match", async () => {
    state.header = "acme.test";
    await expect(siteForRequest("acme.test")).resolves.toBe(SITE);
  });

  it.each([
    ["no header", null, "acme.test"],
    ["mismatch", "acme.test", "evil.test"],
    ["unknown host", "nobody.test", "nobody.test"],
  ])("calls notFound() on %s", async (_name, header, param) => {
    state.header = header;
    await expect(siteForRequest(param)).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
