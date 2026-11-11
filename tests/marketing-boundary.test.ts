// Marketing token + price-literal boundary (HUB-05, D104, D264, CONTEXT A2-Q1, RESEARCH Pitfall 10).
// Owner: 15-01. 15-26 may only add PRICE_LITERAL_ALLOW keys (recorded in its SUMMARY).
//
// Marketing code (the hub site) is born inside its own `--mk-*` token set:
//   (a) no --hub-, --site-, --cds-, font-hub, [data-site]
//   (b) no hub-/site-/cds- utility classes inside className
//   (c) no @cds/ui/hub, @cds/ui/site or /start/_components/ imports (Turnstile excepted)
//   (d) no hex / rgb( / rgba( literal outside packages/ui/src/marketing/tokens.css
//   (e) no $+digit literal (prices come from the catalog), except claims.ts and allow-listed copy.ts keys
//   (f) --mk- appears nowhere outside marketing code and apps/web/app/globals.css
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const norm = (p: string) => p.replace(/\\/g, "/");

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [norm(rel)];
  });
}

const SRC = /\.(ts|tsx|css)$/;
const MARKETING_APP = "apps/web/app/(platform)/(marketing)";
const MARKETING_UI = "packages/ui/src/marketing";
const MARKETING_CORE = "packages/core/src/marketing";
const TOKENS_CSS = `${MARKETING_UI}/tokens.css`;

/** copy.ts keys whose values are bound to calculator inputs and may name a dollar figure. */
const PRICE_LITERAL_ALLOW = ["CALC_ERR_SALES", "CALC_ERR_AVG"];

type Hit = string; // "file:line: text"
const hit = (file: string, i: number, line: string): Hit =>
  `${file}:${i + 1}: ${line.trim()}`;

function eachLine(
  file: string,
  src: string,
  test: (line: string, i: number) => boolean,
): Hit[] {
  return src
    .split(/\r?\n/)
    .flatMap((line, i) => (test(line, i) ? [hit(file, i, line)] : []));
}

// (a) foreign token names
const FOREIGN_TOKEN = /--hub-|--site-|--cds-|font-hub|\[data-site\]/;
function ruleForeignTokens(file: string, src: string): Hit[] {
  return eachLine(file, src, (l) => FOREIGN_TOKEN.test(l));
}

// (b) hub-/site-/cds- utility classes inside className strings or templates
const CLASSNAME =
  /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g;
const FOREIGN_CLASS = /\b(hub|site|cds)-[a-z0-9-]+/;
function ruleForeignClasses(file: string, src: string): Hit[] {
  return eachLine(file, src, (l) =>
    [...l.matchAll(CLASSNAME)].some((m) =>
      FOREIGN_CLASS.test(m.slice(1).filter(Boolean).join(" ")),
    ),
  );
}

// (c) forbidden imports
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
function forbiddenSpecifier(s: string): boolean {
  if (/^@cds\/ui\/(hub|site)(\/|$)/.test(s)) return true;
  if (s.includes("/start/_components/"))
    return !/\/Turnstile(\.tsx?)?$/.test(s);
  return false;
}
function ruleForbiddenImports(file: string, src: string): Hit[] {
  return eachLine(file, src, (l) =>
    [...l.matchAll(SPECIFIER)].some((m) => forbiddenSpecifier(m[1] ?? "")),
  );
}

// (d) colour literals outside tokens.css
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
function ruleColourLiterals(file: string, src: string): Hit[] {
  if (norm(file) === TOKENS_CSS) return [];
  return eachLine(file, src, (l) => COLOUR.test(l));
}

// (e) $+digit literals; claims.ts exempt whole, copy.ts exempt per allow-listed key only
const PRICE = /\$\d/;
const KEY_START = /^\s*(?:export\s+const\s+)?([A-Z][A-Z0-9_]*)\s*[:=]/;
function rulePriceLiterals(
  file: string,
  src: string,
  allow: readonly string[] = PRICE_LITERAL_ALLOW,
): Hit[] {
  const f = norm(file);
  if (f.endsWith("/marketing/claims.ts")) return [];
  const isCopy = f.endsWith("/marketing/copy.ts");
  let key: string | undefined;
  return eachLine(file, src, (l) => {
    if (isCopy) {
      const m = KEY_START.exec(l);
      if (m) key = m[1];
      if (key && allow.includes(key)) return false;
    }
    return PRICE.test(l);
  });
}

// (f) --mk- only inside marketing code and globals.css
const MK = /--mk-/;
function mkAllowed(file: string): boolean {
  const f = norm(file);
  return (
    f.startsWith(`${MARKETING_UI}/`) ||
    f.startsWith(`${MARKETING_APP}/`) ||
    f === "apps/web/app/globals.css"
  );
}
function ruleMkLeak(file: string, src: string): Hit[] {
  if (mkAllowed(file)) return [];
  return eachLine(file, src, (l) => MK.test(l));
}

const marketingFiles = () =>
  [...walk(MARKETING_APP), ...walk(MARKETING_UI)].filter((f) => SRC.test(f));

function scanAll(
  files: string[],
  rule: (f: string, s: string) => Hit[],
): Hit[] {
  return files.flatMap((f) => rule(f, read(f)));
}

