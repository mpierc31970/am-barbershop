// 14-10 (DOM-04, D56; T-14-10-03): the DnsProvider surface is zone operations only, and no
// registrar action (buy, renew, move between registrars, auth codes) exists anywhere in the
// dns sources. Comments and string literals (owner copy such as "Renew it at GoDaddy") are
// stripped first: the test looks for code identifiers only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fakeDnsProvider } from "./fake/provider";
import { DNS_PROVIDER_METHODS, PUBLIC_RESOLVERS } from "./ports";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const DIRS = [
  join(ROOT, "packages", "db", "src", "dns"),
  join(ROOT, "packages", "core", "src", "dns"),
];

// Forbidden words: register, renew, transfer, authCode (as identifiers).
const FORBIDDEN = /\b(register\w*|renew\w*|transfer\w*|authcode\w*)\b/i;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__fixtures__") continue;
      out.push(...sources(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Code with comments, string literals and template text removed (identifiers stay). */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

describe("DnsProvider surface (DOM-04)", () => {
  it("is exactly the nine zone methods plus name", () => {
    expect([...DNS_PROVIDER_METHODS].sort()).toEqual(
      [
        "createZone",
        "deleteRecord",
        "deleteZone",
        "exportBind",
        "importBind",
        "listRecords",
        "scanRecords",
        "upsertRecord",
        "zoneStatus",
      ].sort(),
    );
    const p = fakeDnsProvider();
    expect(Object.keys(p).sort()).toEqual(
      ["name", ...DNS_PROVIDER_METHODS].sort(),
    );
    expect(p.name).toBe("fake");
  });

  it("names the two public resolvers step 7 requires", () => {
    expect(PUBLIC_RESOLVERS).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("has no register / renew / transfer / authCode identifier in any dns source", () => {
    const files = DIRS.flatMap(sources);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of files) {
      const code = codeOnly(readFileSync(f, "utf8"));
      code.split("\n").forEach((line, i) => {
        const m = FORBIDDEN.exec(line);
        // P14_COPY keys and copy builders are owner text about the registrar, not
        // capabilities; copy.ts holds no callable registrar action (DOM-04).
        if (m && !f.endsWith(join("core", "src", "dns", "copy.ts"))) {
          hits.push(`${relative(ROOT, f)}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("the stripper keeps identifiers and drops text", () => {
    expect(FORBIDDEN.test(codeOnly('const a = "renew it"; // transfer'))).toBe(
      false,
    );
    expect(FORBIDDEN.test(codeOnly("async renewDomain() {}"))).toBe(true);
    expect(FORBIDDEN.test(codeOnly("const authCode = 1;"))).toBe(true);
  });
});
