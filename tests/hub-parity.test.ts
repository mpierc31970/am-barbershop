// HUB-03 parity inventory check (D62, CONTEXT A1-Q4..Q6). Owner: 15-06.
// The on-disk route check (each covering route has a page.tsx) was added by 15-22.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABOUT_FACTS,
  EXTERNAL_COVERING,
  MARKETING_ROUTES,
  PARITY,
  TESTIMONIALS,
  WORK_SITES,
  visibleProof,
} from "../packages/core/src/marketing";

const root = join(import.meta.dirname, "..");

const coveringRoutes = new Set([
  ...MARKETING_ROUTES.map((r) => r.path),
  ...EXTERNAL_COVERING,
]);

describe("parity inventory (HUB-03)", () => {
  it("has a row for every old page", () => {
    const pages = [
      "/",
      "/about",
      "/services",
      "/work",
      "/testimonials",
      "/resources",
      "/contact",
      "/book",
      "/privacy",
      "/terms",
      "/unsubscribe",
      "/admin/login",
      "/admin/schedule",
    ];
    const old = new Set(PARITY.map((r) => r.oldPath));
    for (const p of pages) expect(old.has(p), p).toBe(true);
  });

  it("every row is covered or retired", () => {
    for (const row of PARITY)
      expect(["covered", "retired"]).toContain(row.status);
  });

  it("retired rows give a reason and no route", () => {
    for (const row of PARITY.filter((r) => r.status === "retired")) {
      expect(
        row.reason.length,
        `${row.oldPath} ${row.topic}`,
      ).toBeGreaterThanOrEqual(10);
      expect(row.route).toBeNull();
    }
  });

  it("covered rows name a hub route that is declared", () => {
    for (const row of PARITY.filter((r) => r.status === "covered")) {
      expect(row.route, `${row.oldPath} ${row.topic}`).not.toBeNull();
      expect(
        coveringRoutes.has(row.route as string),
        `${row.oldPath} → ${row.route}`,
      ).toBe(true);
    }
  });
});

describe("marketing routes", () => {
  it("paths are unique and /report + /unsubscribe stay out of the index", () => {
    const paths = MARKETING_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ["/report", "/unsubscribe"]) {
      const r = MARKETING_ROUTES.find((x) => x.path === p)!;
      expect(r.indexed).toBe(false);
      expect(r.sitemap).toBe(false);
    }
    expect(MARKETING_ROUTES.find((r) => r.path === "/")!.dir).toBe("");
  });
});

// 15-22 choice 7 (HUB-03): every covering route exists on disk.
describe("covering routes exist on disk (15-22)", () => {
  const platformDir = join(root, "apps/web/app/(platform)");
  const pageFor = (dir: string) =>
    join(platformDir, "(marketing)", dir, "page.tsx");

  it("every MARKETING_ROUTES dir has a page.tsx under (marketing)", () => {
    for (const r of MARKETING_ROUTES) {
      expect(
        existsSync(pageFor(r.dir)),
        `${r.path} → (marketing)/${r.dir}`,
      ).toBe(true);
    }
    expect(pageFor("")).toBe(join(platformDir, "(marketing)", "page.tsx"));
  });

  it("every covered parity row's route exists", () => {
    const external: Record<string, string> = {
      "/legal/terms-of-service": join(
        platformDir,
        "legal",
        "[key]",
        "page.tsx",
      ),
      "/sign-in": join(platformDir, "sign-in", "page.tsx"),
    };
    expect(Object.keys(external).sort()).toEqual([...EXTERNAL_COVERING].sort());
    for (const row of PARITY.filter((r) => r.status === "covered")) {
      const route = row.route as string;
      const m = MARKETING_ROUTES.find((r) => r.path === route);
      const file = m ? pageFor(m.dir) : external[route];
      expect(file, `${row.oldPath} → ${route}`).toBeDefined();
      expect(existsSync(file as string), `${row.oldPath} → ${route}`).toBe(
        true,
      );
    }
  });
});

describe("proof data (A1-Q6, P15-P15)", () => {
  it("work sites have https URLs, a path and an outcome", () => {
    for (const s of WORK_SITES) {
      expect(s.url.startsWith("https://"), s.name).toBe(true);
      expect(["standard", "studio"]).toContain(s.path);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.outcome.length).toBeGreaterThan(0);
      expect(typeof s.confirmed).toBe("boolean");
    }
  });

  it("testimonials and about facts have the expected shape", () => {
    for (const t of TESTIMONIALS) {
      expect(t.quote.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.confirmed).toBe("boolean");
    }
    for (const f of ABOUT_FACTS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.value.length).toBeGreaterThan(0);
      expect(typeof f.confirmed).toBe("boolean");
    }
  });

  it("visibleProof shows confirmed only in production", () => {
    const list = [
      { id: 1, confirmed: true },
      { id: 2, confirmed: false },
    ];
    expect(visibleProof(list, true).map((e) => e.id)).toEqual([1]);
    expect(visibleProof(list, false).map((e) => e.id)).toEqual([1, 2]);
  });
});
