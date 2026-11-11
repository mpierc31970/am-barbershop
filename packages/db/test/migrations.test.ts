import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  checkUnique,
  migrationFiles,
  timestampOf,
} from "../scripts/migrations-dir.mjs";

// D19: a restore rehearsal needs every migration to be reversible. PocketBase makes
// down() optional, so this suite is what makes it mandatory.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(PKG_DIR, "pb_migrations");
const ADDONS_DIR = join(PKG_DIR, "..", "addons");
const NAME_PATTERN = /^\d{10}_[a-z0-9_]+\.js$/;

interface MigrateCall {
  up: unknown;
  down: unknown;
}

/** Evaluate a migration source in a sandbox and capture its migrate() calls. */
function captureMigrateCalls(source: string, filename: string): MigrateCall[] {
  const calls: MigrateCall[] = [];
  const context = vm.createContext({
    migrate: (up: unknown, down?: unknown) => {
      calls.push({ up, down });
    },
    Collection: class {
      args: unknown[];
      constructor(...args: unknown[]) {
        this.args = args;
      }
    },
  });
  vm.runInContext(source, context, { filename });
  return calls;
}

function hasUpAndDown(calls: MigrateCall[]): boolean {
  return (
    calls.length === 1 &&
    typeof calls[0].up === "function" &&
    typeof calls[0].down === "function"
  );
}

// Core + packages/addons/*/migrations (ADDON-03): every per-file check covers both.
const paths = migrationFiles();
const files = paths.map((p) => basename(p));
const sourceOf = (file: string) =>
  readFileSync(paths[files.indexOf(file)]!, "utf8");

describe("pb_migrations", () => {
  it("contains at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names every file <10-digit unix ts>_<snake_name>.js", () => {
    for (const file of [...readdirSync(MIGRATIONS_DIR), ...files]) {
      expect(file, `bad migration file name: ${file}`).toMatch(NAME_PATTERN);
    }
  });

  it("calls migrate(up, down) exactly once with both functions in every file", () => {
    for (const file of files) {
      const source = sourceOf(file);
      const calls = captureMigrateCalls(source, file);
      expect(hasUpAndDown(calls), `${file} must call migrate(up, down)`).toBe(
        true,
      );
    }
  });

  it("uses plain goja scripts (no import/export)", () => {
    for (const file of files) {
      const source = sourceOf(file);
      expect(source, `${file} must not use ES modules`).not.toMatch(
        /^(import|export)\s/m,
      );
    }
  });

  it("includes every packages/addons/*/migrations file (ADDON-03)", () => {
    const expected: string[] = [];
    if (existsSync(ADDONS_DIR)) {
      for (const entry of readdirSync(ADDONS_DIR)) {
        const dir = join(ADDONS_DIR, entry, "migrations");
        if (!statSync(join(ADDONS_DIR, entry)).isDirectory()) continue;
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".js")) expected.push(f);
        }
      }
    }
    for (const f of expected) expect(files).toContain(f);
    for (const f of readdirSync(MIGRATIONS_DIR)) {
      if (f.endsWith(".js")) expect(files).toContain(f);
    }
  });

  it("lists migrations sorted by name with unique numeric timestamps", () => {
    expect(files).toEqual([...files].sort());
    const prefixes = new Set(files.map((f) => timestampOf(f)));
    expect(prefixes.size).toBe(files.length);
    expect(files).toContain("1790000300_create_org_addons.js");
  });

  it("refuses a duplicate timestamp or file name (T-05-13)", () => {
    expect(() =>
      checkUnique(["1790000500_a.js", "1790000600_b.js"]),
    ).not.toThrow();
    expect(() => checkUnique(["1790000500_a.js", "1790000500_b.js"])).toThrow(
      /duplicate migration timestamp 1790000500/,
    );
    expect(() => checkUnique(["1790000500_a.js", "1790000500_a.js"])).toThrow(
      /duplicate migration file name/,
    );
    expect(() => checkUnique(["nots_a.js"])).toThrow(/timestamp/);
  });

  it("guards the guard: a migration without down is reported", () => {
    const calls = captureMigrateCalls("migrate((app) => {})", "synthetic.js");
    expect(calls).toHaveLength(1);
    expect(hasUpAndDown(calls)).toBe(false);
  });
});
