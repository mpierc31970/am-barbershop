// Add-on JSON backups (ADDON-14; D126, D187; CONTEXT A5-Q4; RESEARCH Pattern 8; T-05-39,
// T-05-40, T-05-41). A backup is one JSON object in the ObjectStore, never a database row:
//   tenants/<org>/backups/<add-on>/<timestamp>.json
// holding every collection the add-on's manifest declares, serialized through toSnapshot (the
// D187 approved field lists, deny by default). Only the newest ADDON_BACKUPS_KEPT are kept.
//
// Restore is the undo of an import. It accepts only a backup id (the key's timestamp) that
// is LISTED under the caller's own org prefix, never a caller-supplied key; every row must
// pass fromSnapshotRecord and belong to ctx.orgId. It writes a "before-restore" backup first,
// then applies one PB batch (deletes, updates, creates keeping ids) plus the audit row.
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { auditBody, type AuditEvent } from "../audit";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { recordContentFlag } from "../content/flags";
import { withOrgLock } from "../content/lock";
import { addonTag, liveTag } from "../content/ports";
import { screen, type ScanOutcome } from "../content/screen";
import type { Op } from "../content/shared";
import { mapError, requirePermission } from "../repository";
import { fromSnapshotRecord, toSnapshot } from "../snapshot";
import {
  getObjectStore,
  tenantAddonBackupKey,
  tenantAddonBackupPrefix,
  type ObjectStore,
} from "../storage";
import { assertAddonActive } from "./entitlements";
import { cleanValues } from "./records";
import type { AddonDeps } from "./types";

export const ADDON_BACKUP_FORMAT = "cds-addon-backup";
export const ADDON_BACKUP_VERSION = 1;
export const ADDON_BACKUPS_KEPT = 3;
/** PB batch maxRequests (migration 1790000310). A bigger import or restore is refused. */
export const MAX_ADDON_BATCH = 5000;

export const TOO_MANY_CHANGES_COPY =
  "This changes too many records at once. Split the file and import each part.";

export type AddonBackupReason = "before-import" | "manual" | "before-restore";
const REASONS: readonly AddonBackupReason[] = [
  "before-import",
  "manual",
  "before-restore",
];

export type AddonBackupSummary = {
  /** The key's timestamp stamp, e.g. 2026-09-28T10-15-00-123Z. */
  id: string;
  reason: AddonBackupReason;
  createdAt: string;
  count: number;
};

export type AddonBackupBody = {
  format: typeof ADDON_BACKUP_FORMAT;
  version: typeof ADDON_BACKUP_VERSION;
  addon: string;
  reason: AddonBackupReason;
  createdAt: string;
  collections: Record<string, Record<string, unknown>[]>;
};

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const KEY_STAMP_RE = /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;
const ID_RE = /^[a-z0-9]{15}$/;
const AUTODATE = new Set(["created", "updated"]);

// ---------------------------------------------------------------------------------------
// Shared internals (also used by import.ts; never exported from index.ts)

export function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** addon:<slug> read/write; renters are refused (add-on records are not owner-scoped). */
export function checkAddonAccess(
  ctx: OrgContext,
  slug: string,
  action: "read" | "write",
): void {
  assertOrgContext(ctx);
  requirePermission(ctx, `addon:${slug}`, action);
  if (ctx.role === "renter") {
    throw new Forbidden("renter access needs an owner-scoped collection");
  }
}

export function manifestOf(deps: AddonDeps, slug: unknown): AddonManifest {
  const manifest = deps.addons.get(slug);
  if (!manifest) throw new NotFound();
  return manifest;
}

export function addonLockKey(orgId: string): string {
  return `addons:${orgId}`;
}

export function storeOf(deps: AddonDeps): ObjectStore {
  return deps.store ?? getObjectStore();
}

