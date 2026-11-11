// LockedPanel (12-14 choice 2; COMM-11, D102; 12-UI-SPEC "Locks and held changes" lines
// 584-597). Under the builder page header, an add-on tab header or a site-part editor while a
// window locks the target: CdsSurface 16px padding, Lock 16 + "Editing is paused while CDS
// works on this {target}", LOCKED-BODY, and "Until {end}" in business time. With held changes
// (an autosave hit the lock) it adds HELD-KEPT and "Saved at {time}" in a polite live region,
// read once (no dialog, no toast); a save from an earlier business day names the day ("Saved
// yesterday at 2:14 pm", 12-REVIEW IN-D08). Editors point their disabled controls at `id` with
// aria-describedby. Pure presentation, server-safe.
import { formatNoticeEnd } from "@cds/core/support";
import { Lock } from "lucide-react";
import { CdsSurface } from "../../cds";
import { clockTime, dayLabel, THREAD_COPY } from "../thread/copy";
import { NOTICES_COPY } from "./copy";

export interface LockedPanelProps {
  /** The locked thing in owner words: "page", "footer", "header", "add-on". */
  target: string;
  /** The window's end (ISO). */
  until: string;
  timeZone: string;
  /** Clock for "4:00 pm" vs "tomorrow at …" (tests). Default: now. */
  now?: Date;
  /** Held changes kept by the lock (12-13). */
  held?: { savedAt: string } | null;
  /** For the editor's aria-describedby. */
  id?: string;
  className?: string;
}

export function LockedPanel({
  target,
  until,
  timeZone,
  now,
  held,
  id,
  className,
}: LockedPanelProps) {
  const at = now ?? new Date();
  const end = new Date(until);
  const endText = Number.isFinite(end.getTime())
    ? formatNoticeEnd(end, at, timeZone)
    : "";
  const saved = held ? clockTime(held.savedAt, timeZone) : "";
  const savedDay = held ? dayLabel(held.savedAt, timeZone, at.getTime()) : "";
  const day =
    savedDay === THREAD_COPY.today
      ? ""
      : savedDay === THREAD_COPY.yesterday
        ? "yesterday"
        : savedDay;
  return (
    <CdsSurface
      as="section"
      id={id}
      data-locked-panel=""
      className={`flex flex-col gap-2 font-hub${className ? ` ${className}` : ""}`}
    >
      <p className="inline-flex items-center gap-2 text-base font-semibold">
        <Lock aria-hidden size={16} strokeWidth={2} className="shrink-0" />
        {NOTICES_COPY.lockedHeading(target)}
      </p>
      <p className="max-w-[68ch] text-base">{NOTICES_COPY.LOCKED_BODY}</p>
      {held ? (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-base font-semibold">{NOTICES_COPY.HELD_KEPT}</p>
          {saved ? (
            <p className="text-sm text-hub-ink-muted">
              {NOTICES_COPY.savedAt(saved, day)}
            </p>
          ) : null}
        </div>
      ) : null}
      {endText ? (
        <p className="text-sm text-hub-ink-muted">
          {NOTICES_COPY.until(endText)}
        </p>
      ) : null}
    </CdsSurface>
  );
}
