// Shared CSV import / export for list add-ons, chokepoint side (ADDON-12, ADDON-13, ADDON-14;
// D120, D125, D126, D270; CONTEXT A5-Q4; RESEARCH Pattern 8; T-05-36, T-05-37, T-05-38,
// T-05-43). Written once here so every list add-on gets it through its manifest `csv` spec.
//
//   - the text is capped (2,000,000 chars and MAX_IMPORT_BYTES) and parsed server-side on
//     BOTH preview and commit; the browser's size check is only a courtesy
//   - commit re-plans from the raw text (never a client plan) and refuses while any row has
//     an error
//   - every create/update goes through the add-on's own record validator (the single source
//     of field rules) and the content scan: a held row lands hidden with a flag (D270)
//   - the before-import backup is written FIRST, then one PB batch of creates, updates and
//     (Replace all) deletes plus the audit row: all or nothing
import { InvalidInput, NotFound } from "@cds/core";
import type { AddonManifest, AddonRecordSpec } from "@cds/core/addons";
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
  type ExistingRecord,
  type ImportMode,
  type ImportPlan,
  type ImportPreview,
  type PlannedRow,
  type ValidatedRow,
} from "@cds/core/csv";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../context";
import { recordContentFlag } from "../content/flags";
import { withOrgLock } from "../content/lock";
import { addonTag, liveTag } from "../content/ports";
import { pingAndRecord } from "../content/indexing-record";
import type { ScanOutcome } from "../content/screen";
import { siteUrls, type Op } from "../content/shared";
import { getCollectionSpec } from "../registry";
import { newRecordId } from "../repository";
import { withSuperuser } from "../client";
import {
  addonLockKey,
  checkAddonAccess,
  manifestOf,
  MAX_ADDON_BATCH,
  nowOf,
  orgRows,
  pbRun,
  pruneAddonBackups,
  sendAudited,
  storeOf,
  TOO_MANY_CHANGES_COPY,
  writeAddonBackup,
} from "./backups";
import { assertAddonActive } from "./entitlements";
import { prepareRecord } from "./records";
import type { AddonDeps } from "./types";

/** Hard cap on the raw text, before any parsing (T-05-37). */
export const MAX_IMPORT_CHARS = 2_000_000;

/** Replace all: the records to remove differ from the list the owner confirmed (D126). */
export const REMOVALS_CHANGED_COPY =
  "Your list changed since you checked the file. Check it again before you replace all.";

/**
 * True when the re-planned removals are exactly the set the owner confirmed (A-WR-03, D126).
 * No confirmation is needed only when nothing would be removed.
 */
export function removalsConfirmed(
  planned: readonly string[],
  confirmed: readonly string[] | undefined,
): boolean {
  if (confirmed === undefined) return planned.length === 0;
  if (!Array.isArray(confirmed)) return false;
  const want = new Set(confirmed);
  if (want.size !== confirmed.length || want.size !== planned.length) {
    return false;
  }
  return planned.every((id) => want.has(id));
}

const SYSTEM_KEYS: ReadonlySet<string> = new Set([
  "id",
  "organization",
  "created",
  "updated",
  "collectionId",
  "collectionName",
  "expand",
]);

type CsvTarget = {
  manifest: AddonManifest;
  csv: CsvSpec;
  spec: AddonRecordSpec;
  collection: string;
};

function csvTarget(
  deps: AddonDeps,
  slug: string,
  collection: unknown,
): CsvTarget {
  const manifest = manifestOf(deps, slug);
  if (
    typeof collection !== "string" ||
    !Object.hasOwn(manifest.collections, collection) ||
    !manifest.csv ||
    !Object.hasOwn(manifest.csv, collection) ||
    !Object.hasOwn(manifest.records, collection)
  ) {
    throw new InvalidInput(
      `${manifest.name} has no spreadsheet import for that list.`,
    );
  }
  return {
    manifest,
    csv: manifest.csv[collection]!,
    spec: manifest.records[collection]!,
    collection,
  };
}

function checkText(text: unknown): string {
  if (typeof text !== "string")
    throw new InvalidInput(fileError("not_csv").message);
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

/**
 * A stored record's values as the CSV would read them back (format -> parse), so planning
 * compares like with like: PB's blank-rating 0 reads as "no rating", export -> re-import is
 * "unchanged".
 */
function csvValues(
  record: Record<string, unknown>,
  csv: CsvSpec,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const col of csv.columns) {
    const raw = record[col.key];
    const back = col.parse(col.format(raw));
    values[col.key] = back.ok ? back.value : raw;
  }
  return values;
}

function existingOf(
  records: readonly Record<string, unknown>[],
  csv: CsvSpec,
): ExistingRecord[] {
  return records.map((r) => ({ id: String(r.id), values: csvValues(r, csv) }));
}

function currentRecords(
  pb: PocketBase,
  orgId: string,
  collection: string,
): Promise<Record<string, unknown>[]> {
  return orgRows(pb, orgId, collection, "sort_order,id");
}

