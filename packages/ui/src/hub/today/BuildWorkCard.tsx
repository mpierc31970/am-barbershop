// BuildWorkCard (11-19; DASH-33; 11-UI-SPEC "Today" § 2 "Live, normal" WorkProgressCard). After
// launch, while CDS work orders need setup: a small panel above Needs you with one row per job:
// Body 600 title, the compact vertical tracker limited to three steps (Ordered · CDS is setting
// it up · Ready; StageStatusIcon with hidden words, aria-current on the current step) and Label
// "Started 9 Oct", plus a "View quote" link. Absent when no job is open. Server-safe.
import { useId } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { StageStatusIcon, type StageRailStatus } from "../StageRail";
import { TODAY_CARDS_COPY } from "./copy";

export type BuildWorkStep = "ordered" | "setting_up";

export type BuildWorkJob = {
  id: string;
  title: string;
  step: BuildWorkStep;
  /** "9 Oct"; "" hides the line. */
  startedLabel: string;
  href: string;
};

export interface BuildWorkCardProps {
  jobs: readonly BuildWorkJob[];
  LinkComponent?: HubLinkComponent;
}

const CURRENT: Readonly<Record<BuildWorkStep, number>> = {
  ordered: 0,
  setting_up: 1,
};

function statusAt(i: number, current: number): StageRailStatus {
  if (i < current) return "done";
  return i === current ? "started" : "not_started";
}

export function BuildWorkCard({ jobs, LinkComponent }: BuildWorkCardProps) {
  const headingId = useId();
  const Link = LinkComponent ?? "a";
  if (jobs.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      data-build-work=""
      className="flex flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
    >
      <h2 id={headingId} className="text-xl leading-tight font-semibold">
        {TODAY_CARDS_COPY.workHeading}
      </h2>
      <ul className="flex flex-col divide-y divide-hub-border">
        {jobs.map((job) => {
          const current = CURRENT[job.step];
          return (
            <li
              key={job.id}
              data-build-job={job.id}
              data-step={job.step}
              className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-base font-semibold break-words">
                  {job.title}
                </p>
                <ol className="flex flex-col gap-1">
                  {TODAY_CARDS_COPY.workSteps.map((name, i) => (
                    <li
                      key={name}
                      aria-current={i === current ? "step" : undefined}
                      className={
                        "flex items-center gap-2 text-sm " +
                        (i === current
                          ? "font-semibold text-hub-accent"
                          : "text-hub-ink-muted")
                      }
                    >
                      <StageStatusIcon status={statusAt(i, current)} />
                      {name}
                    </li>
                  ))}
                </ol>
                {job.startedLabel ? (
                  <p className="text-sm text-hub-ink-muted">
                    {TODAY_CARDS_COPY.started(job.startedLabel)}
                  </p>
                ) : null}
              </div>
              <Link
                href={job.href}
                aria-label={`${TODAY_CARDS_COPY.viewQuote}: ${job.title}`}
                className="shrink-0 rounded text-base text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
              >
                {TODAY_CARDS_COPY.viewQuote}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
