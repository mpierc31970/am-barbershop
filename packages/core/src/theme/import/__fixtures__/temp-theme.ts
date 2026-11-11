// Test helpers for the theme importer: a temp root with a design/ folder, the committed
// DCR-shaped fixture copied into it, and a builder for small authored themes. Test-only.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

type Raw = Record<string, unknown>;

export const FIXTURE_DCR = join(dirname(fileURLToPath(import.meta.url)), "dcr");

/** A fresh temp root containing design/tenants/. */
export function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cds-theme-"));
  mkdirSync(join(root, "design", "tenants"), { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Copy the committed DCR-shaped fixture to design/tenants/dcr; returns the relative dir. */
export function copyDcr(root: string): string {
  cpSync(FIXTURE_DCR, join(root, "design", "tenants", "dcr"), {
    recursive: true,
  });
  return "design/tenants/dcr";
}

export const TIDEWATER_COLORS: Record<string, string> = {
  "sea-mist": "#F3F6F8",
  "harbor-fog": "#E1EAEF",
  "deep-water": "#0F1D26",
  "slate-tide": "#465A66",
  "signal-blue": "#1F3FCC",
  "white-cap": "#FFFFFF",
  "signal-coral": "#F06A4D",
  "rope-line": "#C3D1D9",
};

export const TIDEWATER_ROLES: Record<string, string> = {
  surface: "sea-mist",
  "surface-raised": "harbor-fog",
  text: "deep-water",
  "text-muted": "slate-tide",
  primary: "signal-blue",
  "primary-contrast": "white-cap",
  accent: "signal-coral",
  border: "rope-line",
};

export const OVERLAY = "0 16px 48px rgb(15 29 38 / 0.2)";

export type ThemeSpec = {
  frontMatter?: Raw;
  sidecar?: Raw | null;
  body?: string;
  eol?: "\n" | "\r\n";
};

export function baseFrontMatter(): Raw {
  return {
    name: "Tidewater",
    description: "Test theme.",
    colors: { ...TIDEWATER_COLORS },
    typography: {
      display: {
        fontFamily: "Archivo, system-ui, sans-serif",
        fontSize: "clamp(2.5rem, 4vw + 1rem, 3.5rem)",
      },
      heading: { fontFamily: "Archivo", fontSize: "36px" },
      subhead: { fontFamily: "Archivo", fontSize: "24px" },
      body: { fontFamily: "Public Sans", fontSize: "18px" },
    },
    rounded: { sm: "4px", md: "8px" },
    spacing: { sm: "8px", md: "16px" },
  };
}

export function baseSidecar(): Raw {
  return {
    schemaVersion: 2,
    extensions: {
      roles: { ...TIDEWATER_ROLES },
      shadows: [{ name: "overlay", value: OVERLAY }],
      motion: [{ name: "duration-quick", value: "160ms" }],
    },
  };
}

/** Write design/tenants/<slug>/DESIGN.md (+ .impeccable/design.json); returns the relative dir. */
export function writeTheme(
  root: string,
  slug: string,
  spec: ThemeSpec = {},
): string {
  const dir = join(root, "design", "tenants", slug);
  mkdirSync(join(dir, ".impeccable"), { recursive: true });
  const eol = spec.eol ?? "\n";
  const fm = stringify(spec.frontMatter ?? baseFrontMatter());
  const body = spec.body ?? "## Overview\n\nSea light and signal colours.\n";
  const md = `---\n${fm}---\n\n${body}`.replace(/\n/g, eol);
  writeFileSync(join(dir, "DESIGN.md"), md, "utf8");
  const sidecar = spec.sidecar === undefined ? baseSidecar() : spec.sidecar;
  if (sidecar !== null) {
    const json = `${JSON.stringify(sidecar, null, 2)}\n`.replace(/\n/g, eol);
    writeFileSync(join(dir, ".impeccable", "design.json"), json, "utf8");
  }
  return `design/tenants/${slug}`;
}