function rowCopy(n: number): string {
  return n === 1
    ? "1 row needs fixing. Nothing is imported until every row is fixed."
    : `${formatCount(n)} rows need fixing. Nothing is imported until every row is fixed.`;
}

/**
 * The record input a planned row commits as: a new row is its CSV values (plus source
 * "import" where the collection keeps one); an update is the stored record, then its CSV
 * read-back, then the row's values. Shared by preview and commit so both see the same input.
 */
function rowInput(
  row: PlannedRow,
  byId: ReadonlyMap<string, Record<string, unknown>>,
  csv: CsvSpec,
  hasSource: boolean,
): Record<string, unknown> {
  if (row.status === "new") {
    const input: Record<string, unknown> = { ...row.values };
    if (hasSource) input.source = "import";
    return input;
  }
  const current = row.id === null ? undefined : byId.get(row.id);
  if (!current) throw new NotFound();
  const base: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) {
    if (!SYSTEM_KEYS.has(k)) base[k] = v;
  }
  return { ...base, ...csvValues(current, csv), ...row.values };
}

function hasSourceField(collection: string): boolean {
  return (getCollectionSpec(collection).export as readonly string[]).includes(
    "source",
  );
}

/**
 * Run the add-on's record validator on every new / updated row of a plan (B-WR-01, D120).
 * Cross-field rules live only in the record validator ("Expires is before Issued", "Describe
 * the photo"), so without this the preview shows 0 errors and the commit then fails on one
 * row. A failing row becomes an error row with a "Row N:" message and the counts move with
 * it. Pure: the validator never scans or writes.
 */
