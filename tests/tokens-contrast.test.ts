// UI-SPEC "Color" and "Accessibility contract": every declared hub and site fallback text
// pair meets WCAG 2.2 AA. Parses the hex custom properties in apps/web/app/globals.css so a
// token change that breaks contrast fails here, not in a visual review. Uses the one shared
// contrast implementation and pair table from @cds/core/theme (CONTEXT A3-Q4, THEME-05).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, CONTRAST_PAIRS } from "@cds/core/theme";

const css = readFileSync(
  join(import.meta.dirname, "..", "apps/web/app/globals.css"),
  "utf8",
);
// 15-02 (HUB-05, D104): the marketing --mk-* tokens live in their own file on [data-mk].
const mkCss = readFileSync(
  join(import.meta.dirname, "..", "packages/ui/src/marketing/tokens.css"),
  "utf8",
);

const tokens = new Map<string, string>();
for (const m of `${css}
${mkCss}`.matchAll(
  /--((?:hub|site|mk)-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
)) {
  const [, name, hex] = m;
  if (name && hex && !tokens.has(name)) tokens.set(name, hex);
}

function hex(name: string): string {
  if (name === "white") return "#ffffff";
  const v = tokens.get(name);
  if (!v)
    throw new Error(`token --${name} not found in globals.css or tokens.css`);
  return v;
}

const HUB_TEXT_PAIRS: [string, string][] = [
  ["hub-ink", "hub-surface"],
  ["hub-ink-muted", "hub-surface"],
  ["hub-ink-muted", "hub-surface-2"],
  ["white", "hub-accent"],
  ["white", "hub-danger"],
  ["hub-success", "hub-success-tint"],
  ["hub-warning", "hub-warning-tint"],
];

/** The enforced pairs of the shared table, applied to the [data-site] fallbacks. */
const SITE_PAIRS = CONTRAST_PAIRS.flatMap((p) =>
  p.min === null ? [] : [{ fg: p.fg, bg: p.bg, min: p.min }],
);

/** UI-SPEC "--mk-* tokens" table: every text pair, fg on bg (>= 4.5:1). */
const MK_TEXT_PAIRS: [string, string][] = [
  ["mk-ink", "mk-card"],
  ["mk-ink", "mk-stock"],
  ["mk-ink-muted", "mk-card"],
  ["mk-ink-muted", "mk-stock"],
  ["white", "mk-ink"],
  ["mk-ink-soft", "mk-ink"],
  ["white", "mk-cobalt"],
  ["mk-cobalt-tint", "mk-cobalt"],
  ["mk-cobalt-deep", "mk-cobalt-tint"],
  ["white", "mk-berry"],
  ["mk-berry-tint", "mk-berry"],
  ["mk-berry-deep", "mk-berry-tint"],
  ["white", "mk-leaf"],
  ["mk-leaf", "mk-card"],
  ["mk-ink", "mk-leaf-tint"],
  ["mk-ink", "mk-tangerine"],
  ["mk-ink", "mk-tangerine-tint"],
  ["mk-ink", "mk-marigold"],
  ["white", "mk-violet"],
  ["mk-violet-tint", "mk-violet"],
  ["white", "mk-teal"],
  ["mk-ink", "mk-rose"],
  ["mk-ink", "mk-sky"],
  ["mk-danger", "mk-card"],
  ["mk-ink", "mk-danger-tint"],
  ["mk-danger", "mk-danger-tint"],
];

/** Non-text (1.4.11): input and checkbox borders on the light grounds (>= 3:1). */
const MK_NON_TEXT_PAIRS: [string, string][] = [
  ["mk-rule-strong", "mk-card"],
  ["mk-rule-strong", "mk-stock"],
];

/** UI-SPEC field-scope table, read from tokens.css: [data-mk-field="x"] { --mk-*: var(--mk-*) }. */
const MK_FIELDS = [
  "card",
  "stock",
  "cobalt",
  "berry",
  "violet",
  "leaf",
  "teal",
  "marigold",
  "rose",
  "sky",
  "tangerine",
  "ink",
] as const;

function fieldScope(field: string): Record<string, string> {
  const block = new RegExp(
    String.raw`\[data-mk-field="${field}"\]\s*\{([^}]*)\}`,
  ).exec(mkCss);
  if (!block?.[1]) throw new Error(`no [data-mk-field="${field}"] scope`);
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(
    /--(mk-[a-z-]+):\s*var\(--(mk-[a-z-]+)\)\s*;/g,
  )) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe("token contrast (WCAG AA)", () => {
  it("finds the full hub and site token set", () => {
    expect(tokens.size).toBeGreaterThanOrEqual(23);
  });

  it.each(HUB_TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("hub-border-strong on hub-surface is at least 3:1 (non-text)", () => {
    expect(
      contrastRatio(hex("hub-border-strong"), hex("hub-surface")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("checks every enforced site pair", () => {
    expect(SITE_PAIRS.length).toBeGreaterThanOrEqual(9);
  });

  for (const { fg, bg, min } of SITE_PAIRS) {
    it(`${fg} on ${bg}`, () => {
      expect(
        contrastRatio(hex(`site-${fg}`), hex(`site-${bg}`)),
      ).toBeGreaterThanOrEqual(min);
    });
  }

  it("finds the full --mk-* hex token set", () => {
    expect([...tokens.keys()].filter((k) => k.startsWith("mk-")).length).toBe(
      25,
    );
  });

  it.each(MK_TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MK_NON_TEXT_PAIRS)(
    "%s on %s is at least 3:1 (non-text)",
    (fg, bg) => {
      expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
    },
  );

  describe.each(MK_FIELDS)('[data-mk-field="%s"]', (field) => {
    const scope = fieldScope(field);
    const ground = (k: string) => {
      const ref = scope[k];
      if (!ref)
        throw new Error(`[data-mk-field="${field}"] does not set --${k}`);
      return hex(ref);
    };

    it("sets every scope variable", () => {
      for (const k of [
        "mk-field-bg",
        "mk-fg",
        "mk-muted",
        "mk-focus",
        "mk-action-bg",
        "mk-action-fg",
      ]) {
        expect(scope[k], k).toBeDefined();
      }
    });

    it("fg and muted on the field are at least 4.5:1", () => {
      expect(
        contrastRatio(ground("mk-fg"), ground("mk-field-bg")),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(ground("mk-muted"), ground("mk-field-bg")),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("the focus ring on the field is at least 3:1", () => {
      expect(
        contrastRatio(ground("mk-focus"), ground("mk-field-bg")),
      ).toBeGreaterThanOrEqual(3);
    });

    it("the primary button text is at least 4.5:1, the button at least 3:1 on the field", () => {
      expect(
        contrastRatio(ground("mk-action-fg"), ground("mk-action-bg")),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(ground("mk-action-bg"), ground("mk-field-bg")),
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("declares --mk-* tokens on [data-mk] only, never :root", () => {
    expect(mkCss).not.toMatch(/:root/);
    expect(mkCss).toMatch(/\[data-mk\]\s*\{/);
  });

  it("contrastRatio() matches known reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
