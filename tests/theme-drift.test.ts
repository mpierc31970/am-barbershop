// THEME-04, THEME-06, D48, CONTEXT A4-Q2, D-UI-P4-2: the deterministic colour and font drift
// gate. RESEARCH Finding 1: the impeccable engine treats design-system-color as advisory, so
// this test is the colour gate. Every site renderer, template and add-on paints only from the
// --site-* tokens / site-* Tailwind aliases; a raw colour, a palette class, an arbitrary colour
// value, black/white in colour position or a font-family literal fails `npm test` with
// file:line. --site-accent is scoped to HeroSection and CountdownView (D-UI-P4-2), and the P3
// token names (site-ground, site-ink, site-on-primary, site-rule) never come back (THEME-06).
// True exceptions live in tests/theme-drift.allowlist.json, each with a reason; a stale entry
// fails the test so the allowlist cannot silently grow.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

/** Future templates (P7) and add-ons (P5+) inherit the gate by living under these roots. */
const SCAN_ROOTS = [
  "packages/ui/src/site",
  "packages/templates/src",
  "packages/addons",
  "apps/web/app/tenant",
];

/** --site-accent is allowed only here (D-UI-P4-2). */
const ACCENT_FILES = new Set([
  "packages/ui/src/site/HeroSection.tsx",
  "packages/ui/src/site/client/CountdownView.tsx",
]);

const SCANNED = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY =
  "text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|accent|caret|divide|shadow";

interface Rule {
  name: string;
  patterns: RegExp[];
  /** Return false to skip the rule for this file. */
  appliesTo?: (file: string) => boolean;
}

const RULES: Rule[] = [
  {
    // A hex literal in colour context. "#content"-style anchors are not colours: an href,
    // id, to or htmlFor attribute is never a colour position.
    name: "hex",
    patterns: [
      /(?::\s*["'`]?|\(\s*|\[|,\s*|_|\s["'`]|(?<!\b(?:href|id|to|htmlFor))=\s*["'`])#[0-9a-fA-F]{3,8}\b/,
    ],
  },
  {
    // color-mix( itself is fine; its operands are checked by the other rules.
    name: "colour-fn",
    patterns: [/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/],
  },
  {
    name: "palette-class",
    patterns: [
      new RegExp(`\\b(?:${UTILITY})-(?:${PALETTE})-\\d{2,3}\\b`),
      new RegExp(`\\b(?:${UTILITY})-(?:black|white)\\b`),
    ],
  },
  {
    name: "arbitrary",
    patterns: [/-\[#/, /-\[(?:rgba?|hsla?|oklch)\(/],
  },
  {
    // black/white as a CSS value or a color-mix/var() operand.
    name: "keyword",
    patterns: [/(?:[,(_]\s*|:\s*["'`]?)(?:black|white)\b/],
  },
  {
    name: "font-literal",
    patterns: [/font-family\s*:/, /fontFamily\s*:/, /\bfont-\[/],
  },
  {
    name: "accent-scope",
    patterns: [/site-accent/],
    appliesTo: (file) => !ACCENT_FILES.has(file),
  },
  {
    name: "p3-names",
    patterns: [/site-(?:ground|ink|on-primary|rule)\b/],
  },
];

interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/** Pure: every rule hit in one source text, one hit per (line, rule). */
function lintSource(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo(file)) continue;
      if (rule.patterns.some((p) => p.test(lineText))) {
        hits.push({
          file,
          line: i + 1,
          rule: rule.name,
          text: lineText.trim(),
        });
      }
    }
  });
  return hits;
}

const fmt = (h: Hit) => `${h.file}:${h.line} ${h.rule} ${h.text}`;

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (name === "node_modules") return [];
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

function scannedFiles(): string[] {
  return SCAN_ROOTS.flatMap(walk).filter(
    (f) => SCANNED.test(f) && !/\.test\./.test(f) && !/README\.md$/.test(f),
  );
}

interface AllowEntry {
  file: string;
  pattern: string;
  reason: string;
}

