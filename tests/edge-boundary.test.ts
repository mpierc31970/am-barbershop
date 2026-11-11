// RESEARCH Pitfall 1 / T-03-02: sanitize-html (htmlparser2, postcss) must never reach the
// Edge middleware bundle. The sanitizer is exported only as "@cds/core/content/sanitize";
// the @cds/core root that middleware imports stays free of it, and client-side UI code
// (builder, site islands, hub primitives) never imports it either.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

describe("Edge boundary (sanitizer stays out of middleware)", () => {
  it("@cds/core root index re-exports no content or sanitize module", () => {
    const index = read("packages/core/src/index.ts");
    expect(index).not.toMatch(/content/);
    expect(index).not.toMatch(/sanitize/);
  });

  it("the sanitizer is only reachable through its own subpath export", () => {
    const pkg = JSON.parse(read("packages/core/package.json")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["."]).toBe("./src/index.ts");
    expect(pkg.exports["./content/sanitize"]).toBe("./src/content/sanitize.ts");
    const others = Object.entries(pkg.exports).filter(
      ([key]) => key !== "./content/sanitize",
    );
    for (const [, target] of others) expect(target).not.toMatch(/sanitize/);
  });

  it("apps/web/middleware.ts imports @cds/core only via the root specifier", () => {
    const src = read("apps/web/middleware.ts");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    const core = specifiers.filter((s) => s?.startsWith("@cds/core"));
    expect(core.length).toBeGreaterThan(0);
    for (const s of core) expect(s).toBe("@cds/core");
    expect(src).not.toMatch(/sanitize/);
  });

  it("client-side UI code never imports the sanitizer", () => {
    const files = [
      ...walk("packages/ui/src/builder"),
      ...walk("packages/ui/src/site/client"),
      ...walk("packages/ui/src/hub"),
    ].filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
    for (const f of files) expect(read(f), f).not.toMatch(/content\/sanitize/);
  });
});

