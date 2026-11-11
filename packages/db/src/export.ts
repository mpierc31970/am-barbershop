// Tenant export and isolated restore (TEN-10, TEN-12, TEN-13, LIFE-03; D171, D187;
// RESEARCH Pattern 8).
//
// Export: one JSON bundle per organization in the ObjectStore at
// [dev/]tenants/<org-id>/exports/<ts>.json. Every record goes through toSnapshot, so only
// approved fields leave the database (deny by default). end_users (export "never") are not
// exported: tenant customer logins come back through platform disaster recovery (LIFE-03).
//
// Restore: the bundle is untrusted input. It is validated completely before any write:
//   - shape (format, version, orgId), the org exists, every collection is an exportable
//     registry collection, every id is a PB id, every record belongs to bundle.orgId, and no
//     bundle id is a record of another organization (no takeover by id)
//   - only approved export fields are read back (fromSnapshotRecord)
// Then ONE PocketBase batch: org update, the "replace" collections' delete-extra requests in
// REVERSE registry order (a page_sections row goes before its required page; RESEARCH
// Pitfall 4, TEN-12), then upserts in registry order; "append-missing" collections
// (audit_log, content_flags) create only the rows that are gone (never delete history),
// and the "tenant.restore" audit row. A failing request rolls the whole batch back. More
// than MAX_BATCH requests is refused, never chunked (a chunked restore could half-apply).
// Autodate fields (created/updated) are not writable: restored rows get fresh timestamps, so
// a restored audit_log row carries meta.original_created and meta.restored_from (WR-03).
// The write paths' invariants hold on restore too (WR-02): the org keeps its current status
// unless the operator asks (restoreStatus), at least one owner with a live user must come
// back and no restored owner may already own another org (D286), and every org_hosts
// hostname must classify as a tenant host (D4).
import {
  authorizeStaff,
  classifyHost,
  InvalidContext,
  InvalidInput,
  NotFound,
  parsePlatformHosts,
  RestoreRejected,
} from "@cds/core";
import { EXPORT_RETENTION_DAYS } from "@cds/core/legal";
import { validateOrganizationDesign } from "@cds/core/theme";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { appendAudit, auditBody } from "./audit";
import { withSuperuser } from "./client";
import type { Invalidator } from "./content/ports";
import {
  assertPlatformContext,
  assertSystemContext,
  isOrgContext,
  isPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "./context";
import {
  addonCollectionsRegistered,
  allTenantCollections,
  rowFilterTemplate,
  type CollectionSpec,
} from "./registry";
import { writePlatformMeta } from "./platform-meta";
import { requirePermission } from "./repository";
import { fromSnapshotRecord, toSnapshot } from "./snapshot";
import {
  getObjectStore,
  tenantExportKey,
  tenantExportPrefix,
  type ObjectStore,
} from "./storage";
import { queueDesignWrite, themeTag } from "./theme";

export const BUNDLE_FORMAT = "cds-tenant-export";
export const BUNDLE_VERSION = 1;
/** PB batch maxRequests (migration 1790000160). A bigger restore is refused. */
export const MAX_BATCH = 1000;
/** TEN-12 retention of nightly exports, read from the one retention table (CONTEXT A4-Q1). */
export { EXPORT_RETENTION_DAYS };

export type TenantBundle = {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  orgId: string;
  createdAt: string;
  organization: Record<string, unknown>;
  collections: Record<string, Record<string, unknown>[]>;
};

export type ExportResult = { key: string; counts: Record<string, number> };

export type RestoreSkip = { collection: string; id: string; reason: string };
export type RestoreOptions = {
  /** Also restore organizations.status from the bundle. Default false: a held or disabled org stays so (WR-02). */
  restoreStatus?: boolean;
  /** Drops the org's cached theme after a restore that wrote its design (WR-01). */
  invalidator?: Invalidator;
};
export type RestoreResult = {
  restored: Record<string, number>;
  skipped: RestoreSkip[];
};

const ID_RE = /^[a-z0-9]{15}$/;
const AUTODATE = new Set(["created", "updated"]);
const CHUNK = 50;

export type Exportable = {
  name: string;
  spec: CollectionSpec & { export: readonly string[] };
};

/**
 * Every tenant collection with an export field list (deny by default), core + registered
 * add-ons, in registry order. Shared by the LIFE-03 export and the LIFE-04 data download
 * (11-40 choice 2), so both read the same allowlists.
 */
export function exportableCollections(): Exportable[] {
  const out: Exportable[] = [];
  // Core + registered add-on collections (RESEARCH Pattern 3, Pitfall 5).
  for (const [name, spec] of Object.entries(allTenantCollections()) as [
    string,
    CollectionSpec,
  ][]) {
    if (spec.export === "never" || spec.kind === "auth") continue;
    out.push({
      name,
      spec: spec as CollectionSpec & { export: readonly string[] },
    });
  }
  return out;
}

async function orgRecord(pb: PocketBase, orgId: string): Promise<RecordModel> {
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) throw new NotFound();
  try {
    return await pb.collection("organizations").getOne(orgId);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------
// Export

async function buildBundle(
  pb: PocketBase,
  orgId: string,
  now: Date,
): Promise<{ bundle: TenantBundle; counts: Record<string, number> }> {
  const org = await orgRecord(pb, orgId);
  const collections: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const { name, spec } of exportableCollections()) {
    // Row filter (12-04): internal support notes never enter the bundle.
    const rowFilter = rowFilterTemplate(spec);
    const rows = await pb.collection(name).getFullList({
      filter:
        pb.filter("organization = {:org}", { org: orgId }) +
        (rowFilter
          ? " && " + pb.filter(rowFilter.template, rowFilter.params)
          : ""),
      sort: "id",
    });
    collections[name] = rows.map((r) => toSnapshot(name, r));
    counts[name] = rows.length;
  }
  return {
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      orgId,
      createdAt: now.toISOString(),
      organization: toSnapshot("organizations", org),
      collections,
    },
    counts,
  };
}

