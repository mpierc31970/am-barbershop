// P7 seam guard (07-02). Every barrel, port file, training module and doc section that the
// later P7 plans fill exists and is wired. Reads files only, so it stays green as owning
// plans replace barrel and section bodies (it checks existence and wiring, never content).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => existsSync(path.join(root, rel));

const DB_AREAS = [
  "media/store",
  "media/cdn",
  "media/library",
  "media/video",
  "media/ops",
  "forms",
  "contacts",
  "content/chrome",
  "content/history",
  "content/seo",
  "content/site-index",
  "content/protected",
];

const TRAINING = [
  "blocks-a",
  "blocks-b",
  "items",
  "media",
  "forms",
  "inbox",
  "contacts",
  "consent",
  "chrome",
  "site-settings",
  "history",
  "seo",
  "search",
  "protected",
];

const UI: Record<string, string[]> = {
  hub: ["contacts", "media", "forms", "inbox", "history"],
  site: ["consent", "chrome", "search", "protected", "render"],
  "site/client": ["consent", "forms", "chrome"],
  builder: ["media"],
};

const PORT_FILES = [
  "packages/db/src/media/ports.ts",
  "packages/db/src/forms/scanner-port.ts",
  "packages/db/src/content/p7-ports.ts",
];

const CORE_BARRELS = [
  "packages/core/src/content/validate-helpers.ts",
  "packages/core/src/content/blocks/index.ts",
  "packages/core/src/content/blocks/exports-a.ts",
  "packages/core/src/content/blocks/exports-b.ts",
  "packages/core/src/content/items/index.ts",
  "packages/core/src/content/chrome/index.ts",
  "packages/core/src/seo/index.ts",
  "packages/core/src/seo/page/index.ts",
  "packages/core/src/seo/site-index/index.ts",
  "packages/core/training/types.ts",
];

describe("P7 seams (07-02)", () => {
  it("has every db area barrel and port file", () => {
    for (const a of DB_AREAS) {
      expect(exists(`packages/db/src/${a}/index.ts`), a).toBe(true);
    }
    for (const f of PORT_FILES) expect(exists(f), f).toBe(true);
  });

  it("wires each db area barrel into @cds/db with export *", () => {
    const src = read("packages/db/src/index.ts");
    for (const a of DB_AREAS) {
      expect(src, a).toContain(`export * from "./${a}";`);
    }
    expect(src).toContain('from "./media/ports"');
    expect(src).toContain('from "./forms/scanner-port"');
    expect(src).toContain('from "./content/p7-ports"');
  });

  it("has the core barrels and wires them", () => {
    for (const f of CORE_BARRELS) expect(exists(f), f).toBe(true);
    const content = read("packages/core/src/content/index.ts");
    for (const b of ["./blocks", "./items", "./chrome"]) {
      expect(content, b).toContain(`export * from "${b}";`);
    }
    expect(content).toContain(
      'export * as contentValidators from "./validate-helpers";',
    );
    const blocks = read("packages/core/src/content/blocks/index.ts");
    expect(blocks).toContain('export * from "./exports-a";');
    expect(blocks).toContain('export * from "./exports-b";');
    const seo = read("packages/core/src/seo/index.ts");
    expect(seo).toContain('export * from "./page";');
    expect(seo).toContain('export * from "./site-index";');
    const pkg = JSON.parse(read("packages/core/package.json")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./seo"]).toBe("./src/seo/index.ts");
  });

  it("has the 14 training modules, each imported by entries.ts", () => {
    const entries = read("packages/core/training/entries.ts");
    for (const m of TRAINING) {
      expect(exists(`packages/core/training/p7/${m}.ts`), m).toBe(true);
      expect(entries, m).toContain(`from "./p7/${m}";`);
    }
  });

  it("wires every ui p7 barrel into its package barrel", () => {
    for (const [pkg, files] of Object.entries(UI)) {
      const barrel = read(`packages/ui/src/${pkg}/index.ts`);
      for (const f of files) {
        expect(exists(`packages/ui/src/${pkg}/p7/${f}.ts`), `${pkg}/${f}`).toBe(
          true,
        );
        expect(barrel, `${pkg}/${f}`).toContain(`export * from "./p7/${f}";`);
      }
    }
  });

  it("reserves the P7 slugs and excludes the media job path", () => {
    const pages = read("packages/db/src/content/pages.ts");
    for (const slug of ["search", "llms.txt", "_media"]) {
      expect(pages, slug).toContain(`"${slug}"`);
    }
    expect(read("apps/web/middleware.ts")).toContain("api/jobs/media$");
    expect(read("apps/web/lib/tenant.ts")).toContain(
      "export async function siteForRoute",
    );
  });
});
