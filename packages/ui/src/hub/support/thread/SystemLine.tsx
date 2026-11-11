// SystemLine (12-09; COMM-01, COMM-09; 12-UI-SPEC lines 313-316). Status changes and events
// between messages, no box: Label ink-muted, ArrowRight 14 + the event text + " · " + the
// clock time ("Reopened by your reply · 2:14 pm"). The server composes the event sentence
// ("Status changed to Waiting on you · CDS", "Marked solved by Maria"); this renders it as
// text only.
import type { TenantMessage } from "@cds/core/support";
import { ArrowRight } from "lucide-react";
import { clockTime } from "./copy";

export interface SystemLineProps {
  message: TenantMessage;
  timeZone: string;
}

export function SystemLine({ message: m, timeZone }: SystemLineProps) {
  const text = (m.event ?? "").trim() || m.body.trim();
  const time = clockTime(m.created, timeZone);
  return (
    <p
      data-system-line={m.id}
      className="flex items-center gap-1 font-hub text-sm text-hub-ink-muted"
    >
      <ArrowRight aria-hidden size={14} strokeWidth={2} className="shrink-0" />
      <span>
        {text}
        {time ? (
          <>
            {" · "}
            <time dateTime={m.created}>{time}</time>
          </>
        ) : null}
      </span>
    </p>
  );
}
