// Team and Services spreadsheet import / export (ONB-13, D37, D120, D125, D126; invariant 1,
// TEN-03; T-06-55). The P5 engine (@cds/core/csv) exactly as addons/import.ts uses it:
//   - the text is capped (MAX_IMPORT_CHARS and MAX_IMPORT_BYTES) and parsed server-side on
//     BOTH preview and commit; the browser's size check is only a courtesy
//   - commit re-plans from the raw text (never a client plan) and refuses while any row has
//     an error; the record validator (validateTeamMember / validateService) runs on every new
//     and updated row in the plan, so preview and commit agree ("Add a price" shows as a row
//     error, not a failed commit)
//   - Replace all deletes only the removals the owner confirmed on the preview (D126)
//   - one PB batch of creates, updates and deletes plus one audit row "<kind>.import"
// Formula injection: the engine strips its own guard on read and guards every cell on export.
// 13-52 (STAFF-25, D270): every new and updated row runs the publish scan (list-screen.ts)
// inside the lock; a held row is written hidden and flagged, like a single save.
// "add" is the UI word for the engine's "update" mode (new rows added, matches updated).
import { InvalidInput } from "@cds/core";
import {
  exportCsv,
  fileError,
  formatCount,
  MAX_IMPORT_BYTES,
  parseCsv,
  planImport,
  templateCsv,
  toImportPreview,
  validateRows,
  type CsvSpec,
  type ImportMode,
  type ImportPlan,
  type ImportPreview,
  type PlannedRow,
  type ValidatedRow,
} from "@cds/core/csv";
import {
  SERVICES_CSV,
  TEAM_CSV,
  validateService,
  validateTeamMember,
} from "@cds/core/intake";
import type { RecordModel } from "pocketbase";
import {
  MAX_ADDON_BATCH,
  sendAudited,
  TOO_MANY_CHANGES_COPY,
} from "../addons/backups";
import {
  MAX_IMPORT_CHARS,
  REMOVALS_CHANGED_COPY,
  removalsConfirmed,
} from "../addons/import";
import type { OrgContext } from "../context";
import { newRecordId } from "../repository";
import { refreshSiteIndex } from "../content/site-index/build";
import type { ScanOutcome } from "../content/screen";
import {
  afterListImport,
  screenListRow,
  type ListScanDeps,
} from "./list-screen";
import { storedService } from "./services";
import { nextSortOrder, orgList, runRead, runWrite, type Op } from "./shared";

export type CoreListKind = "team_members" | "services";
export type CoreImportMode = "add" | "update" | "replace";

type Target = {
  csv: CsvSpec;
  /** The stored row as record-validator input. */
  stored(r: RecordModel): Record<string, unknown>;
  validate(raw: unknown): Record<string, unknown>;
};

const TARGETS: Readonly<Record<CoreListKind, Target>> = {
  team_members: {
    csv: TEAM_CSV,
    stored: (r) => ({
      name: typeof r.name === "string" ? r.name : "",
      role: typeof r.role === "string" ? r.role : "",
      bio: typeof r.bio === "string" ? r.bio : "",
      is_published: r.is_published === true,
    }),
    validate: (raw) => validateTeamMember(raw),
  },
  services: {
    csv: SERVICES_CSV,
    stored: storedService,
    validate: (raw) => validateService(raw),
  },
};

function targetOf(kind: unknown): Target {
  if (kind !== "team_members" && kind !== "services") {
    throw new InvalidInput("That list has no spreadsheet import.");
  }
  return TARGETS[kind];
}

function modeOf(mode: unknown): ImportMode {
  if (mode === "add" || mode === "update") return "update";
  if (mode === "replace") return "replace";
  throw new InvalidInput("Choose Add and update or Replace all.");
}

function checkText(text: unknown): string {
  if (typeof text !== "string") {
    throw new InvalidInput(fileError("not_csv").message);
  }
  if (
    text.length > MAX_IMPORT_CHARS ||
    new TextEncoder().encode(text).length > MAX_IMPORT_BYTES
  ) {
    throw new InvalidInput(fileError("too_big").message);
  }
  return text;
}

function parseText(
  text: string,
  csv: CsvSpec,
): { rows: ValidatedRow[]; ignored: string[] } {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new InvalidInput(parsed.error.message);
  const validated = validateRows(parsed, csv);
  if (!validated.ok) throw new InvalidInput(validated.error.message);
  return { rows: validated.rows, ignored: validated.ignored };
}

/** A stored row's values as the CSV reads them back (format -> parse): like with like. */
function csvValues(r: RecordModel, t: Target): Record<string, unknown> {
  const stored = t.stored(r);
  const values: Record<string, unknown> = {};
  for (const col of t.csv.columns) {
    const back = col.parse(col.format(stored[col.key]));
    values[col.key] = back.ok ? back.value : stored[col.key];
  }
  return values;
}

/** The record-validator input for a planned new / updated row. */
function rowInput(
  row: PlannedRow,
  byId: ReadonlyMap<string, RecordModel>,
  t: Target,
): Record<string, unknown> {
  if (row.status === "new") return { ...row.values };
  const current = row.id === null ? undefined : byId.get(row.id);
  if (!current) throw new InvalidInput(REMOVALS_CHANGED_COPY);
  return { ...t.stored(current), ...row.values };
}

