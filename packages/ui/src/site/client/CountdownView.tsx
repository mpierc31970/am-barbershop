// Countdown markup shared by the server render and the client island (CONT-10, D122,
// D-UI-12; RESEARCH Pitfall 8; 03-UI-SPEC "Countdown item").
//
// One component draws both states so the island's first render is byte-identical to the
// server's (no hydration mismatch). Not a client component by itself: the server
// Countdown imports it directly for the past-target case, which then ships no JS.
// - Counting: role="timer" with the long-form label, a visually hidden <time>, four units;
//   numerals tabular-nums at min-width 2ch so digits never shift. No aria-live.
// - Reduced motion: the Seconds unit is hidden by CSS (motion-reduce), before any JS.
// - Done: the tenant's message replaces the units in the same min-height box, so the page
//   does not move at zero.
import type { CountdownState } from "@cds/core/content";

export interface CountdownViewProps {
  state: CountdownState;
  targetIso: string;
  zeroMessage: string;
  /** The timer's accessible name (countdownAriaLabel). */
  label: string;
  /** Visible text of the hidden <time> element. */
  when: string;
  /** Set by the island once it knows the visitor prefers reduced motion. */
  hideSeconds?: boolean;
}

/** Height of the counting state: numeral line + unit label line. */
export const COUNTDOWN_BOX =
  "flex min-h-[calc(var(--site-text-h2)*1.2_+_var(--site-text-body)*1.6)] items-center";

const pad = (n: number) => String(n).padStart(2, "0");

export function CountdownView({
  state,
  targetIso,
  zeroMessage,
  label,
  when,
  hideSeconds = false,
}: CountdownViewProps) {
  if (state.done) {
    return (
      <div className={COUNTDOWN_BOX} data-cds-countdown="done">
        <p className="text-[length:var(--site-text-h3)] font-semibold leading-[1.3]">
          {zeroMessage}
        </p>
      </div>
    );
  }

  const units = [
    { key: "days", value: String(state.days), label: "Days" },
    { key: "hours", value: pad(state.hours), label: "Hours" },
    { key: "minutes", value: pad(state.minutes), label: "Minutes" },
    { key: "seconds", value: pad(state.seconds), label: "Seconds" },
  ];

  return (
    <div className={COUNTDOWN_BOX} data-cds-countdown="counting">
      <div role="timer" aria-label={label} className="flex flex-wrap gap-4">
        <time dateTime={targetIso} className="sr-only">
          {when}
        </time>
        {units.map((u) => (
          <div
            key={u.key}
            className={
              u.key === "seconds"
                ? `flex flex-col items-center motion-reduce:hidden${hideSeconds ? " hidden" : ""}`
                : "flex flex-col items-center"
            }
            aria-hidden="true"
          >
            <span className="min-w-[2ch] text-center text-[length:var(--site-text-h2)] font-semibold leading-[1.2] tabular-nums text-site-accent">
              {u.value}
            </span>
            <span className="text-[length:var(--site-text-body)] font-normal leading-[1.6] text-site-text-muted">
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
