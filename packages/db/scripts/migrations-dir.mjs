#!/usr/bin/env node
// One assembled migration list for every consumer (ADDON-03, RESEARCH Pattern 4, Pitfall 4).
//
// PocketBase reads a single --migrationsDir, but add-on collections ship from day one
// (invariant 3), so their migrations live beside the add-on in
// packages/addons/<slug>/migrations/*.js. This module lists core + add-on migrations as one
// ordered set; the PB test harness, the round-trip test, db:migrate:dev and the production
// push all use it, so an add-on migration can never be skipped.
//
// Timestamp blocks (one 100-block per owner, 10-digit unix-style prefix):
//   core (packages/db/pb_migrations)  17900000xx .. 17900003xx onward
//   testimonials add-on               17900005xx
//   credentials add-on                17900006xx
//   next add-on                       the next free 100-block
// A duplicate basename or a duplicate numeric timestamp prefix is refused, so two add-ons
// can never silently shadow or reorder each other's migrations (T-05-13).
//
// Usage:
//   node packages/db/scripts/migrations-dir.mjs <targetDir>   (npm run db:migrations:assemble -- <dir>)
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");
const CORE_DIR = join(PKG_DIR, "pb_migrations");
const ADDONS_DIR = join(REPO_ROOT, "packages", "addons");

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

/** Leading digits before the first "_" (the migration timestamp). */
export function timestampOf(name) {
  const m = /^(\d+)_/.exec(name);
  return m ? m[1] : null;
}

/**
 * Throw when two names share a basename or a numeric timestamp prefix. Pure; exported for
 * tests.
 */
export function checkUnique(names) {
  const seenNames = new Set();
  const seenTs = new Map();
  for (const name of names) {
    if (seenNames.has(name)) {
      throw new Error(`duplicate migration file name: ${name}`);
    }
    seenNames.add(name);
    const ts = timestampOf(name);
    if (ts === null) {
      throw new Error(`migration ${name} has no numeric timestamp prefix`);
    }
    const prior = seenTs.get(ts);
    if (prior !== undefined) {
      throw new Error(
        `duplicate migration timestamp ${ts}: ${prior} and ${name}`,
      );
    }
    seenTs.set(ts, name);
  }
}

/** Absolute paths of every core + add-on migration, sorted by basename. */
export function migrationFiles() {
  const files = [...jsFiles(CORE_DIR)];
  if (existsSync(ADDONS_DIR)) {
    for (const entry of readdirSync(ADDONS_DIR).sort()) {
      const dir = join(ADDONS_DIR, entry);
      if (!statSync(dir).isDirectory()) continue;
      files.push(...jsFiles(join(dir, "migrations")));
    }
  }
  const byName = (a, b) =>
    basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0;
  files.sort(byName);
  checkUnique(files.map((f) => basename(f)));
  return files;
}

/**
 * Copy every migration into `target` (created if missing) and return the copied paths.
 * A stale *.js in the target that is not part of the list is refused, so PB never applies
 * a migration the repo no longer has.
 */
export function assembleMigrationsDir(target) {
  const files = migrationFiles();
  mkdirSync(target, { recursive: true });
  const wanted = new Set(files.map((f) => basename(f)));
  const stale = readdirSync(target).filter(
    (f) => f.endsWith(".js") && !wanted.has(f),
  );
  if (stale.length > 0) {
    throw new Error(
      `${target} holds migrations not in the repo: ${stale.join(", ")}`,
    );
  }
  const copied = [];
  for (const file of files) {
    const dest = join(target, basename(file));
    copyFileSync(file, dest);
    copied.push(dest);
  }
  return copied;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) {
    console.error(
      "usage: node packages/db/scripts/migrations-dir.mjs <targetDir>",
    );
    process.exit(1);
  }
  try {
    const copied = assembleMigrationsDir(resolve(target));
    console.log(
      `assembled ${copied.length} migrations into ${resolve(target)}`,
    );
  } catch (err) {
    console.error(`FAIL ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
