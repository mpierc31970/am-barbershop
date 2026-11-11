"use server";
// Team and Services actions (06-20; ONB-01, ONB-13, D37, D120, D257; 06-UI-SPEC "Team,
// Services"; T-06-95, T-06-97). Public POST endpoints: every argument is untrusted. The
// tenant, role and impersonation come only from the session cookie via runAction; payload
// keys are allow-listed here and the @cds/db chokepoint validates them again (business
// write: an Editor gets the Forbidden copy). Record ids are shape-checked before they reach
// the chokepoint, which scopes every read and write to the session's tenant (a foreign id is
// the same NotFound as a missing one). Spreadsheets are parsed, planned and validated on the
// server (the P5 engine) on preview AND commit. Saves refresh the /hub layout, so the setup
// summaries and the sidebar's needed-count follow the lists.
// 13-52 (STAFF-25, D270): saves, Show on site and imports pass contentDeps() so the publish
// scan runs on save and the live site is invalidated; results carry `held`.
import { InvalidInput } from "@cds/core";
import type { ImportPreview } from "@cds/core/csv";
import { SERVICES_CSV } from "@cds/core/intake";
import {
  commitCoreImport,
  coreCsvTemplate,
  deleteService,
  exportCoreCsv,
  previewCoreImport,
  removeTeamMember,
  reorderServices,
  reorderTeam,
  saveService,
  saveTeamMember,
  type CoreListKind,
  type SavedService,
  type SavedTeamMember,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

const ID = /^[a-z0-9]{1,32}$/i;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const MODE_COPY = "Choose Add and update or Replace all.";
const REORDER_COPY = "That move didn't save. Try again.";
const MAX_LIST = 500;

const TEAM_KEYS = ["name", "role", "bio", "is_published", "photoId"] as const;
const SERVICE_KEYS = [
  "name",
  "description",
  "price_display",
  "price_cents",
  "duration_minutes",
  "is_published",
] as const;

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[lists] revalidate failed", err);
  }
}

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function optionalId(raw: unknown): string | undefined {
  return raw === undefined || raw === null ? undefined : idOf(raw);
}

function idsOf(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_LIST) {
    throw new InvalidInput(REORDER_COPY);
  }
  return raw.map(idOf);
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

/** Own, allow-listed keys only; anything else in the payload is dropped. */
function pick(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const o = plain(raw);
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.hasOwn(o, k)) out[k] = o[k];
  return out;
}

function onOff(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new InvalidInput("Show on site must be on or off.");
  }
  return raw;
}

function kindOf(raw: unknown): CoreListKind {
  if (raw !== "team_members" && raw !== "services") {
    throw new InvalidInput("That list has no spreadsheet import.");
  }
  return raw;
}

function modeOf(raw: unknown): "update" | "replace" {
  if (raw !== "update" && raw !== "replace") throw new InvalidInput(MODE_COPY);
  return raw;
}

function textOf(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InvalidInput("That file couldn't be read. Choose it again.");
  }
  return raw;
}

function removalsOf(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length > MAX_LIST ||
    !raw.every((id) => typeof id === "string" && ID.test(id))
  ) {
    throw new InvalidInput(
      "The list to remove couldn't be read. Check the file again.",
    );
  }
  return raw as string[];
}

const PRICE_COLUMN = SERVICES_CSV.columns.find((c) => c.key === "price_cents")!;

/**
 * The service payload: a typed amount as the owner wrote it ("$45", "45.00") becomes cents
 * with the spreadsheet's own price rule, so the drawer and the import agree. The chokepoint's
 * validateService then owns every price rule (Fixed and Starting at need one).
 */
