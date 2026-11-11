// BILL-05, D42 (T-10-18-03): client components never import the db layer. A "use client"
// module under apps/web or packages/ui that imports @cds/db or pocketbase (value or type
// import) could serialise a raw row into the browser bundle; data reaches clients only as
// props built by server code, projected through BROWSER_FIELDS / toBrowser.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "dist", "coverage"]);

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

/** True when the module's first statement is the "use client" directive. */
export function isClientModule(src: string): boolean {
  const body = src
    .replace(/^﻿/, "")
    .replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(body);
}

const DB_SPECIFIER = /^(@cds\/db(\/.*)?|pocketbase(\/.*)?)$/;

/** Every module specifier the file imports or re-exports (value, type, dynamic). */
export function specifiersOf(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
  )) {
    out.push(m[1]!);
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(m[1]!);
  }
  return out;
}

describe("browser boundary (client components never import the db layer)", () => {
  it("detects the directive and db imports (self-check)", () => {
    expect(
      isClientModule('// c\n/* x */\n"use client";\nimport x from "y";'),
    ).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";')).toBe(false);
    const specs = specifiersOf(
      'import type { RecordModel } from "pocketbase";\nimport {\n  a,\n} from "@cds/db/payments";\nconst m = import("@cds/core");',
    );
    expect(specs.filter((s) => DB_SPECIFIER.test(s))).toEqual([
      "pocketbase",
      "@cds/db/payments",
    ]);
  });

  it("no 'use client' module under apps/web or packages/ui imports @cds/db or pocketbase", () => {
    const files = [...walk("apps/web"), ...walk("packages/ui")].filter((f) =>
      /\.(ts|tsx)$/.test(f),
    );
    const clients = files.filter((f) =>
      isClientModule(readFileSync(join(root, f), "utf8")),
    );
    expect(clients.length).toBeGreaterThan(50);
    const offenders = clients.flatMap((f) =>
      specifiersOf(readFileSync(join(root, f), "utf8"))
        .filter((s) => DB_SPECIFIER.test(s))
        .map((s) => `${f.replace(/\\/g, "/")} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
