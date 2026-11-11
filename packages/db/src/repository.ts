// The tenant chokepoint (Invariant 1; TEN-02, TEN-03, TEN-08, TEN-14; D5, D98, D285).
//
// PocketBase writes go through a superuser client, so PB API rules protect nobody: this file
// is the only tenant isolation there is. Every method:
//   1. assertOrgContext(ctx)        a cast or copied context throws InvalidContext
//   2. requirePermission(...)       the @cds/core matrix (read / write)
//   3. scopes to ctx.orgId          reads filter `organization = {:org}` with bound params;
//                                   foreign and absent ids both throw NotFound (no oracle)
// Renter contexts (and every context on a `personal` collection, P11 Pitfall 6) are
// narrowed to rows whose registry ownerField equals their actor.
// Writes under an impersonated context go in one PB batch with their audit_log row.
// Filters are built only with pb.filter(expr, params); values are never concatenated.
import { randomBytes, randomInt } from "node:crypto";
import {
  authorize,
  Forbidden,
  InvalidInput,
  classifyHost,
  isReservedHost,
  parsePlatformHosts,
  NotFound,
  type Action,
} from "@cds/core";
import PocketBase, {
  ClientResponseError,
  type ListResult,
  type RecordModel,
} from "pocketbase";
import { auditBody, clampInt } from "./audit";
import { withSuperuser } from "./client";
import { assertOrgContext, type OrgContext } from "./context";
import {
  getCollectionSpec,
  rowFilterTemplate,
  type CollectionSpec,
  type TENANT_COLLECTIONS,
} from "./registry";

export type ListOptions = {
  /**
   * A PB filter over the collection's filterable fields only (registry `filterable`, else
   * the export list). Values go in `params` as `{:name}` placeholders. No `@` macros, no
   * relation paths, no modifiers, no functions (CR-02).
   */
  filter?: string;
  params?: Record<string, unknown>;
  sort?: string;
  page?: number;
  perPage?: number;
};

export type RecordData = Record<string, unknown>;

export type ReadRepo = {
  get(ctx: OrgContext, id: string): Promise<RecordModel>;
  list(ctx: OrgContext, opts?: ListOptions): Promise<ListResult<RecordModel>>;
};

export type WriteRepo = ReadRepo & {
  create(ctx: OrgContext, data: RecordData): Promise<RecordModel>;
  update(ctx: OrgContext, id: string, data: RecordData): Promise<RecordModel>;
  delete(ctx: OrgContext, id: string): Promise<void>;
};

type Registry = typeof TENANT_COLLECTIONS;
export type RepoFor<N extends keyof Registry> =
  Registry[N]["writes"] extends "generic" ? WriteRepo : ReadRepo;

/** Assert a minted context, then check the permission matrix (throws Forbidden / ImpersonationDenied). */
export function requirePermission(
  ctx: OrgContext,
  feature: string,
  action: Action,
): void {
  assertOrgContext(ctx);
  authorize(ctx, feature, action);
}

const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;
/** A writable record key: letters, digits, underscore. Rejects PB modifiers (`x+`, `+x`, `x-`, `x:y`). */
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SYSTEM_FIELDS = [
  "id",
  "created",
  "updated",
  "collectionId",
  "collectionName",
];
const AUTH_SECRET_FIELDS = [
  "password",
  "passwordConfirm",
  "oldPassword",
  "tokenKey",
];