async function writeExport(
  ctx: OrgContext | PlatformContext | SystemContext,
  orgId: string,
  store: ObjectStore,
  now: Date,
): Promise<ExportResult> {
  const { bundle, counts } = await withSuperuser((pb) =>
    buildBundle(pb, orgId, now),
  );
  const key = tenantExportKey(orgId, now);
  await store.put(key, JSON.stringify(bundle, null, 2), "application/json");
  await appendAudit(ctx, {
    action: "tenant.export",
    organization: orgId,
    targetCollection: "organizations",
    targetId: orgId,
    meta: { key, counts },
  });
  return { key, counts };
}

/**
 * Fail closed (ADDON-05, RESEARCH Pattern 3, T-05-16): an export taken before the add-on
 * collections are registered would silently omit add-on data.
 */
export function assertAddonCollectionsRegistered(): void {
  if (!addonCollectionsRegistered()) {
    throw new Error(
      "add-on collections are not registered: import @cds/addon-registry/server first",
    );
  }
}

/**
 * Export one organization to the ObjectStore (TEN-10). An org member must be that org's
 * owner (exports:run, D285); CDS staff need tenant_export (both staff roles). Audited.
 */
export async function exportTenant(
  ctx: OrgContext | PlatformContext,
  orgId: string,
  opts: { store?: ObjectStore; now?: Date } = {},
): Promise<ExportResult> {
  assertAddonCollectionsRegistered();
  if (isOrgContext(ctx)) {
    if (ctx.orgId !== orgId) throw new NotFound();
    requirePermission(ctx, "exports", "run");
  } else {
    assertPlatformContext(ctx);
    authorizeStaff(ctx.staffRole, "tenant_export");
  }
  return writeExport(
    ctx,
    orgId,
    opts.store ?? getObjectStore(),
    opts.now ?? new Date(),
  );
}

