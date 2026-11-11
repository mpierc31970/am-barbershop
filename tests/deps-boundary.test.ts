import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Invariant 1 / D5 second guard: the lint rule misses require() and dynamic import(),
// so dependencies and module strings are checked here too. PLAT-06: PocketBase stays,
// no postgres driver enters the tree.
const repoRoot = path.resolve(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, onFile: (file: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

const inside = (target: string, dir: string): boolean =>
  target === dir || target.startsWith(`${dir}/`);

// R2-WR-01: mirrors cds/addon-boundary. An add-on's relative paths stay inside its own
// folder (its tests may also use packages/ui/src/test-support); nothing outside
// packages/db reaches packages/db/src by relative path (IN-07). Both repo-relative paths.
function relativeEscape(where: string, target: string): boolean {
  const own = /^packages\/addons\/([^/]+)\//.exec(where)?.[1];
  if (own) {
    if (inside(target, `packages/addons/${own}`)) return false;
    const isTest = /\.test\.[cm]?[jt]sx?$/.test(where);
    return !(isTest && inside(target, "packages/ui/src/test-support"));
  }
  return !where.startsWith("packages/db/") && inside(target, "packages/db/src");
}

function workspacePackageJsons(): string[] {
  const found: string[] = [];
  for (const top of ["apps", "packages"]) {
    walk(path.join(repoRoot, top), (file) => {
      if (path.basename(file) === "package.json") found.push(file);
    });
  }
  return found;
}

function deps(file: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
}

const rel = (file: string) =>
  path.relative(repoRoot, file).split(path.sep).join("/");
const POSTGRES_DRIVERS = ["postgres", "pg"];

describe("dependency boundary (Invariant 1, PLAT-06 / D5)", () => {
  it("finds the workspace package.json files", () => {
    expect(workspacePackageJsons().map(rel)).toContain(
      "packages/db/package.json",
    );
  });

  it("lets only packages/db depend on pocketbase", () => {
    const users = workspacePackageJsons()
      .filter((file) => "pocketbase" in deps(file))
      .map(rel);
    expect(users).toEqual(["packages/db/package.json"]);
    expect("pocketbase" in deps(path.join(repoRoot, "package.json"))).toBe(
      false,
    );
  });

  it("has no postgres driver in any package.json, root included", () => {
    const all = [
      path.join(repoRoot, "package.json"),
      ...workspacePackageJsons(),
    ];
    const offenders = all.flatMap((file) =>
      POSTGRES_DRIVERS.filter((name) => name in deps(file)).map(
        (name) => `${rel(file)}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("TEN-02: has no 'pocketbase' module string outside packages/db/{src,scripts,test} (catches require and import())", () => {
    const pattern = /["'`]pocketbase(\/[^"'`]*)?["'`]/;
    const allowed = ["src", "scripts", "test"].map(
      (d) => path.join(repoRoot, "packages", "db", d) + path.sep,
    );
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      walk(path.join(repoRoot, top), (file) => {
        if (allowed.some((d) => file.startsWith(d)) || !SOURCE_EXT.test(file))
          return;
        if (pattern.test(readFileSync(file, "utf8"))) offenders.push(rel(file));
      });
    }
    expect(offenders).toEqual([]);
  });

  // PAY-09 / CONTEXT A1 (T-10-02-01): no checkout code calls Stripe except through the
  // gateway interface. Only @cds/db depends on the SDK, and only payments/stripe/ names it.
  it("PAY-09: lets only packages/db depend on stripe", () => {
    const users = workspacePackageJsons()
      .filter((file) => "stripe" in deps(file))
      .map(rel);
    expect(users).toEqual(["packages/db/package.json"]);
    expect("stripe" in deps(path.join(repoRoot, "package.json"))).toBe(false);
  });

  it("PAY-09: has no 'stripe' module specifier outside packages/db/src/payments/stripe/ (import, export-from, require, import())", () => {
    // Specifier positions only: "stripe" as a plain string (a gateway name) is fine.
    const pattern =
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]stripe(?:\/[^"'`]*)?["'`]/;
    const allowed =
      path.join(repoRoot, "packages", "db", "src", "payments", "stripe") +
      path.sep;
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      walk(path.join(repoRoot, top), (file) => {
        if (file.startsWith(allowed) || !SOURCE_EXT.test(file)) return;
        if (pattern.test(readFileSync(file, "utf8"))) offenders.push(rel(file));
      });
    }
    expect(offenders).toEqual([]);
  });

  it("PAY-09: the stripe specifier scan catches every import form", () => {
    const pattern =
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]stripe(?:\/[^"'`]*)?["'`]/;
    for (const src of [
      'import Stripe from "stripe";',
      "import 'stripe';",
      'export { default } from "stripe/cjs";',
      'const S = require("stripe");',
      "const S = await import('stripe');",
    ]) {
      expect(pattern.test(src), src).toBe(true);
    }
    expect(pattern.test('const provider = "stripe";')).toBe(false);
  });

  // PUSH-01 (11-22, T-11-22-04): web-push is a @cds/db dependency used only by the
  // alerts/push adapter folder. Tests mock it with vi.mock("web-push"), which is not an
  // import form, so the scan needs no test carve-out.
  const WEB_PUSH_SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]web-push(?:\/[^"'`]*)?["'`]/;

  it("PUSH-01: lets only packages/db depend on web-push", () => {
    const users = workspacePackageJsons()
      .filter((file) => "web-push" in deps(file))
      .map(rel);
    expect(users).toEqual(["packages/db/package.json"]);
    expect("web-push" in deps(path.join(repoRoot, "package.json"))).toBe(false);
  });

  it("PUSH-01: has no 'web-push' module specifier outside packages/db/src/alerts/push/", () => {
    const allowed =
      path.join(repoRoot, "packages", "db", "src", "alerts", "push") + path.sep;
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      walk(path.join(repoRoot, top), (file) => {
        if (file.startsWith(allowed) || !SOURCE_EXT.test(file)) return;
        if (WEB_PUSH_SPECIFIER.test(readFileSync(file, "utf8")))
          offenders.push(rel(file));
      });
    }
    expect(offenders).toEqual([]);
  });

  it("PUSH-01: the web-push specifier scan catches every import form", () => {
    for (const src of [
      'import webpush from "web-push";',
      "import 'web-push';",
      'export { default } from "web-push/src/index.js";',
      'const w = require("web-push");',
      "const w = await import('web-push');",
    ]) {
      expect(WEB_PUSH_SPECIFIER.test(src), src).toBe(true);
    }
    expect(WEB_PUSH_SPECIFIER.test('vi.mock("web-push", () => ({}));')).toBe(
      false,
    );
  });
});

// Chokepoint source scans (TEN-02, TEN-15, T-02-13, RESEARCH Pitfall 3).
function dbSrcFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  walk(path.join(repoRoot, "packages", "db", "src"), (file) => {
    if (SOURCE_EXT.test(file)) {
      out.push({ file: rel(file), text: readFileSync(file, "utf8") });
    }
  });
  return out;
}

function offendersOf(test: (text: string) => boolean): string[] {
  return dbSrcFiles()
    .filter(({ text }) => test(text))
    .map(({ file }) => file);
}

describe("chokepoint source gates (packages/db/src)", () => {
  it("scans a non-empty packages/db/src", () => {
    expect(dbSrcFiles().map((f) => f.file)).toContain(
      "packages/db/src/client.ts",
    );
  });

  it("TEN-02: only client.ts constructs a PocketBase client (new PocketBase()", () => {
    expect(offendersOf((t) => /new\s+PocketBase\s*\(/.test(t))).toEqual([
      "packages/db/src/client.ts",
    ]);
  });

  it("TEN-15: never calls .impersonate( (it mints an MFA-less token)", () => {
    expect(offendersOf((t) => /\.impersonate\s*\(/.test(t))).toEqual([]);
  });

  it("TEN-15: never calls requestOTP( except the staff users collection", () => {
    // Staff OTP (plan 06) is allowed only as the literal collection("users").requestOTP(.
    const strip = (t: string) =>
      t.replace(/collection\(\s*["']users["']\s*\)\s*\.requestOTP\s*\(/g, "");
    expect(offendersOf((t) => /requestOTP\s*\(/.test(strip(t)))).toEqual([]);
  });

  it("T-02-13: never builds a filter from a template literal", () => {
    expect(offendersOf((t) => /filter\s*[:(]\s*`[^`]*\$\{/.test(t))).toEqual(
      [],
    );
  });
});

// Invariant 4 / ADDON-06 second guard: an add-on's package.json never depends on another
// add-on, the registry or the PocketBase SDK (passes vacuously until 05-07 lands one).
describe("add-on dependency boundary (Invariant 4, ADDON-06)", () => {
  it("no packages/addons/*/package.json lists another add-on, the registry or pocketbase", () => {
    const addonsDir = path.join(repoRoot, "packages", "addons");
    const offenders: string[] = [];
    for (const entry of readdirSync(addonsDir, { withFileTypes: true })) {
      const file = path.join(addonsDir, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const own = JSON.parse(readFileSync(file, "utf8")).name as string;
      for (const name of Object.keys(deps(file))) {
        if (
          name === "pocketbase" ||
          name === "@cds/addon-registry" ||
          (name.startsWith("@cds/addon-") && name !== own)
        ) {
          offenders.push(`${rel(file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // B-CR-01: npm hoists every @cds/addon-* into node_modules, so an undeclared import still
  // resolves. Scan module strings (static, dynamic import() and require alike) and relative
  // paths, the way the pocketbase gate above does.
  it("no module string reaches an add-on outside the registry, and no add-on reaches another", () => {
    const bare = /["'`]@cds\/addon-([a-z0-9-]+)(?=[/"'`])/g;
    const relative = /["'`](\.{1,2}\/[^"'`\s]*)["'`]/g;
    const registryDir = "packages/addon-registry/";
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      walk(path.join(repoRoot, top), (file) => {
        if (!SOURCE_EXT.test(file)) return;
        const where = rel(file);
        if (where.startsWith(registryDir)) return;
        const own = /^packages\/addons\/([^/]+)\//.exec(where)?.[1] ?? null;
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(bare)) {
          const slug = m[1]!;
          // Platform code may use the registry; an add-on may name only itself.
          const ok = own === null ? slug === "registry" : slug === own;
          if (!ok) offenders.push(`${where}: @cds/addon-${slug}`);
        }
        for (const m of text.matchAll(relative)) {
          const target = path
            .relative(repoRoot, path.resolve(path.dirname(file), m[1]!))
            .split(path.sep)
            .join("/");
          const slug = /^packages\/addons\/([^/]+)(\/|$)/.exec(target)?.[1];
          if (slug && slug !== own) offenders.push(`${where}: ${m[1]}`);
          else if (relativeEscape(where, target)) {
            offenders.push(`${where}: ${m[1]} (R2-WR-01)`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("relativeEscape refuses an add-on or platform relative path around @cds/db (R2-WR-01)", () => {
    const A = "packages/addons/testimonials/repo.ts";
    expect(relativeEscape(A, "packages/db/src/index")).toBe(true);
    expect(relativeEscape(A, "packages/db/src/context")).toBe(true);
    expect(relativeEscape(A, "packages/core/src/addons/types")).toBe(true);
    expect(relativeEscape(A, "node_modules/@cds/db/src/index")).toBe(true);
    expect(relativeEscape(A, "packages/ui/src/test-support/dom")).toBe(true);
    expect(relativeEscape(A, "packages/addons/testimonials/records")).toBe(
      false,
    );
    expect(relativeEscape(A, "packages/addons/testimonials")).toBe(false);
    expect(
      relativeEscape(
        "packages/addons/testimonials/admin/x.dom.test.tsx",
        "packages/ui/src/test-support/dom",
      ),
    ).toBe(false);
    expect(relativeEscape("apps/web/lib/x.ts", "packages/db/src/client")).toBe(
      true,
    );
    expect(
      relativeEscape("apps/web/test/x.test.ts", "packages/db/test/seeded"),
    ).toBe(false);
    expect(
      relativeEscape("packages/db/src/content/x.ts", "packages/db/src/client"),
    ).toBe(false);
  });

  it("the add-on source scan catches each known bypass shape", () => {
    // Guard the guard: the regexes above must see these (B-CR-01 review cases).
    const bare = /["'`]@cds\/addon-([a-z0-9-]+)(?=[/"'`])/g;
    const relative = /["'`](\.{1,2}\/[^"'`\s]*)["'`]/g;
    const src = [
      'import m from "../credentials/records";',
      'import n from "../../packages/addons/testimonials/index";',
      'const l = () => import("@cds/addon-testimonials");',
      "const r = require('@cds/addon-credentials/server');",
    ].join("\n");
    expect([...src.matchAll(bare)].map((m) => m[1])).toEqual([
      "testimonials",
      "credentials",
    ]);
    expect([...src.matchAll(relative)].map((m) => m[1])).toEqual([
      "../credentials/records",
      "../../packages/addons/testimonials/index",
    ]);
  });

  it("only @cds/addon-registry and apps/web's registry dependency reach add-ons", () => {
    const offenders = workspacePackageJsons()
      .filter((file) => !rel(file).startsWith("packages/addons/"))
      .filter((file) => rel(file) !== "packages/addon-registry/package.json")
      .flatMap((file) =>
        Object.keys(deps(file))
          .filter(
            (n) => n.startsWith("@cds/addon-") && n !== "@cds/addon-registry",
          )
          .map((n) => `${rel(file)}: ${n}`),
      );
    expect(offenders).toEqual([]);
  });
});
