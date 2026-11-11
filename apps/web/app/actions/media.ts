"use server";
// Setup photo actions (06-19; ONB-04, D280, D-UI-P6-31; 06-UI-SPEC "Upload field"; T-06-93,
// T-06-94). Uploads go through the POST /hub/api/media route (XHR progress); everything
// after the upload (description, remove, Undo, order) goes through these actions. Public POST
// endpoints: every argument is untrusted. The org comes only from the session (runAction) and
// the @cds/db media chokepoint scopes every read and write to it (business write: an Editor
// gets the Forbidden copy). Saves refresh the /hub layout, so the sidebar's needed-count
// follows photo descriptions and removals.
//
// 07-17 (CONT-21, D275; T-07-17-01, T-07-17-03): the Website › Media tab's writes. Delete,
// video Try again and the video cover go through these allowlisted actions (ids through idOf,
// the org from the session); reads and the describe write go through the
// /hub/api/media/library route (choice 1). Successful writes refresh /hub/website and the
// /hub layout (sidebar counts).
import { InvalidInput } from "@cds/core";
import {
  deleteMediaAsset,
  removeMedia,
  reorderMedia,
  restoreMedia,
  retryVideo,
  setMediaAlt,
  setVideoCover,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { nextInvalidator } from "../../lib/invalidator";
import { SECTION_REGISTRY } from "../../lib/section-registry";

const ID = /^[a-z0-9]{1,32}$/i;
const BAD_PHOTO = "That photo isn't available any more. Refresh and try again.";

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw))
    throw new InvalidInput(BAD_PHOTO);
  return raw;
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[media] revalidate failed", err);
  }
}

/** Save a photo description (alt text, D280). */
export async function setMediaAltAction(
  id: string,
  alt: string,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    if (typeof alt !== "string") {
      throw new InvalidInput("The description must be text.");
    }
    await setMediaAlt(s.ctx, idOf(id), alt);
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

/**
 * Remove a photo from setup (soft; Undo is restoreMediaAction). Removing the first mood board
 * returns the recomputed proposal (null when none is left); otherwise data is null.
 */
export async function removeMediaAction(
  id: string,
): Promise<ActionResult<{ proposal: unknown } | null>> {
  const res = await runAction(async (s) => {
    // WR-C06: a logo change regenerates the site icons and drops their cached `v`.
    const r = await removeMedia(s.ctx, idOf(id), {
      invalidator: nextInvalidator,
    });
    return r && r.proposal !== undefined ? { proposal: r.proposal } : null;
  });
  if (res.ok) refreshHub();
  return res;
}

/** Undo a remove (a restored first mood board returns its proposal, as remove does). */
export async function restoreMediaAction(
  id: string,
): Promise<ActionResult<{ proposal: unknown } | null>> {
  const res = await runAction(async (s) => {
    // WR-C06: a logo change regenerates the site icons and drops their cached `v`.
    const r = await restoreMedia(s.ctx, idOf(id), {
      invalidator: nextInvalidator,
    });
    return r && r.proposal !== undefined ? { proposal: r.proposal } : null;
  });
  if (res.ok) refreshHub();
  return res;
}

/** Put the gallery or the mood boards in this order (ids = exactly the active ones). */
export async function reorderMediaAction(
  kind: "gallery" | "moodboard",
  ids: string[],
): Promise<ActionResult<{ proposal?: unknown }>> {
  const res = await runAction(async (s) => {
    if (kind !== "gallery" && kind !== "moodboard") {
      throw new InvalidInput(BAD_PHOTO);
    }
    if (!Array.isArray(ids) || ids.length > 50) {
      throw new InvalidInput(BAD_PHOTO);
    }
    const r = await reorderMedia(s.ctx, kind, ids.map(idOf));
    return r.proposal === undefined ? {} : { proposal: r.proposal };
  });
  if (res.ok) refreshHub();
  return res;
}

function refreshMedia(): void {
  try {
    revalidatePath("/hub/website");
  } catch (err) {
    console.error("[media] revalidate failed", err);
  }
  refreshHub();
}

/**
 * Delete a library file (07-12 deleteMediaAsset): soft when a page, a kept version or a pop-up
 * uses it (D275, it keeps showing there), hard otherwise. Returns which one happened.
 */
export async function deleteLibraryMediaAction(
  id: string,
): Promise<ActionResult<{ outcome: "soft" | "hard" }>> {
  const res = await runAction(async (s) => {
    const r = await deleteMediaAsset(s.ctx, idOf(id), {
      sections: SECTION_REGISTRY,
      invalidator: nextInvalidator,
    });
    return { outcome: r.outcome };
  });
  if (res.ok) refreshMedia();
  return res;
}

/** Couldn't optimize -> Try again (once; 07-13 refuses a second retry with InvalidInput). */
export async function retryVideoAction(
  id: string,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await retryVideo(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshMedia();
  return res;
}

/** A video's cover: a library photo id, or null for the generated cover (07-13 choice 12). */
export async function setVideoCoverAction(
  videoId: string,
  imageId: string | null,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    if (imageId !== null && typeof imageId !== "string") {
      throw new InvalidInput(BAD_PHOTO);
    }
    await setVideoCover(
      s.ctx,
      idOf(videoId),
      imageId === null ? null : idOf(imageId),
    );
    return null;
  });
  if (res.ok) refreshMedia();
  return res;
}
