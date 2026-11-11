// Review queue view mapping (13-38 choice 2). Server-side: turns the @cds/db read model into the
// plain row views the client lists render (no functions, no reporter contact in list rows).
// Staff names: no staff roster read exists yet (13-35/13-36 precedent), so an assignee is "You"
// or "CDS staff".
import type { ReviewQueueItem, StaffReviewCase } from "@cds/db";
import { REVIEW_COPY } from "@cds/ui/staff";
import type {
  FlagRowView,
  ReportRowView,
  ReviewListView,
  SpotRowView,
} from "./ReviewLists";

const C = REVIEW_COPY;

export function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export function listView(raw: string | string[] | undefined): ReviewListView {
  return one(raw) === "done" ? "done" : "open";
}

export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export function assigneeLabel(id: string | null, me: string): string {
  if (!id) return C.unassigned;
  return id === me ? C.you : C.cdsStaff;
}

/** Who did a step: the public form / a job (""), you, or CDS staff. */
export function actorLabel(by: string, me: string): string {
  if (!by) return "Public form";
  return by === me ? C.you : C.cdsStaff;
}

const VERDICT_WORDS: Readonly<Record<string, string>> = {
  unsure: "Scanner unsure",
  held: "Held by the scanner",
  error: "Scanner error",
};

export function flagRow(i: ReviewQueueItem, me: string): FlagRowView {
  const held = i.kind === "scan_hold";
  return {
    ref: i.ref,
    held,
    queued: i.status === "queued",
    heldDays: held ? (i.heldBusinessDays ?? null) : null,
    late: i.pastPromise,
    business: i.business ?? C.noSite,
    what: i.target.title,
    why:
      i.reasons.length > 0
        ? i.reasons.join("; ")
        : i.status === "queued"
          ? "Waiting for the scanner"
          : (VERDICT_WORDS[i.verdict ?? ""] ?? C.none),
    createdAt: i.createdAt,
    assignee: assigneeLabel(i.assignee, me),
    href: i.href,
  };
}

export type SpotPageRaw = { state: string };

export function spotRow(i: ReviewQueueItem): SpotRowView {
  const pages = Array.isArray(i.case?.pages) ? i.case.pages : [];
  const marked = pages.filter((p) => {
    const s = (p as { state?: unknown } | null)?.state;
    return s === "ok" || s === "issue";
  }).length;
  return {
    ref: i.ref,
    business: i.business ?? C.noSite,
    whyPicked: i.case?.description ?? "",
    marked,
    total: pages.length,
    opened: i.createdAt,
    late: i.pastPromise,
    href: i.href,
  };
}

const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  copyright: "Copyright",
  scam: "Scam or fraud",
  illegal: "Illegal content",
  other: "Other",
  spot_check: "Spot check",
};

export function categoryLabel(c: string): string {
  return CATEGORY_WORDS[c] ?? C.none;
}

export function stepLabel(c: StaffReviewCase | undefined): string {
  const s = c?.currentStep;
  return s ? C.steps[s] : C.none;
}

export function reportRow(
  i: ReviewQueueItem,
  me: string,
  repeat: ReadonlySet<string>,
): ReportRowView {
  return {
    ref: i.ref,
    kind: i.kind === "dmca" ? "dmca" : "report",
    business: i.business ?? C.noSite,
    repeat: i.orgId ? repeat.has(i.orgId) : false,
    category: categoryLabel(i.case?.category ?? ""),
    step: stepLabel(i.case),
    due: i.case?.dueAt ?? null,
    late: i.pastPromise,
    received: i.case?.steps[0]?.at ?? i.createdAt,
    assignee: assigneeLabel(i.assignee, me),
    href: i.href,
  };
}

const PAGE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * WR-D03: the live URL of one spot-checked page (home is the site root), or null when the
 * case has no site URL or the page no slug (cases opened before the slug was stored), so no
 * link points every page at the same address.
 */
export function spotPageUrl(
  siteUrl: string,
  slug: string | undefined,
): string | null {
  if (!siteUrl || !slug || !PAGE_SLUG_RE.test(slug)) return null;
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return new URL(slug === "home" ? "/" : `/${slug}`, u.origin).toString();
  } catch {
    return null;
  }
}
