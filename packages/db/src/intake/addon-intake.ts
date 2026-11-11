// Add-on intake (CONTEXT A3-Q5; RESEARCH Pattern 7, Pitfall 16; invariant 3; T-06-61). The
// "People & proof" stage collects proof for add-ons the owner picked on the quote
// (testimonials, credentials...) BEFORE anything is installed. Everything lands in
// org_intake.addon_config[slug] = { fields, records }; nothing is written to an add-on's
// own collections (installing an add-on is never a migration, and intake never installs).
//
//   - only add-ons in org_intake.selections.addons, and only what the manifest's `intake`
//     declares (fields, and one records collection with its CSV spec)
//   - every record goes through the add-on's own records[collection].validate (the single
//     source of field rules; its owner-facing InvalidInput passes through)
//   - CSV text is capped (chars + MAX_IMPORT_BYTES), parsed and re-planned server-side on
//     preview AND commit with the P5 engine; a file with any error row commits nothing
//   - the list caps at MAX_IMPORT_ROWS and the whole addon_config under the 4 MB json field
// Writes: business write (Owner / Admin). Imports are one always-audited batch.
// B-WR-08: every held record has a stable key (addon_config[slug].keys, parallel to
// records). Edit and remove address a row by key, so a list changed in another tab or by
// another editor never makes an action hit the wrong row.
import { randomBytes } from "node:crypto";
import { InvalidInput } from "@cds/core";
import type {
  AddonIntakeField,
  AddonManifest,
  AddonRecordSpec,
  AddonRegistry,
} from "@cds/core/addons";
import {
  fileError,
  formatCount,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  planImport,
  toImportPreview,
  validateRows,
  type CsvSpec,
  type ImportPlan,
  type ImportPreview,
} from "@cds/core/csv";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { sendAudited } from "../addons/backups";
import { applyRecordRules, MAX_IMPORT_CHARS } from "../addons/import";
import type { OrgContext } from "../context";
import { newRecordId } from "../repository";
import {
  intakeFromRow,
  isIntakeKey,
  type AddonIntakeConfig,
} from "./org-intake";
import { commit, orgRow, runWrite, type Op } from "./shared";

const COLLECTION = "org_intake";

/** Under the org_intake.addon_config 4 MB json cap, with room for the other keys. */
export const MAX_ADDON_CONFIG_BYTES = 3_900_000;
export const ADDON_TEXT_MAX = 2000;

export const ADDON_INTAKE_COPY = {
  unknown: "That add-on doesn't exist. Refresh and try again.",
  notSelected: (name: string) => `Add ${name} to your quote first.`,
  noRecords: (name: string) => `${name} doesn't collect a list during setup.`,
  noFields: (name: string) => `${name} has no setup questions.`,
  tooMany: `That's more than ${formatCount(MAX_IMPORT_ROWS)} rows. Split the file, or add the rest after launch.`,
  tooBig:
    "That's more than we can hold during setup. Import fewer rows, or add the rest after launch.",
  index: "That item isn't on the list anymore. Refresh and try again.",
  mode: "Choose Add to my list or Replace all.",
  url: (label: string) => `${label} must start with https:// or http://.`,
  long: (label: string, max: number) =>
    `${label} is longer than ${formatCount(max)} characters.`,
  text: (label: string) => `${label} must be text.`,
  switch: (label: string) => `${label} must be on or off.`,
} as const;

export type AddonIntakeImportMode = "add" | "replace";

