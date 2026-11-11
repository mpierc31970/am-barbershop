// Ratings & SLA report data (STAFF-21, D212, P13-P32; 13-16 choice 5). Tickets rated in one
// business month (America/Chicago, `careMonth`): overall and per-agent thumbs up/down and rate,
// the comments with ticket numbers, and thumbs-down not yet followed up. The agent is the
// staff-only `rated_agent` stamped at resolve (P13-P18); it never reaches the tenant.
// `staffMarkRatingFollowedUp` stamps `rating_followed_at` (audited with the organization, so
// the tenant's audit log shows it), which clears the row from Today and the follow-up list.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { careMonth } from "@cds/core/payments";
import {
  parseTicketNumber,
  ratingRate,
  type RatingChoice,
} from "@cds/core/support";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { slaMonthOf } from "../support/sla-report";
import { staffFirstName, THREADS } from "../support/shared";

/** Rows one report reads (10-50 tenants: a month's ratings fit). */
const REPORT_MAX = 5000;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const STAFF_ID_RE = /^[a-z0-9]{15}$/;

export type StaffRatingsAgentRow = {
  /** Empty string for tickets resolved with no staff reply or assignee. */
  agentId: string;
  name: string;
  up: number;
  down: number;
  /** Rounded thumbs-up percentage; null when nothing was rated. */
  rate: number | null;
};

export type StaffRatingComment = {
  number: number;
  orgId: string;
  business: string;
  rating: RatingChoice;
  comment: string;
  ratedAt: string;
  agent: string;
};

export type StaffRatingFollowUp = {
  number: number;
  orgId: string;
  business: string;
  agent: string;
  comment: string | null;
  ratedAt: string;
};

