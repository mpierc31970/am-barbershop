// EarlierNotes (12-11 choice 2; COMM-02; 12-UI-SPEC Messages lines 282-283). Dated (unpinned)
// CDS notes in a native <details>, closed by default, on --hub-surface-2; summary "Earlier notes
// (3)"; inside, the same card without the Pin line, in the order given (newest first, server
// sorts). Absent when there are none. Server-safe: no hooks.
import type { CdsNote } from "@cds/core/support";
import { CdsNoteCard, NOTES_COPY } from "./CdsNoteCard";

export interface EarlierNotesProps {
  notes: readonly CdsNote[];
  /** Ids this person hasn't read ("New" badge). */
  unreadIds?: readonly string[];
  timeZone: string;
}

export function EarlierNotes({
  notes,
  unreadIds = [],
  timeZone,
}: EarlierNotesProps) {
  if (notes.length === 0) return null;
  return (
    <details className="rounded-lg bg-hub-surface-2 p-4 font-hub">
      <summary className="cursor-pointer text-sm font-semibold text-hub-ink">
        {NOTES_COPY.earlier(notes.length)}
      </summary>
      <ul className="mt-4 flex flex-col gap-4">
        {notes.map((n) => (
          <CdsNoteCard
            key={n.id}
            as="li"
            note={n}
            showPin={false}
            unread={unreadIds.includes(n.id)}
            timeZone={timeZone}
          />
        ))}
      </ul>
    </details>
  );
}
