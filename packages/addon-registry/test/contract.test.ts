// Add-on package contract (ADDON-02, testable not asserted; RESEARCH Pattern 2; invariant 4).
// Runs for every discovered add-on, so 05-07/05-09 light it up by dropping their folders in.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../scripts/gen.mjs";
import { addonBlockForm, addonPanel, ADDON_ADMIN } from "../src/admin";
import { MANIFESTS } from "../src/generated/manifests";
import { ADDON_REGISTRY } from "../src/index";
import { ADDON_SERVER } from "../src/server";
import { ADDON_SITE_RENDERERS } from "../src/site";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const addons = discover(repoRoot);

const EXPORTS = {
  ".": "./index.ts",
  "./server": "./server.ts",
  "./site": "./site/index.ts",
  "./admin": "./admin/index.ts",
};

const REQUIRED_FILES = [
  "index.ts",
  "addon.config.ts",
  "collections.ts",
  "install.ts",
  "uninstall.ts",
  "repo.ts",
  "server.ts",
];
const REQUIRED_DIRS = ["migrations", "sections", "site", "admin", "training"];

// 10-07 (BILL-14, D233): a manifest-only add-on (Builder Pro) owns no data, no block and no
// screen, so it ships only the manifest, training and the three registry entry stubs. It
// must have NO migrations folder (invariant 3) and no data modules.
const MANIFEST_ONLY_FILES = ["index.ts", "addon.config.ts", "server.ts"];
const MANIFEST_ONLY_DIRS = ["site", "admin", "training"];
const DATA_ONLY = ["collections.ts", "install.ts", "uninstall.ts", "repo.ts"];

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

describe("add-on contract (ADDON-02)", () => {
  it("registers exactly the discovered add-ons", () => {
    expect(MANIFESTS.map((m) => m.slug).sort()).toEqual(
      addons.map((a) => a.slug),
    );
    expect(ADDON_REGISTRY.list().length).toBe(addons.length);
  });

  if (addons.length === 0) {
    it("has no add-ons yet (allowed until 05-07)", () => {
      expect(MANIFESTS.length).toBe(0);
      expect(discover(repoRoot).length).toBe(0);
      expect(Object.keys(ADDON_SERVER)).toEqual([]);
      expect(Object.keys(ADDON_SITE_RENDERERS)).toEqual([]);
      expect(Object.keys(ADDON_ADMIN)).toEqual([]);
    });
    return;
  }

  describe.each(addons.map((a) => [a.slug]))("%s", (slug) => {
    const dir = path.join(repoRoot, "packages", "addons", slug);
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const manifest = ADDON_REGISTRY.get(slug)!;

    it("has a manifest whose slug is the folder name", () => {
      expect(manifest?.slug).toBe(slug);
    });

    it("exports exactly . ./server ./site ./admin", () => {
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe("module");
      expect(pkg.exports).toEqual(EXPORTS);
    });

    const manifestOnly = manifest.nav.placement === "none";

    if (manifestOnly) {
      it("is manifest-only: no collections, records, blocks, page or migrations", () => {
        expect(manifest.collections).toEqual({});
        expect(manifest.records).toEqual({});
        expect(manifest.sections).toEqual([]);
        expect(manifest.install).toEqual({});
        expect(ADDON_SERVER[slug]!.blockCollections).toEqual([]);
        for (const f of MANIFEST_ONLY_FILES) {
          expect(existsSync(path.join(dir, f)), `${slug}/${f}`).toBe(true);
        }
        for (const d of MANIFEST_ONLY_DIRS) {
          expect(isDir(path.join(dir, d)), `${slug}/${d}/`).toBe(true);
        }
        expect(existsSync(path.join(dir, "migrations")), "migrations/").toBe(
          false,
        );
        for (const f of DATA_ONLY) {
          expect(existsSync(path.join(dir, f)), `${slug}/${f}`).toBe(false);
        }
      });
    } else {
      it("has every required file and folder", () => {
        for (const f of REQUIRED_FILES) {
          expect(existsSync(path.join(dir, f)), `${slug}/${f}`).toBe(true);
        }
        for (const d of REQUIRED_DIRS) {
          expect(isDir(path.join(dir, d)), `${slug}/${d}/`).toBe(true);
        }
      });

      it("ships at least one migration", () => {
        const js = readdirSync(path.join(dir, "migrations")).filter((f) =>
          f.endsWith(".js"),
        );
        expect(js.length).toBeGreaterThanOrEqual(1);
      });
    }

    it("has csv.ts if and only if the manifest declares csv", () => {
      expect(existsSync(path.join(dir, "csv.ts"))).toBe(
        manifest.csv !== undefined,
      );
    });

    it("has a site renderer and a block form for every section type", () => {
      for (const def of manifest.sections) {
        expect(ADDON_SITE_RENDERERS[def.type], def.type).toBeTypeOf("function");
        expect(addonBlockForm(def.type), def.type).toBeTypeOf("function");
      }
    });

    it("has a nav panel", () => {
      expect(addonPanel(slug)).toBeTypeOf("function");
    });

    it("has a pure server module", () => {
      const mod = ADDON_SERVER[slug];
      expect(mod).toBeDefined();
      expect(Array.isArray(mod!.blockCollections)).toBe(true);
      for (const c of mod!.blockCollections) {
        expect(Object.keys(manifest.collections)).toContain(c);
      }
      expect(mod!.blockData).toBeTypeOf("function");
    });

    it("seeds only section types it owns", () => {
      for (const s of manifest.install.page?.sections ?? []) {
        expect(ADDON_REGISTRY.ownerOf(s.section_type), s.section_type).toBe(
          slug,
        );
      }
    });

    it("disables and retains on uninstall (invariant 9)", () => {
      expect(manifest.uninstall.retain).toBe("all");
    });
  });
});

describe("registry lookups", () => {
  it("returns undefined for unknown or non-string keys", () => {
    expect(addonPanel("nope")).toBeUndefined();
    expect(addonPanel("__proto__")).toBeUndefined();
    expect(addonPanel(42)).toBeUndefined();
    expect(addonBlockForm("toString")).toBeUndefined();
    expect(addonBlockForm(undefined)).toBeUndefined();
  });
});