type Target = { manifest: AddonManifest; slug: string };
type RecordsTarget = Target & {
  collection: string;
  spec: AddonRecordSpec;
  csv: CsvSpec | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The manifest, only when it exists and the owner picked it on the quote. */
function targetOf(
  registry: AddonRegistry,
  slug: unknown,
  row: RecordModel | null,
): Target {
  const manifest = registry.get(slug);
  if (!manifest || !manifest.intake) {
    throw new InvalidInput(ADDON_INTAKE_COPY.unknown);
  }
  const selections = intakeFromRow(row).selections;
  if (!selections.addons.includes(manifest.slug)) {
    throw new InvalidInput(ADDON_INTAKE_COPY.notSelected(manifest.name));
  }
  return { manifest, slug: manifest.slug };
}

function recordsTargetOf(t: Target): RecordsTarget {
  const rec = t.manifest.intake?.records;
  const spec = rec ? t.manifest.records[rec.collection] : undefined;
  if (!rec || !spec) {
    throw new InvalidInput(ADDON_INTAKE_COPY.noRecords(t.manifest.name));
  }
  const csvKey = rec.csv ?? rec.collection;
  const csv =
    t.manifest.csv && Object.hasOwn(t.manifest.csv, csvKey)
      ? t.manifest.csv[csvKey]!
      : null;
  return { ...t, collection: rec.collection, spec, csv };
}

function configOf(row: RecordModel | null): AddonIntakeConfig {
  return intakeFromRow(row).addonConfig;
}

type Held = {
  fields: Record<string, unknown>;
  records: Record<string, unknown>[];
  keys: string[];
};

/** addon_config[slug] with its keys (always aligned with records once read). */
function heldOf(row: RecordModel | null, slug: string): Held {
  const c = configOf(row)[slug];
  if (!c) return { fields: {}, records: [], keys: [] };
  const keys =
    c.keys && c.keys.length === c.records.length
      ? [...c.keys]
      : c.records.map((_, i) => `r${i}`);
  return { fields: c.fields, records: [...c.records], keys };
}

/** A fresh held-record key (base64url, 12 chars). */
function newIntakeKey(): string {
  return randomBytes(9).toString("base64url");
}

/** The row a key names, or the "not on the list anymore" refusal. */
function indexOfKey(held: Held, key: unknown): number {
  const i = isIntakeKey(key) ? held.keys.indexOf(key) : -1;
  if (i < 0) throw new InvalidInput(ADDON_INTAKE_COPY.index);
  return i;
}

/** One record through the add-on's own validator (an `id` key is dropped; an organization key is refused by the validator). */
function validated(
  spec: AddonRecordSpec,
  raw: unknown,
): Record<string, unknown> {
  if (isRecord(raw) && Object.hasOwn(raw, "id")) {
    const rest = { ...raw };
    delete rest.id;
    return spec.validate(rest);
  }
  return spec.validate(raw);
}

/** Write addon_config[slug] (create the row if signup never did), size-checked. */
async function writeConfig(
  pb: PocketBase,
  ctx: OrgContext,
  row: RecordModel | null,
  slug: string,
  next: AddonIntakeConfig[string],
  action: string,
  audited: boolean,
  meta: Record<string, unknown>,
): Promise<void> {
  if (next.keys?.length !== next.records.length) {
    throw new Error("addon intake keys out of step with records");
  }
  const config: AddonIntakeConfig = { ...configOf(row), [slug]: next };
  if (
    new TextEncoder().encode(JSON.stringify(config)).length >
    MAX_ADDON_CONFIG_BYTES
  ) {
    throw new InvalidInput(ADDON_INTAKE_COPY.tooBig);
  }
  const id = row?.id ?? newRecordId();
  const op: Op = row
    ? {
        collection: COLLECTION,
        op: "update",
        id,
        body: { addon_config: config },
      }
    : {
        collection: COLLECTION,
        op: "create",
        id,
        body: { organization: ctx.orgId, selections: {}, addon_config: config },
      };
  const event = {
    action: `addon_intake.${action}`,
    targetCollection: COLLECTION,
    targetId: id,
    meta: { slug, ...meta },
  };
  if (audited) await sendAudited(pb, ctx, [op], event);
  else await commit(pb, ctx, [op], event);
}

// ---------------------------------------------------------------------------------------
// Fields

function fieldValue(f: AddonIntakeField, raw: unknown): unknown {
  if (f.kind === "switch") {
    if (typeof raw !== "boolean") {
      throw new InvalidInput(ADDON_INTAKE_COPY.switch(f.label));
    }
    return raw;
  }
  if (typeof raw !== "string") {
    throw new InvalidInput(ADDON_INTAKE_COPY.text(f.label));
  }
  const v = raw.trim();
  const max = Math.min(f.max ?? ADDON_TEXT_MAX, ADDON_TEXT_MAX);
  if (v.length > max)
    throw new InvalidInput(ADDON_INTAKE_COPY.long(f.label, max));
  if (f.kind === "url" && v !== "") {
    let ok = false;
    try {
      const u = new URL(v);
      ok = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      ok = false;
    }
    if (!ok) throw new InvalidInput(ADDON_INTAKE_COPY.url(f.label));
  }
  return v;
}

/** Save the given declared fields (others are ignored); merges over the stored ones. */
export async function saveAddonIntakeFields(
  ctx: OrgContext,
  registry: AddonRegistry,
  slug: string,
  fields: unknown,
): Promise<void> {
  if (!isRecord(fields)) throw new InvalidInput("The change must be an object");
  await runWrite(ctx, async (pb) => {
    const row = await orgRow(pb, ctx, COLLECTION);
    const t = targetOf(registry, slug, row);
    const declared = t.manifest.intake?.fields ?? [];
    if (declared.length === 0) {
      throw new InvalidInput(ADDON_INTAKE_COPY.noFields(t.manifest.name));
    }
    const values: Record<string, unknown> = {};
    for (const f of declared) {
      if (Object.hasOwn(fields, f.id))
        values[f.id] = fieldValue(f, fields[f.id]);
    }
    if (Object.keys(values).length === 0) return;
    const current = heldOf(row, t.slug);
    await writeConfig(
      pb,
      ctx,
      row,
      t.slug,
      { ...current, fields: { ...current.fields, ...values } },
      "fields",
      false,
      { keys: Object.keys(values) },
    );
  });
}

// ---------------------------------------------------------------------------------------
// Records: CSV import (intake mode) and one by one

const INTAKE_ID = "intake-";

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

function checkMode(mode: unknown): AddonIntakeImportMode {
  if (mode !== "add" && mode !== "replace") {
    throw new InvalidInput(ADDON_INTAKE_COPY.mode);
  }
  return mode;
}

/** A stored record as the CSV reads it back, so planning compares like with like. */
function csvValues(
  record: Record<string, unknown>,
  csv: CsvSpec,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const col of csv.columns) {
    const back = col.parse(col.format(record[col.key]));
    values[col.key] = back.ok ? back.value : record[col.key];
  }
  return values;
}

