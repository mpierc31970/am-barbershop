// WR-01: organizations.design has exactly one writer (queueDesignWrite in theme.ts). A source
// scan of every non-test file in packages/db/src and packages/db/scripts, so a new direct
// write (a literal `design` key, or a spread that could carry one, on an organizations
// create/update/upsert) fails here instead of hiding behind an exported-name check.
// The one dynamic org write (restoreTenant's planned update built from the bundle row) is
// listed explicitly and must strip `design` and route it through queueDesignWrite.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__fixtures__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip // and /* *\/ comments (good enough for this repo's source; strings kept). */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The argument text of the call whose "(" is at `open`, up to its matching ")". */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

const ORG_WRITE =
  /collection\(\s*["']organizations["']\s*\)\s*\.\s*(?:update|create|upsert)\s*\(/g;

function orgWrites(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(ORG_WRITE)) {
    out.push(argsAt(src, m.index + m[0].length - 1));
  }
  return out;
}

const FILES = [
  ...sourceFiles(join(PKG, "src")),
  ...sourceFiles(join(PKG, "scripts")),
].map((f) => ({
  rel: relative(PKG, f).replace(/\\/g, "/"),
  src: code(readFileSync(f, "utf8")),
}));

/** Files with a planned (dynamic) organizations write, and the proof each one routes design. */
const DYNAMIC_ORG_WRITERS: Record<string, RegExp[]> = {
  "src/export.ts": [/delete orgBody\.design;/, /queueDesignWrite\(/],
  // 06-11: org_name renames the organization in the business-profile batch; A-CR-01 adds
  // the fit hold's stage. The body is a patch typed { name?, stage? } only, so design can
  // never ride along.
  "src/intake/business-profile.ts": [
    /const orgPatch:\s*\{\s*name\?:\s*string;\s*stage\?:\s*"fit_review"\s*\}\s*=\s*\{\};/,
    /collection:\s*"organizations",\s*op:\s*"update",\s*id:\s*ctx\.orgId,\s*body:\s*orgPatch,?\s*\}/,
  ],
};

describe("organizations.design has exactly one writer (WR-01)", () => {
  it("the scan sees theme.ts's own write (the check is not vacuous)", () => {
    const theme = FILES.find((f) => f.rel === "src/theme.ts")!;
    const writes = orgWrites(theme.src);
    expect(writes.length).toBe(1);
    expect(writes[0]).toMatch(/\bdesign\b/);
  });

  it("no other file puts `design` (or a spread) on an organizations create/update/upsert", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (f.rel === "src/theme.ts") continue;
      for (const args of orgWrites(f.src)) {
        if (/\bdesign\b/.test(args) || args.includes("...")) {
          offenders.push(
            `${f.rel}: ${args.replace(/\s+/g, " ").slice(0, 120)}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every planned organizations write strips design and routes it through queueDesignWrite", () => {
    const planned = FILES.filter(
      (f) =>
        f.rel !== "src/theme.ts" &&
        /collection:\s*["']organizations["']/.test(f.src),
    ).map((f) => f.rel);
    expect(planned.sort()).toEqual(Object.keys(DYNAMIC_ORG_WRITERS).sort());
    for (const [rel, proofs] of Object.entries(DYNAMIC_ORG_WRITERS)) {
      const f = FILES.find((x) => x.rel === rel)!;
      for (const re of proofs) expect(f.src, `${rel} ${re}`).toMatch(re);
    }
  });

  it("queueDesignWrite is called only by theme.ts, restore, the dev seed and the demo seed (13-31); not a root export", () => {
    const callers = FILES.filter(
      (f) => f.rel !== "src/theme.ts" && /\bqueueDesignWrite\s*\(/.test(f.src),
    ).map((f) => f.rel);
    expect(callers.sort()).toEqual([
      "scripts/seed-am-barber.ts",
      "src/demo/seed.ts",
      "src/dev-seed.ts",
      "src/export.ts",
    ]);
    const index = FILES.find((f) => f.rel === "src/index.ts")!;
    expect(index.src).not.toMatch(/queueDesignWrite/);
  });
});
