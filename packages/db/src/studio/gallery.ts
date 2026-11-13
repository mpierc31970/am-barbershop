// A barber's new gallery photo -> the owner's "Add it to the main Gallery?" alert (A&M fork).
// The alert's source key carries the decision: "gallery:<seat>:<media>" while it waits, then
// "gallery-added:..." or "gallery-skipped:..." on every recipient's row, so each card shows
// the outcome without a schema change.
import { randomUUID } from "node:crypto";
import { InvalidInput, NotFound } from "@cds/core";
import { raiseAlert } from "../alerts/raise";
import { withSuperuser } from "../client";
import { listPages } from "../content/pages";
import { publishPage, type PublishDeps } from "../content/publish";
import { listSections, saveSection } from "../content/sections";
import { mintSystemContext, type OrgContext } from "../context";
import { requireManager, seatFor, str, studioRead } from "./shared";

export type GalleryOffer = {
  seatId: string;
  mediaId: string;
  state: "pending" | "added" | "skipped";
};

const KEY_RE = /^gallery(-added|-skipped)?:([a-z0-9]{15}):([a-z0-9]{15})$/;
export const GALLERY_REMOVED_COPY = "This photo was removed.";

/** The offer an alert stands for, or null for any other alert. */
export function galleryOfferOf(sourceKey: string): GalleryOffer | null {
  const m = KEY_RE.exec(sourceKey);
  if (!m) return null;
  return {
    seatId: m[2]!,
    mediaId: m[3]!,
    state: m[1] === "-added" ? "added" : m[1] ? "skipped" : "pending",
  };
}

/** Best effort (raiseAlert never throws): ask the owner and admins about a new photo. */
export async function raiseGalleryOffer(
  orgId: string,
  seatId: string,
  mediaId: string,
  barber: string,
): Promise<void> {
  const who = barber || "A barber";
  await raiseAlert(
    { orgId, as: mintSystemContext({ job: "studio-booking" }) },
    {
      type: "studio-booking.gallery_photo",
      sourceKey: `gallery:${seatId}:${mediaId}`,
      title: `${who} added a photo. Add it to the main Gallery?`,
      safeTitle: `${who} added a photo`,
      href: "/hub/alerts",
      actionLabel: "Add or skip",
      audience: { roles: ["owner", "admin"] },
    },
  );
}

/**
 * Owner/admin only. Add: append the photo to the Gallery page's gallery block and publish
 * the page (a retry after a held publish does not add it twice). Skip: the alert is deleted,
 * so it leaves every recipient's list.
 */
export async function decideGalleryPhoto(
  ctx: OrgContext,
  seatId: string,
  mediaId: string,
  add: boolean,
  deps: PublishDeps,
): Promise<void> {
  requireManager(ctx, "write");
  const key = `gallery:${seatId}:${mediaId}`;
  if (!galleryOfferOf(key)) throw new NotFound();
  if (add) {
    const seat = await studioRead((pb) => seatFor(pb, ctx, seatId)).catch(
      () => null,
    );
    const gallery: unknown[] = Array.isArray(seat?.gallery) ? seat.gallery : [];
    if (!gallery.includes(mediaId))
      throw new InvalidInput(GALLERY_REMOVED_COPY);
    const page = (await listPages(ctx)).find((p) => p.slug === "gallery");
    if (!page) throw new NotFound();
    const grid = (await listSections(ctx, page.id)).find(
      (s) => s.section_type === "gallery",
    );
    if (!grid) throw new NotFound();
    const content = grid.content as { images?: { asset?: string }[] };
    const images = content.images ?? [];
    if (!images.some((i) => i.asset === mediaId)) {
      await saveSection(ctx, deps.sections, {
        id: grid.id,
        pageId: page.id,
        section_type: grid.section_type,
        row_layout: grid.row_layout,
        settings: grid.settings,
        content: {
          ...content,
          images: [
            ...images,
            {
              id: randomUUID(),
              asset: mediaId,
              alt: `Haircut by ${str(seat?.name)}`.slice(0, 250),
              alt_reviewed: true,
              caption: "",
            },
          ],
        },
      });
    }
    const res = await publishPage(ctx, page.id, deps);
    if (res.status !== "published") {
      throw new InvalidInput(
        "The photo is in the Gallery draft but didn't go live. Try again.",
      );
    }
  }
  const done = `gallery-${add ? "added" : "skipped"}:${seatId}:${mediaId}`;
  await withSuperuser(async (pb) => {
    const rows = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:o} && source_key = {:k}", {
        o: ctx.orgId,
        k: key,
      }),
      fields: "id",
    });
    if (rows.length === 0) return;
    const batch = pb.createBatch();
    // A skipped photo leaves the owner's list; an added one keeps its "Added" card.
    for (const r of rows) {
      if (add) batch.collection("alerts").update(r.id, { source_key: done });
      else batch.collection("alerts").delete(r.id);
    }
    await batch.send();
  });
}
