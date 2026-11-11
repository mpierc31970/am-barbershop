"use client";
// RatingsReport (13-42 choice 4; STAFF-21, D212, P13-P32; 13-UI-SPEC "Ratings & SLA" lines
// 597-609). Heading "Ratings", one overall Body line "23 rated · 21 thumbs up · 2 thumbs down
// (91%)", then a StaffTable per agent (Agent · Thumbs up · Thumbs down · Rate). Below, a
// SegmentedControl **Needs follow-up · All comments**:
//   - Needs follow-up: every thumbs-down not yet followed up (any month, so nothing drops off):
//     # (link) · Site · Agent · Comment (2-line clamp) · Rated · Switch **Followed up**. Turning
//     it on calls `onFollowedUp(number)`; the row leaves the list once it saves (and Today's
//     count follows). Roles without `support_reply` see the list without the switch.
//   - All comments: # · Site · Rating · Comment · Agent · Rated.
// Rating words always sit next to the icon (Badge "Thumbs up" / "Thumbs down"): never colour
// alone. Empty month: "No ratings in October yet." The "Resolved (n)" column is left out: the
// report has no per-agent resolved count (13-42 SUMMARY). Tenant text is React text only.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { P13_COPY } from "@cds/core/staff";
import type { RatingChoice } from "@cds/core/support";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../hub/Badge";
import { SegmentedControl } from "../../hub/SegmentedControl";
import { Switch } from "../../hub/Switch";
import { StaffTable, type StaffColumn } from "../table/StaffTable";

export type RatingsAgentView = {
  agentId: string;
  name: string;
  up: number;
  down: number;
  rate: number | null;
};

export type RatingsCommentView = {
  number: number;
  orgId: string;
  business: string;
  rating: RatingChoice;
  comment: string;
  ratedAt: string;
  agent: string;
};

export type RatingsFollowUpView = {
  number: number;
  orgId: string;
  business: string;
  agent: string;
  comment: string | null;
  ratedAt: string;
};

/** The console's view of `staffRatingsReport` (structurally the same shape). */
export type RatingsReportView = {
  month: string;
  label: string;
  overall: { up: number; down: number; rate: number | null };
  byAgent: readonly RatingsAgentView[];
  comments: readonly RatingsCommentView[];
  toFollowUp: readonly RatingsFollowUpView[];
};

export type FollowUpResult =
  { ok: true; message: string } | { ok: false; message: string };

export interface RatingsReportProps {
  report: RatingsReportView;
  /** `support_reply`: shows the Followed up switch. */
  canFollowUp: boolean;
  onFollowedUp(number: number): Promise<FollowUpResult>;
  /** Toast a message; without it the message shows inline. */
  notify?(message: string): void;
  timeZone?: string;
}

function rateText(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

export const RATINGS_REPORT_COPY = Object.freeze({
  heading: "Ratings",
  overall: (up: number, down: number, rate: number | null) =>
    `${up + down} rated · ${up} thumbs up · ${down} thumbs down` +
    (rate === null ? "" : ` (${rate}%)`),
  empty: (label: string) =>
    `No ratings in ${label.split(" ")[0] ?? label} yet.`,
  agentCaption: "Ratings by agent",
  followCaption: "Thumbs down to follow up, oldest first",
  commentsCaption: "Rating comments, newest first",
  views: { follow: "Needs follow-up", comments: "All comments" },
  viewsLabel: "Show",
  followHeading: "Thumbs down to follow up",
  commentsHeading: "Comments",
  followEmpty: "Every thumbs down is followed up.",
  commentsEmpty: "No comments this month.",
  cols: {
    agent: "Agent",
    up: "Thumbs up",
    down: "Thumbs down",
    rate: "Rate",
    number: "#",
    site: "Site",
    rating: "Rating",
    comment: "Comment",
    rated: "Rated",
    followed: "Followed up",
  },
  up: "Thumbs up",
  down: "Thumbs down",
  unassigned: "Unassigned",
  noComment: P13_COPY.MAIL_NO_COMMENT,
  followedRow: (n: number) => `Followed up #${n}`,
  agentLine: (r: RatingsAgentView) =>
    `${r.up} Thumbs up · ${r.down} Thumbs down · ${rateText(r.rate)}`,
});
const C = RATINGS_REPORT_COPY;

type View = "follow" | "comments";

function dayText(iso: string, timeZone: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);
}

