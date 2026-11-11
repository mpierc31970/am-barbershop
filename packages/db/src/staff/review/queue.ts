// packages/db/src/staff/review/queue.ts (13-23; STAFF-23, STAFF-26; D248, D292, P13-P8, P13-P10).
// The one review queue read model. Three sources, nothing copied (P13-P8):
// - content_flags: open (unsure / held) and queued (scanner outage, waiting for a rescan);
// - held items: a `held` flag whose target is still held, aged in business days (Mon-Fri,
//   America/Chicago) against the 2-business-day promise (D248) and sorted first;
// - review_cases: spot checks, public reports and DMCA notices (R-<seq>).
// Fit holds are listed read-only on the flags tab with a link to Pipeline > Fit holds (they are
// decided there; P13-P10). Every item kind passes through `queueFor` and must be `review_queue`
// (STAFF-26). reviewGauges feeds 13-29 (heldPastPromise) and 13-40 (§4 review gauges).
import { authorizeStaff, InvalidInput } from "@cds/core";
import {
  businessDeadline,
  businessMsBetween,
  SLA_BUSINESS_DAYS,
} from "@cds/core/support";
import { queueFor, type QueueItemKind } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { assertPlatformContext, type PlatformContext } from "../../context";
import { staffFitHolds } from "../pipeline";
import { reviewCaseRef, reviewCaseView, type StaffReviewCase } from "./cases";

const DAY_MS = 86_400_000;
const DONE_LIMIT = 200;
const ID_RE = /^[a-z0-9]{15}$/;

export const REVIEW_QUEUE_TABS = ["flags", "spot", "reports"] as const;
export type ReviewQueueTab = (typeof REVIEW_QUEUE_TABS)[number];
export type ReviewQueueStatusFilter = "open" | "done";

/** Review-queue item kinds (the `review_queue` half of QUEUE_MAP). */
export type ReviewQueueKind = Extract<
  QueueItemKind,
  "scan_flag" | "scan_hold" | "fit_hold" | "spot_check" | "report" | "dmca"
>;

export type ReviewQueueItem = {
  kind: ReviewQueueKind;
  /** Flag id, "R-31", or the org id (fit hold). */
  ref: string;
  orgId: string | null;
  business: string | null;
  target: {
    collection: string;
    id: string;
    title: string;
    url: string | null;
  };
  verdict?: "unsure" | "held" | "error";
  reasons: string[];
  /** Held items and fit holds: whole business days since the hold. */
  heldBusinessDays?: number;
  /** Held past the 2-business-day promise (D248), or a case past its due date. */
  pastPromise: boolean;
  /** Flags: open | queued | resolved. Cases: open | waiting | closed. Fit holds: held. */
  status: string;
  assignee: string | null;
  createdAt: string;
  /** Fit holds: decided in Pipeline, never here (P13-P10). */
  readOnly?: boolean;
  /** Where the row opens. */
  href: string;
  /** Cases only. */
  case?: StaffReviewCase;
};