/** Run the record validator on every new / updated row; failures become row errors. */
function plan(
  rows: ValidatedRow[],
  records: readonly RecordModel[],
  t: Target,
  mode: ImportMode,
): ImportPlan {
  const base = planImport({
    rows,
    existing: records.map((r) => ({ id: r.id, values: csvValues(r, t) })),
    spec: t.csv,
    mode,
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const counts = { ...base.counts };
  const planned = base.rows.map((row): PlannedRow => {
    if (row.status !== "new" && row.status !== "updated") return row;
    try {
      t.validate(rowInput(row, byId, t));
      return row;
    } catch (err) {
      if (!(err instanceof InvalidInput)) throw err;
      if (row.status === "new") counts.new--;
      else counts.updated--;
      counts.errors++;
      return {
        ...row,
        status: "error",
        messages: [`Row ${row.rowNumber}: ${err.message}`],
      };
    }
  });
  return {
    ...base,
    counts,
    rows: planned,
    creates: planned.filter((r) => r.status === "new").map((r) => r.values),
    updates: planned
      .filter((r) => r.status === "updated" && r.id !== null)
      .map((r) => ({ id: r.id!, values: r.values })),
  };
}

function titleOf(values: Record<string, unknown>): string {
  return typeof values.name === "string" ? values.name : "";
}

function rowCopy(n: number): string {
  return n === 1
    ? "1 row needs fixing. Nothing is imported until every row is fixed."
    : `${formatCount(n)} rows need fixing. Nothing is imported until every row is fixed.`;
}

/** Validate + dedupe + diff the file against the org's list (business write). */
export async function previewCoreImport(
  ctx: OrgContext,
  kind: CoreListKind,
  csvText: string,
  mode: CoreImportMode,
): Promise<ImportPreview> {
  const t = targetOf(kind);
  const importMode = modeOf(mode);
  const { rows, ignored } = parseText(checkText(csvText), t.csv);
  // Preview is part of an import, so it needs write (as addons/import.ts).
  return runWrite(ctx, async (pb) => {
    const records = await orgList(pb, ctx, kind);
    return toImportPreview(
      plan(rows, records, t, importMode),
      t.csv,
      titleOf,
      ignored,
    );
  });
}

/**
 * Commit an import (business write, under the org lock). Re-plans from the raw text; refuses
 * on any row error. Replace all deletes only when `confirmedRemovals` (the preview's removal
 * ids) equals the re-planned removals, else nothing is written (D126).
 */
export async function commitCoreImport(
  ctx: OrgContext,
  kind: CoreListKind,
  csvText: string,
  mode: CoreImportMode,
  confirmedRemovals?: readonly string[],
  deps: ListScanDeps = {},
): Promise<{ added: number; updated: number; removed: number }> {
  const t = targetOf(kind);
  const importMode = modeOf(mode);
  const { rows } = parseText(checkText(csvText), t.csv);
  const screened: { id: string; outcome: ScanOutcome }[] = [];
  const result = await runWrite(ctx, async (pb) => {
    const records = await orgList(pb, ctx, kind);
    const p = plan(rows, records, t, importMode);
    if (p.counts.errors > 0) throw new InvalidInput(rowCopy(p.counts.errors));
    if (
      importMode === "replace" &&
      !removalsConfirmed(
        p.removals.map((r) => r.id),
        confirmedRemovals,
      )
    ) {
      throw new InvalidInput(REMOVALS_CHANGED_COPY);
    }
    if (
      p.counts.new + p.counts.updated + p.removals.length + 1 >
      MAX_ADDON_BATCH
    ) {
      throw new InvalidInput(TOO_MANY_CHANGES_COPY);
    }
    const byId = new Map(records.map((r) => [r.id, r]));
    let sort = nextSortOrder(records);
    const ops: Op[] = [];
    const pending: { id: string; outcome: ScanOutcome }[] = [];
    for (const row of p.rows) {
      if (row.status === "new") {
        const id = newRecordId();
        const { body, outcome } = await screenListRow(
          ctx,
          deps,
          kind,
          t.validate(rowInput(row, byId, t)),
        );
        pending.push({ id, outcome });
        ops.push({
          collection: kind,
          op: "create",
          id,
          body: { ...body, organization: ctx.orgId, sort_order: sort++ },
        });
      } else if (row.status === "updated" && row.id !== null) {
        const { body, outcome } = await screenListRow(
          ctx,
          deps,
          kind,
          t.validate(rowInput(row, byId, t)),
        );
        pending.push({ id: row.id, outcome });
        ops.push({ collection: kind, op: "update", id: row.id, body });
      }
    }
    for (const r of p.removals) {
      ops.push({ collection: kind, op: "delete", id: r.id });
    }
    const counts = {
      added: p.counts.new,
      updated: p.counts.updated,
      removed: p.removals.length,
    };
    if (ops.length === 0) return counts;
    await sendAudited(pb, ctx, ops, {
      action: `${kind}.import`,
      targetCollection: kind,
      targetId: "",
      meta: { mode: importMode, ...counts },
    });
    screened.push(...pending);
    return counts;
  });
  if (screened.length > 0) {
    // 13-52: flags for held / unsure / outage rows, then one index rebuild + invalidate + ping.
    await afterListImport(ctx, deps, kind, screened);
  } else if (kind === "services" && result.removed > 0) {
    // 07-31: rebuild index.json after a committed services import.
    await refreshSiteIndex(ctx.orgId);
  }
  return result;
}

/** The org's list as CSV: a leading id column, then the spec's columns (business read). */
export async function exportCoreCsv(
  ctx: OrgContext,
  kind: CoreListKind,
): Promise<string> {
  const t = targetOf(kind);
  return runRead(ctx, async (pb) => {
    const records = await orgList(pb, ctx, kind);
    return exportCsv(
      t.csv,
      records.map((r) => ({ ...t.stored(r), id: r.id })),
    );
  });
}

/** The downloadable template: header row plus one example row. No org data. */
export function coreCsvTemplate(kind: CoreListKind): string {
  return templateCsv(targetOf(kind).csv);
}
