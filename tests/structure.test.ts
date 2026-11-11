import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

const WORKSPACES: Record<string, string> = {
  "apps/web": "@cds/web",
  "packages/db": "@cds/db",
  "packages/core": "@cds/core",
  "packages/ui": "@cds/ui",
  "packages/templates": "@cds/templates",
  "packages/addon-registry": "@cds/addon-registry",
};

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"));
}

describe("monorepo structure (PLAT-01)", () => {
  it("has every workspace directory, including packages/addons", () => {
    for (const dir of [...Object.keys(WORKSPACES), "packages/addons"]) {
      const full = path.join(repoRoot, dir);
      expect(existsSync(full), dir).toBe(true);
      expect(statSync(full).isDirectory(), dir).toBe(true);
    }
  });

  it("names each workspace package exactly @cds/*", () => {
    for (const [dir, name] of Object.entries(WORKSPACES)) {
      expect(readJson(`${dir}/package.json`).name, dir).toBe(name);
    }
  });

  it("declares the three workspace globs at the root", () => {
    expect(readJson("package.json").workspaces).toEqual([
      "apps/*",
      "packages/*",
      "packages/addons/*",
    ]);
  });

  it("lists every workspace package.json in the Dockerfile deps stage (WR-07)", () => {
    // npm ci in the deps stage fails with a lockfile mismatch at deploy time if any
    // workspace manifest is missing, so expand the globs and check each one here.
    const globs = readJson("package.json").workspaces as string[];
    const dirs: string[] = [];
    for (const glob of globs) {
      expect(glob.endsWith("/*"), glob).toBe(true);
      const parent = glob.slice(0, -2);
      for (const entry of readdirSync(path.join(repoRoot, parent), {
        withFileTypes: true,
      })) {
        const dir = `${parent}/${entry.name}`;
        if (
          entry.isDirectory() &&
          existsSync(path.join(repoRoot, dir, "package.json"))
        ) {
          dirs.push(dir);
        }
      }
    }
    expect(dirs.length).toBeGreaterThanOrEqual(Object.keys(WORKSPACES).length);

    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
    const missing = dirs.filter(
      (dir) =>
        !new RegExp(
          `^COPY ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/package\\.json ${dir}/\\s*$`,
          "m",
        ).test(dockerfile),
    );
    expect(missing, "add a COPY line to the Dockerfile deps stage").toEqual([]);
  });

  it("has one Dockerfile COPY line per add-on package (ADDON-01, Pitfall 6)", () => {
    // Each add-on dropped into packages/addons/<slug> must add its own deps-stage line.
    const addonsDir = path.join(repoRoot, "packages", "addons");
    const addons = readdirSync(addonsDir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          existsSync(path.join(addonsDir, e.name, "package.json")),
      )
      .map((e) => `packages/addons/${e.name}`);
    const dockerfile = readFileSync(
      path.join(repoRoot, "Dockerfile"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const required = ["packages/addon-registry", ...addons];
    const missing = required.filter(
      (dir) => !dockerfile.includes(`COPY ${dir}/package.json ${dir}/\n`),
    );
    expect(missing, "add a COPY line to the Dockerfile deps stage").toEqual([]);
  });

  it("keeps packages/addons as a documented folder, not a package", () => {
    expect(existsSync(path.join(repoRoot, "packages/addons/README.md"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(repoRoot, "packages/addons/package.json")),
    ).toBe(false);
  });
});