/** A PB-compatible 15-char record id, so an audit row can reference a record before it exists. */
export function newRecordId(): string {
  let id = "";
  for (let i = 0; i < 15; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

function ownerFieldOf(spec: CollectionSpec): string | undefined {
  if (!spec.ownerField) return undefined;
  if (!FIELD_NAME.test(spec.ownerField)) {
    throw new Error("registry ownerField is not a plain field name");
  }
  return spec.ownerField;
}

/** Renter scope: the owner field to pin, or Forbidden when the collection has none (fail closed). */
function renterField(
  ctx: OrgContext,
  spec: CollectionSpec,
): string | undefined {
  // Per-person collections (P11 Pitfall 6) pin every org context to its own rows.
  if (ctx.role !== "renter" && !spec.personal) return undefined;
  const field = ownerFieldOf(spec);
  if (!field)
    throw new Forbidden(
      spec.personal
        ? "a personal collection needs an owner field"
        : "renter access needs an owner-scoped collection",
    );
  return field;
}

/**
 * Fields a caller may filter and sort on: the registry `filterable` list, else the approved
 * export list (D187), else none. Never a hidden, secret or auth field.
 */
export function filterableFields(spec: CollectionSpec): readonly string[] {
  if (spec.filterable) return spec.filterable;
  return Array.isArray(spec.export) ? spec.export : [];
}

// Filter operators PocketBase accepts, longest first so `!=` wins over `!`.
const FILTER_OPS = [
  "?!~",
  "?!=",
  "?>=",
  "?<=",
  "!=",
  ">=",
  "<=",
  "!~",
  "?=",
  "?>",
  "?<",
  "?~",
  "&&",
  "||",
  "=",
  ">",
  "<",
  "~",
] as const;
const FILTER_LITERALS = new Set(["true", "false", "null"]);
const FILTER_DENIED = "filter may only use the collection's filterable fields";

/**
 * Validate a caller filter (after bound params are substituted) with a strict tokenizer
 * (CR-02). The superuser client would otherwise evaluate `@collection.*`, `@request.*`,
 * relation paths (`user.password`), back-relations (`x_via_y`), modifiers (`:lower`),
 * functions and hidden fields (`tokenKey`, `password`), which is a cross-tenant and
 * secret-hash oracle through the row count. Allowed: quoted strings, numbers, the literals
 * true/false/null, comparison and logical operators, balanced parentheses, and bare
 * identifiers from the allowlist. Everything else throws InvalidInput.
 */
export function assertSafeFilter(
  filter: string,
  allowed: readonly string[],
): void {
  let depth = 0;
  let i = 0;
  const n = filter.length;
  while (i < n) {
    const ch = filter[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (filter[j] === "\\") j += 2;
        else if (filter[j] === ch) {
          closed = true;
          break;
        } else j++;
      }
      if (!closed)
        throw new InvalidInput("filter must be a balanced expression");
      i = j + 1;
      continue;
    }
    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      if (--depth < 0)
        throw new InvalidInput("filter must be a balanced expression");
      i++;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(filter.slice(i));
    if (num) {
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(filter.slice(i));
    if (ident) {
      const word = ident[0];
      i += word.length;
      // A path, modifier or call continues the identifier: `a.b`, `a:lower`, `fn(`.
      const next = filter.slice(i).trimStart()[0];
      if (filter[i] === "." || filter[i] === ":" || next === "(") {
        throw new InvalidInput(FILTER_DENIED);
      }
      if (FILTER_LITERALS.has(word)) continue;
      if (!allowed.includes(word)) throw new InvalidInput(FILTER_DENIED);
      continue;
    }
    const op = FILTER_OPS.find((o) => filter.startsWith(o, i));
    if (op) {
      i += op.length;
      continue;
    }
    // `@`, `.`, `/` (comments), `[`, `,` and anything else.
    throw new InvalidInput(FILTER_DENIED);
  }
  if (depth !== 0) {
    throw new InvalidInput("filter must be a balanced expression");
  }
}

/** Sort terms must be allowlisted plain field names with an optional +/- prefix (CR-02). */
export function assertSafeSort(sort: string, allowed: readonly string[]): void {
  for (const term of sort.split(",")) {
    const m = /^[-+]?([a-z_][a-z0-9_]*)$/.exec(term);
    if (!m || !allowed.includes(m[1]!)) {
      throw new InvalidInput("sort must be a list of filterable field names");
    }
  }
}

function scopeFilter(
  pb: PocketBase,
  ctx: OrgContext,
  spec: CollectionSpec,
  extra?: { filter?: string; params?: Record<string, unknown> },
): string {
  let filter = pb.filter("organization = {:org}", { org: ctx.orgId });
  const owner = renterField(ctx, spec);
  if (owner) {
    filter += " && " + pb.filter(owner + " = {:actor}", { actor: ctx.actor });
  }
  // Row-level deny by default (12-04): e.g. support_messages internal notes never reach a
  // generic read, whatever the caller's own filter says.
  const rowFilter = rowFilterTemplate(spec);
  if (rowFilter) {
    filter += " && " + pb.filter(rowFilter.template, rowFilter.params);
  }
  if (extra?.filter !== undefined && extra.filter !== "") {
    if (typeof extra.filter !== "string") {
      throw new InvalidInput("filter must be a string");
    }
    const bound = pb.filter(extra.filter, extra.params ?? {});
    assertSafeFilter(bound, filterableFields(spec));
    filter += " && (" + bound + ")";
  }
  return filter;
}

export function mapError(err: unknown): never {
  if (err instanceof ClientResponseError) {
    if (err.status === 404) throw new NotFound();
    if (err.status === 400) {
      const data = (err.response?.data ?? {}) as Record<string, unknown>;
      const fields = Object.keys(data).join(", ");
      throw new InvalidInput(
        fields ? `validation failed: ${fields}` : "request rejected",
      );
    }
  }
  throw err;
}

export function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-z0-9]{1,64}$/i.test(id))
    throw new NotFound();
}

