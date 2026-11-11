// CdsNoteCard (12-11 choice 2; COMM-02, COMM-05; 12-UI-SPEC Messages lines 276-281). One CDS
// note: CdsSurface lg (the `data-cds-identity` container) with CdsMark 20 + title, a "New"
// badge when unread, the Pin "Pinned" marker on pinned notes, the body (line breaks kept,
// http(s) links only, React text — never HTML, T-12-11-01) and "From CDS · 9 Oct".
// Server-safe: no hooks.
import type { CdsNote } from "@cds/core/support";
import { Pin } from "lucide-react";
import { Badge } from "../../Badge";
import { CdsMark, CdsSurface } from "../../cds";
import { formatDayMonth } from "../../today/copy";
import { MessageBody } from "../thread";

export const NOTES_COPY = Object.freeze({
  pinned: "Pinned",
  unread: "New",
  from: (day: string) => (day ? `From Support · ${day}` : "From Support"),
  earlier: (n: number) => `Earlier notes (${n})`,
});

export interface CdsNoteCardProps {
  note: CdsNote;
  /** Not yet read by this person: "New" badge after the title. */
  unread?: boolean;
  /** Show the Pinned marker (defaults to `note.pinned`; Earlier notes pass false). */
  showPin?: boolean;
  /** Business time zone for "9 Oct". */
  timeZone: string;
  as?: "article" | "li";
}

export function CdsNoteCard({
  note,
  unread = false,
  showPin,
  timeZone,
  as = "article",
}: CdsNoteCardProps) {
  const pin = showPin ?? note.pinned;
  return (
    <CdsSurface as={as} padding="lg" data-note={note.id}>
      <div className="flex items-start gap-3">
        <CdsMark size={20} className="mt-0.5" />
        <h3 className="min-w-0 flex-1 font-hub text-lg leading-snug font-semibold break-words text-hub-ink">
          {note.title}
          {unread ? (
            <Badge tone="unread" className="ml-2 align-middle">
              {NOTES_COPY.unread}
            </Badge>
          ) : null}
        </h3>
        {pin ? (
          <span className="flex shrink-0 items-center gap-1 font-hub text-sm text-hub-ink-muted">
            <Pin aria-hidden size={14} strokeWidth={2} />
            {NOTES_COPY.pinned}
          </span>
        ) : null}
      </div>
      {note.body ? <MessageBody text={note.body} className="mt-3" /> : null}
      <p className="mt-3 font-hub text-sm text-hub-ink-muted">
        {NOTES_COPY.from(formatDayMonth(note.created, timeZone))}
      </p>
    </CdsSurface>
  );
}
