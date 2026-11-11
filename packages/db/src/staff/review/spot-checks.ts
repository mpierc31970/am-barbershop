// packages/db/src/staff/review/spot-checks.ts (13-29; STAFF-23, D248, P13-P26). The weekly part
// of review:run: on Mondays (America/Chicago) pick 5 live sites and open one `spot_check` case
// per site listing its changed pages, for staff to mark each page OK / issue on the review
// queue's Spot checks tab.
//
// - pickSpotCheckSites is pure: demo and non-live sites never; sites launched in the last 30
//   days first (newest first), then the most pages changed in the last 7 days; the 5th seat goes
//   to one random pick from the rest when there is a rest (rng injectable for tests).
// - jobOpenSpotChecks claims `review:spot:<yyyy>-w<ww>` (ISO week of the Chicago date) in
//   platform_meta before writing, so a second Monday run the same week opens none. Cases use
//   the one R-<seq> sequence (retried on the unique index, as cases.ts insertCase does) and
//   write `review.case_created` with the organization, by the system job.
// - A case lists the pages changed in the last 7 days; a site with none lists its pages (up to
//   20) so staff still have something to look at.
import { businessDeadline, SLA_BUSINESS_DAYS } from "@cds/core/support";
import { businessDate } from "@cds/core/today";
import type PocketBase from "pocketbase";
import { auditBody } from "../../audit";
import { withSuperuser } from "../../client";
import { mintSystemContext, type SystemContext } from "../../context";
import { isUniqueViolation } from "../../payments/staff-alert";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../../platform-meta";
import { newRecordId } from "../../repository";
import { reviewCaseRef } from "./cases";

/** Sites opened per weekly run (D248). */
export const SPOT_CHECK_SITES = 5;
/** "Launched recently" window (P13-P26). */
export const SPOT_CHECK_RECENT_DAYS = 30;
/** "Pages changed" window (P13-P26). */
export const SPOT_CHECK_CHANGED_DAYS = 7;
/** Pages listed for a site that changed none. */
export const SPOT_CHECK_FALLBACK_PAGES = 20;

const SPOT_TZ = "America/Chicago";
const DAY_MS = 86_400_000;
const SEQ_RETRIES = 5;
const READ_MAX = 2000;
/** A claim never goes stale: the week is spent once claimed. */
const NEVER_STALE = Number.MAX_SAFE_INTEGER;

export type SpotCheckCandidate = {
  orgId: string;
  /** organizations.launched_at (ISO or Date); null when never launched. */
  launchedAt: string | Date | null;
  /** Pages updated in the last 7 days. */
  changedPages7d: number;
  demo: boolean;
  /** stage live, not closed, not suspended. Defaults to true. */
  live?: boolean;
};

export type SpotCheckPage = {
  page_id: string;
  title: string;
  /** WR-D03: the page slug, so the console links each page, not just the site. */
  slug: string;
  state: "unchecked";
};

export type SpotCheckJobResult = {
  /** Cases opened (dry run: cases a run would open). */
  opened: number;
  /** This ISO week already had its spot checks. */
  alreadyDone: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function timeOf(v: string | Date | null): number {
  if (v instanceof Date) return v.getTime();
  const s = str(v);
  if (!s) return NaN;
  return Date.parse(s.replace(" ", "T"));
}

/**
 * Up to 5 org ids: launched <= 30 days (newest first), then most pages changed in 7 days; the
 * 5th seat is replaced by one random pick from the remainder when there is one (P13-P26).
 */
export function pickSpotCheckSites(
  candidates: readonly SpotCheckCandidate[],
  opts: { now: Date; rng?: () => number },
): string[] {
  const nowMs = opts.now.getTime();
  const rng = opts.rng ?? Math.random;
  const recentCut = nowMs - SPOT_CHECK_RECENT_DAYS * DAY_MS;
  const eligible = candidates.filter(
    (c) => !c.demo && c.live !== false && typeof c.orgId === "string",
  );
  const recent = (c: SpotCheckCandidate): number => {
    const t = timeOf(c.launchedAt);
    return Number.isFinite(t) && t >= recentCut && t <= nowMs ? t : NaN;
  };
  const ranked = [...eligible].sort((a, b) => {
    const ra = recent(a);
    const rb = recent(b);
    const aNew = Number.isFinite(ra);
    const bNew = Number.isFinite(rb);
    if (aNew !== bNew) return aNew ? -1 : 1;
    if (aNew && bNew && ra !== rb) return rb - ra;
    const d = (b.changedPages7d || 0) - (a.changedPages7d || 0);
    if (d !== 0) return d;
    return a.orgId < b.orgId ? -1 : a.orgId > b.orgId ? 1 : 0;
  });
  const picked = ranked.slice(0, SPOT_CHECK_SITES).map((c) => c.orgId);
  const rest = ranked.slice(SPOT_CHECK_SITES);
  if (picked.length === SPOT_CHECK_SITES && rest.length > 0) {
    const r = rng();
    const i = Math.min(
      rest.length - 1,
      Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * rest.length)),
    );
    picked[SPOT_CHECK_SITES - 1] = rest[i]!.orgId;
  }
  return picked;
}

