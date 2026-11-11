// UI-SPEC "Import report contract": plain text, column-aligned, fixed order, no colour codes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRoot, writeTheme } from "./__fixtures__/temp-theme";
import { importThemeDir } from "./import";
import type { ThemeImportReport } from "./import";
import {
  ORG_NOT_FOUND_COPY,
  RESULT_DRY_RUN,
  RESULT_ROLES_DERIVED,
  RESULT_SUCCESS,
  WRITE_FAILED_COPY,
  formatReport,
} from "./report";

let root = "";
let cleanup: () => void = () => {};
let report: ThemeImportReport;

beforeEach(() => {
  ({ root, cleanup } = makeRoot());
  report = importThemeDir(writeTheme(root, "demo-b"), { root }).report;
});

afterEach(() => cleanup());

const META = { orgId: "abc123def456ghi", slug: "demo-b", dryRun: true };

describe("formatReport", () => {
  it("prints every section in the UI-SPEC order", () => {
    const out = formatReport(report, META);
    const order = [
      'Theme "Tidewater" for org abc123def456ghi (demo-b)',
      "[DRY RUN, nothing written]",
      `Source  design/tenants/demo-b  hash ${report.hash8}`,
      "\nRoles\n",
      "\nContrast\n",
      "\nAdjustments (1)\n",
      "Fonts   heading Archivo  body Public Sans  (catalog ok)",
    ];
    let at = -1;
    for (const needle of order) {
      const i = out.indexOf(needle);
      expect(i, needle).toBeGreaterThan(at);
      at = i;
    }
    expect(out.trimEnd().endsWith("(catalog ok)")).toBe(true);
    expect(out).not.toContain("Result");
  });

  it("omits the dry-run tag on a real import", () => {
    const out = formatReport(report, { ...META, dryRun: false });
    expect(out).not.toContain("DRY RUN");
  });

  it("prints role rows with the adjusted arrow", () => {
    const out = formatReport(report, META);
    expect(out).toMatch(/^ {2}surface {11}sea-mist {10}#F3F6F8$/m);
    expect(out).toMatch(
      /^ {2}accent +signal-coral +#F06A4D -> #[0-9A-F]{6} +adjusted$/m,
    );
  });

  it("prints contrast lines with 2-decimal ratios, minimums and the was-ratio", () => {
    const out = formatReport(report, META);
    expect(out).toMatch(
      /^ {2}text on surface +\d+\.\d\d:1 {2}needs 4\.5 {2}pass$/m,
    );
    expect(out).toMatch(
      /^ {2}accent on surface-raised +\d\.\d\d:1 {2}needs 3\.0 {2}pass \(was 2\.50\)$/m,
    );
    expect(out).toMatch(
      /^ {2}border on surface +\d\.\d\d:1 {2}decorative, not checked$/m,
    );
  });

  it("prints the adjustment with lightness and reason", () => {
    const out = formatReport(report, META);
    expect(out).toMatch(
      /^ {2}accent {2}#F06A4D -> #[0-9A-F]{6} {2}lightness 0\.\d\d -> 0\.\d\d {2}reason: accent on surface-raised 2\.50 < 3\.00$/m,
    );
  });

  it("marks a fallback adjustment", () => {
    const withFallback: ThemeImportReport = {
      ...report,
      adjustments: report.adjustments.map((a) => ({ ...a, fallback: true })),
    };
    const out = formatReport(withFallback, META);
    expect(out).toMatch(
      /reason: .+ {2}fallback: no in-hue value passes; re-author this colour\.$/m,
    );
  });

  it("prints notes and has no ANSI escape codes", () => {
    const out = formatReport(
      {
        ...report,
        notes: [
          "No overlay shadow in design.json; using the neutral preset's overlay.",
        ],
      },
      { ...META, orgId: null },
    );
    expect(out).toContain(
      "No overlay shadow in design.json; using the neutral preset's overlay.",
    );
    expect(out).not.toMatch(/\u001b/);
  });
});

describe("result copy", () => {
  it("matches the UI-SPEC with the within-a-minute deviation", () => {
    expect(RESULT_SUCCESS).toBe(
      "Imported. The site shows the new theme within a minute.",
    );
    expect(RESULT_DRY_RUN).toBe(
      "Dry run finished. Nothing was written. Run again without --dry-run to import.",
    );
    expect(RESULT_ROLES_DERIVED).toBe(
      "Roles were derived from colorMeta. Add this map to extensions.roles in design.json so the next import is explicit:",
    );
    expect(ORG_NOT_FOUND_COPY("x1")).toBe(
      "Org x1 not found, or this account isn't CDS staff.",
    );
    expect(WRITE_FAILED_COPY).toBe(
      "Import didn't finish. The site still shows its previous theme. Try again.",
    );
  });
});