type Planned = {
  plan: ImportPlan;
  ignored: string[];
  existing: Record<string, unknown>[];
};

/** Parse + plan against the held records ("add" = update by natural key, else append). */
function planIntake(
  t: RecordsTarget,
  text: string,
  mode: AddonIntakeImportMode,
  existing: Record<string, unknown>[],
): Planned {
  if (!t.csv) {
    throw new InvalidInput(ADDON_INTAKE_COPY.noRecords(t.manifest.name));
  }
  const csv = t.csv;
  const parsed = parseCsv(checkText(text));
  if (!parsed.ok) throw new InvalidInput(parsed.error.message);
  const rows = validateRows(parsed, csv);
  if (!rows.ok) throw new InvalidInput(rows.error.message);
  // Held records have no ids: every row matches by natural key only.
  const withIds = existing.map((r, i) => ({ ...r, id: `${INTAKE_ID}${i}` }));
  const plan = applyRecordRules(
    planImport({
      rows: rows.rows.map((r) => ({ ...r, id: null })),
      existing: withIds.map((r) => ({ id: r.id, values: csvValues(r, csv) })),
      spec: csv,
      mode: mode === "add" ? "update" : "replace",
    }),
    withIds,
    csv,
    t.spec,
    false,
  );
  return { plan, ignored: rows.ignored, existing };
}

function indexOf(id: string | null): number {
  return id === null ? -1 : Number(id.slice(INTAKE_ID.length));
}

/** The list a committed plan leaves: add keeps the held list, replace keeps only the file. */
function applyPlan(
  t: RecordsTarget,
  p: Planned,
  existingKeys: readonly string[],
): { records: Record<string, unknown>[]; keys: string[] } {
  const { plan, existing } = p;
  if (plan.counts.errors > 0) {
    throw new InvalidInput(
      plan.counts.errors === 1
        ? "1 row needs fixing. Nothing is imported until every row is fixed."
        : `${formatCount(plan.counts.errors)} rows need fixing. Nothing is imported until every row is fixed.`,
    );
  }
  const merged = (row: ImportPlan["rows"][number]) =>
    validated(t.spec, { ...(existing[indexOf(row.id)] ?? {}), ...row.values });
  const keyAt = (row: ImportPlan["rows"][number]) =>
    existingKeys[indexOf(row.id)] ?? newIntakeKey();
  if (plan.mode === "replace") {
    const records: Record<string, unknown>[] = [];
    const keys: string[] = [];
    for (const row of plan.rows) {
      if (row.status === "new") {
        records.push(validated(t.spec, row.values));
        keys.push(newIntakeKey());
      } else if (row.status === "updated") {
        records.push(merged(row));
        keys.push(keyAt(row));
      } else if (row.status === "unchanged") {
        records.push(existing[indexOf(row.id)]!);
        keys.push(keyAt(row));
      }
    }
    return { records, keys };
  }
  const records = [...existing];
  const keys = [...existingKeys];
  for (const row of plan.rows) {
    if (row.status === "new") {
      records.push(validated(t.spec, row.values));
      keys.push(newIntakeKey());
    } else if (row.status === "updated") {
      records[indexOf(row.id)] = merged(row);
    }
  }
  return { records, keys };
}

