// LaunchReviewCard (11-17; DASH-33, D172; 11-UI-SPEC "Today" § 2 Ready for your review;
// D-UI-P11-25). Replaces the tracker once the site is ready for review: a surface-2 panel
// with the heading, "N of 6 done", a determinate bar (role=progressbar with a text
// equivalent) and the six D172 items with status icons. The primary Continue review shows
// only when P14 reports the review available AND this person may run it (the Owner);
// before P14 the card shows REVIEW-SOON and no button (never a button to a screen that
// doesn't exist). Server-safe (useId only).
// 14-34 (choice 5; DOM-10, D172): with P14 the review is available at ready_for_review and
// Continue review goes to /hub/review. Once the owner has sent it (`submitted`), the heading
// becomes SUBMITTED-H "CDS is giving it a final look." and the button goes.
import { P14_COPY } from "@cds/core/dns";
import { useId } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { buttonClasses } from "../Button";
import { StageStatusIcon } from "../StageRail";
import { TODAY_COPY } from "./copy";

export interface LaunchReviewItemView {
  id: string;
  label: string;
  done: boolean;
}

export interface LaunchReviewCardProps {
  items: readonly LaunchReviewItemView[];
  done: number;
  total: number;
  /** P14's review route exists for this site. */
  available: boolean;
  /** The person may run the review (Owner; Admin and staff see it read-only). */
  canContinue: boolean;
  continueHref?: string;
  /** 14-34: the owner sent the review (Ready to launch) and nothing changed since. */
  submitted?: boolean;
  LinkComponent?: HubLinkComponent;
}

export function LaunchReviewCard({
  items,
  done,
  total,
  available,
  canContinue,
  continueHref = "/hub/review",
  submitted = false,
  LinkComponent,
}: LaunchReviewCardProps) {
  const headingId = useId();
  const Link = LinkComponent ?? "a";
  const count = TODAY_COPY.reviewCount(done, total);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
      data-launch-review=""
      data-submitted={submitted ? "" : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {submitted ? P14_COPY.SUBMITTED_H : TODAY_COPY.reviewHeading}
        </h2>
        <p className="ml-auto text-sm tabular-nums">{count}</p>
      </div>
      <div
        role="progressbar"
        aria-label={TODAY_COPY.reviewHeading}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={count}
        className="h-1 w-full overflow-hidden rounded-full bg-hub-border"
      >
        <div className="h-full bg-hub-ink" style={{ width: `${pct}%` }} />
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 text-base"
            data-review-item={item.id}
          >
            <StageStatusIcon status={item.done ? "done" : "not_started"} />
            {item.label}
          </li>
        ))}
      </ul>
      {available ? (
        canContinue && !submitted ? (
          <div>
            <Link href={continueHref} className={buttonClasses("primary")}>
              {TODAY_COPY.continueReview}
            </Link>
          </div>
        ) : null
      ) : (
        <p className="text-sm text-hub-ink-muted">{TODAY_COPY.reviewSoon}</p>
      )}
    </section>
  );
}