// ---------------------------------------------------------------------------------------
// Retention and the nightly job

const STAMP_RE = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

function exportTime(key: string, lastModified: Date): number {
  const m = STAMP_RE.exec(key);
  if (m) {
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
    if (Number.isFinite(t)) return t;
  }
  return lastModified.getTime();
}

/** Delete this org's exports older than `maxAgeDays` (by the key's timestamp). Returns deleted keys. */
export async function pruneExports(
  store: ObjectStore,
  orgId: string,
  now: Date,
  maxAgeDays = EXPORT_RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];
  for (const obj of await store.list(tenantExportPrefix(orgId))) {
    if (exportTime(obj.key, obj.lastModified) < cutoff) {
      await store.delete(obj.key);
      pruned.push(obj.key);
    }
  }
  return pruned;
}

export type NightlyResult = {
  exported: { orgId: string; key: string }[];
  pruned: string[];
  failed: { orgId: string; error: string }[];
};

/**
 * The nightly job (TEN-12): export EVERY organization, whatever its status (a held or
 * disabled tenant is still backed up, invariant 9), then prune its exports past 90 days.
 * The system context is minted here and nowhere else. One org failing does not stop the rest.
 */
export async function runNightlyExports(
  opts: { store?: ObjectStore; now?: Date } = {},
): Promise<NightlyResult> {
  assertAddonCollectionsRegistered();
  const ctx = mintSystemContext({ job: "nightly-export" });
  assertSystemContext(ctx);
  const store = opts.store ?? getObjectStore();
  const now = opts.now ?? new Date();
  const orgs = await listOrganizationIds();
  const result: NightlyResult = { exported: [], pruned: [], failed: [] };
  for (const orgId of orgs) {
    try {
      const { key } = await writeExport(ctx, orgId, store, now);
      result.exported.push({ orgId, key });
      result.pruned.push(...(await pruneExports(store, orgId, now)));
    } catch (err) {
      result.failed.push({ orgId, error: safeMessage(err) });
    }
  }
  // 13-40: monitor §4 `backups.tenant_exports_last_success` (check 6); only a clean run.
  if (result.failed.length === 0) {
    await writePlatformMeta(ctx, "job:exports:last_success", now.toISOString());
  }
  return result;
}

/** Every organization id, sorted (used by the nightly job and its dry run). */
export async function listOrganizationIds(): Promise<string[]> {
  return withSuperuser(async (pb) =>
    (
      await pb
        .collection("organizations")
        .getFullList({ fields: "id", sort: "id" })
    ).map((o) => o.id),
  );
}

function safeMessage(err: unknown): string {
  if (err instanceof ClientResponseError) return `database error ${err.status}`;
  if (err instanceof Error)
    return err.name === "Error" ? err.message : err.name;
  return "unknown error";
}

// ---------------------------------------------------------------------------------------
// Restore

type Row = Record<string, unknown> & { id: string };
type Parsed = {
  orgId: string;
  createdAt: string;
  organization: Record<string, unknown>;
  collections: Map<string, Row[]>;
};

