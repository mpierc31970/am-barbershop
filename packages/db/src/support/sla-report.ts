// P12 SLA month report (12-28; SUPPORT-02). `support:sla` prints it; P13's console reads the
// same function. Problem and Question tickets created in one business month (America/Chicago,
// `careMonth`) are counted by their first public CDS reply: met (on or before due) or missed
// (late, or still unanswered past due). Tickets CDS opened itself are left out: they are
// answered at creation (D210) and would only inflate "met". Unanswered tickets not yet due are
// counted as `waiting`.
//
// Also `staffSupportSignature`: the "Mara · CDS" name the owner sees on a staff reply, for the
// support:reply preview (the CLI holds no PocketBase client, Invariant 1).
import { authorizeStaff, InvalidInput } from "@cds/core";
import { careMonth } from "@cds/core/payments";
import {
  businessMsBetween,
  slaApplies,
  type TicketType,
} from "@cds/core/support";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { assertId } from "../repository";
import { staffFirstName, THREADS } from "./shared";

/** Rows one report reads (10-50 tenants: a month's tickets fit). */
const REPORT_MAX = 5000;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export type SlaMissedTicket = {
  number: number;
  orgId: string;
  orgName: string;
  /** Business milliseconds past due (to the reply, or to now when unanswered). */
  lateMs: number;
  answered: boolean;
};

export type SlaMonthReport = {
  /** "2026-10" */
  month: string;
  /** "October 2026" */
  label: string;
  /** met + missed: tickets whose first-reply SLA is decided. */
  firstReplies: number;
  met: number;
  missed: number;
  /** Unanswered and not yet due. */
  waiting: number;
  /** Oldest number first. */
  missedTickets: SlaMissedTicket[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function time(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

/** "2026-10" for the business month `now` falls in. */
export function slaMonthOf(now: Date): string {
  const m = careMonth(now);
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
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

/**
 * First-reply SLA hits and misses for one business month (`support_read`). `orgId` narrows
 * the report to one site.
 */
export async function staffSlaReport(
  ctx: PlatformContext,
  input: { month?: string; orgId?: string; now?: Date } = {},
): Promise<SlaMonthReport> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  const month = input.month ?? slaMonthOf(now);
  const bounds = monthBounds(month);
  if (input.orgId !== undefined) assertId(input.orgId);

  return withSuperuser(async (pb) => {
    const parts = [
      "kind = 'ticket'",
      "(type = 'problem' || type = 'question')",
      "opened_by_cds = false",
      "created >= {:start} && created < {:end}",
    ];
    const params: Record<string, unknown> = {
      start: bounds.start,
      end: bounds.end,
    };
    if (input.orgId !== undefined) {
      parts.push("organization = {:org}");
      params.org = input.orgId;
    }
    const res = await pb.collection(THREADS).getList(1, REPORT_MAX, {
      filter: pb.filter(parts.join(" && "), params),
      sort: "number",
      fields:
        "id,number,organization,type,first_reply_due_at,first_replied_at,opened_by_cds,resolved_at,closed_at",
      skipTotal: true,
    });
    let met = 0;
    let waiting = 0;
    const missed: Omit<SlaMissedTicket, "orgName">[] = [];
    for (const r of res.items) {
      if (!slaApplies(str(r.type) as TicketType)) continue;
      const due = time(r.first_reply_due_at);
      if (due === null) continue;
      const replied = time(r.first_replied_at);
      const stopped = stoppedAt(r);
      if (replied !== null) {
        if (replied <= due) met++;
        else {
          missed.push({
            number: Number(r.number) || 0,
            orgId: str(r.organization),
            lateMs: businessMsBetween(new Date(due), new Date(replied)),
            answered: true,
          });
        }
      } else if (stopped !== null && stopped <= due) {
        // 12-REVIEW WR-A08: solved or closed before it was due with no reply needed (the
        // member solved it, or an incident or a status-only move resolved it): not counted.
        continue;
      } else if (now.getTime() > due) {
        // Never answered: late until it was resolved or closed, else until now.
        const until = Math.min(stopped ?? now.getTime(), now.getTime());
        missed.push({
          number: Number(r.number) || 0,
          orgId: str(r.organization),
          lateMs: businessMsBetween(new Date(due), new Date(until)),
          answered: false,
        });
      } else {
        waiting++;
      }
    }
    const names = new Map<string, string>();
    for (const id of new Set(missed.map((m) => m.orgId))) {
      if (!/^[a-z0-9]{15}$/.test(id)) continue;
      const org = await pb
        .collection("organizations")
        .getOne(id, { fields: "id,name" })
        .catch(() => null);
      names.set(id, str(org?.name));
    }
    return {
      month,
      label: `${bounds.label} ${bounds.year}`,
      firstReplies: met + missed.length,
      met,
      missed: missed.length,
      waiting,
      missedTickets: missed.map((m) => ({
        ...m,
        orgName: names.get(m.orgId) ?? "",
      })),
    };
  });
}

/** "3h late", "45m late", "2d late" (business time). */
/** The earliest of resolved_at and closed_at, or null while the ticket is still open. */
function stoppedAt(r: Readonly<Record<string, unknown>>) {
  const times = [time(r.resolved_at), time(r.closed_at)].filter(
    (t): t is number => t !== null,
  );
  return times.length > 0 ? Math.min(...times) : null;
}

export function slaLateLabel(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m late`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h late`;
  return `${Math.floor(h / 24)}d late`;
}

/** "October 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)" (UI-SPEC). */
export function slaReportLine(r: SlaMonthReport): string {
  const misses = r.missedTickets
    .map((m) => `#${m.number}, ${slaLateLabel(m.lateMs)}`)
    .join("; ");
  const parts = [
    r.label,
    `first replies ${r.firstReplies}`,
    `met ${r.met}`,
    `missed ${r.missed}${misses ? ` (${misses})` : ""}`,
  ];
  if (r.waiting > 0) parts.push(`not yet due ${r.waiting}`);
  return parts.join(" · ");
}

/** The name the owner sees on this staff member's replies: "Mara · CDS" (`support_reply`). */
export async function staffSupportSignature(
  ctx: PlatformContext,
): Promise<string> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_reply");
  const first = await withSuperuser((pb) => staffFirstName(pb, ctx.actor));
  return first === "CDS" ? "CDS" : `${first} · CDS`;
}