const allowlist = JSON.parse(
  readFileSync(join(root, "tests/theme-drift.allowlist.json"), "utf8"),
) as AllowEntry[];

const allowed = (h: Hit, list: AllowEntry[]) =>
  list.some((e) => e.file === h.file && h.text.includes(e.pattern));

function treeHits(): Hit[] {
  return scannedFiles().flatMap((f) =>
    lintSource(f, readFileSync(join(root, f), "utf8")),
  );
}

describe("theme drift lint: rule self-test", () => {
  const OTHER = "packages/ui/src/site/Banner.tsx";
  const flags = (src: string, file = OTHER) =>
    lintSource(file, src).map((h) => h.rule);

  it.each([
    ["color: #ff0000", "hex"],
    ['className="text-red-500"', "palette-class"],
    ['className="bg-[#123456]"', "arbitrary"],
    ["background: rgb(0 0 0)", "colour-fn"],
    ['style={{ fontFamily: "Inter" }}', "font-literal"],
    ["bg-[color-mix(in_oklch,var(--site-primary)_88%,black)]", "keyword"],
    ['className="text-site-accent"', "accent-scope"],
    ['className="bg-site-ground"', "p3-names"],
    ['className="border-white"', "palette-class"],
    ["font-[Georgia]", "font-literal"],
    ["fill: oklch(0.5 0.1 200)", "colour-fn"],
  ])("flags %s as %s", (src, rule) => {
    expect(flags(src)).toContain(rule);
  });

  it.each([
    'href="#content"',
    "color: var(--site-primary)",
    'className="bg-site-surface text-site-text"',
    "bg-[color-mix(in_oklch,var(--site-primary)_88%,var(--site-text))]",
    'id="#fade"',
    "bg-transparent",
  ])("does not flag %s", (src) => {
    expect(flags(src)).toEqual([]);
  });

  it("allows text-site-accent in HeroSection and CountdownView only", () => {
    const src = '<span className="text-site-accent" />';
    for (const f of ACCENT_FILES) expect(flags(src, f)).toEqual([]);
    expect(flags(src, "packages/templates/src/index.ts")).toEqual([
      "accent-scope",
    ]);
  });

  it("reports file and line for each hit", () => {
    const [hit] = lintSource(OTHER, "ok\nok\n  color: #abc;\n");
    expect(hit && fmt(hit)).toBe(`${OTHER}:3 hex color: #abc;`);
  });
});

describe("theme drift lint: the real tree", () => {
  it("walks missing scan roots without error", () => {
    expect(walk("packages/addons/does-not-exist")).toEqual([]);
  });

  it("scans site renderers, templates, add-ons and the tenant route (not tests)", () => {
    const files = scannedFiles();
    expect(files).toContain("packages/ui/src/site/HeroSection.tsx");
    expect(files).toContain("packages/ui/src/site/client/CountdownView.tsx");
    expect(files).toContain("packages/templates/src/index.ts");
    expect(files).toContain("apps/web/app/tenant/[host]/layout.tsx");
    expect(files.some((f) => /\.test\./.test(f))).toBe(false);
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("has no off-token colour or font outside the allowlist", () => {
    const bad = treeHits().filter((h) => !allowed(h, allowlist));
    expect(bad.map(fmt), bad.map(fmt).join("\n")).toEqual([]);
  });
});

describe("theme drift lint: allowlist hygiene", () => {
  it("every entry names a file, a pattern and a reason", () => {
    expect(Array.isArray(allowlist)).toBe(true);
    for (const e of allowlist) {
      expect(e.file, JSON.stringify(e)).toBeTruthy();
      expect(e.pattern, JSON.stringify(e)).toBeTruthy();
      expect(e.reason?.trim(), JSON.stringify(e)).toBeTruthy();
    }
  });

  it("every entry matches at least one real hit (no stale entries)", () => {
    const hits = treeHits();
    const stale = allowlist.filter((e) => !hits.some((h) => allowed(h, [e])));
    expect(stale, JSON.stringify(stale)).toEqual([]);
  });
});