function reject(why: string): never {
  throw new RestoreRejected(`bundle rejected: ${why}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure validation of the untrusted bundle (no database access). */
function parseBundle(input: unknown): Parsed {
  if (!isObj(input)) reject("not an object");
  if (input.format !== BUNDLE_FORMAT) reject("unknown format");
  if (input.version !== BUNDLE_VERSION) reject("unsupported version");
  const orgId = input.orgId;
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) reject("bad orgId");
  if (!isObj(input.organization) || input.organization.id !== orgId) {
    reject("organization record does not match orgId");
  }
  const organization = fromSnapshotRecord("organizations", input.organization);
  if (!isObj(input.collections)) reject("collections missing");
  const allowed = new Map(exportableCollections().map((e) => [e.name, e]));
  const collections = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(input.collections)) {
    if (!allowed.has(name)) reject(`${name} is not an exportable collection`);
    if (!Array.isArray(rows)) reject(`${name} is not a list`);
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const raw of rows as unknown[]) {
      if (!isObj(raw)) reject(`${name} row is not an object`);
      if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) {
        reject(`${name} row has a bad id`);
      }
      if (seen.has(raw.id)) reject(`${name} has a duplicate id`);
      seen.add(raw.id);
      if (raw.organization !== orgId) {
        reject(`${name} row belongs to another organization`);
      }
      const row = fromSnapshotRecord(name, raw) as Row;
      if (name === "org_hosts") {
        const cls =
          typeof row.hostname === "string"
            ? classifyHost(
                row.hostname,
                parsePlatformHosts(process.env.PLATFORM_HOSTS),
              )
            : ({ kind: "invalid" } as const);
        if (cls.kind !== "tenant")
          reject("org_hosts row has an invalid hostname");
        row.hostname = cls.host;
      }
      out.push(row);
    }
    collections.set(name, out);
  }
  const createdAt =
    typeof input.createdAt === "string" ? input.createdAt.slice(0, 64) : "";
  return { orgId, createdAt, organization, collections };
}

function writable(row: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!AUTODATE.has(k)) body[k] = v;
  }
  return body;
}

async function idsIn(
  pb: PocketBase,
  collection: string,
  ids: string[],
  extra?: { expr: string; params: Record<string, unknown> },
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const params: Record<string, unknown> = { ...(extra?.params ?? {}) };
    const ors = part.map((id, j) => {
      params[`i${j}`] = id;
      return `id = {:i${j}}`;
    });
    const expr = extra
      ? `(${ors.join(" || ")}) && ${extra.expr}`
      : ors.join(" || ");
    const rows = await pb
      .collection(collection)
      .getFullList({ filter: pb.filter(expr, params), fields: "id" });
    for (const r of rows) found.add(r.id);
  }
  return found;
}

/**
 * Every relation in a restored row must point at a record this organization will have after
 * the restore (deferred from 07-01, fixed in 07-15): the bundle's rows of the target collection
 * when the bundle carries it (the restore replaces that collection), else the org's current
 * rows. Relation fields are read from the live PB schema, so new collections are covered
 * without a list to maintain. Targets without an organization field (users, platform tables)
 * are guarded elsewhere (userRefs) or are global; the organization field itself is checked by
 * parseBundle. A tampered bundle can never link one org's row to another org's record.
 */
async function assertRelationsOwned(
  pb: PocketBase,
  orgId: string,
  collections: Map<string, Row[]>,
): Promise<void> {
  const schema = await pb.collections.getFullList({ fields: "id,name,fields" });
  const byId = new Map(schema.map((c) => [c.id, c]));
  const byName = new Map(schema.map((c) => [c.name, c]));
  const allowedCache = new Map<string, Set<string>>();
  const allowedIn = async (target: string): Promise<Set<string>> => {
    let set = allowedCache.get(target);
    if (set) return set;
    const bundleRows = collections.get(target);
    set = bundleRows
      ? new Set(bundleRows.map((r) => r.id))
      : new Set(
          (
            await pb.collection(target).getFullList({
              filter: pb.filter("organization = {:org}", { org: orgId }),
              fields: "id",
            })
          ).map((r) => r.id),
        );
    allowedCache.set(target, set);
    return set;
  };
  for (const [name, rows] of collections) {
    const fields = (byName.get(name)?.fields ?? []) as {
      name: string;
      type: string;
      collectionId?: string;
    }[];
    for (const f of fields) {
      if (f.type !== "relation" || f.name === "organization") continue;
      const target = byId.get(f.collectionId ?? "");
      if (!target || target.name === "organizations") continue;
      const tenantScoped = ((target.fields ?? []) as { name: string }[]).some(
        (tf) => tf.name === "organization",
      );
      if (!tenantScoped) continue;
      for (const r of rows) {
        const raw = r[f.name];
        const ids = (Array.isArray(raw) ? raw : [raw]).filter(
          (v): v is string => typeof v === "string" && v !== "",
        );
        if (ids.length === 0) continue;
        const allowed = await allowedIn(target.name);
        if (ids.some((id) => !allowed.has(id))) {
          reject(
            `${name}.${f.name} points at a record this organization will not have`,
          );
        }
      }
    }
  }
}

function userRefs(name: string, row: Row): string[] {
  const refs: string[] = [];
  const fields =
    name === "audit_log"
      ? ["actor", "impersonator"]
      : name === "contact_notes"
        ? ["author"]
        : ["user"];
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && v !== "") refs.push(v);
  }
  return refs;
}

type Planned =
  | {
      collection: string;
      op: "update";
      id: string;
      body: Record<string, unknown>;
    }
  | { collection: string; op: "upsert"; body: Record<string, unknown> }
  | { collection: string; op: "create"; body: Record<string, unknown> }
  | { collection: string; op: "delete"; id: string };

/**
 * Restore one organization from an export bundle (TEN-10, TEN-12). super_admin only.
 * Replaces only bundle.orgId's records, in one all-or-nothing PB batch; audit_log history is
 * never deleted (append-missing). Memberships of users that no longer exist are skipped
 * and reported (logins return through disaster recovery, LIFE-03).
 */
export async function restoreTenant(
  ctx: PlatformContext,
  bundle: unknown,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  if (!isPlatformContext(ctx)) {
    throw new InvalidContext("restore needs a platform (staff) context");
  }
  authorizeStaff(ctx.staffRole, "tenant_restore");
  const parsed = parseBundle(bundle);
  const { orgId } = parsed;

  let designWritten = false;
  const result = await withSuperuser(async (pb) => {
    const currentOrg = await orgRecord(pb, orgId).catch((err) => {
      if (err instanceof NotFound) reject("organization does not exist");
      throw err;
    });

    const plan: Planned[] = [];
    const restored: Record<string, number> = {};
    const skipped: RestoreSkip[] = [];
    const owners: string[] = [];

    const orgBody = writable(parsed.organization);
    delete orgBody.id;
    if (!opts.restoreStatus) delete orgBody.status;
    // The design never rides on the plain org update: it goes through the one design writer
    // (queueDesignWrite: validated, audited, theme cache dropped; WR-01). A bundle without
    // the field leaves the current theme alone; null restores "no theme" (neutral preset).
    const hasDesign = Object.prototype.hasOwnProperty.call(orgBody, "design");
    const bundleDesign: unknown = hasDesign
      ? (orgBody.design ?? null)
      : undefined;
    delete orgBody.design;
    const currentDesign: unknown = currentOrg.design ?? null;
    let writeDesign =
      bundleDesign !== undefined &&
      !(bundleDesign === null && currentDesign === null);
    if (writeDesign && bundleDesign !== null) {
      try {
        validateOrganizationDesign(bundleDesign);
      } catch (err) {
        if (!(err instanceof InvalidInput)) throw err;
        // A tampered or older-schema design is never stored: the current theme stays.
        writeDesign = false;
        skipped.push({
          collection: "organizations",
          id: orgId,
          reason: "design failed validation; the current theme is kept",
        });
      }
    }
    plan.push({
      collection: "organizations",
      op: "update",
      id: orgId,
      body: orgBody,
    });

    // Users referenced by the bundle that still exist.
    const refs = new Set<string>();
    for (const [name, rows] of parsed.collections) {
      for (const r of rows) for (const u of userRefs(name, r)) refs.add(u);
    }
    const liveUsers = await idsIn(pb, "users", [...refs]);
    // CDS staff reach a tenant only by audited impersonation, never a membership (CR-03,
    // invariant 10): a membership of a user who has since become staff is not restored.
    const nonStaff = await idsIn(pb, "users", [...refs], {
      expr: "staff_role = ''",
      params: {},
    });

    // RESEARCH Pitfall 4 / TEN-12: page_sections.page is a required relation. Deletes are
    // collected per collection and sent in REVERSE registry order (sections before their
    // pages), then every upsert/create in registry order (pages before their sections).
    const deletes: Planned[][] = [];
    const upserts: Planned[] = [];
    // WR-A01: memberships this restore will not have (skipped and not live). A bundled
    // contact list that still names one as its owner gets the link cleared, never a
    // relation failure that rejects the whole restore.
    const droppedMemberships = new Set<string>();

    // Every restored section must point at a page this org will have after the restore:
    // the bundle's pages when it carries them, else the org's current pages. Never a page
    // of another organization (T-03-09).
    const bundlePages = parsed.collections.get("pages");
    const allowedPages = bundlePages
      ? new Set(bundlePages.map((r) => r.id))
      : new Set(
          (
            await pb.collection("pages").getFullList({
              filter: pb.filter("organization = {:org}", { org: orgId }),
              fields: "id",
            })
          ).map((r) => r.id),
        );
    for (const r of parsed.collections.get("page_sections") ?? []) {
      if (typeof r.page !== "string" || !allowedPages.has(r.page)) {
        reject(
          "page_sections row points at a page this organization will not have",
        );
      }
    }

    // Every other relation too (form_submissions.form/page/contact, contact_* links, team
    // photos, ...): never a record of another organization (07-15, deferred from 07-01).
    await assertRelationsOwned(pb, orgId, parsed.collections);

    for (const { name, spec } of exportableCollections()) {
      const collectionDeletes: Planned[] = [];
      deletes.push(collectionDeletes);
      // AGR-05 / RESEARCH Pitfall 2: append-only legal evidence is never deleted and never
      // created by a restore; bundle rows are ignored (the append-only hook would refuse
      // the delete and abort the whole batch).
      if (spec.restore === "skip") {
        skipped.push({
          collection: name,
          id: "",
          reason: "append-only evidence",
        });
        continue;
      }
      const rows = parsed.collections.get(name);
      if (!rows) {
        skipped.push({ collection: name, id: "", reason: "not in bundle" });
        continue;
      }
      const current = await pb.collection(name).getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        fields: "id",
      });
      const currentIds = new Set(current.map((r) => r.id));
      // No takeover by id: a bundle id that exists must already be this org's.
      const foreign = await idsIn(
        pb,
        name,
        rows.map((r) => r.id).filter((id) => !currentIds.has(id)),
      );
      if (foreign.size > 0)
        reject(`${name} id belongs to another organization`);

      let count = 0;
      if ((spec.restore ?? "replace") === "append-missing") {
        for (const r of rows) {
          if (currentIds.has(r.id)) continue;
          const body = writable(r);
          // created is an autodate: PB stamps "now". Keep the original time and mark the
          // row as restored, so it never passes for a current event (WR-03).
          const meta = isObj(r.meta)
            ? r.meta
            : r.meta == null
              ? {}
              : { value: r.meta };
          body.meta = {
            ...meta,
            original_created: typeof r.created === "string" ? r.created : "",
            restored_from: parsed.createdAt,
          };
          for (const f of ["actor", "impersonator"]) {
            if (
              typeof body[f] === "string" &&
              body[f] &&
              !liveUsers.has(body[f] as string)
            ) {
              body[f] = "";
            }
          }
          upserts.push({ collection: name, op: "create", body });
          count++;
        }
      } else {
        const keep = new Set(rows.map((r) => r.id));
        for (const id of currentIds) {
          if (!keep.has(id)) {
            collectionDeletes.push({ collection: name, op: "delete", id });
          }
        }
        for (const r of rows) {
          const dangling = userRefs(name, r).some((u) => !liveUsers.has(u));
          if (name === "memberships" && dangling) {
            skipped.push({
              collection: name,
              id: r.id,
              reason: "user no longer exists",
            });
            if (!currentIds.has(r.id)) droppedMemberships.add(r.id);
            continue;
          }
          if (
            name === "memberships" &&
            userRefs(name, r).some((u) => !nonStaff.has(u))
          ) {
            skipped.push({
              collection: name,
              id: r.id,
              reason: "user is CDS staff",
            });
            if (!currentIds.has(r.id)) droppedMemberships.add(r.id);
            continue;
          }
          if (name === "memberships" && r.role === "owner") {
            owners.push(String(r.user));
          }
          const body = writable(r);
          // WR-A01: a note whose author account is gone keeps its text, not the dead link.
          if (name === "contact_notes" && dangling) body.author = "";
          if (
            name === "contact_lists" &&
            typeof body.owner_member === "string" &&
            droppedMemberships.has(body.owner_member)
          ) {
            body.owner_member = "";
          }
          upserts.push({ collection: name, op: "upsert", body });
          count++;
        }
      }
      restored[name] = count;
    }
    // CR-A01: contact_events is append-missing (history is never dropped), but its contact
    // relation is required and non-cascading, so PB refuses to delete a contact that still
    // has events. The events of a contact this restore removes go with it, matching
    // deleteContact's erasure. Pushed last, they run first after the reverse below.
    const doomedContacts = new Set(
      deletes
        .flat()
        .filter((p) => p.collection === "contacts" && p.op === "delete")
        .map((p) => (p as { id: string }).id),
    );
    if (doomedContacts.size > 0) {
      const events = await pb.collection("contact_events").getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        fields: "id,contact",
      });
      deletes.push(
        events
          .filter((e) => doomedContacts.has(String(e.contact)))
          .map((e) => ({
            collection: "contact_events",
            op: "delete" as const,
            id: e.id,
          })),
      );
    }
    plan.push(...deletes.reverse().flat(), ...upserts);

    // LastOwner and one owned organization per user (D286), checked before any write.
    if (parsed.collections.has("memberships")) {
      if (owners.length === 0) {
        reject("the restored organization would have no owner");
      }
      for (const owner of owners) {
        const elsewhere = await pb.collection("memberships").getList(1, 1, {
          filter: pb.filter(
            "user = {:user} && role = 'owner' && organization != {:org}",
            { user: owner, org: orgId },
          ),
          fields: "id",
        });
        if (elsewhere.totalItems > 0) {
          reject("an owner in the bundle already owns another organization");
        }
      }
    }

    // +1 for the tenant.restore audit row, +2 for the design write and its audit row.
    const total = plan.length + 1 + (writeDesign ? 2 : 0);
    if (total > MAX_BATCH) {
      reject(
        `too large: ${total} requests exceed the ${MAX_BATCH}-request batch limit`,
      );
    }

    const batch = pb.createBatch();
    for (const p of plan) {
      const col = batch.collection(p.collection);
      if (p.op === "update") col.update(p.id, p.body);
      else if (p.op === "upsert") col.upsert(p.body);
      else if (p.op === "create") col.create(p.body);
      else col.delete(p.id);
    }
    if (writeDesign) {
      queueDesignWrite(
        batch,
        ctx,
        orgId,
        currentDesign,
        bundleDesign,
        "restore",
      );
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "tenant.restore",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { restored, skipped: skipped.length },
      }),
    );
    try {
      await batch.send();
    } catch (err) {
      if (err instanceof ClientResponseError) {
        throw new RestoreRejected(
          `restore failed in the database (HTTP ${err.status}); nothing was changed`,
        );
      }
      throw err;
    }
    designWritten = writeDesign;
    return { restored, skipped };
  });
  if (designWritten) opts.invalidator?.invalidate([themeTag(orgId)]);
  return result;
}