/** `review:spot:2026-w42`: the ISO week of the America/Chicago calendar day. */
export function spotCheckWeekKey(now: Date): string {
  const [y, m, d] = businessDate(now, SPOT_TZ).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const day = new Date(Date.UTC(y, m - 1, d));
  const dow = day.getUTCDay() || 7; // Mon 1 .. Sun 7
  day.setUTCDate(day.getUTCDate() + 4 - dow); // the week's Thursday
  const isoYear = day.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((day.getTime() - jan1) / DAY_MS + 1) / 7);
  return `review:spot:${isoYear}-w${String(week).padStart(2, "0")}`;
}

/** True when the America/Chicago weekday of `now` is Monday. */
export function isSpotCheckDay(now: Date): boolean {
  const [y, m, d] = businessDate(now, SPOT_TZ).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

type SiteRow = {
  orgId: string;
  host: string;
  candidate: SpotCheckCandidate;
  changed: SpotCheckPage[];
};

async function readSites(pb: PocketBase, now: Date): Promise<SiteRow[]> {
  const orgs = await pb.collection("organizations").getFullList({
    filter: "stage = 'live' && status != 'closed' && suspended_at = ''",
    fields: "id,launched_at,demo",
    batch: READ_MAX,
  });
  if (orgs.length === 0) return [];
  const since = new Date(now.getTime() - SPOT_CHECK_CHANGED_DAYS * DAY_MS);
  const pages = await pb.collection("pages").getFullList({
    filter: pb.filter("deleted_at = '' && updated >= {:since}", { since }),
    sort: "-updated,id",
    fields: "id,organization,title,slug",
    batch: READ_MAX,
  });
  const hosts = await pb.collection("org_hosts").getFullList({
    filter: "primary = true",
    fields: "organization,hostname",
    batch: READ_MAX,
  });
  const hostOf = new Map<string, string>();
  for (const h of hosts) hostOf.set(str(h.organization), str(h.hostname));
  const changedOf = new Map<string, SpotCheckPage[]>();
  for (const p of pages) {
    const org = str(p.organization);
    const list = changedOf.get(org) ?? [];
    list.push({
      page_id: p.id,
      title: str(p.title) || "Untitled page",
      slug: str(p.slug),
      state: "unchecked",
    });
    changedOf.set(org, list);
  }
  return orgs.map((o) => {
    const changed = changedOf.get(o.id) ?? [];
    return {
      orgId: o.id,
      host: hostOf.get(o.id) ?? "",
      changed,
      candidate: {
        orgId: o.id,
        launchedAt: str(o.launched_at) || null,
        changedPages7d: changed.length,
        demo: o.demo === true,
        live: true,
      },
    };
  });
}

async function fallbackPages(
  pb: PocketBase,
  orgId: string,
): Promise<SpotCheckPage[]> {
  const res = await pb
    .collection("pages")
    .getList(1, SPOT_CHECK_FALLBACK_PAGES, {
      filter: pb.filter("organization = {:org} && deleted_at = ''", {
        org: orgId,
      }),
      sort: "created,id",
      fields: "id,title,slug",
      skipTotal: true,
    });
  return res.items.map((p) => ({
    page_id: p.id,
    title: str(p.title) || "Untitled page",
    slug: str(p.slug),
    state: "unchecked" as const,
  }));
}

async function insertSpotCase(
  pb: PocketBase,
  sys: SystemContext,
  site: { orgId: string; host: string; pages: SpotCheckPage[] },
  now: Date,
): Promise<string> {
  for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
    const top = await pb
      .collection("review_cases")
      .getList(1, 1, { sort: "-seq", fields: "seq" });
    const t = top.items[0];
    const seq = (t && typeof t.seq === "number" ? t.seq : 0) + 1;
    const id = newRecordId();
    const batch = pb.createBatch();
    batch.collection("review_cases").create({
      id,
      seq,
      kind: "spot_check",
      org_id: site.orgId,
      target_url: site.host ? `https://${site.host}/` : "",
      target_collection: "",
      target_id: "",
      category: "spot_check",
      description: `Weekly spot check: ${site.pages.length} page${site.pages.length === 1 ? "" : "s"} to look at.`,
      reporter_name: "",
      reporter_email: "",
      dmca_statement: null,
      status: "open",
      steps: [{ step: "received", at: now.toISOString(), by: "" }],
      due_at: businessDeadline(now, SLA_BUSINESS_DAYS).toISOString(),
      assignee: "",
      outcome: "",
      pages: site.pages,
      created_by: "",
    });
    batch.collection("audit_log").create(
      auditBody(sys, {
        action: "review.case_created",
        organization: site.orgId,
        targetCollection: "review_cases",
        targetId: id,
        meta: {
          ref: reviewCaseRef(seq),
          kind: "spot_check",
          category: "spot_check",
        },
      }),
    );
    try {
      await batch.send();
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
    return reviewCaseRef(seq);
  }
  throw new Error("SpotCheckSeqBusy");
}

/**
 * review:run step `spot-checks` (the caller runs it on Mondays only). Claims the ISO week,
 * picks the sites and opens one case per site. Dry run: counts, writes nothing.
 */
export async function jobOpenSpotChecks(
  now: Date,
  deps: { dryRun?: boolean; rng?: () => number } = {},
): Promise<SpotCheckJobResult> {
  const key = spotCheckWeekKey(now);
  if (deps.dryRun === true) {
    if ((await readPlatformMeta(key)) !== null) {
      return { opened: 0, alreadyDone: true };
    }
    const sites = await withSuperuser((pb) => readSites(pb, now));
    const picked = pickSpotCheckSites(
      sites.map((s) => s.candidate),
      { now, ...(deps.rng ? { rng: deps.rng } : {}) },
    );
    return { opened: picked.length, alreadyDone: false };
  }
  const claim = await acquirePlatformLock(key, { now, staleMs: NEVER_STALE });
  if (claim === null) return { opened: 0, alreadyDone: true };
  const sys = mintSystemContext({ job: "review" });
  try {
    return await withSuperuser(async (pb) => {
      // WR-A10: a retry after a failed run tops up to SPOT_CHECK_SITES, skipping the sites
      // already opened today (the run is Mondays only, so "today" is this week's run).
      const done = await pb.collection("review_cases").getFullList({
        filter: pb.filter("kind = 'spot_check' && created >= {:since}", {
          since: new Date(now.getTime() - DAY_MS).toISOString(),
        }),
        fields: "org_id",
      });
      const already = new Set(done.map((r) => String(r.org_id ?? "")));
      const sites = (await readSites(pb, now)).filter(
        (s) => !already.has(s.orgId),
      );
      const picked = pickSpotCheckSites(
        sites.map((s) => s.candidate),
        { now, ...(deps.rng ? { rng: deps.rng } : {}) },
      ).slice(0, Math.max(0, SPOT_CHECK_SITES - already.size));
      const byId = new Map(sites.map((s) => [s.orgId, s]));
      let opened = 0;
      for (const orgId of picked) {
        const site = byId.get(orgId);
        if (!site) continue;
        const pages =
          site.changed.length > 0
            ? site.changed
            : await fallbackPages(pb, orgId);
        await insertSpotCase(pb, sys, { orgId, host: site.host, pages }, now);
        opened += 1;
      }
      return { opened, alreadyDone: false };
    });
  } catch (err) {
    // WR-A10: a failed run gives the week back, so the next hourly run finishes it.
    await releasePlatformLock(key, claim).catch(() => undefined);
    throw err;
  }
}