// THEME-06, CONTEXT A2-Q1, D-UI-P4-1: @cds/core/theme is Edge-safe. Only the Node-only
// importer under packages/core/src/theme/import may use node:* or yaml.
describe("Edge boundary (theme subpath stays Edge-safe)", () => {
  it("packages/core/src/theme has no node:, yaml or require outside import/", () => {
    const files = walk("packages/core/src/theme").filter(
      (f) =>
        /\.(ts|tsx|js|mjs)$/.test(f) &&
        !/\.test\./.test(f) &&
        !/[\\/]theme[\\/]import[\\/]/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /from ["']node:|from ["']yaml["']|require\(/,
      );
    }
  });

  it("@cds/core root index does not re-export theme", () => {
    expect(read("packages/core/src/index.ts")).not.toMatch(/theme/);
  });

  it("the ./theme export targets the barrel, never the importer", () => {
    const pkg = JSON.parse(read("packages/core/package.json")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./theme"]).toBe("./src/theme/index.ts");
    expect(read("packages/core/src/theme/index.ts")).not.toMatch(
      /from ["']\.\/import/,
    );
  });
});

// ADDON-01, T-05-05: @cds/core/addons is pure and Edge-safe. No node:*, no @cds/db, and
// the root barrel that middleware imports never re-exports it.
describe("Edge boundary (addons subpath stays Edge-safe)", () => {
  it("packages/core/src/addons has no node:, @cds/db or require", () => {
    const files = walk("packages/core/src/addons").filter(
      (f) =>
        /\.(ts|tsx|js|mjs)$/.test(f) &&
        !/\.test\./.test(f) &&
        !/[\\/]__fixtures__[\\/]/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /from ["']node:|from ["']@cds\/db|require\(/,
      );
    }
  });

  it("@cds/core root index does not re-export addons", () => {
    expect(read("packages/core/src/index.ts")).not.toMatch(/addons/);
  });
});

// P9 (LIFE-02, AGR-01, RESEARCH Pitfall 8): @cds/core/legal is pure and Edge-safe. sha256
// lives in the codegen script and @cds/db; the HTML sanitizer stays in content/sanitize.
describe("Edge boundary (legal subpath stays pure)", () => {
  it("packages/core/src/legal has no node:, @cds/db, sanitize-html or require", () => {
    const files = walk("packages/core/src/legal").filter(
      (f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.test\./.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /from ["']node:|from ["']@cds\/db|sanitize-html|require\(/,
      );
    }
  });

  it("@cds/core root index does not re-export legal", () => {
    expect(read("packages/core/src/index.ts")).not.toMatch(/legal/);
  });
});

// ADDON-12..14 / Pitfall 1: the CSV engine is pure (it runs in client import previews).
describe("Edge boundary (csv subpath stays pure)", () => {
  it("packages/core/src/csv has no node:, @cds/db or require", () => {
    const files = walk("packages/core/src/csv").filter(
      (f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.test\./.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /from ["']node:|from ["']@cds\/db|require\(/,
      );
    }
  });
});

// ONB-06, ONB-11, ONB-12, T-06-04: @cds/core/pricing and @cds/core/onboarding run in the
// browser (the /start receipt) and on the server. No node:*, no @cds/db, no require; the AUP
// module never reads files at runtime (RESEARCH anti-pattern). The root barrel stays clean.
describe("Edge boundary (pricing and onboarding subpaths stay pure)", () => {
  it.each(["packages/core/src/pricing", "packages/core/src/onboarding"])(
    "%s has no node:, @cds/db or require",
    (dir) => {
      const files = walk(dir).filter(
        (f) =>
          /\.(ts|tsx|js|mjs)$/.test(f) &&
          !/\.test\./.test(f) &&
          !/[\\/]__fixtures__[\\/]/.test(f),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(read(f), f).not.toMatch(
          /from ["']node:|from ["']@cds\/db|require\(/,
        );
      }
    },
  );

  it("@cds/core root index does not re-export pricing or onboarding", () => {
    expect(read("packages/core/src/index.ts")).not.toMatch(
      /pricing|onboarding/,
    );
  });
});

// ONB-01..03, EMAIL-01, ONB-10: @cds/core/intake and @cds/core/email run in the hub (browser)
// and on the server. No node:*, no @cds/db, no require; the root barrel stays clean.
describe("Edge boundary (intake, email and forms subpaths stay pure)", () => {
  it.each([
    "packages/core/src/intake",
    "packages/core/src/email",
    "packages/core/src/forms",
  ])("%s has no node:, @cds/db or require", (dir) => {
    const files = walk(dir).filter(
      (f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.test\./.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /from ["']node:|from ["']@cds\/db|require\(/,
      );
    }
  });

  it("@cds/core root index does not re-export intake, email or forms", () => {
    expect(read("packages/core/src/index.ts")).not.toMatch(
      /intake|email|forms/,
    );
  });

  it("the ./intake, ./email and ./forms exports target their barrels", () => {
    const pkg = JSON.parse(read("packages/core/package.json")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./intake"]).toBe("./src/intake/index.ts");
    expect(pkg.exports["./email"]).toBe("./src/email/index.ts");
    expect(pkg.exports["./forms"]).toBe("./src/forms/index.ts");
  });
});

// ADDON-01, T-05-15, RESEARCH Pitfall 1: the registry's pure entry (imported by the
// "use client" builder through lib/section-registry.ts) never reaches server code.
describe("Edge boundary (add-on registry pure entry)", () => {
  it.each([
    "packages/addon-registry/src/index.ts",
    "packages/addon-registry/src/generated/manifests.ts",
    "packages/addon-registry/src/generated/howto.ts",
  ])("%s imports no @cds/db, server module or node:*", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/from ["']@cds\/db|import ["']@cds\/db/);
    expect(src).not.toContain('/server"');
    expect(src).not.toMatch(/["']node:/);
  });

  // B-WR-07: the direct imports above are not enough. manifests.ts imports each add-on's
  // "." entry, which pulls in records.ts, csv.ts, install.ts and so on. Walk the whole
  // runtime import graph from the pure entry, through @cds/addon-* "." entries and relative
  // imports, and fail if any reached file imports server code.
  it("no file reachable from the pure entry imports @cds/db, node:*, pocketbase or a server/site/admin module", () => {
    const reached = pureGraph("packages/addon-registry/src/index.ts");
    const addonFiles = reached.filter((f) => f.startsWith("packages/addons/"));
    // Every add-on's "." entry and its pure modules are in the walk. A manifest-only
    // add-on (builder-pro, 10-07: no collections, no records) has no records.ts; when the
    // file exists it must be reached.
    for (const slug of addonSlugs()) {
      expect(reached, slug).toContain(`packages/addons/${slug}/index.ts`);
      if (existsSync(join(root, "packages/addons", slug, "records.ts"))) {
        expect(reached, slug).toContain(`packages/addons/${slug}/records.ts`);
      }
    }
    expect(addonFiles.length).toBeGreaterThan(addonSlugs().length);
    for (const f of reached) {
      expect(f, "server module reached").not.toMatch(SERVER_FILE);
      for (const spec of runtimeSpecifiers(read(f))) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(FORBIDDEN_SPEC);
      }
    }
  });

  it("the graph walk catches an add-on entry that pulls in server code (self-test)", () => {
    expect(
      runtimeSpecifiers(
        'import type { X } from "@cds/db";\nimport { a } from "./repo";\nexport { b } from "./records";\nexport type { C } from "./types";\nconst m = () => import("./server");\n',
      ),
    ).toEqual(["./repo", "./records", "./server"]);
    expect("@cds/db").toMatch(FORBIDDEN_SPEC);
    expect("node:fs").toMatch(FORBIDDEN_SPEC);
    expect("pocketbase").toMatch(FORBIDDEN_SPEC);
    expect("@cds/addon-registry/server").toMatch(FORBIDDEN_SPEC);
    expect("@cds/addon-testimonials/admin").toMatch(FORBIDDEN_SPEC);
    expect("@cds/core/addons").not.toMatch(FORBIDDEN_SPEC);
    expect("packages/addons/x/repo.ts").toMatch(SERVER_FILE);
    expect("packages/addons/x/server.ts").toMatch(SERVER_FILE);
    expect("packages/addons/x/site/Block.tsx").toMatch(SERVER_FILE);
    expect("packages/addons/x/admin/index.ts").toMatch(SERVER_FILE);
    expect("packages/addons/x/records.ts").not.toMatch(SERVER_FILE);
  });
});

const FORBIDDEN_SPEC =
  /^(@cds\/db(\/|$)|node:|pocketbase(\/|$)|next\/headers$|@cds\/addon-[a-z0-9-]+\/(server|site|admin)(\/|$))/;
const SERVER_FILE =
  /(^|\/)(server|repo)\.tsx?$|^packages\/addons\/[^/]+\/(site|admin)\//;

/** Module specifiers that survive compilation (type-only imports and exports are erased). */
function runtimeSpecifiers(src: string): string[] {
  const out: string[] = [];
  const stmt =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(stmt)) {
    if (m[2]) continue;
    out.push(m[3]!);
  }
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(m[1]!);
  }
  return out;
}

function addonSlugs(): string[] {
  return readdirSync(join(root, "packages/addons")).filter((d) =>
    existsSync(join(root, "packages/addons", d, "package.json")),
  );
}

function resolveFile(base: string): string | null {
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    const abs = join(root, c);
    if (existsSync(abs) && statSync(abs).isFile()) return c;
  }
  return null;
}

function addonEntry(slug: string, sub: string): string | null {
  const pkgPath = join(root, "packages/addons", slug, "package.json");
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    exports: Record<string, string>;
  };
  const target = pkg.exports[sub === "" ? "." : `./${sub}`];
  return target
    ? resolveFile(`packages/addons/${slug}/${target.replace(/^\.\//, "")}`)
    : null;
}

/** Files reached from `start` through relative imports and @cds/addon-* package entries. */
function pureGraph(start: string): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(read(file))) {
      let next: string | null = null;
      if (spec.startsWith(".")) {
        const dir = file.split("/").slice(0, -1).join("/");
        const joined = join(dir, spec).split("\\").join("/");
        next = resolveFile(joined);
        expect(next, `${file} imports ${spec}: not found`).not.toBeNull();
      } else {
        const m =
          /^@cds\/addon-(?!registry(\/|$))([a-z0-9-]+)(?:\/(.+))?$/.exec(spec);
        if (m) next = addonEntry(m[2]!, m[3] ?? "");
      }
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}
