// THEME-03 / THEME-05 (at import): importThemeDir turns an authored theme directory into a
// valid, contrast-solved OrganizationDesign plus a report (CONTEXT A1-Q3/Q4, A2-Q2, A3-Q3;
// RESEARCH Pitfalls 7, 8, open question 4; T-04-18, T-04-19, T-04-21).
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { NEUTRAL_DESIGN } from "../neutral";
import { validateOrganizationDesign } from "../validate";
import {
  OVERLAY,
  baseFrontMatter,
  baseSidecar,
  copyDcr,
  makeRoot,
  writeTheme,
} from "./__fixtures__/temp-theme";
import { FILE_MAX_BYTES, importThemeDir } from "./import";

type Raw = Record<string, unknown>;

let root = "";
let cleanup: () => void = () => {};

beforeEach(() => {
  ({ root, cleanup } = makeRoot());
});

afterEach(() => cleanup());

const NOW = () => new Date("2026-09-27T12:00:00.000Z");

function withTypography(patch: Raw): Raw {
  const fm = baseFrontMatter();
  return { ...fm, typography: { ...(fm.typography as Raw), ...patch } };
}

describe("importThemeDir on the DCR-shaped fixture", () => {
  it("returns a design that passes the validator", () => {
    const { design } = importThemeDir(copyDcr(root), { root, now: NOW });
    expect(() => validateOrganizationDesign(design)).not.toThrow();
    expect(design.schemaVersion).toBe(2);
    expect(design.name).toBe("Harbor Ivory");
    expect(design.importedAt).toBe("2026-09-27T12:00:00.000Z");
  });

  it("reduces font stacks to the first catalog family and converts rem to px", () => {
    const { design, report } = importThemeDir(copyDcr(root), { root });
    expect(design.typography).toEqual({
      headingFamily: "Source Serif 4",
      bodyFamily: "Public Sans",
      body: "18px",
      h3: "20.48px",
      h2: "clamp(2rem, 1.6rem + 1.8vw, 2.75rem)",
      display: "clamp(2.6rem, 1.9rem + 3.2vw, 4.6rem)",
    });
    expect(report.fonts).toEqual({
      heading: "Source Serif 4",
      body: "Public Sans",
    });
  });

  it("maps rounded.sm / rounded.md and resolves {colors.x} role names", () => {
    const { design, report } = importThemeDir(copyDcr(root), { root });
    expect(design.rounded).toEqual({ button: "2px", media: "6px" });
    expect(design.roles.primary).toBe("#17656a");
    const primary = report.roles.find((r) => r.role === "primary");
    expect(primary?.colorName).toBe("brand");
    expect(report.derivedRoles).toBeNull();
  });

  it("falls back to the neutral overlay shadow with a report note", () => {
    const { design, report } = importThemeDir(copyDcr(root), { root });
    expect(design.shadows.overlay).toBe(NEUTRAL_DESIGN.shadows.overlay);
    expect(report.notes).toContain(
      "No overlay shadow in design.json; using the neutral preset's overlay.",
    );
  });

  it("keeps the prose body, the sidecar and component HTML only inside source", () => {
    const { design } = importThemeDir(copyDcr(root), { root });
    expect(design.source.designMd.body.startsWith("## Overview")).toBe(true);
    const sidecar = design.source.sidecar as Raw;
    expect(Array.isArray(sidecar.components)).toBe(true);
    const rendered = JSON.stringify({ ...design, source: null });
    expect(rendered).not.toContain("<button");
    expect(design.spacing).toEqual({
      xs: "4px",
      sm: "8px",
      md: "16px",
      lg: "32px",
      xl: "64px",
    });
    expect(design.motion).toEqual({
      "ease-out-deep": "cubic-bezier(0.16, 1, 0.3, 1)",
      "duration-quick": "160ms",
    });
  });
});