describe("marketing boundary: rule self-tests (each regex bites)", () => {
  it("(a) flags foreign token names", () => {
    const fx =
      'a\n.x { color: var(--hub-ink); }\n<div className="font-hub" />\n[data-site] {}\nvar(--mk-ink)';
    expect(ruleForeignTokens("x.tsx", fx)).toHaveLength(3);
    expect(ruleForeignTokens("x.tsx", "var(--mk-ink)")).toHaveLength(0);
  });

  it("(b) flags hub-/site-/cds- utilities in className", () => {
    const fx = [
      '<p className="text-hub-ink p-2" />',
      "<p className={`bg-site-primary ${x}`} />",
      '<p className={"cds-card"} />',
      '<p className="mk-figures text-ink" />',
      'const href = "/site-rules";',
    ].join("\n");
    const hits = ruleForeignClasses("x.tsx", fx);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatch(/^x\.tsx:1:/);
  });

  it("(c) flags @cds/ui/hub, @cds/ui/site and /start/_components imports except Turnstile", () => {
    const fx = [
      'import { Card } from "@cds/ui/hub";',
      'import { X } from "@cds/ui/hub/legal";',
      'import { S } from "@cds/ui/site";',
      'import { C } from "../start/_components/Configurator";',
      'import { Turnstile } from "../start/_components/Turnstile";',
      'import { MkButton } from "@cds/ui/marketing";',
      'import { Hubbub } from "@cds/ui/hubbub";',
    ].join("\n");
    expect(ruleForbiddenImports("x.tsx", fx)).toHaveLength(4);
  });

  it("(d) flags hex and rgb( literals outside tokens.css", () => {
    const fx =
      "a { color: #fff; }\nb { color: #1a2b3c80; }\nc { color: rgb(0 0 0); }\nd { color: var(--mk-ink); }";
    expect(ruleColourLiterals(`${MARKETING_UI}/x.css`, fx)).toHaveLength(3);
    expect(ruleColourLiterals(TOKENS_CSS, fx)).toHaveLength(0);
  });

  it("(e) flags $+digit, exempts claims.ts whole and only allow-listed copy.ts keys", () => {
    const copy = [
      "export const COPY = {",
      '  HERO: "Sites from $49 a month",',
      '  CALC_ERR_SALES: "Enter monthly sales between $0 and $1,000,000.",',
      '  CALC_ERR_AVG: "Enter an average sale between $1 and $10,000.",',
      '  FOOTER: "No $5 fees",',
      "};",
      "const x = `${y}`;",
    ].join("\n");
    const hits = rulePriceLiterals(`${MARKETING_CORE}/copy.ts`, copy);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatch(/copy\.ts:2:/);
    expect(hits[1]).toMatch(/copy\.ts:5:/);
    expect(rulePriceLiterals(`${MARKETING_CORE}/claims.ts`, copy)).toHaveLength(
      0,
    );
    expect(
      rulePriceLiterals(`${MARKETING_UI}/PriceRun.tsx`, copy),
    ).toHaveLength(4);
  });

  it("(f) flags --mk- outside marketing code and globals.css", () => {
    const fx = "a { color: var(--mk-ink); }";
    expect(ruleMkLeak("packages/ui/src/hub/x.css", fx)).toHaveLength(1);
    expect(ruleMkLeak(`${MARKETING_UI}/tokens.css`, fx)).toHaveLength(0);
    expect(ruleMkLeak(`${MARKETING_APP}/page.tsx`, fx)).toHaveLength(0);
    expect(ruleMkLeak("apps/web/app/globals.css", fx)).toHaveLength(0);
  });
});

describe("marketing boundary: the real trees", () => {
  it("(a) no --hub-/--site-/--cds-/font-hub/[data-site] in marketing code", () => {
    expect(scanAll(marketingFiles(), ruleForeignTokens)).toEqual([]);
  });

  it("(b) no hub-/site-/cds- utility classes in marketing className", () => {
    expect(scanAll(marketingFiles(), ruleForeignClasses)).toEqual([]);
  });

  it("(c) no @cds/ui/hub, @cds/ui/site or /start/_components imports (Turnstile excepted)", () => {
    expect(scanAll(marketingFiles(), ruleForbiddenImports)).toEqual([]);
  });

  it("(d) no hex or rgb( literal outside tokens.css", () => {
    expect(scanAll(marketingFiles(), ruleColourLiterals)).toEqual([]);
  });

  it("(e) no $+digit literal outside claims.ts and allow-listed copy.ts keys", () => {
    const files = [
      ...marketingFiles(),
      ...walk(MARKETING_CORE).filter((f) => SRC.test(f)),
    ];
    expect(scanAll(files, rulePriceLiterals)).toEqual([]);
  });

  it("(f) --mk- stays inside marketing code and globals.css", () => {
    const files = [...walk("apps"), ...walk("packages")].filter(
      (f) =>
        SRC.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        !f.includes("/test/") &&
        !f.includes("/test-support/"),
    );
    expect(scanAll(files, ruleMkLeak)).toEqual([]);
  });

  it("the boundary covers the seam files 15-01 created", () => {
    expect(walk(MARKETING_UI).length).toBeGreaterThanOrEqual(28);
    expect(walk(MARKETING_CORE).length).toBeGreaterThanOrEqual(11);
  });
});
