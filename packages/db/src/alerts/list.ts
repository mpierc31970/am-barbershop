// P11 alerts/list (11-20; DASH-34, DASH-37; UI-SPEC Bell). The bell reads, per person.
//
// - Per person (Pitfall 6, T-11-20-05): every read and write is bound to
//   `organization = ctx.orgId && user = ctx.actor`; a colleague's or another org's alert id
//   is NotFound.
// - Impersonating staff see no bell (UI-SPEC): reads return nothing, marks are silently
//   refused. A system-job context has no bell either.
// - Self-clearing (D313): an unread alert whose source_key is no longer in the person's
//   Needs-you keys reads `cleared: true` and is not counted. Computed on read, never written;
//   only alert types that mirror a Needs-you item can clear (site.stage, cds.notice... never).
// - The bell keeps 30 days.
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";

export type BellAlert = {
  id: string;
  type: string;
  level: "urgent" | "normal" | "summary";
  /** Full title: the hub always shows it, sensitive mode or not (D305). */
  title: string;
  href: string;
  section: string;
  /** ISO time the alert was raised. */
  createdAt: string;
  read: boolean;
  /** Unread, but its Needs-you item is done: renders read and is not counted. */
  cleared: boolean;
  /** What raised it ("booking:<id>" for a booking request); lets a screen act in place. */
  sourceKey: string;
};

export type BellKeys = ReadonlySet<string> | readonly string[];

const COLLECTION = "alerts";
const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_LIMIT = 100;
/** Upper bound on unread rows read for the count (and marked by markAllRead). */
const MAX_UNREAD = 500;
const ID_RE = /^[a-z0-9]{1,30}$/;

/** Core alert types that mirror a Needs-you item (same key). */
const NEEDS_YOU_TYPES: ReadonlySet<string> = new Set([
  "form.message",
  "billing.card_failed",
  "payments.payouts_paused",
  // 12-05: support:ticket:<n> and support:messages (cds.document stays a plain alert).
  "support.reply",
  "support.status",
  "cds.message",
  "cds.note",
]);

/** Core type prefixes: an add-on type is `<slug>.<event>` with any other prefix. */
const CORE_PREFIXES: ReadonlySet<string> = new Set([
  "form",
  "billing",
  "payments",
  "site",
  "data_export",
  "contact",
  "cds",
  "reports",
  "support",
  // P14 (14-29): domain.* and offboarding.* are plain alerts (cleared when read). Without
  // these, their `domain:M-<n>:...` keys read as add-on Needs-you mirrors and vanish unread.
  "domain",
  "offboarding",
]);

/**
 * True when an alert of this type stands for a Needs-you item, so it clears once that item
 * is gone. Add-on alerts qualify when their key is in the add-on's own `<slug>:` namespace
 * (the Needs-you key rule for add-on providers, 11-13).
 */
