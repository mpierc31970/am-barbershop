"use server";
// Held-draft actions (12-17 choice 3; COMM-11, D102, P12-P9; UI-SPEC "Locks and held changes"
// lines 595-608; T-12-17-02). Public POST endpoints: every argument is untrusted. The person and
// the org come only from the session (runAction); ids are shape-checked and the @cds/db
// held-drafts module (12-13) binds every row to this org and this person, re-checks the
// writer permission and derives the lock target from the payload, never from the caller.
//   - holdDraftAction(kind, ref, payload): park a change an editor's save could not write
//     (TargetLocked). Returns the held id, its time and the editor's fresh lock state, so the
//     editor flips read-only with HELD-KEPT without a reload.
//   - applyHeldDraftAction(id): after the window, re-run the original writer (sections land
//     in the draft; nothing is published).
//   IN-C05: only block edits, site parts and add-on records are parked. Page-level saves
//   (SEO & sharing, Page settings, reorder, hide, add) are refused with LOCKED-BODY and the
//   drawer keeps what was typed; Page settings carry a password, which is never written to
//   a held draft. So the "page" kind is not accepted here (no editor sends it).
//   - discardHeldDraftAction(id) / undoDiscardHeldDraftAction(id): soft discard with the
//     8 s toast Undo (the chokepoint allows 30 s).
// Each revalidates the editor and the hub layout. Nothing here logs payloads.
import { InvalidInput } from "@cds/core";
import type { WriteTarget } from "@cds/core/support";
import {
  applyHeldDraft,
  discardHeldDraft,
  holdDraft,
  undoDiscardHeldDraft,
  type HeldSitePart,
  type HoldDraftInput,
} from "@cds/db";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";
import { loadEditorLock, refreshEditors } from "../../lib/editor-lock";
import type { EditorLockState } from "../../lib/editor-lock-shared";

const ID = /^[a-z0-9]{1,30}$/;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const SECTION_KEYS = [
  "id",
  "pageId",
  "section_type",
  "row_layout",
  "content",
  "settings",
  "afterId",
] as const;

type Rec = Record<string, unknown>;

function record(v: unknown): Rec | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Rec)
    : null;
}

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

/** The editor's (kind, ref, payload) as the 12-13 HoldDraftInput; unknown keys dropped. */
function holdInput(
  kind: unknown,
  ref: unknown,
  payload: unknown,
): HoldDraftInput {
  const body = record(payload);
  switch (kind) {
    case "section": {
      if (!body) throw new InvalidInput(GONE);
      const section: Rec = {};
      for (const k of SECTION_KEYS)
        if (Object.hasOwn(body, k)) section[k] = body[k];
      return { kind: "section", section };
    }
    case "site_part":
      if (
        ref !== "nav" &&
        ref !== "footer" &&
        ref !== "banner" &&
        ref !== "settings"
      ) {
        throw new InvalidInput(GONE);
      }
      return { kind: "site_part", part: ref, value: payload ?? null };
    case "addon_record": {
      const rec = body ? record(body.record) : null;
      if (typeof ref !== "string" || !body || !rec) {
        throw new InvalidInput(GONE);
      }
      return {
        kind: "addon_record",
        slug: ref,
        collection: typeof body.collection === "string" ? body.collection : "",
        record: rec,
      };
    }
    default:
      throw new InvalidInput(GONE);
  }
}

function pathsFor(target: WriteTarget): string[] {
  return target.kind === "page"
    ? [`/hub/website/pages/${target.id}`, "/hub/website"]
    : ["/hub/website"];
}

export type HoldDraftResult = {
  id: string;
  savedAt: string;
  /** The editor's lock state right after the hold (locked + this held change). */
  lock: EditorLockState;
};

export async function holdDraftAction(
  kind: unknown,
  ref: unknown,
  payload: unknown,
): Promise<ActionResult<HoldDraftResult>> {
  return runAction(async ({ ctx }) => {
    const view = await holdDraft(ctx, holdInput(kind, ref, payload));
    // WR-C04: a site part's editor sees only its own held changes (Banner and Site settings
    // share the "header" lock target).
    const lock = await loadEditorLock(
      ctx,
      view.target,
      view.kind === "site_part" ? { part: view.ref as HeldSitePart } : {},
    );
    refreshEditors(pathsFor(view.target));
    return { id: view.id, savedAt: view.savedAt, lock };
  });
}

export type ApplyHeldResult = {
  kind: string;
  /** A screened writer (site parts, add-on records) held the text for review. */
  held: boolean;
};

export async function applyHeldDraftAction(
  id: unknown,
): Promise<ActionResult<ApplyHeldResult>> {
  return runAction(async ({ ctx }) => {
    // Loaded here, not at module top: the add-on registry's server entry registers every
    // add-on collection, and only Apply needs it (editors import these actions too).
    const { addonDeps } = await import("../../lib/addons");
    const res = await applyHeldDraft(ctx, idOf(id), {
      ...contentDeps(),
      sectionOwners: ADDON_REGISTRY,
      addonDeps: addonDeps(),
    });
    refreshEditors(pathsFor(res.target));
    return { kind: res.kind, held: res.held };
  });
}

export async function discardHeldDraftAction(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async ({ ctx }) => {
    const res = await discardHeldDraft(ctx, idOf(id));
    refreshEditors(["/hub/website"]);
    return { id: res.id };
  });
}

export async function undoDiscardHeldDraftAction(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async ({ ctx }) => {
    const view = await undoDiscardHeldDraft(ctx, idOf(id));
    refreshEditors(pathsFor(view.target));
    return { id: view.id };
  });
}
