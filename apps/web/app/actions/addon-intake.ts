"use server";
// Add-on proof actions for "People & proof" (06-20; CONTEXT A3-Q5; ONB-01; D-UI-P6-18;
// invariant 3; T-06-95, T-06-96). Intake mode only: every call goes to the @cds/db
// add-on intake functions, which hold fields and rows on the setup record
// (org_intake.addon_config[slug]) and never touch an add-on's own collections, so nothing is
// installed before the owner adds the add-on. Public POST endpoints: every argument is
// untrusted. The tenant comes only from the session (runAction); the chokepoint checks the
// slug against the registry and the owner's quote picks, and runs the add-on's own record
// validator on every row. "Add one by one" sends the add-on's spreadsheet columns as typed
// text: each is read with that column's own parse rule here (the same rule an import uses),
// then validated at the chokepoint.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import { templateCsv, type CsvSpec, type ImportPreview } from "@cds/core/csv";
import {
  commitAddonIntakeImport,
  previewAddonIntakeImport,
  removeAddonIntakeRecord,
  saveAddonIntakeFields,
  saveAddonIntakeRecord,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const UNKNOWN = "That add-on doesn't exist. Refresh and try again.";
const MODE_COPY = "Choose Add to my list or Replace all.";
const INDEX_COPY =
  "That item isn't on the list anymore. Refresh and try again.";

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[addon-intake] revalidate failed", err);
  }
}

function slugOf(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-z0-9-]{1,64}$/.test(raw)) {
    throw new InvalidInput(UNKNOWN);
  }
  return raw;
}

function textOf(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InvalidInput("That file couldn't be read. Choose it again.");
  }
  return raw;
}

/** The P5 dialog's "update" is intake's "add" (new rows added, matches updated). */
function modeOf(raw: unknown): "add" | "replace" {
  if (raw === "update" || raw === "add") return "add";
  if (raw === "replace") return "replace";
  throw new InvalidInput(MODE_COPY);
}

/** A held row's stable key (B-WR-08); rows are never addressed by position. */
function keyOf(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(raw)) {
    throw new InvalidInput(INDEX_COPY);
  }
  return raw;
}

/** Where Undo puts a removed row back (a hint; out of range means the end). */
function positionOf(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new InvalidInput(INDEX_COPY);
  }
  return raw;
}

function plain(raw: unknown): Record<string, unknown> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype &&
      Object.getPrototypeOf(raw) !== null)
  ) {
    throw new InvalidInput("That item couldn't be read. Try again.");
  }
  return raw as Record<string, unknown>;
}

/** The add-on's intake spreadsheet spec (its own CSV spec for the intake collection). */
function intakeCsv(slug: string): CsvSpec {
  const m = ADDON_REGISTRY.get(slug);
  const rec = m?.intake?.records;
  const key = rec ? (rec.csv ?? rec.collection) : null;
  if (!m || !key || !m.csv || !Object.hasOwn(m.csv, key)) {
    throw new InvalidInput(UNKNOWN);
  }
  return m.csv[key]!;
}

/**
 * The add-on's own spreadsheet columns, read with their parse rules. Only declared columns
 * are forwarded; a column the owner left out is sent as empty (its default).
 */
function recordInput(slug: string, raw: unknown): Record<string, unknown> {
  const o = plain(raw);
  const csv = intakeCsv(slug);
  const out: Record<string, unknown> = {};
  for (const col of csv.columns) {
    const v = Object.hasOwn(o, col.key) ? o[col.key] : "";
    if (typeof v !== "string") {
      throw new InvalidInput(`${col.label} must be text.`);
    }
    if (col.required && v.trim() === "") {
      throw new InvalidInput(`Add the ${col.label.toLowerCase()}.`);
    }
    const parsed = col.parse(v);
    if (!parsed.ok) throw new InvalidInput(parsed.message);
    out[col.key] = parsed.value;
  }
  return out;
}

/** Save the add-on's own setup questions (declared fields only). */
export async function saveAddonIntakeFieldsAction(
  slug: unknown,
  fields: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await saveAddonIntakeFields(
      s.ctx,
      ADDON_REGISTRY,
      slugOf(slug),
      plain(fields),
    );
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

export async function previewAddonIntakeImportAction(
  slug: unknown,
  csvText: unknown,
  mode: unknown = "update",
): Promise<ActionResult<ImportPreview>> {
  return runAction(async (s) =>
    previewAddonIntakeImport(
      s.ctx,
      ADDON_REGISTRY,
      slugOf(slug),
      textOf(csvText),
      modeOf(mode),
    ),
  );
}

/** Commit an intake import; returns how many rows are held for the add-on. */
export async function commitAddonIntakeImportAction(
  slug: unknown,
  csvText: unknown,
  mode: unknown,
): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async (s) =>
    commitAddonIntakeImport(
      s.ctx,
      ADDON_REGISTRY,
      slugOf(slug),
      textOf(csvText),
      modeOf(mode),
    ),
  );
  if (res.ok) refreshHub();
  return res;
}

/**
 * Add one row (no key; at `at` when given, e.g. Undo) or replace the row `key` names.
 * Returns the list's size and the row's key.
 */
export async function saveAddonIntakeRecordAction(
  slug: unknown,
  input: unknown,
  key?: unknown,
  at?: unknown,
): Promise<ActionResult<{ count: number; key: string }>> {
  const res = await runAction(async (s) => {
    const sl = slugOf(slug);
    const k = key === undefined || key === null ? undefined : keyOf(key);
    return saveAddonIntakeRecord(
      s.ctx,
      ADDON_REGISTRY,
      sl,
      recordInput(sl, input),
      k,
      k === undefined ? positionOf(at) : undefined,
    );
  });
  if (res.ok) refreshHub();
  return res;
}

/** Remove the row `key` names; returns the list's size and where the row was (for Undo). */
export async function removeAddonIntakeRecordAction(
  slug: unknown,
  key: unknown,
): Promise<ActionResult<{ count: number; index: number }>> {
  const res = await runAction(async (s) =>
    removeAddonIntakeRecord(s.ctx, ADDON_REGISTRY, slugOf(slug), keyOf(key)),
  );
  if (res.ok) refreshHub();
  return res;
}

/** The add-on's spreadsheet template (no tenant data; still needs a signed-in member). */
export async function templateAddonIntakeCsvAction(
  slug: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction(async () => {
    const sl = slugOf(slug);
    return { filename: `${sl}-template.csv`, csv: templateCsv(intakeCsv(sl)) };
  });
}
