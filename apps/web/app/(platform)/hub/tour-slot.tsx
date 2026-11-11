// TourSlot (11-48; DASH-17, D208; T-11-48-01): the server half of a screen's first-use tour.
// Impersonating staff (and system contexts) get nothing, so they never see or consume a
// person's tours. Otherwise it reads this person's member_prefs.tours_seen and mounts the
// client TourHost: auto-starting when unseen, replay-only (Help "Show the tour") when seen.
// A failed prefs read counts as seen: a tour must never nag because a read failed.
import { readMemberPrefs, type OrgContext } from "@cds/db";
import type { TourId } from "@cds/ui/hub/help";
import { TourHost } from "./TourHost";

/** True when the person behind `ctx` should get this tour automatically. */
export async function tourUnseen(
  ctx: OrgContext,
  tourId: TourId,
): Promise<boolean> {
  try {
    const prefs = await readMemberPrefs(ctx);
    return !prefs.toursSeen.includes(tourId);
  } catch {
    return false;
  }
}

/** A screen's tour state: null = no tour (staff, system), else whether it auto-starts. */
export async function tourState(
  ctx: OrgContext,
  tourId: TourId,
): Promise<{ autoStart: boolean } | null> {
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return null;
  return { autoStart: await tourUnseen(ctx, tourId) };
}

/** Streaming form (Today renders it behind its own Suspense). */
export async function TourSlot({
  ctx,
  tourId,
}: {
  ctx: OrgContext;
  tourId: TourId;
}) {
  const state = await tourState(ctx, tourId);
  return state ? (
    <TourHost tourId={tourId} autoStart={state.autoStart} />
  ) : null;
}
