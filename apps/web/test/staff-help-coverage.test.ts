// Every console area's ScreenHeader "?" opens a real article (13-50 choice 3, choice 8;
// P13-P12): each STAFF_SECTIONS helpSlug is a key of STAFF_HELP with Activate and Use
// steps, and no staff article reaches the tenant Help bundle (T-13-50-01).
import { describe, expect, it } from "vitest";
import { STAFF_HELP } from "@cds/addon-registry/staff-help";
import { helpArticlePaths } from "@cds/addon-registry/help";
import { STAFF_SECTIONS } from "../app/(platform)/staff/sections";

const sections = Object.values(STAFF_SECTIONS);

describe("staff console help coverage (13-50)", () => {
  it.each(sections.map((s) => [s.key, s.helpSlug] as const))(
    "%s: STAFF_HELP has %s with Activate and Use steps",
    (_key, slug) => {
      const article = STAFF_HELP[slug];
      expect(article, `docs/how-to/${slug}.md`).toBeDefined();
      expect(article!.activate.length).toBeGreaterThan(0);
      expect(article!.use.length).toBeGreaterThan(0);
      expect(article!.route).toMatch(/^\/staff\b/);
    },
  );

  it("no STAFF_HELP key is in the tenant help map", () => {
    const tenant = new Set(
      helpArticlePaths().map((p) =>
        p.replace(/^docs\/how-to\//, "").replace(/\.md$/, ""),
      ),
    );
    const leaked = Object.keys(STAFF_HELP).filter((k) => tenant.has(k));
    expect(leaked).toEqual([]);
  });

  it("the tenant help map has no staff- article and no /staff route", () => {
    const paths = helpArticlePaths();
    expect(paths.filter((p) => /\/staff-|media-staff-tools/.test(p))).toEqual(
      [],
    );
  });
});
