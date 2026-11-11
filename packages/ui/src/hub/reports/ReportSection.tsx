// Reports building blocks (11-33; DASH-10, DASH-11; 11-UI-SPEC "Reports" lines 741-802,
// "Interaction states" Reports row). Server-safe (no hooks except useId).
// - ReportSection: one `<section aria-labelledby>` with an <h2>, an optional right-aligned
//   Label ("Last 30 days") and a body. `failed` swaps the body for ERR-SECTION + Try again,
//   so one failed read never takes the page down.
// - NotConnectedNote: GA4 / Search Console before CDS connects them (D196). Never an error,
//   never a connect button.
// - PeriodControl: Last 7 / 30 / 90 days as real links (`?period=`), styled like the
//   SegmentedControl; works without JavaScript and keeps history.
// - ReportFigures: the Summary sentence + <dl> row (Body 600 tabular figures with
//   plain-word deltas; no Display numbers, D-UI-P11-9).
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import {
  REPORTS_COPY,
  REPORT_PERIODS,
  deltaWords,
  formatCount,
  type ReportPeriod,
} from "./copy";

export interface ReportSectionProps {
  title: string;
  /** Right-aligned Label, e.g. "Last 30 days". */
  label?: string;
  /** The section's read failed: show ERR-SECTION instead of the body. */
  failed?: boolean;
  /** Where Try again goes (the same report URL). */
  retryHref?: string;
  children?: ReactNode;
  LinkComponent?: HubLinkComponent;
}

export function ReportSection({
  title,
  label,
  failed = false,
  retryHref,
  children,
  LinkComponent,
}: ReportSectionProps) {
  const id = useId();
  const Link = LinkComponent ?? "a";
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 font-hub text-hub-ink"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} className="text-xl leading-tight font-semibold">
          {title}
        </h2>
        {label ? (
          <p className="ml-auto text-sm text-hub-ink-muted">{label}</p>
        ) : null}
      </div>
      {failed ? (
        <InlineAlert
          tone="error"
          action={
            retryHref ? (
              <Link
                href={retryHref}
                className={buttonClasses("secondary", "sm")}
              >
                {REPORTS_COPY.tryAgain}
              </Link>
            ) : undefined
          }
        >
          {REPORTS_COPY.errSection}
        </InlineAlert>
      ) : (
        children
      )}
    </section>
  );
}

/** GA4 / Search Console not connected yet (stand-in or no property). */
export function NotConnectedNote() {
  return (
    <div className="flex flex-col gap-1 font-hub" data-not-connected="">
      <p className="text-base text-hub-ink-muted">
        {REPORTS_COPY.notConnected}
      </p>
      <p className="text-sm text-hub-ink-muted">
        {REPORTS_COPY.notConnectedNote}
      </p>
    </div>
  );
}

export interface PeriodControlProps {
  value: ReportPeriod;
  hrefFor: (period: ReportPeriod) => string;
  LinkComponent?: HubLinkComponent;
}

export function PeriodControl({
  value,
  hrefFor,
  LinkComponent,
}: PeriodControlProps) {
  const Link = LinkComponent ?? "a";
  return (
    <nav aria-label={REPORTS_COPY.periodLabel} className="font-hub">
      <ul className="inline-flex rounded border border-hub-border bg-hub-surface-2 p-0.5">
        {REPORT_PERIODS.map((p) => {
          const active = p === value;
          return (
            <li key={p}>
              <Link
                href={hrefFor(p)}
                aria-current={active ? "true" : undefined}
                className={
                  "inline-flex h-9 items-center rounded px-3 text-sm transition-colors duration-150 " +
                  "pointer-coarse:h-11 " +
                  (active
                    ? "bg-hub-surface font-semibold text-hub-ink shadow-sm"
                    : "text-hub-ink-muted hover:text-hub-ink")
                }
              >
                {REPORTS_COPY.periodName(p)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface ReportFigure {
  label: string;
  now: number;
  /** Previous period's value; omit to show no delta. */
  prev?: number;
}

export interface ReportFiguresProps {
  period: ReportPeriod;
  figures: readonly ReportFigure[];
  /** The one-sentence summary (rendered above the figures). */
  sentence?: ReactNode;
}

const DELTA_ICON = {
  up: ArrowUp,
  new: ArrowUp,
  down: ArrowDown,
  same: ArrowRight,
} as const;

export function ReportFigures({
  period,
  figures,
  sentence,
}: ReportFiguresProps) {
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      {sentence ? <p className="max-w-[68ch] text-base">{sentence}</p> : null}
      <dl className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-6">
        {figures.map((f) => {
          const delta =
            f.prev === undefined ? null : deltaWords(f.now, f.prev, period);
          const Icon = delta ? DELTA_ICON[delta.direction] : null;
          return (
            <div key={f.label} className="flex flex-col gap-0.5">
              <dt className="text-sm text-hub-ink-muted">{f.label}</dt>
              <dd className="text-base font-semibold tabular-nums">
                {formatCount(f.now)}
              </dd>
              {delta && Icon ? (
                <dd className="inline-flex items-center gap-1 text-sm text-hub-ink-muted">
                  <Icon aria-hidden size={14} strokeWidth={2} />
                  {delta.words}
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>
    </div>
  );
}
