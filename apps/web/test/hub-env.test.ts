// P15-P4 / T-15-01-01: the hub production gate reads CDS_ENV per call, never at module scope,
// so a Docker build (CDS_ENV unset) can never bake dev behaviour into production or vice versa.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hubCanonical,
  hubMetadataBase,
  hubRobots,
  isProductionHub,
} from "../lib/hub-env";

const saved = process.env.CDS_ENV;
const savedUrl = process.env.CDS_PLATFORM_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = saved;
  if (savedUrl === undefined) delete process.env.CDS_PLATFORM_URL;
  else process.env.CDS_PLATFORM_URL = savedUrl;
});

describe("hubMetadataBase (15 CR-A02)", () => {
  it("is the brand apex in production, whatever CDS_PLATFORM_URL says", () => {
    process.env.CDS_ENV = "production";
    process.env.CDS_PLATFORM_URL = "https://example.sslip.io";
    expect(hubMetadataBase().href).toBe(
      "https://connectionsdesignstudios.com/",
    );
    // An og:image path resolves onto the apex, never localhost.
    expect(new URL("/pricing/opengraph-image", hubMetadataBase()).href).toBe(
      "https://connectionsdesignstudios.com/pricing/opengraph-image",
    );
  });

  it("is the CDS_PLATFORM_URL origin off production, else localhost", () => {
    process.env.CDS_ENV = "dev";
    process.env.CDS_PLATFORM_URL = "https://cds.needtobeedgy.com/some/path";
    expect(hubMetadataBase().href).toBe("https://cds.needtobeedgy.com/");
    process.env.CDS_PLATFORM_URL = "not a url";
    expect(hubMetadataBase().origin).toMatch(/^http:\/\/localhost:\d+$/);
    delete process.env.CDS_PLATFORM_URL;
    expect(hubMetadataBase().origin).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("the marketing layout sets it as metadataBase", async () => {
    vi.doMock("../app/(platform)/(marketing)/fonts", () => ({
      anybody: { variable: "a" },
      hanken: { variable: "h" },
    }));
    const { generateMetadata } =
      await import("../app/(platform)/(marketing)/layout");
    process.env.CDS_ENV = "production";
    expect(generateMetadata().metadataBase?.toString()).toBe(
      "https://connectionsdesignstudios.com/",
    );
  });
});

describe("hub-env", () => {
  it("isProductionHub flips when CDS_ENV changes between calls (no caching)", () => {
    process.env.CDS_ENV = "production";
    expect(isProductionHub()).toBe(true);
    process.env.CDS_ENV = "dev";
    expect(isProductionHub()).toBe(false);
    delete process.env.CDS_ENV;
    expect(isProductionHub()).toBe(false);
    process.env.CDS_ENV = "production";
    expect(isProductionHub()).toBe(true);
  });

  it("only the exact string 'production' counts", () => {
    for (const v of ["Production", "prod", "production ", ""]) {
      process.env.CDS_ENV = v;
      expect(isProductionHub(), v).toBe(false);
    }
  });

  it("hubRobots is undefined in production and noindex/nofollow otherwise", () => {
    process.env.CDS_ENV = "production";
    expect(hubRobots()).toBeUndefined();
    process.env.CDS_ENV = "dev";
    expect(hubRobots()).toEqual({ index: false, follow: false });
    delete process.env.CDS_ENV;
    expect(hubRobots()).toEqual({ index: false, follow: false });
  });

  it("hubCanonical returns the brand apex URL in production only", () => {
    process.env.CDS_ENV = "production";
    expect(hubCanonical("/pricing")).toBe(
      "https://connectionsdesignstudios.com/pricing",
    );
    expect(hubCanonical("/")).toBe("https://connectionsdesignstudios.com/");
    process.env.CDS_ENV = "dev";
    expect(hubCanonical("/pricing")).toBeUndefined();
  });
});
