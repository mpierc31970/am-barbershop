"use client";
// Locked editors (12-17 choices 2-5; COMM-11, D102, D119; UI-SPEC "Locks and held changes"
// lines 586-608, Accessibility line 845). The client pieces every lockable editor shares:
//   - EditorLockPanel: the LockedPanel (CDS layer, "Until …", HELD-KEPT + "Saved at …" when a
//     save was parked) while a window locks the target, then the HeldChangesPanel (Apply my
//     changes / Discard my changes) once the window has ended and changes still wait.
//     Apply re-runs the original writer for each held change (oldest first), Toast "Your
//     changes are back in the draft. Publish when ready." (builder) or "Your changes are
//     saved." (live-save editors). Discard is soft with an 8 s Undo toast (P12-P9).
//     Choice 5: the bell poll only refreshes counts (it does not re-render server props), so
//     while locked the panel schedules one router.refresh() just after the window's end; the
//     next render then offers Apply / Discard. A new lock mid-edit is learned on the next save.
//   - LockedFieldset: the edit controls, disabled not hidden (`disabled` + aria-disabled +
//     aria-describedby pointing at the panel). Preview, History (read) and navigation sit
//     outside it.
//   - EditorLockFrame: panel + fieldset around a whole site-part or add-on editor.
// Pure client: the actions take ids only; the chokepoint binds rows to this person and org.
import { useBrowserTimeZone } from "@cds/ui/builder";
import { AddonTabLockContext, useToast } from "@cds/ui/hub";
import { HeldChangesPanel, LockedPanel } from "@cds/ui/hub/support";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  applyHeldDraftAction,
  discardHeldDraftAction,
  undoDiscardHeldDraftAction,
} from "../../../actions/held-drafts";
import { callAction } from "../../../../lib/call-action";
import {
  editorReadOnly,
  type EditorLockState,
} from "../../../../lib/editor-lock-shared";

export const HELD_COPY = {
  appliedDraft: "Your changes are back in the draft. Publish when ready.",
  appliedLive: "Your changes are saved.",
  /** IN-C04: a screened writer held an applied change for review. */
  appliedHeld:
    "Your changes are saved. They're being reviewed before they show, usually within 2 business days.",
  discarded: "Your held changes were discarded.",
  undo: "Undo",
} as const;

/** The Discard toast's Undo stays 8 s (UI-SPEC line 605); the chokepoint allows 30 s. */
export const HELD_UNDO_MS = 8000;
/** The refresh after a window's end waits a moment past it (clock skew). */
export const LOCK_END_GRACE_MS = 2000;
const MAX_TIMER_MS = 2_147_483_647;

/** One router.refresh() just after the window's end, while the editor is locked. */
function useRefreshAtEnd(until: string | null) {
  const router = useRouter();
  useEffect(() => {
    if (!until) return;
    const end = Date.parse(until);
    if (!Number.isFinite(end)) return;
    const wait = Math.min(
      Math.max(end - Date.now() + LOCK_END_GRACE_MS, 0),
      MAX_TIMER_MS,
    );
    const t = setTimeout(() => router.refresh(), wait);
    return () => clearTimeout(t);
  }, [until, router]);
}

export interface EditorLockPanelProps {
  state: EditorLockState;
  /** The locked thing in owner words: "page", "footer", "menu", "header", "add-on". */
  target: string;
  /** The panel id the disabled controls point at. */
  panelId: string;
  /** Builder changes land in the draft; site parts and add-on records save live. */
  applies?: "draft" | "live";
  /** Hide the LockedPanel (the add-on tab header shows its own). */
  hideLocked?: boolean;
  /** IN-C04: the editor's own held-for-review copy (default HELD_COPY.appliedHeld). */
  heldCopy?: string;
  className?: string;
}