export function nowOf(deps: AddonDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/** Writes plus their audit_log row, in one PB batch (all-or-nothing, T-05-38, T-05-41). */
export async function sendAudited(
  pb: PocketBase,
  ctx: OrgContext,
  ops: readonly Op[],
  event: AuditEvent,
): Promise<void> {
  if (ops.length + 1 > MAX_ADDON_BATCH) {
    throw new InvalidInput(TOO_MANY_CHANGES_COPY);
  }
  const batch = pb.createBatch();
  for (const w of ops) {
    const col = batch.collection(w.collection);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
  }
  batch.collection("audit_log").create(auditBody(ctx, event));
  await batch.send();
}

/** Every row of one collection for the org, sorted by id (deterministic snapshots). */
export async function orgRows(
  pb: PocketBase,
  orgId: string,
  collection: string,
  sort = "id",
): Promise<Record<string, unknown>[]> {
  const rows = await pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort,
  });
  return rows as unknown as Record<string, unknown>[];
}

type BackupEntry = { key: string; id: string; time: number };

function stampTime(stamp: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(
    stamp,
  );
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

function stampOf(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/** Backup objects under the org's own prefix, newest first. */
async function backupEntries(
  store: ObjectStore,
  orgId: string,
  slug: string,
): Promise<BackupEntry[]> {
  const prefix = tenantAddonBackupPrefix(orgId, slug);
  const out: BackupEntry[] = [];
  for (const obj of await store.list(prefix)) {
    const rest = obj.key.slice(prefix.length);
    const m = KEY_STAMP_RE.exec(rest);
    if (!m || rest !== `${m[1]}.json`) continue;
    const time = stampTime(m[1]!);
    if (!Number.isFinite(time)) continue;
    out.push({ key: obj.key, id: m[1]!, time });
  }
  return out.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readBody(
  store: ObjectStore,
  key: string,
): Promise<Record<string, unknown> | null> {
  const bytes = await store.get(key);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isObj(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summaryOf(
  entry: BackupEntry,
  body: Record<string, unknown>,
  slug: string,
): AddonBackupSummary | null {
  if (
    body.format !== ADDON_BACKUP_FORMAT ||
    body.version !== ADDON_BACKUP_VERSION ||
    body.addon !== slug ||
    !isObj(body.collections)
  ) {
    return null;
  }
  const reason = REASONS.includes(body.reason as AddonBackupReason)
    ? (body.reason as AddonBackupReason)
    : "manual";
  let count = 0;
  for (const rows of Object.values(body.collections)) {
    if (Array.isArray(rows)) count += rows.length;
  }
  return {
    id: entry.id,
    reason,
    createdAt: new Date(entry.time).toISOString(),
    count,
  };
}

/** The newest ADDON_BACKUPS_KEPT readable backups, with their keys. */
async function listed(
  store: ObjectStore,
  orgId: string,
  slug: string,
): Promise<(AddonBackupSummary & { key: string })[]> {
  const out: (AddonBackupSummary & { key: string })[] = [];
  for (const entry of await backupEntries(store, orgId, slug)) {
    if (out.length >= ADDON_BACKUPS_KEPT) break;
    const body = await readBody(store, entry.key);
    const summary = body ? summaryOf(entry, body, slug) : null;
    if (summary) out.push({ ...summary, key: entry.key });
  }
  return out;
}

/**
 * Snapshot every declared collection of the add-on for the org and write it (internal:
 * the caller holds the addons lock and has checked access). Never overwrites a backup
 * written in the same millisecond: the stamp moves forward instead.
 */
export async function writeAddonBackup(
  pb: PocketBase,
  ctx: OrgContext,
  manifest: AddonManifest,
  store: ObjectStore,
  now: Date,
  reason: AddonBackupReason,
): Promise<AddonBackupSummary> {
  const collections: Record<string, Record<string, unknown>[]> = {};
  let count = 0;
  for (const name of Object.keys(manifest.collections).sort()) {
    const rows = await orgRows(pb, ctx.orgId, name);
    collections[name] = rows.map((r) => toSnapshot(name, r));
    count += rows.length;
  }
  const taken = new Set(
    (await backupEntries(store, ctx.orgId, manifest.slug)).map((e) => e.id),
  );
  let at = now;
  while (taken.has(stampOf(at))) at = new Date(at.getTime() + 1);
  const body: AddonBackupBody = {
    format: ADDON_BACKUP_FORMAT,
    version: ADDON_BACKUP_VERSION,
    addon: manifest.slug,
    reason,
    createdAt: at.toISOString(),
    collections,
  };
  await store.put(
    tenantAddonBackupKey(ctx.orgId, manifest.slug, at),
    JSON.stringify(body, null, 2),
    "application/json",
  );
  return { id: stampOf(at), reason, createdAt: at.toISOString(), count };
}

/** Keep only the newest ADDON_BACKUPS_KEPT backups of the add-on. Returns deleted keys. */
export async function pruneAddonBackups(
  store: ObjectStore,
  orgId: string,
  slug: string,
): Promise<string[]> {
  const pruned: string[] = [];
  const entries = await backupEntries(store, orgId, slug);
  for (const entry of entries.slice(ADDON_BACKUPS_KEPT)) {
    await store.delete(entry.key);
    pruned.push(entry.key);
  }
  return pruned;
}

// ---------------------------------------------------------------------------------------
// Public API

/** The add-on's backups, newest first, at most ADDON_BACKUPS_KEPT (addon:<slug> read). */
export async function listAddonBackups(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
): Promise<AddonBackupSummary[]> {
  checkAddonAccess(ctx, slug, "read");
  const manifest = manifestOf(deps, slug);
  const rows = await listed(storeOf(deps), ctx.orgId, manifest.slug);
  return rows.map(({ id, reason, createdAt, count }) => ({
    id,
    reason,
    createdAt,
    count,
  }));
}

/**
 * "Save a backup now" (addon:<slug> write). Allowed while the add-on is off too: a backup
 * only reads retained data (invariant 9). Prunes to the newest ADDON_BACKUPS_KEPT.
 */
export async function saveAddonBackup(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  reason: AddonBackupReason = "manual",
): Promise<AddonBackupSummary> {
  checkAddonAccess(ctx, slug, "write");
  const manifest = manifestOf(deps, slug);
  if (!REASONS.includes(reason))
    throw new InvalidInput("unknown backup reason");
  const store = storeOf(deps);
  return withOrgLock(addonLockKey(ctx.orgId), () =>
    pbRun(async (pb) => {
      const summary = await writeAddonBackup(
        pb,
        ctx,
        manifest,
        store,
        nowOf(deps),
        reason,
      );
      await pruneAddonBackups(store, ctx.orgId, manifest.slug);
      return summary;
    }),
  );
}

type Row = Record<string, unknown> & { id: string };

/** Pure validation of a stored backup body against the manifest and the caller's org. */
function parseBackup(
  body: Record<string, unknown> | null,
  manifest: AddonManifest,
  orgId: string,
): Map<string, Row[]> {
  const bad = (why: string): never => {
    throw new InvalidInput(`That backup can't be restored (${why}).`);
  };
  if (!body) return bad("unreadable");
  if (body.format !== ADDON_BACKUP_FORMAT) bad("unknown format");
  if (body.version !== ADDON_BACKUP_VERSION) bad("unsupported version");
  if (body.addon !== manifest.slug) bad("another add-on");
  if (!isObj(body.collections)) bad("no collections");
  const out = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(
    body.collections as Record<string, unknown>,
  )) {
    if (!Object.hasOwn(manifest.collections, name)) bad(`unknown ${name}`);
    if (!Array.isArray(rows)) bad(`${name} is not a list`);
    const seen = new Set<string>();
    const parsed: Row[] = [];
    for (const raw of rows as unknown[]) {
      if (!isObj(raw)) bad(`${name} row is not an object`);
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "string" || !ID_RE.test(r.id)) bad(`${name} id`);
      if (seen.has(r.id as string)) bad(`${name} duplicate id`);
      seen.add(r.id as string);
      if (r.organization !== orgId) bad("another organization");
      parsed.push(fromSnapshotRecord(name, r) as Row);
    }
    out.set(name, parsed);
  }
  return out;
}

function writable(row: Row, orgId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "id" && !AUTODATE.has(k)) body[k] = v;
  }
  body.organization = orgId;
  return body;
}

/**
 * Restore one listed backup (addon:<slug> write, add-on active). The records of every
 * collection in the backup end up exactly as they were: current rows absent from it are
 * deleted, rows that exist are updated, the rest are created with their original ids.
 *
 * Restore never bypasses the content scan (A-WR-02, D270): every row of a collection with
 * record rules is screened like a save; a held row comes back hidden (is_published false)
 * and every non-clean row gets a flag after the batch commits, exactly as an import does.
 * The add-on's validator is not re-run: stored rows carry PocketBase zero values (a blank
 * rating reads back as 0) that the validator refuses by design, and the fields are already
 * limited to the approved export list by fromSnapshotRecord.
 */
export async function restoreAddonBackup(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  backupId: string,
): Promise<{ restored: number }> {
  checkAddonAccess(ctx, slug, "write");
  const manifest = manifestOf(deps, slug);
  if (typeof backupId !== "string" || !STAMP_RE.test(backupId)) {
    throw new NotFound();
  }
  const store = storeOf(deps);
  const result = await withOrgLock(addonLockKey(ctx.orgId), () =>
    pbRun(async (pb) => {
      await assertAddonActive(pb, ctx.orgId, manifest);
      // Only a backup listed under THIS org's prefix (T-05-40); never a caller key.
      const hit = (await listed(store, ctx.orgId, manifest.slug)).find(
        (b) => b.id === backupId,
      );
      if (!hit) throw new NotFound();
      const backup = parseBackup(
        await readBody(store, hit.key),
        manifest,
        ctx.orgId,
      );

      const ops: Op[] = [];
      const screened: {
        collection: string;
        id: string;
        outcome: ScanOutcome;
      }[] = [];
      let restored = 0;
      let removed = 0;
      for (const [name, rows] of backup) {
        const spec = Object.hasOwn(manifest.records, name)
          ? manifest.records[name]
          : undefined;
        const current = new Set(
          (
            await pb.collection(name).getFullList({
              filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
              fields: "id",
            })
          ).map((r) => r.id),
        );
        const keep = new Set(rows.map((r) => r.id));
        for (const id of [...current].sort()) {
          if (!keep.has(id)) {
            ops.push({ collection: name, op: "delete", id });
            removed++;
          }
        }
        for (const row of rows) {
          const body = writable(row, ctx.orgId);
          if (spec) {
            const values = cleanValues(body);
            const outcome = await screen(
              ctx,
              deps,
              spec.textsOf(values),
              spec.urlsOf(values),
            );
            if (outcome.verdict === "held") body.is_published = false;
            screened.push({ collection: name, id: row.id, outcome });
          }
          ops.push(
            current.has(row.id)
              ? { collection: name, op: "update", id: row.id, body }
              : { collection: name, op: "create", id: row.id, body },
          );
          restored++;
        }
      }
      if (ops.length + 1 > MAX_ADDON_BATCH) {
        throw new InvalidInput(TOO_MANY_CHANGES_COPY);
      }

      const before = await writeAddonBackup(
        pb,
        ctx,
        manifest,
        store,
        nowOf(deps),
        "before-restore",
      );
      await sendAudited(pb, ctx, ops, {
        action: "addon.backup.restore",
        targetCollection: Object.keys(manifest.collections).sort()[0] ?? "",
        targetId: "",
        meta: {
          addon: manifest.slug,
          backupId,
          beforeRestoreId: before.id,
          restored,
          removed,
        },
      });
      await pruneAddonBackups(store, ctx.orgId, manifest.slug);
      return { restored, screened };
    }),
  );
  // Flags after the commit (the rows exist now).
  for (const s of result.screened) {
    if (s.outcome.verdict === "clean") continue;
    await recordContentFlag(ctx, {
      targetCollection: s.collection,
      targetId: s.id,
      verdict: s.outcome.verdict,
      reasons: s.outcome.reasons,
    });
  }
  deps.invalidator.invalidate([
    addonTag(ctx.orgId, manifest.slug),
    liveTag(ctx.orgId),
  ]);
  return { restored: result.restored };
}