function capRows(list: readonly unknown[]): void {
  if (list.length > MAX_IMPORT_ROWS) {
    throw new InvalidInput(ADDON_INTAKE_COPY.tooMany);
  }
}

/** What an intake import would do (business write: it is part of an import). */
export async function previewAddonIntakeImport(
  ctx: OrgContext,
  registry: AddonRegistry,
  slug: string,
  csvText: string,
  mode: AddonIntakeImportMode = "add",
): Promise<ImportPreview> {
  const m = checkMode(mode);
  return runWrite(ctx, async (pb) => {
    const row = await orgRow(pb, ctx, COLLECTION);
    const t = recordsTargetOf(targetOf(registry, slug, row));
    const existing = configOf(row)[t.slug]?.records ?? [];
    const p = planIntake(t, csvText, m, existing);
    return toImportPreview(p.plan, t.csv!, (v) => t.spec.title(v), p.ignored);
  });
}

/** Commit an intake import into addon_config[slug].records; returns the list's size. */
export async function commitAddonIntakeImport(
  ctx: OrgContext,
  registry: AddonRegistry,
  slug: string,
  csvText: string,
  mode: AddonIntakeImportMode,
): Promise<{ count: number }> {
  const m = checkMode(mode);
  return runWrite(ctx, async (pb) => {
    const row = await orgRow(pb, ctx, COLLECTION);
    const t = recordsTargetOf(targetOf(registry, slug, row));
    const current = heldOf(row, t.slug);
    const p = planIntake(t, csvText, m, current.records);
    const { records, keys } = applyPlan(t, p, current.keys);
    capRows(records);
    await writeConfig(
      pb,
      ctx,
      row,
      t.slug,
      { fields: current.fields, records, keys },
      "import",
      true,
      { mode: m, ...p.plan.counts, total: records.length },
    );
    return { count: records.length };
  });
}

/**
 * Add one record (no key) or replace the one `key` names; returns the list's size and the
 * row's key. A new row goes at `at` when given (Undo puts a removed row back where it was),
 * else at the end. A key that is not on the list is refused (B-WR-08).
 */
export async function saveAddonIntakeRecord(
  ctx: OrgContext,
  registry: AddonRegistry,
  slug: string,
  input: unknown,
  key?: string,
  at?: number,
): Promise<{ count: number; key: string }> {
  return runWrite(ctx, async (pb) => {
    const row = await orgRow(pb, ctx, COLLECTION);
    const t = recordsTargetOf(targetOf(registry, slug, row));
    const held = heldOf(row, t.slug);
    let rowKey: string;
    if (key === undefined) {
      const record = validated(t.spec, input);
      rowKey = newIntakeKey();
      const pos =
        at !== undefined &&
        Number.isInteger(at) &&
        at >= 0 &&
        at <= held.records.length
          ? at
          : held.records.length;
      held.records.splice(pos, 0, record);
      held.keys.splice(pos, 0, rowKey);
    } else {
      const i = indexOfKey(held, key);
      held.records[i] = validated(t.spec, input);
      rowKey = key;
    }
    capRows(held.records);
    await writeConfig(pb, ctx, row, t.slug, held, "record", false, {
      key: rowKey,
      added: key === undefined,
    });
    return { count: held.records.length, key: rowKey };
  });
}

/** Remove the record `key` names; returns the list's size and where the row was. */
export async function removeAddonIntakeRecord(
  ctx: OrgContext,
  registry: AddonRegistry,
  slug: string,
  key: string,
): Promise<{ count: number; index: number }> {
  return runWrite(ctx, async (pb) => {
    const row = await orgRow(pb, ctx, COLLECTION);
    const t = recordsTargetOf(targetOf(registry, slug, row));
    const held = heldOf(row, t.slug);
    const i = indexOfKey(held, key);
    held.records.splice(i, 1);
    held.keys.splice(i, 1);
    await writeConfig(pb, ctx, row, t.slug, held, "record_remove", false, {
      key,
    });
    return { count: held.records.length, index: i };
  });
}
