"use client";
// YoureLive (11-17; DASH-33; 11-UI-SPEC "Today" § 2 Live, first visit; D-UI-P11-26). The
// one-time screen after launch, shown once per person: CircleCheck + H1 "You're live at
// <host>", LIVE-BODY, three first-week steps (title, line, secondary sm link), and the one
// primary Show my Today. The app sets the seen flag: Show my Today calls `onShowToday`, and
// following any step link calls `onStep` first (a refresh alone never loses the screen).
// No confetti, no animation beyond the P3 defaults (D-UI-P10-7). Props in, no data reads.
import { CircleCheck } from "lucide-react";
import { useId } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Button, buttonClasses } from "../Button";
import { TODAY_COPY, type YoureLiveStep } from "./copy";

export interface YoureLiveProps {
  /** The primary host ("riverabakery.com"). */
  host: string;
  steps: readonly YoureLiveStep[];
  onShowToday: () => void;
  onStep?: (id: YoureLiveStep["id"]) => void;
  /** Show my Today is saving (the button shows its busy state). */
  busy?: boolean;
  LinkComponent?: HubLinkComponent;
}

export function YoureLive({
  host,
  steps,
  onShowToday,
  onStep,
  busy = false,
  LinkComponent,
}: YoureLiveProps) {
  const headingId = useId();
  const Link = LinkComponent ?? "a";
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 pt-12 font-hub text-hub-ink"
      data-youre-live=""
    >
      <div className="flex flex-col gap-2">
        <CircleCheck
          aria-hidden
          size={20}
          strokeWidth={2}
          className="text-hub-success"
        />
        <h1
          id={headingId}
          className="text-[28px] leading-[1.2] font-semibold break-words"
        >
          {TODAY_COPY.liveHeading(host)}
        </h1>
        <p className="max-w-[68ch] text-base">{TODAY_COPY.liveBody}</p>
      </div>
      <ol className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {steps.map((s) => (
          <li
            key={s.id}
            data-live-step={s.id}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-base font-semibold">{s.title}</p>
              <p className="text-sm text-hub-ink-muted">{s.line}</p>
            </div>
            <Link
              href={s.href}
              onClick={() => onStep?.(s.id)}
              className={`${buttonClasses("secondary", "sm")} w-full shrink-0 sm:w-auto`}
            >
              {s.actionLabel}
            </Link>
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="primary"
          onClick={onShowToday}
          loading={busy}
          disabled={busy}
        >
          {TODAY_COPY.showToday}
        </Button>
      </div>
    </section>
  );
}