function serviceInput(raw: unknown): Record<string, unknown> {
  const o = plain(raw);
  const out = pick(o, SERVICE_KEYS);
  if (Object.hasOwn(o, "price") && !Object.hasOwn(out, "price_cents")) {
    const typed = o.price;
    if (typed !== null && typed !== undefined && typeof typed !== "string") {
      throw new InvalidInput("Add a price, like 45 or 45.00.");
    }
    const parsed = PRICE_COLUMN.parse(typeof typed === "string" ? typed : "");
    if (!parsed.ok) throw new InvalidInput(parsed.message);
    out.price_cents = parsed.value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Team

/** Add (no id) or edit (id) a team member. */
export async function saveTeamMemberAction(
  input: unknown,
  id?: unknown,
): Promise<ActionResult<SavedTeamMember>> {
  const res = await runAction(async (s) => {
    const rid = optionalId(id);
    return saveTeamMember(s.ctx, pick(input, TEAM_KEYS), rid, contentDeps());
  });
  if (res.ok) refreshHub();
  return res;
}

export async function removeTeamMemberAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await removeTeamMember(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

export async function reorderTeamAction(
  ids: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await reorderTeam(s.ctx, idsOf(ids));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

/** The row's Show on site switch: only is_published is sent (the rest is kept). */
export async function setTeamPublishedAction(
  id: unknown,
  on: unknown,
): Promise<ActionResult<SavedTeamMember>> {
  const res = await runAction(async (s) => {
    const rid = idOf(id);
    return saveTeamMember(
      s.ctx,
      { is_published: onOff(on) },
      rid,
      contentDeps(),
    );
  });
  if (res.ok) refreshHub();
  return res;
}

// ---------------------------------------------------------------------------------------
// Services

/** Add (no id) or edit (id) a service. */
export async function saveServiceAction(
  input: unknown,
  id?: unknown,
): Promise<ActionResult<SavedService>> {
  const res = await runAction(async (s) => {
    const rid = optionalId(id);
    return saveService(s.ctx, serviceInput(input), rid, contentDeps());
  });
  if (res.ok) refreshHub();
  return res;
}

export async function deleteServiceAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await deleteService(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

export async function reorderServicesAction(
  ids: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await reorderServices(s.ctx, idsOf(ids));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

export async function setServicePublishedAction(
  id: unknown,
  on: unknown,
): Promise<ActionResult<SavedService>> {
  const res = await runAction(async (s) => {
    const rid = idOf(id);
    return saveService(s.ctx, { is_published: onOff(on) }, rid, contentDeps());
  });
  if (res.ok) refreshHub();
  return res;
}

// ---------------------------------------------------------------------------------------
// Spreadsheets (D120, D126)

export async function previewCoreImportAction(
  kind: unknown,
  csvText: unknown,
  mode: unknown,
): Promise<ActionResult<ImportPreview>> {
  return runAction(async (s) =>
    previewCoreImport(s.ctx, kindOf(kind), textOf(csvText), modeOf(mode)),
  );
}

/**
 * Commit an import. Core lists keep no import backup in P6 (D-UI-P6-20), so backupId is
 * empty and the toast offers no Undo.
 */
export async function commitCoreImportAction(
  kind: unknown,
  csvText: unknown,
  mode: unknown,
  confirmedRemovals?: unknown,
): Promise<
  ActionResult<{
    added: number;
    updated: number;
    removed: number;
    backupId: string;
  }>
> {
  const res = await runAction(async (s) => {
    const counts = await commitCoreImport(
      s.ctx,
      kindOf(kind),
      textOf(csvText),
      modeOf(mode),
      removalsOf(confirmedRemovals),
      contentDeps(),
    );
    return { ...counts, backupId: "" };
  });
  if (res.ok) refreshHub();
  return res;
}

const FILE_NAMES: Readonly<Record<CoreListKind, string>> = {
  team_members: "team",
  services: "services",
};

export async function exportCoreCsvAction(
  kind: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction(async (s) => {
    const k = kindOf(kind);
    const csv = await exportCoreCsv(s.ctx, k);
    return { filename: `${FILE_NAMES[k]}.csv`, csv };
  });
}

/** The template holds no tenant data, but still needs a signed-in member. */
export async function templateCoreCsvAction(
  kind: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction(async () => {
    const k = kindOf(kind);
    return {
      filename: `${FILE_NAMES[k]}-template.csv`,
      csv: coreCsvTemplate(k),
    };
  });
}
