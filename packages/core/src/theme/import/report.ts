// The theme:import report (UI-SPEC "Import report contract"): plain text, column-aligned,
// fixed order, no colour codes, so it reads the same in a terminal and a CI log.
// formatReport prints everything up to and including the Fonts line; the CLI adds the
// Result line from the copy constants below. NODE-ONLY SUBPATH (see frontmatter.ts).
//
// Copy deviation (RESEARCH Pitfall 6, recorded in 04-07-SUMMARY): RESULT_SUCCESS promises
// the theme within the cache window instead of "on its next page load", because a CLI
// cannot call revalidateTag and the theme cache revalidates every 60 s.
import { contrastRatio } from "../contrast";
import type { Role } from "../roles";
import type { ThemeImportReport } from "./import";

export { MISSING_ROLE_COPY } from "../validate";

export const RESULT_SUCCESS =
  "Imported. The site shows the new theme within a minute.";
export const RESULT_DRY_RUN =
  "Dry run finished. Nothing was written. Run again without --dry-run to import.";
export const RESULT_ROLES_DERIVED =
  "Roles were derived from colorMeta. Add this map to extensions.roles in design.json so the next import is explicit:";
export const ORG_NOT_FOUND_COPY = (orgId: string): string =>
  `Org ${orgId} not found, or this account isn't CDS staff.`;
export const WRITE_FAILED_COPY =
  "Import didn't finish. The site still shows its previous theme. Try again.";
export const FALLBACK_SUFFIX =
  "fallback: no in-hue value passes; re-author this colour.";

export type ReportMeta = {
  orgId: string | null;
  slug: string;
  dryRun: boolean;
};

const HEADER_WIDTH = 51;
const ROLE_COL = 18;
const NAME_COL = 18;
const PAIR_COL = 30;
const RATIO_COL = 8;

function hex(v: string): string {
  return v.toUpperCase();
}

function ratio(n: number): string {
  return `${n.toFixed(2)}:1`;
}

export function formatReport(
  report: ThemeImportReport,
  meta: ReportMeta,
): string {
  const lines: string[] = [];
  const org = meta.orgId ?? "(none)";
  const title = `Theme "${report.name}" for org ${org} (${meta.slug})`;
  lines.push(
    meta.dryRun
      ? `${title.padEnd(HEADER_WIDTH)} [DRY RUN, nothing written]`
      : title,
  );
  lines.push(`Source  ${report.dir}  hash ${report.hash8}`);
  lines.push("");

  lines.push("Roles");
  const authored = new Map<Role, string>();
  for (const r of report.roles) {
    authored.set(r.role, r.authored);
    const head = `  ${r.role.padEnd(ROLE_COL)}${r.colorName.padEnd(NAME_COL)}${hex(r.authored)}`;
    lines.push(r.adjusted ? `${head} -> ${hex(r.stored)}   adjusted` : head);
  }
  lines.push("");

  lines.push("Contrast");
  for (const p of report.pairs) {
    const label = `  ${`${p.fg} on ${p.bg}`.padEnd(PAIR_COL)}${ratio(p.ratio).padStart(RATIO_COL)}`;
    if (p.min === null) {
      lines.push(`${label}  decorative, not checked`);
      continue;
    }
    let line = `${label}  needs ${p.min.toFixed(1)}  ${p.pass ? "pass" : "FAIL"}`;
    const fg = authored.get(p.fg);
    const bg = authored.get(p.bg);
    if (fg !== undefined && bg !== undefined) {
      const was = Math.round(contrastRatio(fg, bg) * 100) / 100;
      if (was.toFixed(2) !== p.ratio.toFixed(2)) {
        line += ` (was ${was.toFixed(2)})`;
      }
    }
    lines.push(line);
  }
  lines.push("");

  lines.push(`Adjustments (${report.adjustments.length})`);
  for (const a of report.adjustments) {
    const line = `  ${a.role}  ${hex(a.from)} -> ${hex(a.to)}  lightness ${a.fromL.toFixed(2)} -> ${a.toL.toFixed(2)}  reason: ${a.reason}`;
    lines.push(a.fallback ? `${line}  ${FALLBACK_SUFFIX}` : line);
  }
  lines.push("");

  if (report.notes.length > 0) {
    lines.push("Notes");
    for (const n of report.notes) lines.push(`  ${n}`);
    lines.push("");
  }

  lines.push(
    `Fonts   heading ${report.fonts.heading}  body ${report.fonts.body}  (catalog ok)`,
  );
  return `${lines.join("\n")}\n`;
}
