// BuildTracker (11-17; DASH-02, DASH-31; 11-UI-SPEC "Today" § 2 Being built). A panel with
// the five steps from core `deriveTracker` (Received · Site assembled · CDS polishing · Your
// review · Live): a horizontal <ol> with 1px connectors from 768px, a vertical one below.
// Status is never colour alone: every icon carries a hidden word (StageStatusIcon), and the
// current step adds the visible word "Now" plus aria-current="step" on an accent-tint
// ground (the P6 StageRail rule). Under the steps: "What CDS is doing now:" with the org's
// build note (and "Updated 9 Oct"), or the current step's TRACK-DEFAULT line; then
// TRACK-EDIT. No percentage, no ring. Server-safe (useId only).
// P14 (14-30 choice 2): optional `heading` (default "Your build") and `orientation:
// "vertical"` (the vertical <ol> at every width) let the domain progress reuse it. The
// defaults render exactly as before.
import type { TrackerStep } from "@cds/core/today";
import { useId } from "react";
import { StageStatusIcon, type StageRailStatus } from "../StageRail";
import { formatDayMonth, TODAY_COPY } from "./copy";

export interface BuildTrackerProps {
  steps: readonly TrackerStep[];
  /** The org's build note (CDS staff write it); "" or absent uses the step default. */
  note?: string;
  /** When the note was written (stored date). */
  noteAt?: string | null;
  /** Business time zone for the dates. */
  timeZone: string;
  /** Panel heading. Default TODAY_COPY.yourBuild. */
  heading?: string;
  /** "vertical" forces the vertical <ol> at every width. Default "responsive". */
  orientation?: "responsive" | "vertical";
}

const STATUS: Readonly<Record<TrackerStep["state"], StageRailStatus>> = {
  done: "done",
  current: "started",
  upcoming: "not_started",
};

function connector(on: boolean, hidden: boolean, vertical: boolean): string {
  return (
    (vertical ? "hidden h-px flex-1 " : "hidden h-px flex-1 md:block ") +
    (hidden ? "invisible" : on ? "bg-hub-ink" : "bg-hub-border-strong")
  );
}

export function BuildTracker({
  steps,
  note,
  noteAt,
  timeZone,
  heading,
  orientation = "responsive",
}: BuildTrackerProps) {
  const vertical = orientation === "vertical";
  const headingId = useId();
  const current = steps.find((s) => s.state === "current");
  const trimmed = note?.trim() ?? "";
  const line = trimmed || current?.defaultLine || "";
  const updated = trimmed && noteAt ? formatDayMonth(noteAt, timeZone) : "";
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
      data-build-tracker=""
    >
      <h2 id={headingId} className="text-xl leading-tight font-semibold">
        {heading ?? TODAY_COPY.yourBuild}
      </h2>
      <ol
        data-orientation={vertical ? "vertical" : undefined}
        className={
          vertical
            ? "flex flex-col gap-1"
            : "flex flex-col gap-1 md:grid md:grid-cols-5 md:gap-0"
        }
      >
        {steps.map((s, i) => {
          const on = s.state === "current";
          const date =
            s.state === "done" && s.at ? formatDayMonth(s.at, timeZone) : "";
          const next = steps[i + 1];
          return (
            <li
              key={s.id}
              aria-current={on ? "step" : undefined}
              data-step={s.id}
              data-state={s.state}
              className={
                (vertical
                  ? "flex min-h-6 items-center gap-2 rounded px-2 py-1 "
                  : "flex min-h-6 items-center gap-2 rounded px-2 py-1 md:flex-col md:items-stretch md:gap-1 md:px-1 md:py-2 ") +
                (on ? "bg-hub-accent-tint text-hub-accent" : "")
              }
            >
              <span
                className={
                  vertical
                    ? "flex items-center gap-2"
                    : "flex items-center gap-2 md:gap-1"
                }
              >
                <span
                  aria-hidden
                  className={connector(s.state === "done", i === 0, vertical)}
                />
                <StageStatusIcon status={STATUS[s.state]} />
                <span
                  aria-hidden
                  className={connector(
                    next?.state === "done",
                    i === steps.length - 1,
                    vertical,
                  )}
                />
              </span>
              <span
                className={
                  vertical
                    ? "flex flex-wrap items-baseline gap-x-2"
                    : "flex flex-wrap items-baseline gap-x-2 md:flex-col md:items-center md:text-center"
                }
              >
                <span className="text-sm font-semibold">{s.label}</span>
                {on ? (
                  <span className="text-sm">{TODAY_COPY.nowWord}</span>
                ) : null}
                {date ? (
                  <span className="text-sm text-hub-ink-muted">{date}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {line ? (
        <div className="flex max-w-[68ch] flex-col gap-1">
          <p className="text-base">
            <span className="font-semibold">{TODAY_COPY.whatNow}</span> {line}
          </p>
          {updated ? (
            <p className="text-sm text-hub-ink-muted">
              {TODAY_COPY.updated(updated)}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="max-w-[68ch] text-sm text-hub-ink-muted">
        {TODAY_COPY.trackEdit}
      </p>
    </section>
  );
}
