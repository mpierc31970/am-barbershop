// Locked editors, server side (12-17 choices 2 and 4; COMM-11, D102). Server-only: reads the
// person's service notices and held drafts through @cds/db with the session context.
//   - loadEditorLock: the lock state one editor's page hands to its client editor. The lock is
//     core lockCovers over activeServiceNotices (the same read as the notice strip, no new query
//     path); the held changes are listHeldDrafts for the target (the person's own only).
//     Either read failing degrades to "not locked" / "nothing held": the chokepoint's commit()
//     lock (12-08) stays the authority, so a failed read never lets a write through.
//   - parkIfLocked: a live-save editor's action (site parts, add-on records) that hit
//     TargetLocked parks the cleaned input as a held draft before the refusal goes back, then
//     revalidates so the editor re-renders read-only with HELD-KEPT. A failed park is logged
//     by error name only; the refusal still returns (the form keeps the unsaved text).
import { CdsError } from "@cds/core";
import type { WriteTarget } from "@cds/core/support";
import {
  activeServiceNotices,
  holdDraft,
  listHeldDrafts,
  type HeldSitePart,
  type HoldDraftInput,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { lockFromNotices, type EditorLockState } from "./editor-lock-shared";

type Ctx = Parameters<typeof listHeldDrafts>[0];

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export async function loadEditorLock(
  ctx: Ctx,
  target: WriteTarget,
  opts: {
    activeAddons?: readonly string[];
    /**
     * WR-C04: the site part this editor writes. Banner and Site settings share the "header"
     * lock target, so held changes are filtered to this editor's own part: each tab shows,
     * applies and discards only its own, and goes read-only only for its own.
     */
    part?: HeldSitePart;
  } = {},
): Promise<EditorLockState> {
  // Add-on windows reach only orgs with the add-on on; an add-on tab is shown only for an
  // active add-on, so its own slug is enough. Page and part targets ignore add-on windows.
  const activeAddons =
    opts.activeAddons ?? (target.kind === "addon" ? [target.slug] : []);
  const safe = async <T>(what: string, read: () => Promise<T>, none: T) => {
    try {
      return await read();
    } catch (err) {
      console.error(`[hub] ${what} read failed`, errName(err));
      return none;
    }
  };
  const [notices, held] = await Promise.all([
    safe(
      "service notices",
      () => activeServiceNotices(ctx, { activeAddons }),
      [] as Awaited<ReturnType<typeof activeServiceNotices>>,
    ),
    safe(
      "held drafts",
      () => listHeldDrafts(ctx, { target }),
      [] as Awaited<ReturnType<typeof listHeldDrafts>>,
    ),
  ]);
  const own = opts.part
    ? held.filter((h) => h.kind === "site_part" && h.ref === opts.part)
    : held;
  return {
    locked: lockFromNotices(notices, target),
    held: own.map((h) => ({ id: h.id, savedAt: h.savedAt, locked: h.locked })),
  };
}

export function isTargetLocked(err: unknown): boolean {
  return err instanceof CdsError && err.code === "target_locked";
}

/** Revalidate the editor and the hub layout (notice strip, Needs you). Never throws. */
export function refreshEditors(paths: readonly string[]): void {
  try {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[hub] held drafts revalidate failed", errName(err));
  }
}

/** On TargetLocked: hold `input` for this person, then revalidate `paths`. Never throws. */
export async function parkIfLocked(
  ctx: Ctx,
  err: unknown,
  input: HoldDraftInput,
  paths: readonly string[] = ["/hub/website"],
): Promise<void> {
  if (!isTargetLocked(err)) return;
  try {
    await holdDraft(ctx, input);
  } catch (holdErr) {
    console.error("[hub] hold draft failed", errName(holdErr));
    return;
  }
  refreshEditors(paths);
}
