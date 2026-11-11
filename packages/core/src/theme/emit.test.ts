import { describe, expect, it } from "vitest";
import { designToCssVars, resolveTheme } from "./emit";
import { SANS_FALLBACK, fontStack } from "./fonts";
import { NEUTRAL_DESIGN, NEUTRAL_HASH } from "./neutral";
import { ROLES } from "./roles";
import type { PublicDesign } from "./types";

type Loose = Record<string, unknown>;

const TIDE_HASH = "3f9a1c2e" + "ab".repeat(28);

function tidewater(): Loose {
  return {
    schemaVersion: 2,
    name: "Tidewater",
    roles: {
      surface: "#f4f7f8",
      "surface-raised": "#e6eef1",
      text: "#0f1d26",
      "text-muted": "#44545e",
      primary: "#0f4c5c",
      "primary-contrast": "#ffffff",
      accent: "#b3452d",
      border: "#c5d3d9",
    },
    typography: {
      headingFamily: "Archivo",
      bodyFamily: "Public Sans",
      body: "18px",
      h3: "22px",
      h2: "36px",
      display: "clamp(2.5rem, 6vw + 0.5rem, 5rem)",
    },
    rounded: { button: "999px", media: "12px" },
    shadows: { overlay: "0 20px 56px rgb(15 29 38 / 0.22)" },
    sourceHash: TIDE_HASH,
    // Never read by the emitter.
    source: {
      designMd: { frontMatter: {}, body: "</style><script>x</script>" },
      sidecar: null,
    },
  };
}

const NEUTRAL_CSS = resolveTheme(NEUTRAL_DESIGN).css;

function braces(css: string): [number, number] {
  return [css.split("{").length - 1, css.split("}").length - 1];
}

describe("resolveTheme: neutral", () => {
  it("emits the neutral preset scoped to hash 00000000", () => {
    const t = resolveTheme(NEUTRAL_DESIGN);
    expect(t.hash).toBe(NEUTRAL_HASH);
    expect(t.css.startsWith('[data-site][data-theme="00000000"]{')).toBe(true);
    expect(t.css.endsWith("}")).toBe(true);
    expect(t.css).toContain("--site-surface:#fbfaf8;");
    expect(t.css).toContain("--site-backdrop:rgb(29 28 26 / 0.55);");
    expect(t.css).toContain("--site-focus:var(--site-text);");
  });

  it.each([null, undefined, "x", 42, [], {}])(
    "falls back to neutral for %j",
    (raw) => {
      const t = resolveTheme(raw);
      expect(t.hash).toBe(NEUTRAL_HASH);
      expect(t.css).toBe(NEUTRAL_CSS);
    },
  );
});

describe("resolveTheme: a real theme", () => {
  it("scopes to the first 8 of sourceHash and emits every role", () => {
    const d = tidewater();
    const t = resolveTheme(d);
    expect(t.hash).toBe("3f9a1c2e");
    expect(t.css.startsWith('[data-site][data-theme="3f9a1c2e"]{')).toBe(true);
    const roles = d.roles as Record<string, string>;
    for (const r of ROLES) expect(t.css).toContain(`--site-${r}:${roles[r]};`);
    expect(t.css).toContain("--site-radius-button:999px;");
    expect(t.css).toContain("--site-radius-media:12px;");
    expect(t.css).toContain("--site-backdrop:rgb(15 29 38 / 0.55);");
    expect(t.css).toContain(
      "--site-shadow-overlay:0 20px 56px rgb(15 29 38 / 0.22);",
    );
    expect(t.css).toContain(
      "--site-text-display:clamp(2.5rem, 6vw + 0.5rem, 5rem);",
    );
  });

  it("emits the declarations in the fixed order", () => {
    const css = designToCssVars(tidewater() as unknown as PublicDesign);
    const names = [...css.matchAll(/(--site-[a-z0-9-]+):/g)].map((m) => m[1]);
    expect(names).toEqual([
      ...ROLES.map((r) => `--site-${r}`),
      "--site-backdrop",
      "--site-focus",
      "--site-font-heading",
      "--site-font-body",
      "--site-text-body",
      "--site-text-h3",
      "--site-text-h2",
      "--site-text-display",
      "--site-radius-button",
      "--site-radius-media",
      "--site-shadow-overlay",
    ]);
  });

  it("resolves catalog fonts to their stacks", () => {
    const css = resolveTheme(tidewater()).css;
    expect(css).toContain(
      `--site-font-heading:"Archivo Variable", ${SANS_FALLBACK};`,
    );
    expect(css).toContain(`--site-font-body:${fontStack("Public Sans")};`);
  });

  it("falls back to the neutral stack for unknown or role-forbidden fonts", () => {
    const d = tidewater();
    (d.typography as Loose).headingFamily = "Comic Sans";
    (d.typography as Loose).bodyFamily = "Fraunces"; // display face: heading only
    const css = resolveTheme(d).css;
    expect(css).toContain(`--site-font-heading:${SANS_FALLBACK};`);
    expect(css).toContain(`--site-font-body:${SANS_FALLBACK};`);
  });
});

