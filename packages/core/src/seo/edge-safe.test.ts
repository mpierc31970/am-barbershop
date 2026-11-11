// @cds/core/seo stays Edge-safe (07-02, T-07-02-06): no node:, yaml, require(), sanitizer
// or next/* import anywhere under src/seo, and the package maps the ./seo subpath.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seoDir = import.meta.dirname;
const pkgPath = path.resolve(seoDir, "..", "..", "package.json");
// An import of the sanitizer module (by package or by path), not the word "sanitize"
// (07-30's sanitizeAddonNodes is an Edge-safe copier).
const FORBIDDEN =
  /from ["']node:|from ["']yaml["']|require\(|from ["'][^"']*sanitize[^"']*["']|from ["']next\//;
// 07-30: what any file reached through relative imports may not import.
const FORBIDDEN_REACHED =
  /from ["']node:|from ["']yaml["']|from ["']sanitize-html["']|from ["'][^"']*\/sanitize["']|from ["']next\//;
const RELATIVE_IMPORT = /(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Every file reached from `start` through relative imports (start included). */
function reachable(start: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(RELATIVE_IMPORT)) {
      const next = resolveImport(file, m[1]!);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("@cds/core/seo is Edge-safe (07-02)", () => {
  it("has source files, none importing Node-only or Next modules", () => {
    const files = sourceFiles(seoDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(FORBIDDEN);
    }
  });

  it("is exported as the ./seo subpath", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./seo"]).toBe("./src/seo/index.ts");
  });
});

describe("@cds/core/seo transitive imports stay Edge-safe (07-30)", () => {
  it("no file reached from seo/** imports node:, yaml, the sanitizer or next/*", () => {
    const files = reachable(sourceFiles(seoDir));
    expect(files.length).toBeGreaterThan(sourceFiles(seoDir).length);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(FORBIDDEN_REACHED);
    }
  });
});