export function sourceKeyIsNeedsYouKind(
  type: string,
  sourceKey: string,
): boolean {
  if (NEEDS_YOU_TYPES.has(type)) {
    // 12-REVIEW CR-A01: support rows mirror Needs-you only under the keys Needs-you emits.
    // `support:closed:<n>` (a closed ticket has no item) is a plain alert, cleared when read.
    if (type === "support.reply" || type === "support.status") {
      return sourceKey.startsWith("support:ticket:");
    }
    if (type === "cds.message" || type === "cds.note") {
      return sourceKey === "support:messages";
    }
    return true;
  }
  const dot = type.indexOf(".");
  if (dot <= 0) return false;
  const slug = type.slice(0, dot);
  if (CORE_PREFIXES.has(slug)) return false;
  return sourceKey.startsWith(`${slug}:`);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function keySet(keys: BellKeys | undefined): ReadonlySet<string> {
  if (!keys) return new Set();
  return keys instanceof Set ? keys : new Set(keys as readonly string[]);
}

/** Null when the caller has no bell (impersonation, system job, no actor). */
function person(ctx: OrgContext): { org: string; user: string } | null {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return null;
  return { org: ctx.orgId, user: ctx.actor };
}

function since(now: Date): Date {
  return new Date(now.getTime() - KEEP_DAYS * DAY_MS);
}

function isCleared(row: RecordModel, keys: ReadonlySet<string>): boolean {
  if (str(row.read_at)) return false;
  const key = str(row.source_key);
  return !keys.has(key) && sourceKeyIsNeedsYouKind(str(row.type), key);
}

function level(v: unknown): BellAlert["level"] {
  return v === "urgent" || v === "summary" ? v : "normal";
}

function toBell(row: RecordModel, keys: ReadonlySet<string>): BellAlert {
  return {
    id: row.id,
    type: str(row.type),
    level: level(row.level),
    title: str(row.title),
    href: str(row.href),
    section: str(row.section),
    createdAt: str(row.created),
    read: str(row.read_at) !== "",
    cleared: isCleared(row, keys),
    sourceKey: str(row.source_key),
  };
}

function ownFilter(
  pb: PocketBase,
  who: { org: string; user: string },
  extra: string,
  params: Record<string, unknown> = {},
): string {
  const clause =
    "organization = {:org} && user = {:u}" + (extra ? " && " + extra : "");
  return pb.filter(clause, { org: who.org, u: who.user, ...params });
}

/** The caller's alerts from the last 30 days, newest first (default 30 rows). */
export async function listBell(
  ctx: OrgContext,
  opts: { needsYouKeys: BellKeys; limit?: number; now?: Date },
): Promise<BellAlert[]> {
  const who = person(ctx);
  if (!who) return [];
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 30), 1), MAX_LIMIT);
  if (!Number.isFinite(limit)) throw new InvalidInput("limit must be a number");
  const keys = keySet(opts.needsYouKeys);
  const now = opts.now ?? new Date();
  return withSuperuser(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, limit, {
      filter: ownFilter(pb, who, "created >= {:since}", { since: since(now) }),
      sort: "-created,-id",
      fields: "id,type,level,title,href,section,source_key,read_at,created",
    });
    return res.items.map((r) => toBell(r, keys));
  });
}

/** Unread, not-cleared alerts for the badge, and how many of them are urgent. */
export async function bellCounts(
  ctx: OrgContext,
  needsYouKeys: BellKeys,
  now: Date = new Date(),
): Promise<{ unread: number; urgent: number }> {
  const who = person(ctx);
  if (!who) return { unread: 0, urgent: 0 };
  const keys = keySet(needsYouKeys);
  return withSuperuser(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, MAX_UNREAD, {
      filter: ownFilter(pb, who, "read_at = '' && created >= {:since}", {
        since: since(now),
      }),
      fields: "id,type,level,source_key,read_at",
    });
    let unread = 0;
    let urgent = 0;
    for (const r of res.items) {
      if (isCleared(r, keys)) continue;
      unread += 1;
      if (r.level === "urgent") urgent += 1;
    }
    return { unread, urgent };
  });
}

/** The bell badge: unread and not cleared. */
export async function bellCount(
  ctx: OrgContext,
  needsYouKeys: BellKeys,
  now?: Date,
): Promise<number> {
  return (await bellCounts(ctx, needsYouKeys, now)).unread;
}

/**
 * Opening an alert marks it read. Another person's (or org's) id is NotFound; under
 * impersonation nothing is written and nothing is thrown.
 */
export async function markAlertRead(
  ctx: OrgContext,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  const who = person(ctx);
  if (!who) return;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  await withSuperuser(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: ownFilter(pb, who, "id = {:id}", { id }),
      fields: "id,read_at",
    });
    const row = res.items[0];
    if (!row) throw new NotFound();
    if (str(row.read_at)) return;
    await pb.collection(COLLECTION).update(row.id, { read_at: now });
  });
}

/** Mark every unread alert of the caller read, in one batch. */
export async function markAllRead(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<{ marked: number }> {
  const who = person(ctx);
  if (!who) return { marked: 0 };
  return withSuperuser(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, MAX_UNREAD, {
      filter: ownFilter(pb, who, "read_at = ''"),
      fields: "id",
    });
    if (res.items.length === 0) return { marked: 0 };
    const batch = pb.createBatch();
    for (const r of res.items) {
      batch.collection(COLLECTION).update(r.id, { read_at: now });
    }
    await batch.send();
    return { marked: res.items.length };
  });
}