describe("per-token fallback", () => {
  const neutralRoleDecls = ROLES.map(
    (r) => `--site-${r}:${NEUTRAL_DESIGN.roles[r]};`,
  );

  it("keeps a valid, AA tenant role set as authored", () => {
    const css = resolveTheme(tidewater()).css;
    expect(css).toContain("--site-surface:#f4f7f8;");
    expect(css).toContain("--site-text:#0f1d26;");
    expect(css).toContain("--site-primary:#0f4c5c;");
  });

  it("one bad role falls back all eight roles together (never a mix, WR-02)", () => {
    const d = tidewater();
    (d.roles as Loose).primary = "red;}body{display:none";
    const css = resolveTheme(d).css;
    for (const decl of neutralRoleDecls) expect(css).toContain(decl);
    expect(css).not.toContain("#f4f7f8");
    expect(css).not.toContain("#b3452d");
    // Non-role tokens keep their own per-token check.
    expect(css).toContain("--site-radius-button:999px;");
  });

  it("a dark theme with an uppercase surface never renders light text on the neutral surface", () => {
    const d = tidewater();
    d.roles = {
      surface: "#1A1A1A",
      "surface-raised": "#262626",
      text: "#f0f0f0",
      "text-muted": "#b8b8b8",
      primary: "#7cc4d6",
      "primary-contrast": "#101010",
      accent: "#f0a070",
      border: "#3a3a3a",
    };
    const css = resolveTheme(d).css;
    for (const decl of neutralRoleDecls) expect(css).toContain(decl);
    expect(css).not.toContain("--site-text:#f0f0f0;");
  });

  it("valid hex roles that fail an enforced contrast pair fall back to the neutral roles", () => {
    const d = tidewater();
    (d.roles as Loose).text = "#eef2f3";
    const css = resolveTheme(d).css;
    for (const decl of neutralRoleDecls) expect(css).toContain(decl);
    expect(css).toContain("--site-backdrop:rgb(29 28 26 / 0.55);");
  });

  it("derives the backdrop from the neutral text when text is bad", () => {
    const d = tidewater();
    (d.roles as Loose).text = "#FFF";
    const css = resolveTheme(d).css;
    expect(css).toContain("--site-text:#1d1c1a;");
    expect(css).toContain("--site-backdrop:rgb(29 28 26 / 0.55);");
  });

  it("falls back out-of-range sizes, radii and shadows", () => {
    const d = tidewater();
    (d.typography as Loose).body = "40px";
    (d.rounded as Loose).media = "999px";
    (d.shadows as Loose).overlay = "inset 0 0 0 red";
    const css = resolveTheme(d).css;
    expect(css).toContain("--site-text-body:18px;");
    expect(css).toContain("--site-radius-media:4px;");
    expect(css).toContain(
      "--site-shadow-overlay:0 16px 48px rgb(0 0 0 / 0.18);",
    );
    expect(css).toContain("--site-radius-button:999px;");
  });
});

describe("injection matrix", () => {
  const PAYLOADS = [
    "}",
    ";x:y",
    "</style><script>alert(1)</script>",
    "url(javascript:alert(1))",
    '@import "x"',
    "expression(1)",
    "18px;}body{background:url(x)",
    '"Archivo Variable"; } @import url(x); {',
  ];
  const FIELDS: [string, string][] = [
    ["roles", "surface"],
    ["roles", "text"],
    ["typography", "body"],
    ["typography", "display"],
    ["typography", "headingFamily"],
    ["typography", "bodyFamily"],
    ["rounded", "button"],
    ["shadows", "overlay"],
  ];

  it.each(PAYLOADS)("never lets %j reach the CSS", (payload) => {
    for (const [group, key] of FIELDS) {
      const d = tidewater();
      (d[group] as Loose)[key] = payload;
      const css = resolveTheme(d).css;
      expect(css).not.toMatch(/[<>]/);
      expect(css).not.toContain("@import");
      expect(css).not.toContain("url(");
      expect(css).not.toContain("expression");
      expect(braces(css)).toEqual([1, 1]);
    }
  });

  it.each(["ZZZ", "../../", "3f9a1c2e", "3F9A1C2E" + "AB".repeat(28), 7, null])(
    "uses the neutral hash for sourceHash %j",
    (h) => {
      const d = tidewater();
      d.sourceHash = h;
      const t = resolveTheme(d);
      expect(t.hash).toBe(NEUTRAL_HASH);
      expect(t.css.startsWith('[data-site][data-theme="00000000"]{')).toBe(
        true,
      );
    },
  );
});

describe("scope limits", () => {
  it("emits no weights, line heights or spacing (D-UI-P4-3/4)", () => {
    const d = tidewater();
    (d as Loose).spacing = { md: "16px" };
    (d.typography as Loose).weight = "900";
    for (const css of [resolveTheme(d).css, NEUTRAL_CSS]) {
      expect(css).not.toContain("font-weight");
      expect(css).not.toContain("line-height");
      expect(css).not.toContain("--site-space");
    }
  });

  it("is deterministic for equal inputs", () => {
    expect(resolveTheme(tidewater())).toEqual(resolveTheme(tidewater()));
    expect(designToCssVars(NEUTRAL_DESIGN)).toBe(
      designToCssVars(NEUTRAL_DESIGN),
    );
  });

  it("does not throw on nested garbage", () => {
    const d = {
      roles: "x",
      typography: [],
      rounded: null,
      shadows: 5,
      sourceHash: {},
    };
    expect(resolveTheme(d).css).toBe(NEUTRAL_CSS);
  });
});
