// NotLiveYet (11-15; DASH-32, D312; 11-UI-SPEC "NotLiveYet"). One shared panel for any tab
// whose output is held until launch: hub-surface-2, 24px padding, 8px radius, max 720px;
// Clock 20 + Heading "Starts when you go live" + Body (per use, default NOTLIVE-BODY) +
// an optional Label ink-muted line. Info tone, never an error. The tab's settings below
// it stay editable; only sending is held.
import { Clock } from "lucide-react";
import { useId } from "react";
import { SHELL_COPY } from "./copy";

export interface NotLiveYetProps {
  /** Body copy for this use; defaults to NOTLIVE-BODY. */
  what?: string;
  /** Optional Label line under the body. */
  note?: string;
  /** Heading level inside the screen (H1 is the ScreenHeader). */
  headingLevel?: 2 | 3;
}

export function NotLiveYet({ what, note, headingLevel = 2 }: NotLiveYetProps) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-[720px] gap-3 rounded bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <Clock
        aria-hidden="true"
        size={20}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-hub-ink-muted"
      />
      <div className="flex flex-col gap-2">
        <Heading id={headingId} className="text-xl leading-tight font-semibold">
          {SHELL_COPY.notLiveHeading}
        </Heading>
        <p className="max-w-[68ch] text-base">
          {what ?? SHELL_COPY.notLiveBody}
        </p>
        {note ? <p className="text-sm text-hub-ink-muted">{note}</p> : null}
      </div>
    </section>
  );
}
