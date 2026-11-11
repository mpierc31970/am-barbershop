// P8 (08-11): the slot report as staff CLI text (UI-SPEC "Staff CLI output", D-UI-P8-27;
// TMPL-04; T-08-11-04). Pure: slot statuses and fixed notes only, never intake answers.
// Slot words come from the one source in @cds/core/templates (SLOT_LABELS, SOURCE_WORDS),
// shared with the build report email (assembly/alerts.ts) and the P13 console.
import {
  SOURCE_WORDS,
  slotLabel,
  type AssemblyReport,
  type PageOutcome,
} from "@cds/core/templates";

export const DRY_RUN_FIRST_LINE = "Dry run: nothing was written.";

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** The page label the report recorded, else the key capitalised. */
function pageLabel(report: AssemblyReport, key: string): string {
  const p = report.pages.find((x) => x.key === key);
  if (p) return p.label;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** One row per slot: page, slot label, result word, note ("" when none). */
export function reportRows(report: AssemblyReport): string[][] {
  return report.slots.map((s) => [
    pageLabel(report, s.page),
    slotLabel(s.slot),
    SOURCE_WORDS[s.source],
    s.note ?? "",
  ]);
}

/**
 * The To polish lines, in the build report email's words: each fallback slot as
 * "{Label} · Default used[ · {note}]", then `report.polish` verbatim.
 */
export function polishLines(report: AssemblyReport): string[] {
  const out = report.slots
    .filter((s) => s.source === "fallback")
    .map((s) =>
      [slotLabel(s.slot), SOURCE_WORDS.fallback, s.note]
        .filter(Boolean)
        .join(" · "),
    );
  return [...out, ...report.polish];
}

/** How many things staff should polish: fallback slots plus report-level items. */
export function polishCount(report: AssemblyReport): number {
  return polishLines(report).length;
}

/**
 * `To polish: N`, then the report-level items (the slot ones are already in the table):
 * `To polish: 3 · Theme: import the impeccable theme (D45)`.
 */
export function polishSummaryLine(report: AssemblyReport): string {
  return [`To polish: ${polishCount(report)}`, ...report.polish].join(" · ");
}

/** `Assembled X: 2 pages, 11 slots (7 filled, 2 default used, 2 left out).` */
export function summaryLine(name: string, report: AssemblyReport): string {
  const count = (src: string) =>
    report.slots.filter((s) => s.source === src).length;
  return (
    `Assembled ${name}: ${plural(report.pages.length, "page", "pages")}, ` +
    `${plural(report.slots.length, "slot", "slots")} ` +
    `(${count("provided")} filled, ${count("fallback")} default used, ` +
    `${count("omitted")} left out).`
  );
}

/** The dry-run last line: `Would assemble 2 pages.` */
export function wouldAssembleLine(report: AssemblyReport): string {
  return `Would assemble ${plural(report.pages.length, "page", "pages")}.`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `7 Oct` (UTC; fixed three-letter months), or "" for a missing or bad date. */
export function dayMonth(at: string | Date | undefined | null): string {
  if (!at) return "";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** `Already assembled on 7 Oct. Use --rerun to rebuild untouched pages.` */
export function alreadyAssembledLine(at: string | undefined): string {
  const day = dayMonth(at);
  return `Already assembled${day ? ` on ${day}` : ""}. Use --rerun to rebuild untouched pages.`;
}

const RERUN_WORDS: Readonly<Record<PageOutcome, string>> = {
  created: "created.",
  rebuilt: "unchanged, rebuilt.",
  unchanged: "unchanged, rebuilt.",
  held: "rebuilt, publish held for review.",
  edited: "edited since it was assembled, left alone.",
  deleted: "deleted, not recreated.",
  skipped_existing: "already there, left alone.",
};

const LEFT_ALONE = new Set<PageOutcome>([
  "edited",
  "deleted",
  "skipped_existing",
]);

/**
 * `--rerun` lines, one per page, labels padded to one column, then
 * `Re-run done: 1 page rebuilt, 1 left alone.`
 */
export function rerunLines(report: AssemblyReport): string[] {
  const width = Math.max(0, ...report.pages.map((p) => p.label.length)) + 2;
  const lines = report.pages.map(
    (p) => `${p.label.padEnd(width)}${RERUN_WORDS[p.outcome]}`,
  );
  const alone = report.pages.filter((p) => LEFT_ALONE.has(p.outcome)).length;
  const rebuilt = report.pages.length - alone;
  lines.push(
    `Re-run done: ${plural(rebuilt, "page", "pages")} rebuilt, ${alone} left alone.`,
  );
  return lines;
}