/**
 * Copy caller data, keeping plain field names only. PocketBase treats `field+`, `+field`,
 * `field-` and `field:modifier` keys as modifiers (on a single relation `+` REPLACES the
 * value), so a modifier key would slip past checkOrg and the renter guard. Anything that is
 * not a plain field name is rejected before any other check (CR-01).
 */
function cleanData(spec: CollectionSpec, data: RecordData): RecordData {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new InvalidInput("record data must be an object");
  }
  const out: RecordData = {};
  for (const [k, v] of Object.entries(data)) {
    if (!PLAIN_KEY.test(k))
      throw new InvalidInput(`field ${k} is not writable`);
    if (SYSTEM_FIELDS.includes(k)) continue;
    if (spec.kind === "auth" && AUTH_SECRET_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function checkOrg(ctx: OrgContext, data: RecordData): void {
  if ("organization" in data && data.organization !== ctx.orgId) {
    throw new InvalidInput(
      "organization cannot be set to another organization",
    );
  }
}

/**
 * org_hosts hostnames are stored normalized and must classify as a tenant host (D4): an IP
 * literal, a malformed host or a platform host can never be mapped to an organization.
 * Tenants add only `custom` hosts: preview hosts are assigned by the platform (D57), and no
 * tenant may claim a platform host, a CDS domain, or any name under them (WR-04).
 */
function normalizeHostField(
  name: string,
  data: RecordData,
  op: "create" | "update",
): void {
  if (name !== "org_hosts") return;
  if (op === "create" && !("kind" in data)) data.kind = "custom";
  if ("kind" in data && data.kind !== "custom") {
    throw new InvalidInput("preview hosts are assigned by the platform");
  }
  if (!("hostname" in data)) return;
  const platform = parsePlatformHosts(process.env.PLATFORM_HOSTS);
  const cls =
    typeof data.hostname === "string"
      ? classifyHost(data.hostname, platform)
      : ({ kind: "invalid" } as const);
  if (cls.kind !== "tenant") {
    throw new InvalidInput("hostname is not a valid tenant host");
  }
  if (isReservedHost(cls.host, platform)) {
    throw new InvalidInput("hostname is reserved by CDS");
  }
  data.hostname = cls.host;
}

/** A platform-assigned preview host row (D57): tenants cannot rename or delete it (WR-04). */
function isPreviewHost(name: string, row: RecordModel): boolean {
  return name === "org_hosts" && row.kind === "preview";
}

async function getScoped(
  name: string,
  spec: CollectionSpec,
  ctx: OrgContext,
  id: string,
): Promise<RecordModel> {
  assertId(id);
  return withSuperuser((pb) =>
    pb
      .collection(name)
      .getFirstListItem(
        pb.filter("id = {:id}", { id }) + " && " + scopeFilter(pb, ctx, spec),
      ),
  ).catch(mapError);
}

type WriteOp =
  | { op: "create"; id: string; body: RecordData }
  | { op: "update"; id: string; body: RecordData }
  | { op: "delete"; id: string };

/** One write; under impersonation it is batched with its audit_log row (TEN-08). */
async function write(
  name: string,
  ctx: OrgContext,
  w: WriteOp,
): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    if (!ctx.impersonator) {
      const col = pb.collection(name);
      if (w.op === "create") return col.create({ ...w.body, id: w.id });
      if (w.op === "update") return col.update(w.id, w.body);
      await col.delete(w.id);
      return null;
    }
    const batch = pb.createBatch();
    const col = batch.collection(name);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: `${name}.${w.op}`,
        targetCollection: name,
        targetId: w.id,
      }),
    );
    const [result] = await batch.send();
    return w.op === "delete" ? null : ((result?.body ?? null) as RecordModel);
  }).catch(mapError);
}

