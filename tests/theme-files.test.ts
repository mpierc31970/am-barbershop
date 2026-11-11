// Every authored theme under design/ is re-imported through the real importer on each
// `npm test` (THEME-03, THEME-05; T-04-27). Also pins the neutral preset in all three places
// (design/presets/neutral == NEUTRAL_DESIGN == globals.css [data-site] fallbacks, RESEARCH
// Pitfall 9), the solver outcomes the exit proof relies on (D-UI-P4-7: Almanac 0
// adjustments, Tidewater exactly 1), and that theme files stay config, never code
// (CONTEXT A1-Q2; T-04-28).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENFORCED_PAIRS, NEUTRAL_DESIGN, ROLES } from "@cds/core/theme";
import { importThemeDir } from "@cds/core/theme/import";

const root = join(import.meta.dirname, "..");

function walk(
  dir: string,
  skip: (rel: string) => boolean = () => false,
): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = join(dir, name).split("\\").join("/");
    if (skip(rel)) return [];
    return statSync(join(root, rel)).isDirectory() ? walk(rel, skip) : [rel];
  });
}

/**
 * Every directory under design/ that holds a DESIGN.md (a theme). design/marketing is the
 * hub site's own --mk-* record (15-26, D-UI-P15-29), not a tenant theme, so it is skipped.
 */
const themeDirs = walk("design", (rel) => rel === "design/marketing")
  .filter((f) => f.endsWith("/DESIGN.md"))
  .map((f) => f.slice(0, -"/DESIGN.md".length))
  .sort();

const load = (dir: string) => importThemeDir(dir, { root });

/** The first `[data-site] { ... }` block of globals.css, as name -> raw value. */
function siteFallbacks(): Map<string, string> {
  const css = readFileSync(join(root, "apps/web/app/globals.css"), "utf8");
  const block = /(^|\n)\[data-site\]\s*\{([^}]*)\}/.exec(css)?.[2] ?? "";
  const out = new Map<string, string>();
  for (const m of block.matchAll(/--(site-[a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name && value && !out.has(name)) out.set(name, value.trim());
  }
  return out;
}

describe("authored theme files (design/)", () => {
  it("finds the three seed themes", () => {
    expect(themeDirs).toEqual(
      expect.arrayContaining([
        "design/presets/neutral",
        "design/tenants/demo",
        "design/tenants/demo-b",
      ]),
    );
  });

  it("every theme imports and meets every enforced contrast pair", () => {
    expect(themeDirs.length).toBeGreaterThanOrEqual(3);
    for (const dir of themeDirs) {
      const { design } = load(dir);
      for (const pair of ENFORCED_PAIRS) {
        const result = design.contrast.pairs.find(
          (p) => p.fg === pair.fg && p.bg === pair.bg,
        );
        expect(result, `${dir}: ${pair.fg} on ${pair.bg}`).toBeDefined();
        expect(
          result?.ratio ?? 0,
          `${dir}: ${pair.fg} on ${pair.bg}`,
        ).toBeGreaterThanOrEqual(pair.min ?? 0);
      }
    }
  });

  it("design/presets/neutral imports to NEUTRAL_DESIGN", () => {
    const { design, report } = load("design/presets/neutral");
    expect(design.name).toBe("Neutral");
    expect(design.roles).toEqual(NEUTRAL_DESIGN.roles);
    expect(design.typography).toEqual(NEUTRAL_DESIGN.typography);
    expect(design.rounded).toEqual(NEUTRAL_DESIGN.rounded);
    expect(design.shadows).toEqual(NEUTRAL_DESIGN.shadows);
    expect(report.adjustments).toEqual([]);
    expect(report.derivedRoles).toBeNull();
  });

  it("globals.css [data-site] fallbacks equal NEUTRAL_DESIGN", () => {
    const css = siteFallbacks();
    for (const role of ROLES) {
      expect(css.get(`site-${role}`)?.toLowerCase(), role).toBe(
        NEUTRAL_DESIGN.roles[role],
      );
    }
    expect(css.get("site-text-body")).toBe(NEUTRAL_DESIGN.typography.body);
    expect(css.get("site-text-h3")).toBe(NEUTRAL_DESIGN.typography.h3);
    expect(css.get("site-text-h2")).toBe(NEUTRAL_DESIGN.typography.h2);
    expect(css.get("site-text-display")).toBe(
      NEUTRAL_DESIGN.typography.display,
    );
    expect(css.get("site-radius-button")).toBe(NEUTRAL_DESIGN.rounded.button);
    expect(css.get("site-radius-media")).toBe(NEUTRAL_DESIGN.rounded.media);
    expect(css.get("site-shadow-overlay")).toBe(NEUTRAL_DESIGN.shadows.overlay);
  });

  it("design/tenants/demo is Almanac with no solver adjustment", () => {
    const { design, report } = load("design/tenants/demo");
    expect(design.name).toBe("Almanac");
    expect(report.adjustments).toHaveLength(0);
    expect(design.typography.headingFamily).toBe("Fraunces");
    expect(design.typography.bodyFamily).toBe("Source Serif 4");
    expect(report.derivedRoles).toBeNull();
  });

  it("design/tenants/demo-b is Tidewater with exactly one accent adjustment", () => {
    const { design, report } = load("design/tenants/demo-b");
    expect(design.name).toBe("Tidewater");
    expect(report.adjustments).toHaveLength(1);
    const [adj] = report.adjustments;
    expect(adj?.role).toBe("accent");
    expect(adj?.from).toBe("#f06a4d");
    expect(adj?.reason).toBe("accent on surface-raised 2.50 < 3.00");
    expect(design.roles.accent).not.toBe("#f06a4d");
    expect(design.typography.headingFamily).toBe("Archivo");
    expect(design.typography.bodyFamily).toBe("Public Sans");
    expect(report.derivedRoles).toBeNull();
  });

  it("demo and demo-b differ in all 8 roles and both font families", () => {
    const a = load("design/tenants/demo").design;
    const b = load("design/tenants/demo-b").design;
    for (const role of ROLES) {
      expect(a.roles[role], role).not.toBe(b.roles[role]);
    }
    expect(a.typography.headingFamily).not.toBe(b.typography.headingFamily);
    expect(a.typography.bodyFamily).not.toBe(b.typography.bodyFamily);
  });

  it("no app or package code references design/ (themes are config, not code)", () => {
    // The one exemption is the DEV-ONLY seed script (04-14): it loads the two demo themes
    // as seed data, exactly as an operator would pass --dir to theme:import. No runtime
    // code path (app, package src) may name a theme directory.
    // The Lighthouse runner (07-33) is the same kind of DEV-ONLY seed caller: it seeds the
    // every-block tenant into a throwaway PocketBase with the demo theme.
    const DEV_SEED = new Set([
      "packages/db/scripts/seed-dev-tenant.ts",
      "packages/db/scripts/lighthouse.ts",
    ]);
    const skip = (rel: string) =>
      /(^|\/)(node_modules|\.next|__fixtures__)$/.test(rel) ||
      /\.test\.tsx?$/.test(rel) ||
      DEV_SEED.has(rel);
    const code = [...walk("apps", skip), ...walk("packages", skip)].filter(
      (f) => /\.(ts|tsx|js|mjs|cjs|json|css)$/.test(f),
    );
    expect(code.length).toBeGreaterThan(0);
    const offenders = code.filter((f) =>
      /design\/(tenants|presets)/.test(readFileSync(join(root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
