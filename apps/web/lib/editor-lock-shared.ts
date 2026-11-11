// Locked editors (12-17 choice 2; COMM-11, D102; UI-SPEC "Locks and held changes" lines
// 586-608). Client-safe: the editor lock state the server pages hand to their editors, and
// the pure rule that turns the person's service notices into "is this editor's target locked,
// and until when". The rule is core `lockCovers` over each active notice (no new query path):
// platform and organization windows lock every content editor, an add-on window its add-on,
// a page window its page, a component window its site part or add-on.
import {
  lockCovers,
  type ServiceNotice,
  type WriteTarget,
} from "@cds/core/support";

/** One held change waiting on this editor (12-13 HeldDraftView, without the payload). */
export type EditorHeld = {
  id: string;
  /** When it was held ("Saved at 2:14 pm"). */
  savedAt: string;
  /** A window still covers it (Apply would be refused). */
  locked: boolean;
};

export type EditorLockState = {
  /** The active window that locks this editor's target, or null. */
  locked: { until: string } | null;
  /** This person's held changes for the target, newest first. */
  held: EditorHeld[];
};

export const NO_LOCK: EditorLockState = { locked: null, held: [] };

/** The latest end among active notices whose window covers `target`; null when none does. */
export function lockFromNotices(
  notices: readonly ServiceNotice[],
  target: WriteTarget,
): { until: string } | null {
  let until: string | null = null;
  for (const n of notices) {
    if (n.phase !== "active") continue;
    const reach = n.reach;
    const covers = lockCovers(
      {
        // A notice without a scope (older shape) is treated as org-wide: the editor shows
        // read-only and the chokepoint stays the authority either way.
        scope: n.scope ?? "organization",
        addon: n.addon ?? null,
        page: reach?.scope === "page" ? reach.page : null,
        component: reach?.scope === "component" ? reach.component : null,
        starts_at: n.startsAt,
        ends_at: n.endsAt,
      },
      target,
    );
    if (!covers) continue;
    if (until === null || Date.parse(n.endsAt) > Date.parse(until)) {
      until = n.endsAt;
    }
  }
  return until === null ? null : { until };
}

/** The editor is read-only while locked or while held changes wait (Apply / Discard first). */
export function editorReadOnly(state: EditorLockState | null | undefined) {
  return !!state && (state.locked !== null || state.held.length > 0);
}

/**
 * A remount key: the editor's local state restarts only when the held set changes (a save was
 * parked, or Apply / Discard ran), so it picks up fresh server state then.
 *
 * WR-C05: the lock itself is NOT part of the key. Many actions revalidate the hub layout, and
 * a window that starts (or a failed notices read) mid-edit used to remount the editor and drop
 * unsaved edits. The editors read the lock from props and go read-only in place, keeping what
 * was typed. A held set only exists while the editor is already read-only, so a key change
 * from it never drops unsaved typing.
 */
export function editorLockKey(state: EditorLockState | null | undefined) {
  if (!state) return "open";
  return `h:${state.held.map((h) => h.id).join(",")}`;
}