function agentHref(r: RatingsAgentView): string {
  return `/staff/tickets?tab=inbox&assignee=${r.agentId ? encodeURIComponent(r.agentId) : "none"}`;
}

function ticketHref(n: number): string {
  return `/staff/tickets/${n}`;
}

function RatingWord({ rating }: { rating: RatingChoice }) {
  return (
    <Badge tone={rating === "up" ? "rating-up" : "rating-down"}>
      {rating === "up" ? C.up : C.down}
    </Badge>
  );
}

const CLAMP = "line-clamp-2 max-w-md break-words";

export function RatingsReport({
  report,
  canFollowUp,
  onFollowedUp,
  notify,
  timeZone = BUSINESS_TIME_ZONE,
}: RatingsReportProps) {
  const [view, setView] = useState<View>("follow");
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const { up, down, rate } = report.overall;
  const follow = useMemo(
    () => report.toFollowUp.filter((r) => !done.has(r.number)),
    [report.toFollowUp, done],
  );

  async function markFollowed(n: number) {
    if (busy !== null) return;
    setBusy(n);
    setMessage(null);
    let res: FollowUpResult;
    try {
      res = await onFollowedUp(n);
    } catch {
      res = { ok: false, message: "That didn't save. Try again." };
    }
    setBusy(null);
    if (res.ok) {
      setDone((cur) => new Set([...cur, n]));
      if (notify) notify(res.message);
      else setMessage({ text: res.message, error: false });
    } else if (res.message) {
      if (notify) notify(res.message);
      else setMessage({ text: res.message, error: true });
    }
  }

  const agentCols: StaffColumn<RatingsAgentView>[] = [
    {
      id: "agent",
      header: C.cols.agent,
      primary: true,
      priority: 1,
      cell: (r) => r.name || C.unassigned,
    },
    {
      id: "up",
      header: C.cols.up,
      priority: 1,
      align: "end",
      stack: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ThumbsUp aria-hidden size={14} strokeWidth={2} />
          {r.up}
        </span>
      ),
    },
    {
      id: "down",
      header: C.cols.down,
      priority: 1,
      align: "end",
      stack: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ThumbsDown aria-hidden size={14} strokeWidth={2} />
          {r.down}
        </span>
      ),
    },
    {
      id: "rate",
      header: C.cols.rate,
      priority: 1,
      align: "end",
      stack: true,
      cell: (r) => <span className="tabular-nums">{rateText(r.rate)}</span>,
    },
  ];

  const followCols: StaffColumn<RatingsFollowUpView>[] = [
    {
      id: "number",
      header: C.cols.number,
      primary: true,
      priority: 1,
      nowrap: true,
      width: "88px",
      cell: (r) => <span className="tabular-nums">#{r.number}</span>,
    },
    {
      id: "site",
      header: C.cols.site,
      priority: 1,
      stack: true,
      cell: (r) => r.business,
    },
    {
      id: "agent",
      header: C.cols.agent,
      priority: 3,
      cell: (r) => r.agent || C.unassigned,
    },
    {
      id: "comment",
      header: C.cols.comment,
      priority: 2,
      cell: (r) =>
        r.comment ? (
          <span className={CLAMP}>{r.comment}</span>
        ) : (
          <span className="text-hub-ink-muted">{C.noComment}</span>
        ),
    },
    {
      id: "rated",
      header: C.cols.rated,
      priority: 3,
      nowrap: true,
      cell: (r) => dayText(r.ratedAt, timeZone),
    },
    ...(canFollowUp
      ? [
          {
            id: "followed",
            header: C.cols.followed,
            priority: 1 as const,
            stack: true,
            cell: (r: RatingsFollowUpView) => (
              <Switch
                id={`followed-${r.number}`}
                label={C.followedRow(r.number)}
                labelHidden
                checked={false}
                disabled={busy !== null}
                onChange={(on) => {
                  if (on) void markFollowed(r.number);
                }}
              />
            ),
          },
        ]
      : []),
  ];

  const commentCols: StaffColumn<RatingsCommentView>[] = [
    {
      id: "number",
      header: C.cols.number,
      primary: true,
      priority: 1,
      nowrap: true,
      width: "88px",
      cell: (r) => <span className="tabular-nums">#{r.number}</span>,
    },
    {
      id: "site",
      header: C.cols.site,
      priority: 2,
      cell: (r) => r.business,
    },
    {
      id: "rating",
      header: C.cols.rating,
      priority: 1,
      stack: true,
      cell: (r) => <RatingWord rating={r.rating} />,
    },
    {
      id: "comment",
      header: C.cols.comment,
      priority: 1,
      stack: true,
      cell: (r) => <span className={CLAMP}>{r.comment}</span>,
    },
    {
      id: "agent",
      header: C.cols.agent,
      priority: 3,
      cell: (r) => r.agent || C.unassigned,
    },
    {
      id: "rated",
      header: C.cols.rated,
      priority: 3,
      nowrap: true,
      cell: (r) => dayText(r.ratedAt, timeZone),
    },
  ];

  const rated = up + down > 0;

  return (
    <section
      aria-labelledby="ratings-report-h"
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-ratings-report={report.month}
    >
      <h2 id="ratings-report-h" className="text-base font-semibold">
        {C.heading}
      </h2>
      {rated ? (
        <>
          <p className="text-base tabular-nums" data-ratings-overall="">
            {C.overall(up, down, rate)}
          </p>
          <StaffTable
            caption={C.agentCaption}
            columns={agentCols}
            rows={report.byAgent}
            rowKey={(r) => r.agentId || "unassigned"}
            rowLabel={(r) => r.name || C.unassigned}
            rowAnnouncement={(r) =>
              `${r.name || C.unassigned}, ${C.agentLine(r)}`
            }
            primaryHref={agentHref}
            shortcutsEnabled={false}
          />
        </>
      ) : (
        <p className="text-base text-hub-ink-muted" data-ratings-empty="">
          {C.empty(report.label)}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <SegmentedControl
          name="ratings-view"
          label={C.viewsLabel}
          options={[
            { value: "follow", label: C.views.follow },
            { value: "comments", label: C.views.comments },
          ]}
          value={view}
          onChange={(v) => setView(v)}
        />
        {view === "follow" ? (
          <div className="flex flex-col gap-2" data-ratings-follow="">
            <h3 className="text-sm font-semibold">{C.followHeading}</h3>
            {follow.length > 0 ? (
              <StaffTable
                caption={C.followCaption}
                columns={followCols}
                rows={follow}
                rowKey={(r) => String(r.number)}
                rowLabel={(r) => `#${r.number}`}
                primaryHref={(r) => ticketHref(r.number)}
                shortcutsEnabled={false}
              />
            ) : (
              <p className="text-sm text-hub-ink-muted">{C.followEmpty}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-ratings-comments="">
            <h3 className="text-sm font-semibold">{C.commentsHeading}</h3>
            {report.comments.length > 0 ? (
              <StaffTable
                caption={C.commentsCaption}
                columns={commentCols}
                rows={report.comments}
                rowKey={(r) => String(r.number)}
                rowLabel={(r) => `#${r.number}`}
                primaryHref={(r) => ticketHref(r.number)}
                shortcutsEnabled={false}
              />
            ) : (
              <p className="text-sm text-hub-ink-muted">{C.commentsEmpty}</p>
            )}
          </div>
        )}
        <p
          role={message?.error ? "alert" : "status"}
          className={
            message
              ? `text-sm ${message.error ? "text-hub-danger" : "text-hub-ink"}`
              : "sr-only"
          }
        >
          {message?.text ?? ""}
        </p>
      </div>
    </section>
  );
}
