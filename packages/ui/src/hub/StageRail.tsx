// StageRail (06-18; 06-UI-SPEC "Stages" frame, Accessibility "Setup"; ONB-02). At 1024px
// and up: a 240px rail on hub-surface-2 with an "All steps" link and the seven steps (Label
// 14; status icon 16px + name; the current one in accent tint + accent text with
// aria-current="step"). Below 1024px it collapses to one line: "Step 3 of 7" + "All steps".
// Status is never colour alone: each icon carries a visually hidden word.
import { ArrowLeft, Circle, CircleCheck, CircleDashed } from "lucide-react";
import type { HubLinkComponent } from "./AddonCard";

export type StageRailStatus = "not_started" | "started" | "done";

export interface StageRailItem {
  slug: string;
  name: string;
  status: StageRailStatus;
  href: string;
}

export interface StageRailProps {
  stages: readonly StageRailItem[];
  current: string;
  /** The setup overview. */
  allHref?: string;
  /** next/link (or a guarded link) from the app; a plain <a> by default. */
  LinkComponent?: HubLinkComponent;
}

export const STATUS_WORDS: Readonly<Record<StageRailStatus, string>> =
  Object.freeze({
    done: "Done",
    started: "Started",
    not_started: "Not started",
  });

export function StageStatusIcon({
  status,
  size = 16,
}: {
  status: StageRailStatus;
  size?: 16 | 20;
}) {
  const Icon =
    status === "done"
      ? CircleCheck
      : status === "started"
        ? CircleDashed
        : Circle;
  return (
    <>
      <Icon
        aria-hidden
        size={size}
        strokeWidth={2}
        className={`shrink-0 ${status === "done" ? "text-hub-success" : "text-hub-ink-muted"}`}
      />
      <span className="sr-only">{STATUS_WORDS[status]}: </span>
    </>
  );
}

const LINK_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function StageRail({
  stages,
  current,
  allHref = "/hub/setup",
  LinkComponent,
}: StageRailProps) {
  const L = LinkComponent ?? "a";
  const index = stages.findIndex((s) => s.slug === current);
  return (
    <>
      <p className="flex items-center gap-2 font-hub text-sm text-hub-ink-muted lg:hidden">
        <span className="tabular-nums">
          Step {index + 1} of {stages.length}
        </span>
        <span aria-hidden>·</span>
        <L
          href={allHref}
          className={`rounded text-hub-accent underline underline-offset-2 ${LINK_FOCUS}`}
        >
          All steps
        </L>
      </p>
      <nav
        aria-label="Setup steps"
        className="hidden w-60 shrink-0 self-start rounded-lg bg-hub-surface-2 p-4 font-hub lg:block"
      >
        <L
          href={allHref}
          className={`mb-4 inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm font-semibold text-hub-accent ${LINK_FOCUS}`}
        >
          <ArrowLeft aria-hidden size={16} strokeWidth={2} />
          All steps
        </L>
        <ol className="flex flex-col gap-1">
          {stages.map((s) => {
            const on = s.slug === current;
            return (
              <li key={s.slug}>
                <L
                  href={s.href}
                  aria-current={on ? "step" : undefined}
                  className={
                    "flex min-h-11 items-center gap-2 rounded px-2 text-sm transition-colors duration-150 " +
                    `${LINK_FOCUS} ` +
                    (on
                      ? "bg-hub-accent-tint font-semibold text-hub-accent"
                      : "text-hub-ink hover:bg-hub-surface")
                  }
                >
                  <StageStatusIcon status={s.status} />
                  {s.name}
                </L>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
