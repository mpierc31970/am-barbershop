// 15-02 choice 3: the marketing font files referenced by fonts.ts (next/font/local) and the
// OG font (P15-P24) exist in the pinned packages, and fonts.ts declares the wdth range.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FONTS_TS = join(ROOT, "apps/web/app/(platform)/(marketing)/fonts.ts");
const source = readFileSync(FONTS_TS, "utf8");

const srcPaths = [...source.matchAll(/src:\s*"([^"]+)"/g)].map((m) => m[1]!);

describe("marketing fonts", () => {
  it("declares exactly two local fonts", () => {
    expect(source.match(/localFont\(/g)?.length).toBe(2);
    expect(srcPaths).toHaveLength(2);
  });

  it.each([
    "@fontsource-variable/anybody/files/anybody-latin-standard-normal.woff2",
    "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  ])("fonts.ts points at an existing %s", (file) => {
    const ref = srcPaths.find((p) => p.endsWith(file));
    expect(ref, `fonts.ts references ${file}`).toBeDefined();
    const abs = resolve(dirname(FONTS_TS), ref!);
    expect(abs).toBe(join(ROOT, "node_modules", file));
    expect(existsSync(abs)).toBe(true);
  });

  it("the static Anybody 700 .woff for OG images exists (P15-P24)", () => {
    expect(
      existsSync(
        join(
          ROOT,
          "node_modules/@fontsource/anybody/files/anybody-latin-700-normal.woff",
        ),
      ),
    ).toBe(true);
  });

  it("declares the font-stretch range so CSS can reach the wdth axis", () => {
    expect(source).toContain("font-stretch");
    expect(source).toContain("50% 150%");
  });

  it("uses the marketing font variables", () => {
    expect(source).toContain('"--font-mk-display"');
    expect(source).toContain('"--font-mk-body"');
  });
});