export type ReviewGauges = {
  /** Items held for review now (pages, photos and records with a held verdict). */
  held_pages: number;
  held_oldest_business_days: number;
  /** Held past the 2-business-day promise (13-29 heldPastPromise). */
  held_past_promise: number;
  /** Content waiting for a scanner that was down or capped. */
  queued_scans: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validNow(now: Date | undefined): Date {
  const d = now ?? new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return d;
}

function reviewKind(kind: ReviewQueueKind): ReviewQueueKind {
  if (queueFor(kind) !== "review_queue") {
    throw new InvalidInput("not a review queue kind");
  }
  return kind;
}

function heldDays(since: Date, now: Date): number {
  return Math.floor(businessMsBetween(since, now) / DAY_MS);
}

function pastPromise(since: Date, now: Date): boolean {
  return now.getTime() > businessDeadline(since, SLA_BUSINESS_DAYS).getTime();
}

function inIds(pb: PocketBase, field: string, ids: readonly string[]): string {
  const clean = [...new Set(ids)].filter((id) => ID_RE.test(id));
  if (clean.length === 0) return "id = ''";
  return clean
    .map((id, i) => pb.filter(field + " = {:v" + i + "}", { ["v" + i]: id }))
    .join(" || ");
}

const COLLECTION_LABELS: Readonly<Record<string, string>> = {
  pages: "Page",
  media_assets: "Image",
  popups: "Pop-up",
  site_settings: "Banner",
  site_chrome: "Menu or footer",
};

function labelOf(collection: string): string {
  const known = COLLECTION_LABELS[collection];
  if (known) return known;
  const s = collection.replace(/_/g, " ").replace(/s$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Lookups = {
  business: Map<string, string>;
  host: Map<string, string>;
  pages: Map<string, { title: string; slug: string; status: string }>;
  media: Map<string, { name: string; status: string }>;
};

async function lookups(
  pb: PocketBase,
  orgIds: string[],
  pageIds: string[],
  mediaIds: string[],
): Promise<Lookups> {
  const out: Lookups = {
    business: new Map(),
    host: new Map(),
    pages: new Map(),
    media: new Map(),
  };
  if (orgIds.length > 0) {
    const orgs = await pb.collection("organizations").getFullList({
      filter: inIds(pb, "id", orgIds),
      fields: "id,name",
    });
    for (const o of orgs) out.business.set(o.id, str(o.name));
    const hosts = await pb.collection("org_hosts").getFullList({
      filter: "primary = true && (" + inIds(pb, "organization", orgIds) + ")",
      fields: "organization,hostname",
    });
    for (const h of hosts) out.host.set(str(h.organization), str(h.hostname));
  }
  if (pageIds.length > 0) {
    const pages = await pb.collection("pages").getFullList({
      filter: inIds(pb, "id", pageIds),
      fields: "id,title,slug,status",
    });
    for (const p of pages) {
      out.pages.set(p.id, {
        title: str(p.title),
        slug: str(p.slug),
        status: str(p.status),
      });
    }
  }
  if (mediaIds.length > 0) {
    const media = await pb.collection("media_assets").getFullList({
      filter: inIds(pb, "id", mediaIds),
      fields: "id,name,status",
    });
    for (const m of media) {
      out.media.set(m.id, { name: str(m.name), status: str(m.status) });
    }
  }
  return out;
}

/** A held flag's target is still held (pages / photos by status; other records while open). */
function stillHeld(flag: RecordModel, l: Lookups): boolean {
  const c = str(flag.target_collection);
  const id = str(flag.target_id);
  if (c === "pages") return l.pages.get(id)?.status === "held";
  if (c === "media_assets") return l.media.get(id)?.status === "held";
  return true;
}

function flagItem(f: RecordModel, l: Lookups, now: Date): ReviewQueueItem {
  const orgId = str(f.organization);
  const c = str(f.target_collection);
  const id = str(f.target_id);
  const verdict = str(f.verdict) as "unsure" | "held" | "error";
  const status = str(f.status);
  const created = new Date(str(f.created));
  const held = verdict === "held" && status !== "resolved" && stillHeld(f, l);
  let title = labelOf(c);
  let url: string | null = null;
  if (c === "pages") {
    const p = l.pages.get(id);
    if (p) {
      title = `Page · ${p.title || "Untitled page"}`;
      const host = l.host.get(orgId);
      if (host && p.slug) {
        url = `https://${host}/${p.slug === "home" ? "" : p.slug}`;
      }
    }
  } else if (c === "media_assets") {
    const m = l.media.get(id);
    if (m) title = `Image · ${m.name || "image"}`;
  }
  const item: ReviewQueueItem = {
    kind: reviewKind(held ? "scan_hold" : "scan_flag"),
    ref: f.id,
    orgId: orgId || null,
    business: l.business.get(orgId) ?? null,
    target: { collection: c, id, title, url },
    verdict,
    reasons: Array.isArray(f.reasons)
      ? (f.reasons as unknown[]).filter(
          (r): r is string => typeof r === "string",
        )
      : [],
    pastPromise:
      held && !Number.isNaN(created.getTime()) && pastPromise(created, now),
    status,
    assignee: null,
    createdAt: str(f.created),
    href: `/staff/review/${f.id}`,
  };
  if (held && !Number.isNaN(created.getTime())) {
    item.heldBusinessDays = heldDays(created, now);
  }
  return item;
}

/** held (past promise first, oldest first) -> open flags (oldest first) -> queued. */
function flagRank(i: ReviewQueueItem): number {
  if (i.kind === "scan_hold") return i.pastPromise ? 0 : 1;
  if (i.status === "queued") return 3;
  return 2;
}

async function flagsTab(
  status: ReviewQueueStatusFilter,
  now: Date,
): Promise<{ items: ReviewQueueItem[]; flags: RecordModel[]; l: Lookups }> {
  return withSuperuser(async (pb) => {
    const flags =
      status === "open"
        ? await pb.collection("content_flags").getFullList({
            filter: "status = 'open' || status = 'queued'",
            sort: "created,id",
          })
        : (
            await pb.collection("content_flags").getList(1, DONE_LIMIT, {
              filter: "status = 'resolved'",
              sort: "-updated,id",
            })
          ).items;
    const l = await lookups(
      pb,
      flags.map((f) => str(f.organization)),
      flags
        .filter((f) => str(f.target_collection) === "pages")
        .map((f) => str(f.target_id)),
      flags
        .filter((f) => str(f.target_collection) === "media_assets")
        .map((f) => str(f.target_id)),
    );
    const items = flags.map((f) => flagItem(f, l, now));
    if (status === "open") {
      items.sort((a, b) => {
        const r = flagRank(a) - flagRank(b);
        if (r !== 0) return r;
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });
    }
    return { items, flags, l };
  });
}

async function casesTab(
  kinds: readonly ("spot_check" | "report" | "dmca")[],
  status: ReviewQueueStatusFilter,
  now: Date,
): Promise<ReviewQueueItem[]> {
  return withSuperuser(async (pb) => {
    const kindFilter = kinds
      .map((k, i) => pb.filter("kind = {:k" + i + "}", { ["k" + i]: k }))
      .join(" || ");
    const statusFilter =
      status === "open" ? "status != 'closed'" : "status = 'closed'";
    const rows =
      status === "open"
        ? await pb.collection("review_cases").getFullList({
            filter: "(" + kindFilter + ") && " + statusFilter,
            sort: "created,seq",
          })
        : (
            await pb.collection("review_cases").getList(1, DONE_LIMIT, {
              filter: "(" + kindFilter + ") && " + statusFilter,
              sort: "-updated,seq",
            })
          ).items;
    const orgIds = rows.map((r) => str(r.org_id)).filter(Boolean);
    const pageIds = rows
      .filter((r) => str(r.target_collection) === "pages")
      .map((r) => str(r.target_id));
    const l = await lookups(pb, orgIds, pageIds, []);
    return rows.map((r) => {
      const orgId = str(r.org_id);
      const business = l.business.get(orgId) ?? null;
      const view = reviewCaseView(r, business);
      const due = view.dueAt ? Date.parse(view.dueAt) : NaN;
      const page = l.pages.get(view.targetId);
      return {
        kind: reviewKind(view.kind),
        ref: reviewCaseRef(view.seq),
        orgId: orgId || null,
        business,
        target: {
          collection: view.targetCollection,
          id: view.targetId,
          title: page
            ? `Page · ${page.title || "Untitled page"}`
            : view.targetUrl || "Site",
          url: view.targetUrl || null,
        },
        reasons: [],
        pastPromise:
          view.status !== "closed" &&
          Number.isFinite(due) &&
          now.getTime() > due,
        status: view.status,
        assignee: view.assignee,
        createdAt: view.created,
        href: `/staff/review/${reviewCaseRef(view.seq)}`,
        case: view,
      } satisfies ReviewQueueItem;
    });
  });
}

/**
 * The one review queue (`review_queue`, both roles). `flags`: flags + holds + fit holds
 * (read-only); `spot`: spot-check cases; `reports`: report and DMCA cases. `status` "done"
 * lists the newest 200 resolved / closed rows.
 */
export async function listReviewQueue(
  ctx: PlatformContext,
  opts: { tab: ReviewQueueTab; status?: ReviewQueueStatusFilter; now?: Date },
): Promise<ReviewQueueItem[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(opts?.now);
  const tab = opts?.tab;
  if (!(REVIEW_QUEUE_TABS as readonly string[]).includes(String(tab))) {
    throw new InvalidInput("unknown review tab");
  }
  const status: ReviewQueueStatusFilter =
    opts.status === "done" ? "done" : "open";
  if (tab === "spot") return casesTab(["spot_check"], status, now);
  if (tab === "reports") return casesTab(["report", "dmca"], status, now);

  const { items } = await flagsTab(status, now);
  if (status === "done") return items;
  const fit = await staffFitHolds(ctx);
  for (const h of fit) {
    const since = h.heldSince ? new Date(h.heldSince) : null;
    const valid = since !== null && !Number.isNaN(since.getTime());
    items.push({
      kind: reviewKind("fit_hold"),
      ref: h.orgId,
      orgId: h.orgId,
      business: h.name || null,
      target: {
        collection: "signup",
        id: h.orgId,
        title: "Signup",
        url: null,
      },
      reasons: h.reasons,
      ...(valid ? { heldBusinessDays: heldDays(since, now) } : {}),
      pastPromise: valid ? pastPromise(since, now) : false,
      status: "held",
      assignee: null,
      createdAt: h.heldSince ?? "",
      readOnly: true,
      href: "/staff/pipeline?tab=fit",
    });
  }
  return items;
}

/**
 * WR-D05: one content flag by record id (`review_queue`, both roles), whatever its status, so
 * a resolved flag older than the Done list's newest 200 still opens. Null when no flag has
 * that id.
 */
export async function staffGetFlag(
  ctx: PlatformContext,
  id: string,
  opts: { now?: Date } = {},
): Promise<ReviewQueueItem | null> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const now = validNow(opts.now);
  return withSuperuser(async (pb) => {
    let f: RecordModel;
    try {
      f = await pb.collection("content_flags").getOne(id);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        return null;
      }
      throw err;
    }
    const c = str(f.target_collection);
    const target = str(f.target_id);
    const l = await lookups(
      pb,
      [str(f.organization)].filter(Boolean),
      c === "pages" ? [target] : [],
      c === "media_assets" ? [target] : [],
    );
    return flagItem(f, l, now);
  });
}

/** Review gauges (13-29 heldPastPromise, 13-40 §4 `review`). Counts only; system read. */
export async function reviewGauges(
  now: Date = new Date(),
): Promise<ReviewGauges> {
  const at = validNow(now);
  const { items } = await flagsTab("open", at);
  const held = items.filter((i) => i.kind === "scan_hold");
  return {
    held_pages: held.length,
    held_oldest_business_days: held.reduce(
      (m, i) => Math.max(m, i.heldBusinessDays ?? 0),
      0,
    ),
    held_past_promise: held.filter((i) => i.pastPromise).length,
    queued_scans: items.filter((i) => i.status === "queued").length,
  };
}