describe("importThemeDir mapping rules", () => {
  it("accepts the impeccable headline/title vocabulary", () => {
    const fm = baseFrontMatter();
    const t = fm.typography as Raw;
    const dir = writeTheme(root, "vocab", {
      frontMatter: {
        ...fm,
        typography: {
          display: t.display,
          headline: { fontFamily: "Archivo", fontSize: "40px" },
          title: { fontFamily: "Archivo", fontSize: "22px" },
          body: t.body,
        },
      },
    });
    const { design } = importThemeDir(dir, { root });
    expect(design.typography.h2).toBe("40px");
    expect(design.typography.h3).toBe("22px");
  });

  it("uses the heading family when display has no fontFamily", () => {
    const dir = writeTheme(root, "nodisplayfont", {
      frontMatter: withTypography({
        display: { fontSize: "clamp(2.5rem, 4vw + 1rem, 3.5rem)" },
        heading: { fontFamily: "Figtree", fontSize: "36px" },
      }),
    });
    expect(importThemeDir(dir, { root }).design.typography.headingFamily).toBe(
      "Figtree",
    );
  });

  it("uses a sidecar overlay shadow when present, with no note", () => {
    const { design, report } = importThemeDir(writeTheme(root, "tide"), {
      root,
    });
    expect(design.shadows.overlay).toBe(OVERLAY);
    expect(report.notes).toEqual([]);
  });

  it("takes the button radius from components.button-primary.rounded without rounded.sm", () => {
    const dir = writeTheme(root, "btn", {
      frontMatter: {
        ...baseFrontMatter(),
        rounded: { md: "8px", pill: "999px" },
        components: { "button-primary": { rounded: "{rounded.pill}" } },
      },
    });
    expect(importThemeDir(dir, { root }).design.rounded.button).toBe("999px");
  });

  it("rounds rem radii to the grammar's one decimal instead of refusing them (WR-05)", () => {
    const dir = writeTheme(root, "rem-radii", {
      frontMatter: {
        ...baseFrontMatter(),
        rounded: { sm: "0.33rem", md: "0.21rem" },
      },
    });
    expect(importThemeDir(dir, { root }).design.rounded).toEqual({
      button: "5.3px",
      media: "3.4px",
    });
  });

  it("derives roles from colorMeta when extensions.roles is absent", () => {
    const sidecar = baseSidecar();
    const ext = sidecar.extensions as Raw;
    delete ext.roles;
    ext.colorMeta = {
      "sea-mist": { role: "neutral" },
      "harbor-fog": { role: "neutral" },
      "rope-line": { role: "neutral" },
      "slate-tide": { role: "neutral" },
      "deep-water": { role: "neutral" },
      "signal-blue": { role: "primary" },
      "signal-coral": { role: "accent" },
    };
    const { report } = importThemeDir(
      writeTheme(root, "derived", { sidecar }),
      {
        root,
      },
    );
    expect(report.derivedRoles?.surface).toBe("sea-mist");
    expect(report.derivedRoles?.border).toBe("rope-line");
  });
});

describe("importThemeDir failures", () => {
  it("rejects an unknown font with the nearest catalog family", () => {
    const dir = writeTheme(root, "font", {
      frontMatter: withTypography({
        display: {
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: "clamp(2.5rem, 4vw + 1rem, 3.5rem)",
        },
      }),
    });
    expect(() => importThemeDir(dir, { root })).toThrow(
      /^"Playfair Display" is not in the font catalog\. Nearest: [A-Za-z0-9 ]+\. Pick a catalog family or add one to the catalog \(a deploy\)\.$/,
    );
  });

  it("rejects a display face as the body font", () => {
    const dir = writeTheme(root, "dispbody", {
      frontMatter: withTypography({
        body: { fontFamily: "Fraunces", fontSize: "18px" },
      }),
    });
    expect(() => importThemeDir(dir, { root })).toThrow(
      "Fraunces is a display face and can't be the body font. Try Source Serif 4 or Newsreader.",
    );
  });

  it("names typography.display.fontSize when the display size is out of range", () => {
    const dir = writeTheme(root, "big", {
      frontMatter: withTypography({
        display: {
          fontFamily: "Archivo",
          fontSize: "clamp(2rem, 10vw, 9rem)",
        },
      }),
    });
    expect(() => importThemeDir(dir, { root })).toThrow(
      'typography.display.fontSize "clamp(2rem, 10vw, 9rem)" is outside the allowed range',
    );
  });

  it("reports an unresolved colour reference with the UI-SPEC copy", () => {
    const fm = baseFrontMatter();
    const dir = writeTheme(root, "ref", {
      frontMatter: {
        ...fm,
        colors: { ...(fm.colors as Raw), "signal-blue": "{colors.teal}" },
      },
    });
    expect(() => importThemeDir(dir, { root })).toThrow(
      "colors.signal-blue refers to {colors.teal}, which doesn't exist.",
    );
  });

  it("fails with the missing-role copy when there is no sidecar", () => {
    const dir = writeTheme(root, "nosidecar", { sidecar: null });
    expect(() => importThemeDir(dir, { root })).toThrow(
      "Missing role: surface.",
    );
  });

  it("rejects design.json that is not valid JSON", () => {
    const dir = writeTheme(root, "badjson");
    writeFileSync(join(root, dir, ".impeccable", "design.json"), "{ nope");
    expect(() => importThemeDir(dir, { root })).toThrow(InvalidInput);
  });

  it("rejects a directory with no DESIGN.md", () => {
    mkdirSync(join(root, "design", "tenants", "empty"));
    expect(() => importThemeDir("design/tenants/empty", { root })).toThrow(
      InvalidInput,
    );
  });
});