export type StaffRatingsReport = {
  /** "2026-10" */
  month: string;
  /** "October 2026" */
  label: string;
  overall: { up: number; down: number; rate: number | null };
  /** Most rated first, then by name. */
  byAgent: StaffRatingsAgentRow[];
  /** Newest first; only ratings with a comment. */
  comments: StaffRatingComment[];
  /** Thumbs-down without `rating_followed_at`, oldest first (any month: nothing drops off). */
  toFollowUp: StaffRatingFollowUp[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function monthBounds(month: string) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new InvalidInput("month must look like 2026-10");
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (year < 2000 || year > 2100 || mon < 1 || mon > 12) {
    throw new InvalidInput("month must look like 2026-10");
  }
  // Mid-month noon UTC is inside the same business month in any US zone.
  return careMonth(new Date(Date.UTC(year, mon - 1, 15, 12)));
}

/** The month's ratings report (`support_read`). */
export async function staffRatingsReport(
  ctx: PlatformContext,
  input: { month?: string; now?: Date } = {},
): Promise<StaffRatingsReport> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  const month = input.month ?? slaMonthOf(now);
  const bounds = monthBounds(month);
  const fields =
    "id,number,organization,rating,rating_comment,rated_at,rated_agent,rating_followed_at";

  return withSuperuser(async (pb) => {
    const rated = await pb.collection(THREADS).getList(1, REPORT_MAX, {
      filter: pb.filter(
        "kind = 'ticket' && rating != '' && rated_at >= {:start} && rated_at < {:end}",
        { start: bounds.start, end: bounds.end },
      ),
      sort: "-rated_at,-id",
      fields,
      skipTotal: true,
    });
    const pending = await pb.collection(THREADS).getList(1, REPORT_MAX, {
      filter: "kind = 'ticket' && rating = 'down' && rating_followed_at = ''",
      sort: "rated_at,id",
      fields,
      skipTotal: true,
    });

    const orgIds = new Set<string>();
    const agentIds = new Set<string>();
    for (const r of [...rated.items, ...pending.items]) {
      orgIds.add(str(r.organization));
      const a = str(r.rated_agent);
      if (STAFF_ID_RE.test(a)) agentIds.add(a);
    }
    const businesses = new Map<string, string>();
    for (const id of orgIds) {
      if (!STAFF_ID_RE.test(id)) continue;
      const org = await pb
        .collection("organizations")
        .getOne(id, { fields: "id,name" })
        .catch(() => null);
      businesses.set(id, str(org?.name) || "Unknown site");
    }
    const names = new Map<string, string>();
    for (const id of agentIds) names.set(id, await staffFirstName(pb, id));
    const agentName = (id: string) =>
      names.get(id) ?? (id ? "CDS" : "Unassigned");
    const business = (id: string) => businesses.get(id) ?? "Unknown site";

    let up = 0;
    let down = 0;
    const per = new Map<string, { up: number; down: number }>();
    const comments: StaffRatingComment[] = [];
    for (const r of rated.items) {
      const choice = str(r.rating);
      if (choice !== "up" && choice !== "down") continue;
      const agent = STAFF_ID_RE.test(str(r.rated_agent))
        ? str(r.rated_agent)
        : "";
      const row = per.get(agent) ?? { up: 0, down: 0 };
      if (choice === "up") {
        up += 1;
        row.up += 1;
      } else {
        down += 1;
        row.down += 1;
      }
      per.set(agent, row);
      const comment = str(r.rating_comment).trim();
      if (comment) {
        comments.push({
          number: Number(r.number) || 0,
          orgId: str(r.organization),
          business: business(str(r.organization)),
          rating: choice,
          comment,
          ratedAt: str(r.rated_at),
          agent: agentName(agent),
        });
      }
    }
    const byAgent: StaffRatingsAgentRow[] = [...per.entries()]
      .map(([agentId, c]) => ({
        agentId,
        name: agentName(agentId),
        up: c.up,
        down: c.down,
        rate: ratingRate(c.up, c.down),
      }))
      .sort(
        (a, b) =>
          b.up + b.down - (a.up + a.down) || a.name.localeCompare(b.name),
      );
    const toFollowUp: StaffRatingFollowUp[] = pending.items.map((r) => {
      const agent = STAFF_ID_RE.test(str(r.rated_agent))
        ? str(r.rated_agent)
        : "";
      return {
        number: Number(r.number) || 0,
        orgId: str(r.organization),
        business: business(str(r.organization)),
        agent: agentName(agent),
        comment: str(r.rating_comment).trim() || null,
        ratedAt: str(r.rated_at),
      };
    });
    return {
      month,
      label: `${bounds.label} ${bounds.year}`,
      overall: { up, down, rate: ratingRate(up, down) },
      byAgent,
      comments,
      toFollowUp,
    };
  });
}

/**
 * Mark a thumbs-down as followed up (`support_reply`): stamps `rating_followed_at` and writes
 * audit `support.rating_followed_up` with the organization. Only a thumbs-down can be marked;
 * marking one already marked changes nothing and writes no audit row.
 */
export async function staffMarkRatingFollowedUp(
  ctx: PlatformContext,
  number: unknown,
  opts: { now?: Date } = {},
): Promise<{ number: number; followedAt: string; changed: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_reply");
  const n = parseTicketNumber(number);
  const now = opts.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return withSuperuser(async (pb) => {
    const found = await pb.collection(THREADS).getList(1, 1, {
      filter: pb.filter("number = {:n} && kind = 'ticket'", { n }),
      fields: "id,number,organization,rating,rating_followed_at",
      skipTotal: true,
    });
    const thread = found.items[0];
    if (!thread) throw new NotFound("ticket not found");
    if (str(thread.rating) !== "down") {
      throw new InvalidInput("only a thumbs-down needs a follow-up");
    }
    const already = str(thread.rating_followed_at);
    if (already) return { number: n, followedAt: already, changed: false };
    const at = now.toISOString();
    const batch = pb.createBatch();
    batch.collection(THREADS).update(thread.id, { rating_followed_at: at });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.rating_followed_up",
        organization: str(thread.organization),
        targetCollection: THREADS,
        targetId: thread.id,
        meta: { number: n },
      }),
    );
    await batch.send();
    return { number: n, followedAt: at, changed: true };
  });
}
