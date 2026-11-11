// P12 content lock (12-08; COMM-11; D99-D102, P12-P4). A service window that reaches an org
// pauses tenant content writes to its target. The rule is enforced in the chokepoint:
// `content/shared.ts commit()` calls `lockTargetsFor` and `assertNotLocked` before any write
// for a member context (impersonated staff and system jobs bypass: staff are doing the fix).
//
// Only an allowlist of collections ever maps to a lock target (RESEARCH Pattern 7, Pitfall 2):
// pages, page_sections, popups, site_settings, media_assets, forms (definitions only) and any
// collection whose registry spec feature is `addon:<slug>`. Support, Billing, Settings,
// Inbox, Profile and visitor writes (form_submissions, form_drafts) are never targets.
//
// The org-reaching windows (platform, add-on, this org's) are one bound query, cached 15 s per
// org in-process (A5; 0 under VITEST unless a test opts in). `service_windows` is a platform
// collection: the org lives in `org_id` (P12-P12).
import { TargetLocked } from "@cds/core";
import {
  lockCovers,
  windowPhase,
  windowReaches,
  WINDOW_UPCOMING_MS,
  type ServiceWindowRule,
  type WriteTarget,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { activeSet } from "../addons/entitlements";
import type { OrgContext } from "../context";
import { getCollectionSpec } from "../registry";

/** One write as commit() sees it (structurally the content `Op`; no import cycle). */
export type LockOp = {
  collection: string;
  op: "create" | "update" | "delete";
  id: string;
  body?: Record<string, unknown>;
};

const WINDOWS = "service_windows";
const SECTION_LOOKUP_MAX = 200;
const ID_RE = /^[a-z0-9]{15}$/;
/** Collections whose every write is site content (org / platform scope locks them). */
const CONTENT: ReadonlySet<string> = new Set([
  "popups",
  "media_assets",
  // Form definitions only: form_submissions and form_drafts are visitor writes and never
  // lock (Pitfall 2).
  "forms",
]);
/** site_settings fields to the SITE_PARTS key a component window names. */
const PART_OF_FIELD: Readonly<Record<string, string>> = {
  nav: "menus",
  footer: "footer",
  banner: "header",
  settings: "header",
  language: "header",
};
const CACHE_MS = 15_000;
const SCAN_MAX = 200;

/** A `service_windows` row as the lock and the notices read it. */
export type ServiceWindowRow = ServiceWindowRule & {
  id: string;
  seq: number;
  incident: string;
  alerted_at: string;
  created_by: string;
};

type CacheEntry = { at: number; rows: ServiceWindowRow[] };

const cache = new Map<string, CacheEntry>();
let testTtl: number | null = null;
let testNow: (() => Date) | null = null;

function ttl(): number {
  if (testTtl !== null) return testTtl;
  return process.env.VITEST ? 0 : CACHE_MS;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function toWindowRow(r: RecordModel): ServiceWindowRow {
  return {
    id: r.id,
    seq: typeof r.seq === "number" ? r.seq : Number(r.seq) || 0,
    scope: str(r.scope) as ServiceWindowRule["scope"],
    org_id: str(r.org_id),
    addon: str(r.addon),
    page: str(r.page),
    component: str(r.component),
    message: str(r.message),
    starts_at: str(r.starts_at),
    ends_at: str(r.ends_at),
    cleared_at: str(r.cleared_at),
    incident: str(r.incident),
    alerted_at: str(r.alerted_at),
    created_by: str(r.created_by),
  };
}

/**
 * Windows not cleared, not ended, starting within 24 h, whose scope could reach this org
 * (platform, any add-on, or `org_id = orgId`). Add-on reach is decided by the caller with
 * `windowReaches` (the org's active add-ons). Cached per org for 15 s.
 */
export async function orgWindowRows(
  pb: PocketBase,
  orgId: string,
  now: Date,
): Promise<ServiceWindowRow[]> {
  const hit = cache.get(orgId);
  const life = ttl();
  if (hit && life > 0 && Date.now() - hit.at < life) return hit.rows;
  const res = await pb.collection(WINDOWS).getList(1, SCAN_MAX, {
    filter: pb.filter(
      "cleared_at = '' && ends_at > {:now} && starts_at <= {:soon} && " +
        "(scope = 'platform' || scope = 'addon' || org_id = {:org})",
      {
        now,
        soon: new Date(now.getTime() + WINDOW_UPCOMING_MS),
        org: orgId,
      },
    ),
    sort: "starts_at,seq",
  });
  const rows = res.items.map(toWindowRow);
  if (life > 0) cache.set(orgId, { at: Date.now(), rows });
  return rows;
}

/** Drops every cached org (a staff create or clear calls it, so this process sees it now). */
export function invalidateWindowCache(): void {
  cache.clear();
}

/**
 * Test hook: clears the cache; `ttlMs` opts a test into caching (default 0 under VITEST);
 * `now` pins the clock `commit()` uses for the lock check. Throws outside VITEST.
 */
export function resetLockCacheForTests(
  opts: { ttlMs?: number; now?: () => Date } = {},
): void {
  if (!process.env.VITEST) {
    throw new Error("resetLockCacheForTests is for tests only");
  }
  cache.clear();
  testTtl = opts.ttlMs ?? null;
  testNow = opts.now ?? null;
}

/** The instant the lock check uses (a test may pin it). */
export function lockClockNow(): Date {
  return testNow ? testNow() : new Date();
}

function addTarget(out: WriteTarget[], t: WriteTarget): void {
  const key = JSON.stringify(t);
  if (!out.some((o) => JSON.stringify(o) === key)) out.push(t);
}

function addonSlugOf(collection: string): string | null {
  let feature: string;
  try {
    feature = getCollectionSpec(collection).feature;
  } catch {
    return null; // not a tenant collection (audit_log, organizations, ...)
  }
  return feature.startsWith("addon:") ? feature.slice("addon:".length) : null;
}

/**
 * The lock targets a batch of writes touches (choice 3). Only the allowlist maps; everything
 * else (Support, Billing, Settings, Inbox, Profile, visitor submits) returns no target.
 * A section update or delete without `page` in the body is resolved by one lookup.
 */
export async function lockTargetsFor(
  pb: PocketBase,
  ops: readonly LockOp[],
): Promise<WriteTarget[]> {
  const out: WriteTarget[] = [];
  const sectionIds: string[] = [];
  for (const w of ops) {
    const body = w.op === "delete" ? undefined : w.body;
    switch (w.collection) {
      case "pages":
        addTarget(out, { kind: "page", id: w.id });
        break;
      case "page_sections": {
        const page = body?.page;
        if (typeof page === "string" && page !== "") {
          addTarget(out, { kind: "page", id: page });
        } else if (w.op !== "create" && ID_RE.test(w.id)) {
          sectionIds.push(w.id);
        } else {
          addTarget(out, { kind: "content" });
        }
        break;
      }
      case "site_settings": {
        const parts = Object.keys(body ?? {})
          .map((k) => PART_OF_FIELD[k])
          .filter((p): p is string => !!p);
        if (parts.length === 0) addTarget(out, { kind: "content" });
        for (const key of parts) addTarget(out, { kind: "part", key });
        break;
      }
      default:
        if (CONTENT.has(w.collection)) {
          addTarget(out, { kind: "content" });
        } else {
          const slug = addonSlugOf(w.collection);
          if (slug) addTarget(out, { kind: "addon", slug });
        }
    }
  }
  const unique = [...new Set(sectionIds)].slice(0, SECTION_LOOKUP_MAX);
  if (unique.length > 0) {
    const params: Record<string, string> = {};
    const expr = unique
      .map((id, i) => {
        params[`s${i}`] = id;
        return `id = {:s${i}}`;
      })
      .join(" || ");
    const rows = await pb.collection("page_sections").getFullList({
      filter: pb.filter(expr, params),
      fields: "id,page",
    });
    const found = new Set<string>();
    for (const r of rows) {
      found.add(r.id);
      const page = str(r.page);
      if (page) addTarget(out, { kind: "page", id: page });
      else addTarget(out, { kind: "content" });
    }
    // A missing row still counts as content: org / platform windows lock it.
    if (found.size < unique.length) addTarget(out, { kind: "content" });
  }
  return out;
}

/**
 * Throws TargetLocked when an active window that reaches this org covers any target
 * (choice 4). The org's active add-ons come from `activeSet` (addons/entitlements.ts), read
 * only when an add-on window is active. A failed window read is logged by error name and lets
 * the write through (a PocketBase outage fails the write itself anyway).
 */
export async function assertNotLocked(
  pb: PocketBase,
  ctx: OrgContext,
  targets: readonly WriteTarget[],
  now: Date = lockClockNow(),
): Promise<void> {
  if (targets.length === 0) return;
  let rows: ServiceWindowRow[];
  try {
    rows = (await orgWindowRows(pb, ctx.orgId, now)).filter(
      (w) => windowPhase(w, now) === "active",
    );
  } catch (err) {
    console.error(
      "[support] lock check failed:",
      err instanceof Error ? err.name : typeof err,
    );
    return;
  }
  if (rows.length === 0) return;
  const activeAddons = rows.some((w) => w.scope === "addon")
    ? [...(await activeSet(pb, ctx.orgId))]
    : [];
  for (const w of rows) {
    if (!windowReaches(w, { orgId: ctx.orgId, activeAddons })) continue;
    if (targets.some((t) => lockCovers(w, t))) throw new TargetLocked();
  }
}