describe("importThemeDir path containment (T-04-18) and size cap (T-04-19)", () => {
  it.each(["../", "design", "design/../packages", "packages/core", ".."])(
    "rejects %s",
    (dir) => {
      expect(() => importThemeDir(dir, { root })).toThrow(InvalidInput);
    },
  );

  it("rejects an absolute path outside <root>/design", () => {
    expect(() => importThemeDir(tmpdir(), { root })).toThrow(InvalidInput);
  });

  it("accepts an absolute path inside <root>/design", () => {
    writeTheme(root, "abs");
    const abs = join(root, "design", "tenants", "abs");
    expect(importThemeDir(abs, { root }).design.name).toBe("Tidewater");
  });

  it("rejects a symlinked directory that escapes design/", (ctx) => {
    const outside = join(root, "outside");
    writeTheme(root, "real");
    mkdirSync(outside);
    const link = join(root, "design", "tenants", "evil");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      ctx.skip();
    }
    expect(() => importThemeDir("design/tenants/evil", { root })).toThrow(
      InvalidInput,
    );
  });

  it("rejects a file larger than FILE_MAX_BYTES before parsing", () => {
    const dir = writeTheme(root, "huge");
    writeFileSync(
      join(root, dir, "DESIGN.md"),
      `---\nname: x\n---\n${"a".repeat(FILE_MAX_BYTES)}`,
    );
    expect(() => importThemeDir(dir, { root })).toThrow(/larger than 256 KB/);
  });
});

describe("importThemeDir hashing and solving", () => {
  it("gives the same sourceHash for CRLF and LF files", () => {
    const lf = importThemeDir(writeTheme(root, "lf"), { root });
    const crlf = importThemeDir(writeTheme(root, "crlf", { eol: "\r\n" }), {
      root,
    });
    expect(lf.design.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(crlf.design.sourceHash).toBe(lf.design.sourceHash);
    expect(lf.report.hash8).toBe(lf.design.sourceHash.slice(0, 8));
  });

  it("changes the hash when the content changes", () => {
    const a = importThemeDir(writeTheme(root, "a"), { root });
    const b = importThemeDir(
      writeTheme(root, "b", { body: "## Overview\n\nDifferent.\n" }),
      { root },
    );
    expect(b.design.sourceHash).not.toBe(a.design.sourceHash);
  });

  it("solves a failing accent and reports the one adjustment everywhere", () => {
    const { design, report } = importThemeDir(writeTheme(root, "tide"), {
      root,
    });
    expect(design.contrast.adjustments).toHaveLength(1);
    expect(report.adjustments).toEqual(design.contrast.adjustments);
    expect(design.contrast.adjustments[0]?.role).toBe("accent");
    const accent = report.roles.find((r) => r.role === "accent");
    expect(accent?.adjusted).toBe(true);
    expect(accent?.authored).toBe("#f06a4d");
    expect(accent?.stored).toBe(design.roles.accent);
    expect(report.roles.filter((r) => r.adjusted)).toHaveLength(1);
    expect(design.contrast.pairs.every((p) => p.pass)).toBe(true);
  });

  it("reports the directory relative to the root with forward slashes", () => {
    const { report } = importThemeDir(writeTheme(root, "tide"), { root });
    expect(report.dir).toBe("design/tenants/tide");
    expect(report.name).toBe("Tidewater");
  });
});