/**
 * The fields a tenantRepo read may hand back (WR-A01, D187, T-03-08): the approved export
 * list plus the filterable fields and PB's record metadata. Deny by default: every read
 * runs as superuser, and PB returns `hidden` fields (pages.password_hash) to superusers, so
 * anything outside this list is stripped before a record leaves the chokepoint.
 */
export function readableFields(spec: CollectionSpec): ReadonlySet<string> {
  return new Set([
    ...(Array.isArray(spec.export) ? spec.export : []),
    ...filterableFields(spec),
    "id",
    "collectionId",
    "collectionName",
  ]);
}

function project(allowed: ReadonlySet<string>, rec: RecordModel): RecordModel {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out as RecordModel;
}

function readRepo(name: string, spec: CollectionSpec): ReadRepo {
  const allowed = readableFields(spec);
  return {
    async get(ctx, id) {
      requirePermission(ctx, spec.feature, "read");
      return project(allowed, await getScoped(name, spec, ctx, id));
    },
    async list(ctx, opts = {}) {
      requirePermission(ctx, spec.feature, "read");
      if (opts.sort !== undefined) {
        if (typeof opts.sort !== "string") {
          throw new InvalidInput("sort must be a list of field names");
        }
        assertSafeSort(opts.sort, filterableFields(spec));
      }
      const page = clampInt(opts.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const perPage = clampInt(opts.perPage, 50, 1, 500);
      const res = await withSuperuser((pb) =>
        pb.collection(name).getList(page, perPage, {
          filter: scopeFilter(pb, ctx, spec, opts),
          ...(opts.sort ? { sort: opts.sort } : {}),
        }),
      ).catch(mapError);
      return { ...res, items: res.items.map((r) => project(allowed, r)) };
    },
  };
}

function writeRepo(name: string, spec: CollectionSpec): WriteRepo {
  const read = readRepo(name, spec);
  const allowed = readableFields(spec);
  return {
    ...read,
    async create(ctx, data) {
      requirePermission(ctx, spec.feature, "write");
      const body = cleanData(spec, data);
      checkOrg(ctx, body);
      body.organization = ctx.orgId;
      const owner = renterField(ctx, spec);
      if (owner) {
        if (owner in body && body[owner] !== ctx.actor) {
          throw new InvalidInput("a renter can only create its own records");
        }
        body[owner] = ctx.actor;
      }
      normalizeHostField(name, body, "create");
      if (spec.kind === "auth") {
        // PB requires a password on auth records even with password auth off (D53). It is
        // random, never returned, never stored anywhere else, never exported.
        const password = randomBytes(32).toString("base64url");
        body.password = password;
        body.passwordConfirm = password;
      }
      const created = await write(name, ctx, {
        op: "create",
        id: newRecordId(),
        body,
      });
      return project(allowed, created as RecordModel);
    },
    async update(ctx, id, data) {
      requirePermission(ctx, spec.feature, "write");
      const body = cleanData(spec, data);
      const existing = await getScoped(name, spec, ctx, id);
      checkOrg(ctx, body);
      if (isPreviewHost(name, existing) && "hostname" in body) {
        throw new InvalidInput("preview hosts are assigned by the platform");
      }
      const owner = renterField(ctx, spec);
      if (owner && owner in body && body[owner] !== ctx.actor) {
        throw new InvalidInput("a renter cannot reassign a record");
      }
      normalizeHostField(name, body, "update");
      const updated = await write(name, ctx, { op: "update", id, body });
      return project(allowed, updated as RecordModel);
    },
    async delete(ctx, id) {
      requirePermission(ctx, spec.feature, "write");
      const existing = await getScoped(name, spec, ctx, id);
      if (isPreviewHost(name, existing)) {
        throw new InvalidInput("preview hosts are assigned by the platform");
      }
      await write(name, ctx, { op: "delete", id });
    },
  };
}

/**
 * The org-scoped repository for one tenant collection. Collections whose registry entry says
 * writes: "custom" (memberships, audit_log) get read methods only: their writes live in
 * dedicated modules with their own invariants.
 */
export function tenantRepo<N extends keyof Registry>(name: N): RepoFor<N>;
export function tenantRepo(name: string): ReadRepo | WriteRepo;
export function tenantRepo(name: string): ReadRepo | WriteRepo {
  const spec = getCollectionSpec(name);
  return spec.writes === "generic"
    ? writeRepo(name, spec)
    : readRepo(name, spec);
}
