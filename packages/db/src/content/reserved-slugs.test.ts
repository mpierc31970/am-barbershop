// Reserved page slugs (07-02, T-07-02-03; 09-16, T-09-16-05): no tenant page may shadow a
// system route.
import { describe, expect, it } from "vitest";
import { mintOrgContext } from "../context";
import { createPage, RESERVED_SLUGS, SlugReserved } from "./pages";

describe("RESERVED_SLUGS", () => {
  it("holds the P3 system routes, the P7 ones and the P9 policy pages", () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      [
        "api",
        "_next",
        "sitemap.xml",
        "robots.txt",
        "hub",
        "sign-in",
        "search",
        "llms.txt",
        "_media",
        "system-404",
        "privacy",
        "terms",
        // Studio Booking public routes
        "barbers",
        "book",
        // 11-35: bio short links
        "ig",
        "fb",
        "tt",
        "yt",
        "li",
        "pin",
        "x",
        "th",
        "yelp",
        "nd",
        "go",
      ].sort(),
    );
  });

  it("holds every bio short code and go (11-35, D199)", async () => {
    const { RESERVED_BIO_SLUGS } = await import("@cds/core/social");
    for (const code of RESERVED_BIO_SLUGS) {
      expect(RESERVED_SLUGS).toContain(code);
    }
  });

  it("is frozen and has no duplicates", () => {
    expect(Object.isFrozen(RESERVED_SLUGS)).toBe(true);
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
  });

  it("refuses privacy and terms like search, before any database access", async () => {
    const ctx = mintOrgContext({
      orgId: "aaaaaaaaaaaaaaa",
      actor: "bbbbbbbbbbbbbbb",
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    });
    for (const slug of ["search", "privacy", "terms", "Privacy", "/terms"]) {
      await expect(
        createPage(ctx, { title: "A page", slug }),
        slug,
      ).rejects.toThrow(SlugReserved);
    }
  });
});
