// The curated font catalog is self-hosted, pinned and declared once (CONTEXT A2-Q4;
// UI-SPEC "Font catalog"; RESEARCH Pitfall 11; T-04-36: no third-party font CDN).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FONT_CATALOG } from "@cds/core/theme";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const pkgJson = JSON.parse(read("../package.json")) as {
  dependencies: Record<string, string>;
};
const layout = read("../app/layout.tsx");
const globals = read("../app/globals.css");

const importLines = layout
  .split("\n")
  .filter((l) => /^import\s+"@fontsource-variable\//.test(l.trim()));

const packaged = FONT_CATALOG.filter((f) => f.pkg !== null);

/**
 * The hub site's own fonts (15-02; HUB-05, D104): loaded through next/font/local by the
 * (marketing) layout only, never offered to tenants and never imported by the root layout.
 */
const MARKETING_FONT_PKGS = [
  "@fontsource-variable/anybody",
  "@fontsource-variable/hanken-grotesk",
  "@fontsource/anybody",
];

describe("font catalog (A2-Q4)", () => {
  it("covers the 10 packaged families", () => {
    expect(packaged).toHaveLength(10);
  });

  it.each(packaged.map((f) => [f.name, f] as const))(
    "%s is pinned at exactly 5.3.0 and imported once",
    (_name, f) => {
      const pkg = f.pkg as string;
      expect(pkgJson.dependencies[pkg]).toBe("5.3.0");
      const roman =
        pkg === "@fontsource-variable/fraunces" ? "opsz.css" : "index.css";
      const mine = importLines.filter((l) => l.includes(`"${pkg}/`));
      const expected = [`import "${pkg}/${roman}";`];
      if (f.italic) expected.push(`import "${pkg}/wght-italic.css";`);
      expect(mine.map((l) => l.trim())).toEqual(expected);
    },
  );

  it("imports no font package outside the catalog", () => {
    const pkgs = new Set(packaged.map((f) => f.pkg));
    for (const line of importLines) {
      const m = /"(@fontsource-variable\/[^/]+)\//.exec(line);
      expect(m && pkgs.has(m[1]!)).toBe(true);
    }
    const deps = Object.keys(pkgJson.dependencies).filter((d) =>
      d.startsWith("@fontsource"),
    );
    expect(deps.sort()).toEqual([...pkgs, ...MARKETING_FONT_PKGS].sort());
  });

  it.each(MARKETING_FONT_PKGS)(
    "marketing font %s is pinned at exactly 5.3.0, outside the tenant catalog and the root layout",
    (pkg) => {
      expect(pkgJson.dependencies[pkg]).toBe("5.3.0");
      expect(FONT_CATALOG.some((f) => f.pkg === pkg)).toBe(false);
      expect(layout).not.toContain(`"${pkg}/`);
    },
  );

  it("uses no third-party font CDN", () => {
    for (const src of [layout, globals]) {
      expect(src).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
    }
  });

  it("keeps the hub on the system stack (no tenant font families)", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(globals)?.[1] ?? "";
    expect(root).toContain("--hub-font");
    expect(root).not.toContain("Variable");
    expect(globals).not.toMatch(/Variable/);
  });
});
