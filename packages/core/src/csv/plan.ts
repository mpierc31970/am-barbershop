// Import planner (ADDON-13; D125 Update / Replace all modes, D126 dedupe; CONTEXT A5-Q4).
// Match order: id first, then normalized natural key. Pure: the same plan previews in the
// browser-facing action and is re-computed server-side at commit (05-08).
import type { ValidatedRow } from "./columns";
import type { CsvSpec } from "./types";

export type ExistingRecord = { id: string; values: Record<string, unknown> };
export type ImportMode = "update" | "replace";

export type PlannedRow = {
  rowNumber: number;
  status: "new" | "updated" | "unchanged" | "duplicate" | "error";
  id: string | null;
  values: Record<string, unknown>;
  changed: string[];
  messages: string[];
};

export type ImportPlan = {
  mode: ImportMode;
  counts: {
    new: number;
    updated: number;
    unchanged: number;
    duplicates: number;
    errors: number;
  };
  rows: PlannedRow[];
  creates: Record<string, unknown>[];
  updates: { id: string; values: Record<string, unknown> }[];
  removals: ExistingRecord[];
};

export type ImportPreview = {
  counts: ImportPlan["counts"];
  mode: ImportMode;
  ignored: string[];
  columns: { key: string; label: string }[];
  rows: {
    rowNumber: number;
    status: PlannedRow["status"];
    cells: Record<string, string>;
    changed: string[];
    messages: string[];
  }[];
  removals: { id: string; title: string }[];
  /** new + updated, plus removals in replace mode. */
  changes: number;
};

const KEY_SEP = "\u0000";

export function normalizeKey(
  values: Record<string, unknown>,
  naturalKey: readonly string[],
): string {
  return naturalKey
    .map((k) => {
      const v = values[k];
      return (v == null ? "" : String(v))
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    })
    .join(KEY_SEP);
}

/** Empty, null and undefined compare equal; objects compare with sorted keys. */
function stable(v: unknown): string {
  if (v === undefined || v === null || v === "") return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function isBlankKey(key: string): boolean {
  return key.split(KEY_SEP).every((p) => p === "");
}

export function planImport(input: {
  rows: ValidatedRow[];
  existing: readonly ExistingRecord[];
  spec: CsvSpec;
  mode: ImportMode;
}): ImportPlan {
  const { rows, existing, spec, mode } = input;
  const byId = new Map<string, ExistingRecord>();
  const byKey = new Map<string, ExistingRecord>();
  for (const rec of existing) {
    byId.set(rec.id, rec);
    const key = normalizeKey(rec.values, spec.naturalKey);
    if (!isBlankKey(key) && !byKey.has(key)) byKey.set(key, rec);
  }

  const seenIds = new Map<string, number>(); // id -> first row number
  const seenKeys = new Map<string, number>(); // natural key -> first row number
  const matched = new Map<string, number>(); // existing id -> row number that claimed it
  const counts = { new: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 0 };
  const creates: Record<string, unknown>[] = [];
  const updates: { id: string; values: Record<string, unknown> }[] = [];

  const planned = rows.map((row): PlannedRow => {
    const base = {
      rowNumber: row.rowNumber,
      id: row.id,
      values: row.values,
      changed: [] as string[],
    };
    if (row.errors.length > 0) {
      counts.errors++;
      return { ...base, status: "error", messages: [...row.errors] };
    }
    const key = normalizeKey(row.values, spec.naturalKey);
    const hasKey = !isBlankKey(key);
    const duplicateOf = (first: number): PlannedRow => {
      counts.duplicates++;
      return {
        ...base,
        status: "duplicate",
        messages: [
          `Row ${row.rowNumber}: Same as row ${first}, so we skipped it.`,
        ],
      };
    };

    let match: ExistingRecord | undefined;
    if (row.id !== null) {
      const first = seenIds.get(row.id);
      if (first !== undefined) return duplicateOf(first);
      match = byId.get(row.id);
      if (!match) {
        counts.errors++;
        return {
          ...base,
          status: "error",
          messages: [
            `Row ${row.rowNumber}: This id belongs to a ${spec.singular} that no longer exists. Clear the id to add it as new.`,
          ],
        };
      }
      seenIds.set(row.id, row.rowNumber);
    } else {
      if (hasKey) {
        const first = seenKeys.get(key);
        if (first !== undefined) return duplicateOf(first);
      }
      match = hasKey ? byKey.get(key) : undefined;
    }

    if (match) {
      const claimed = matched.get(match.id);
      if (claimed !== undefined) return duplicateOf(claimed);
      matched.set(match.id, row.rowNumber);
    }
    if (hasKey && !seenKeys.has(key)) seenKeys.set(key, row.rowNumber);

    if (!match) {
      counts.new++;
      creates.push(row.values);
      return { ...base, status: "new", messages: [] };
    }
    const changed = Object.keys(row.values).filter(
      (k) => stable(row.values[k]) !== stable(match.values[k]),
    );
    if (changed.length === 0) {
      counts.unchanged++;
      return { ...base, id: match.id, status: "unchanged", messages: [] };
    }
    counts.updated++;
    updates.push({ id: match.id, values: row.values });
    return { ...base, id: match.id, status: "updated", changed, messages: [] };
  });

  const removals =
    mode === "replace" ? existing.filter((r) => !matched.has(r.id)) : [];
  return { mode, counts, rows: planned, creates, updates, removals };
}

export function toImportPreview(
  plan: ImportPlan,
  spec: CsvSpec,
  titleOf: (values: Record<string, unknown>) => string,
  ignored: string[],
): ImportPreview {
  return {
    counts: { ...plan.counts },
    mode: plan.mode,
    ignored: [...ignored],
    columns: spec.columns.map((c) => ({ key: c.key, label: c.label })),
    rows: plan.rows.map((r) => {
      const cells: Record<string, string> = {};
      for (const c of spec.columns) {
        if (Object.hasOwn(r.values, c.key))
          cells[c.key] = c.format(r.values[c.key]);
      }
      return {
        rowNumber: r.rowNumber,
        status: r.status,
        cells,
        changed: [...r.changed],
        messages: [...r.messages],
      };
    }),
    removals: plan.removals.map((r) => ({
      id: r.id,
      title: titleOf(r.values),
    })),
    changes:
      plan.counts.new +
      plan.counts.updated +
      (plan.mode === "replace" ? plan.removals.length : 0),
  };
}
