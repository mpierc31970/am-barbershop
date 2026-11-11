"use client";
// StaffThread (13-35 choice 3; STAFF-08, D96; 13-UI-SPEC "Thread column" lines 445-456). The
// whole record in time order, internal notes included:
//   - owner messages and CDS public replies: the P12 ThreadMessage unchanged, exactly as the
//     owner sees them (CDS replies in CdsSurface with CdsAuthor);
//   - internal notes: ThreadMessage variant="internal" (hatched, "Only CDS sees this.");
//   - system lines: the P12 SystemLine; a staff-only line (visibility internal) is prefixed
//     with EyeOff 14 and an sr-only "Only CDS sees this:".
// Day separators as P12. Plain data in, callbacks out: no @cds/db import; bodies are React
// text through MessageBody (T-13-35-02).
import type { TenantAttachment, TenantMessage } from "@cds/core/support";
import { EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import {
  DaySeparator,
  SystemLine,
  ThreadMessage,
  dayKey,
  dayLabel,
} from "../../hub/support/thread";
import { STAFF_TICKETS_COPY as C } from "./copy";

/** A staff view of one message (mirrors the @cds/db StaffThreadMessage). */
export type StaffThreadMessageView = TenantMessage & {
  visibility: "public" | "internal";
};

export interface StaffThreadProps {
  /** Oldest first. */
  messages: readonly StaffThreadMessageView[];
  timeZone: string;
  /** Epoch ms for "Today" / "Yesterday". */
  now?: number;
  onDownload(fileId: string): void | Promise<void>;
  previewSrc?(attachment: TenantAttachment): string | null;
  /** Polite announcement of messages a poll brought in. */
  announcement?: string;
  /** Rendered first in the list column (the IncidentBox when linked). */
  before?: ReactNode;
}

export function StaffThread({
  messages,
  timeZone,
  now,
  onDownload,
  previewSrc,
  announcement,
  before,
}: StaffThreadProps) {
  const at = now ?? Date.now();
  const items: ReactNode[] = [];
  let lastDay = "";
  for (const m of messages) {
    const day = dayKey(m.created, timeZone);
    if (day && day !== lastDay) {
      lastDay = day;
      items.push(
        <li key={`day-${day}`}>
          <DaySeparator label={dayLabel(m.created, timeZone, at)} />
        </li>,
      );
    }
    const internal = m.visibility === "internal";
    if (m.authorKind === "system") {
      items.push(
        <li
          key={m.id}
          data-staff-only={internal ? "" : undefined}
          className="flex items-center gap-1 text-hub-ink-muted"
        >
          {internal ? (
            <>
              <EyeOff
                aria-hidden
                size={14}
                strokeWidth={2}
                className="shrink-0"
              />
              <span className="sr-only">{C.staffOnlyLine}</span>
            </>
          ) : null}
          <SystemLine message={m} timeZone={timeZone} />
        </li>,
      );
      continue;
    }
    items.push(
      <li key={m.id}>
        <ThreadMessage
          message={m}
          timeZone={timeZone}
          onDownload={onDownload}
          previewSrc={previewSrc}
          variant={internal ? "internal" : "default"}
        />
      </li>,
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {before}
      <ol aria-label={C.threadLabel} className="flex flex-col gap-4">
        {items}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement ?? ""}
      </p>
    </div>
  );
}