export function applyRecordRules(
  plan: ImportPlan,
  records: readonly Record<string, unknown>[],
  csv: CsvSpec,
  spec: AddonRecordSpec,
  hasSource: boolean,
): ImportPlan {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const counts = { ...plan.counts };
  const rows = plan.rows.map((row): PlannedRow => {
    if (row.status !== "new" && row.status !== "updated") return row;
    const input = rowInput(row, byId, csv, hasSource);
    delete input.id;
    delete input.organization;
    try {
      spec.validate(input);
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
    ...plan,
    counts,
    rows,
    creates: rows.filter((r) => r.status === "new").map((r) => r.values),
    updates: rows
      .filter((r) => r.status === "updated" && r.id !== null)
      .map((r) => ({ id: r.id!, values: r.values })),
  };
}

/** Validation copy from the add-on's record rules, with the spreadsheet row in front. */
async function prepareRow(
  ctx: OrgContext,
  deps: AddonDeps,
  spec: AddonRecordSpec,
  rowNumber: number,
  input: Record<string, unknown>,
) {
  try {
    return await prepareRecord(ctx, deps, spec, input);
  } catch (err) {
    if (err instanceof InvalidInput) {
      throw new InvalidInput(`Row ${rowNumber}: ${err.message}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------
// Public API

/** Validate + dedupe + diff the file against the org's records (addon:<slug> write). */
export async function previewAddonImport(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  collection: string,
  text: string,
  mode: ImportMode,
): Promise<ImportPreview> {
  checkAddonAccess(ctx, slug, "write");
  const target = csvTarget(deps, slug, collection);
  const importMode = checkMode(mode);
  const { rows, ignored } = parseText(checkText(text), target.csv);
  const records = await pbRun((pb) =>
    currentRecords(pb, ctx.orgId, target.collection),
  );
  const plan = applyRecordRules(
    planImport({
      rows,
      existing: existingOf(records, target.csv),
      spec: target.csv,
      mode: importMode,
    }),
    records,
    target.csv,
    target.spec,
    hasSourceField(target.collection),
  );
  return toImportPreview(
    plan,
    target.csv,
    (v) => target.spec.title(v),
    ignored,
  );
}

function checkMode(mode: unknown): ImportMode {
  if (mode !== "update" && mode !== "replace") {
    throw new InvalidInput("Choose Update only what changed or Replace all.");
  }
  return mode;
}

type Screened = { id: string; outcome: ScanOutcome };

/**
 * Commit an import (addon:<slug> write, add-on active, under the addons lock). Re-plans from
 * the raw text; refuses on any row error; writes the before-import backup, then one batch.
 * Replace all deletes only the removal set the owner confirmed on the preview
 * (`confirmedRemovals`, the preview's removal ids): if the re-plan's removals differ (a
 * record was added or changed since), nothing is written (A-WR-03, D126).
 */
export async function importAddonRecords(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  collection: string,
  text: string,
  mode: ImportMode,
  confirmedRemovals?: readonly string[],
): Promise<{
  added: number;
  updated: number;
  removed: number;
  backupId: string;
}> {
  checkAddonAccess(ctx, slug, "write");
  const {
    manifest,
    csv,
    spec,
    collection: name,
  } = csvTarget(deps, slug, collection);
  const importMode = checkMode(mode);
  const { rows } = parseText(checkText(text), csv);
  const store = storeOf(deps);
  // Imported rows are tagged source "import" where the collection keeps a source field.
  const hasSource = hasSourceField(name);

  const { result, screened } = await withOrgLock(addonLockKey(ctx.orgId), () =>
    pbRun(async (pb) => {
      await assertAddonActive(pb, ctx.orgId, manifest);
      const records = await currentRecords(pb, ctx.orgId, name);
      const plan: ImportPlan = applyRecordRules(
        planImport({
          rows,
          existing: existingOf(records, csv),
          spec: csv,
          mode: importMode,
        }),
        records,
        csv,
        spec,
        hasSource,
      );
      if (plan.counts.errors > 0) {
        throw new InvalidInput(rowCopy(plan.counts.errors));
      }
      if (
        importMode === "replace" &&
        !removalsConfirmed(
          plan.removals.map((r) => r.id),
          confirmedRemovals,
        )
      ) {
        throw new InvalidInput(REMOVALS_CHANGED_COPY);
      }
      const opCount =
        plan.counts.new + plan.counts.updated + plan.removals.length + 1;
      if (opCount > MAX_ADDON_BATCH) {
        throw new InvalidInput(TOO_MANY_CHANGES_COPY);
      }

      const byId = new Map(records.map((r) => [String(r.id), r]));
      let sort = records.reduce(
        (max, r) =>
          typeof r.sort_order === "number" && r.sort_order > max
            ? r.sort_order
            : max,
        0,
      );
      const ops: Op[] = [];
      const screenedRows: Screened[] = [];
      for (const row of plan.rows) {
        if (row.status === "new") {
          const prepared = await prepareRow(
            ctx,
            deps,
            spec,
            row.rowNumber,
            rowInput(row, byId, csv, hasSource),
          );
          const id = newRecordId();
          sort += 1;
          ops.push({
            collection: name,
            op: "create",
            id,
            body: {
              ...prepared.body,
              organization: ctx.orgId,
              sort_order: sort,
            },
          });
          screenedRows.push({ id, outcome: prepared.outcome });
        } else if (row.status === "updated" && row.id !== null) {
          const prepared = await prepareRow(
            ctx,
            deps,
            spec,
            row.rowNumber,
            rowInput(row, byId, csv, hasSource),
          );
          ops.push({
            collection: name,
            op: "update",
            id: row.id,
            body: prepared.body,
          });
          screenedRows.push({ id: row.id, outcome: prepared.outcome });
        }
      }
      for (const r of plan.removals) {
        ops.push({ collection: name, op: "delete", id: r.id });
      }

      // Backup FIRST (ADDON-14). If the batch then fails, the backup stays (pruned later).
      const backup = await writeAddonBackup(
        pb,
        ctx,
        manifest,
        store,
        nowOf(deps),
        "before-import",
      );
      const counts = {
        added: plan.counts.new,
        updated: plan.counts.updated,
        removed: plan.removals.length,
      };
      await sendAudited(pb, ctx, ops, {
        action: "addon.import",
        targetCollection: name,
        targetId: "",
        meta: {
          addon: manifest.slug,
          mode: importMode,
          ...counts,
          backupId: backup.id,
        },
      });
      await pruneAddonBackups(store, ctx.orgId, manifest.slug);
      return {
        result: { ...counts, backupId: backup.id },
        screened: screenedRows,
      };
    }),
  );

  // Flags after the commit (the rows exist now), then one invalidation and one ping.
  for (const s of screened) {
    if (s.outcome.verdict === "clean") continue;
    await recordContentFlag(ctx, {
      targetCollection: name,
      targetId: s.id,
      verdict: s.outcome.verdict,
      reasons: s.outcome.reasons,
    });
  }
  deps.invalidator.invalidate([
    addonTag(ctx.orgId, manifest.slug),
    liveTag(ctx.orgId),
  ]);
  // 14-21 (CONT-16): through the central eligibility guard (custom primary host of a live
  // site only) and recorded per org; pingAndRecord never throws.
  try {
    await pingAndRecord(
      ctx.orgId,
      await withSuperuser((pb) => siteUrls(pb, ctx.orgId)),
      deps.pinger ? { pinger: deps.pinger } : {},
    );
  } catch {
    // Best effort; the import already happened.
  }
  return result;
}

function dateStamp(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The org's records as CSV: a leading id column, then the add-on's columns (addon:<slug>
 * read). Works while the add-on is off (retained data stays exportable, invariant 9).
 */
export async function exportAddonCsv(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  collection: string,
): Promise<{ filename: string; csv: string }> {
  checkAddonAccess(ctx, slug, "read");
  const { manifest, csv, collection: name } = csvTarget(deps, slug, collection);
  const records = await pbRun((pb) => currentRecords(pb, ctx.orgId, name));
  return {
    filename: `${manifest.slug}-${dateStamp(nowOf(deps))}.csv`,
    csv: exportCsv(
      csv,
      records.map((r) => ({ ...r, id: String(r.id) })),
    ),
  };
}

/** The downloadable template: header row plus one example row. No org data. */
export function addonCsvTemplate(
  deps: AddonDeps,
  slug: string,
  collection: string,
): { filename: string; csv: string } {
  const { manifest, csv } = csvTarget(deps, slug, collection);
  return { filename: `${manifest.slug}-template.csv`, csv: templateCsv(csv) };
}
