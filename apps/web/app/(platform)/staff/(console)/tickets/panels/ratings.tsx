// Panel tickets/ratings: filled by 13-42
// Ratings & SLA (13-42 choice 4; STAFF-21, D212, P13-P32; 13-UI-SPEC lines 597-609).
// `?month=YYYY-MM` (default the current business month, America/Chicago; anything else falls
// back to it) drives both reads: staffRatingsReport (per-agent and overall up/down and rate,
// comments, thumbs-down to follow up) and staffSlaReport (the month's first-reply SLA, shown as
// the CLI line `slaReportLine` and the missed tickets). Both are `support_read`; the Followed up
// switch shows only with `support_reply`. The reads run side by side and a failed one shows
// ERR-LOAD for its section only (class name logged).
import {
  slaLateLabel,
  slaMonthOf,
  slaReportLine,
  staffRatingsReport,
  staffSlaReport,
} from "@cds/db";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { RatingsIsland, type RatingsMonthOption } from "../RatingsIsland";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS_SHOWN = 12;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The current business month and the 11 before it, newest first. */
export function ratingsMonths(current: string): RatingsMonthOption[] {
  const m = MONTH_RE.exec(current);
  if (!m) return [];
  let year = Number(m[1]);
  let month = Number(m[2]);
  const out: RatingsMonthOption[] = [];
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  for (let i = 0; i < MONTHS_SHOWN; i += 1) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    out.push({
      value,
      label: fmt.format(new Date(Date.UTC(year, month - 1, 15))),
    });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const now = new Date();
  const current = slaMonthOf(now);
  const months = ratingsMonths(current);
  const asked = one(params.month);
  const month = months.some((m) => m.value === asked) ? asked : current;

  const [ratings, sla] = await Promise.allSettled([
    staffRatingsReport(session.ctx, { month, now }),
    staffSlaReport(session.ctx, { month, now }),
  ]);
  if (ratings.status === "rejected") {
    console.error("[staff] ratings report failed", errName(ratings.reason));
  }
  if (sla.status === "rejected") {
    console.error("[staff] sla report failed", errName(sla.reason));
  }

  return (
    <RatingsIsland
      key={month}
      month={month}
      months={months}
      report={ratings.status === "fulfilled" ? ratings.value : null}
      sla={
        sla.status === "fulfilled"
          ? {
              line: slaReportLine(sla.value),
              missed: sla.value.missedTickets.map((t) => ({
                number: t.number,
                late: slaLateLabel(t.lateMs),
              })),
            }
          : null
      }
      canFollowUp={staffCan(session.role, "support_reply")}
    />
  );
}
