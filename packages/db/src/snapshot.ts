// D187 / TEN-13: deny by default. Page versions (P3), add-on backups (P5) and tenant
// exports (plan 08) MUST serialize through toSnapshot. Only the registry's approved export
// fields are copied, by name, from the record; the record is never spread or cloned, so a
// field added to a collection later stays out of every snapshot until someone approves it.
// Auth collections, PocketBase system collections and unknown names throw.
import { CdsError } from "@cds/core";
import {
  ORGANIZATION_EXPORT_FIELDS,
  getCollectionSpec,
  passesRowFilter,
} from "./registry";

export class SnapshotForbidden extends CdsError {
  override readonly code = "snapshot_forbidden";
}

const NEVER = new Set(["users", "end_users"]);

function approvedSpec(collection: string): {
  fields: readonly string[];
  spec: ReturnType<typeof getCollectionSpec> | null;
} {
  if (collection === "organizations") {
    return { fields: ORGANIZATION_EXPORT_FIELDS, spec: null };
  }
  // approvedFields has already proved the spec exists and is exportable.
  const fields = approvedFields(collection);
  return { fields, spec: getCollectionSpec(collection) };
}

function approvedFields(collection: string): readonly string[] {
  if (collection === "organizations") return ORGANIZATION_EXPORT_FIELDS;
  if (!collection || collection.startsWith("_") || NEVER.has(collection)) {
    throw new SnapshotForbidden(
      `${collection || "(empty)"} is never snapshotted`,
    );
  }
  let spec;
  try {
    spec = getCollectionSpec(collection);
  } catch {
    throw new SnapshotForbidden(
      `${collection} is not an exportable collection`,
    );
  }
  if (spec.kind === "auth" || spec.export === "never") {
    throw new SnapshotForbidden(`${collection} is never snapshotted`);
  }
  return spec.export;
}

/** The approved fields of `record`, in export-list order; missing fields become null. */
export function toSnapshot(
  collection: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { fields, spec } = approvedSpec(collection);
  // Row filter (12-04): a row outside it (an internal support note) is never snapshotted.
  // Readers filter in the query first; this is the fail-closed backstop.
  if (spec && !passesRowFilter(spec, record)) {
    throw new SnapshotForbidden(`${collection} row is not exportable`);
  }
  return Object.fromEntries(fields.map((f) => [f, record[f] ?? null]));
}

/**
 * Reads one snapshot row back for restore: only approved fields that are present are
 * returned, anything else in the file is ignored (a tampered snapshot cannot add fields).
 */
export function fromSnapshotRecord(
  collection: string,
  snapshot: unknown,
): Record<string, unknown> {
  const fields = approvedFields(collection);
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  ) {
    throw new SnapshotForbidden(`${collection} snapshot row is not an object`);
  }
  const row = snapshot as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter((f) => Object.prototype.hasOwnProperty.call(row, f))
      .map((f) => [f, row[f]]),
  );
}