export function EditorLockPanel({
  state,
  target,
  panelId,
  applies = "live",
  hideLocked = false,
  heldCopy = HELD_COPY.appliedHeld,
  className,
}: EditorLockPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const timeZone = useBrowserTimeZone();
  useRefreshAtEnd(state.locked?.until ?? null);

  const newest = state.held[0] ?? null;
  // Oldest first, so the newest change is the one that stays.
  const ids = [...state.held].reverse().map((h) => h.id);

  async function apply() {
    // IN-C04: a screened writer (banner, footer, add-on records) may hold the text for
    // review; then the toast says so instead of "saved".
    let reviewed = false;
    for (const id of ids) {
      const res = await callAction(() => applyHeldDraftAction(id));
      if (!res.ok) {
        toast.show({ message: res.message });
        router.refresh();
        return;
      }
      if (res.data.held) reviewed = true;
    }
    toast.show({
      message:
        applies === "draft"
          ? HELD_COPY.appliedDraft
          : reviewed
            ? heldCopy
            : HELD_COPY.appliedLive,
    });
    router.refresh();
  }

  async function discard() {
    const done: string[] = [];
    for (const id of ids) {
      const res = await callAction(() => discardHeldDraftAction(id));
      if (!res.ok) {
        toast.show({ message: res.message });
        break;
      }
      done.push(id);
    }
    router.refresh();
    if (done.length === 0) return;
    toast.show({
      message: HELD_COPY.discarded,
      durationMs: HELD_UNDO_MS,
      action: {
        label: HELD_COPY.undo,
        onClick: () => {
          void (async () => {
            for (const id of done) {
              const res = await callAction(() =>
                undoDiscardHeldDraftAction(id),
              );
              if (!res.ok) {
                toast.show({ message: res.message });
                break;
              }
            }
            router.refresh();
          })();
        },
      },
    });
  }

  if (state.locked) {
    if (hideLocked) return null;
    return (
      <LockedPanel
        id={panelId}
        target={target}
        until={state.locked.until}
        timeZone={timeZone}
        held={newest ? { savedAt: newest.savedAt } : null}
        className={className}
      />
    );
  }
  if (!newest) return null;
  return (
    <div id={panelId} className={className}>
      <HeldChangesPanel
        savedAt={newest.savedAt}
        timeZone={timeZone}
        onApply={apply}
        onDiscard={discard}
      />
    </div>
  );
}

export interface LockedFieldsetProps {
  readOnly: boolean;
  panelId: string;
  children: ReactNode;
  className?: string;
}

/** Edit controls, disabled not hidden, described by the lock panel. */
export function LockedFieldset({
  readOnly,
  panelId,
  children,
  className,
}: LockedFieldsetProps) {
  return (
    <fieldset
      disabled={readOnly}
      aria-disabled={readOnly || undefined}
      aria-describedby={readOnly ? panelId : undefined}
      data-locked-editor={readOnly ? "" : undefined}
      className={`m-0 min-w-0 border-0 p-0${className ? ` ${className}` : ""}`}
    >
      {children}
    </fieldset>
  );
}

export interface EditorLockFrameProps {
  state: EditorLockState;
  target: string;
  panelId: string;
  applies?: "draft" | "live";
  /** Add-on tabs: the LockedPanel sits in AddonTabHeader (context) instead. */
  addonHeader?: boolean;
  /** IN-C04: the editor's own held-for-review copy for Apply. */
  heldCopy?: string;
  children: ReactNode;
}

/** A whole site-part or add-on editor: the panel above, the form read-only while locked. */
export function EditorLockFrame({
  state,
  target,
  panelId,
  applies = "live",
  addonHeader = false,
  heldCopy,
  children,
}: EditorLockFrameProps) {
  const timeZone = useBrowserTimeZone();
  const readOnly = editorReadOnly(state);
  const newest = state.held[0] ?? null;
  const body = (
    <div className="flex flex-col gap-4">
      <EditorLockPanel
        state={state}
        target={target}
        panelId={panelId}
        applies={applies}
        hideLocked={addonHeader}
        {...(heldCopy ? { heldCopy } : {})}
      />
      <LockedFieldset readOnly={readOnly} panelId={panelId}>
        {children}
      </LockedFieldset>
    </div>
  );
  if (!addonHeader) return body;
  return (
    <AddonTabLockContext.Provider
      value={
        state.locked
          ? {
              until: state.locked.until,
              target,
              timeZone,
              panelId,
              held: newest ? { savedAt: newest.savedAt } : null,
            }
          : null
      }
    >
      {body}
    </AddonTabLockContext.Provider>
  );
}
