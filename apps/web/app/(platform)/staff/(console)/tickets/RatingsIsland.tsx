"use client";
// Ratings & SLA island (13-42 choice 4; STAFF-21, D212; 13-UI-SPEC lines 597-609). The Month
// Select (last 12 business months, `?month=YYYY-MM`), the SlaCard and the RatingsReport. The
// Followed up switch posts markRatingFollowedUpAction through useStaffAction (session-ended
// and role refusals handled by the console provider) and toasts the action line. A section
// whose read failed shows ERR-LOAD with Try again.
import { InlineAlert, Select, useToast } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import {
  RatingsReport,
  SlaCard,
  useStaffAction,
  type RatingsReportView,
  type SlaMissedView,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { markRatingFollowedUpAction } from "../../../../actions/staff/ratings";

export type RatingsMonthOption = { value: string; label: string };

export interface RatingsIslandProps {
  month: string;
  months: readonly RatingsMonthOption[];
  report: RatingsReportView | null;
  sla: { line: string; missed: SlaMissedView[] } | null;
  canFollowUp: boolean;
}

export function ratingsTabHref(month: string): string {
  return `/staff/tickets?tab=ratings&month=${encodeURIComponent(month)}`;
}

function LoadError({ month }: { month: string }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <a
          href={ratingsTabHref(month)}
          className="rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          {SUPPORT_UI_COPY.BUTTONS.tryAgain}
        </a>
      }
    >
      {SUPPORT_UI_COPY.ERR_LOAD}
    </InlineAlert>
  );
}

export function RatingsIsland({
  month,
  months,
  report,
  sla,
  canFollowUp,
}: RatingsIslandProps) {
  const router = useRouter();
  const toast = useToast();
  const markFollowed = useStaffAction(markRatingFollowedUpAction);

  async function onFollowedUp(n: number) {
    const res = await markFollowed(n);
    if (res.ok) {
      router.refresh();
      return { ok: true as const, message: res.data.message };
    }
    // session_ended / step-up are handled by the console provider.
    return {
      ok: false as const,
      message: res.code === "session_ended" ? "" : res.message,
    };
  }

  return (
    <div className="flex flex-col gap-6" data-ratings-tab={month}>
      <div className="max-w-60">
        <Select
          id="ratings-month"
          label="Month"
          options={months}
          value={month}
          onChange={(ev) => router.push(ratingsTabHref(ev.target.value))}
        />
      </div>
      {sla ? (
        <SlaCard line={sla.line} missed={sla.missed} />
      ) : (
        <LoadError month={month} />
      )}
      {report ? (
        <RatingsReport
          report={report}
          canFollowUp={canFollowUp}
          onFollowedUp={onFollowedUp}
          notify={(message) => toast.show({ message })}
        />
      ) : (
        <LoadError month={month} />
      )}
    </div>
  );
}
