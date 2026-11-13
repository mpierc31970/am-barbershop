// A barber's new gallery photo -> the owner's "Add it to the main Gallery?" alert (A&M fork).
// The alert's source key carries the decision: "gallery:<seat>:<media>" while it waits, then
// "gallery-added:..." or "gallery-skipped:..." on every recipient's row, so each card shows
// the outcome without a schema change.
import { randomUUID } from "node:crypto";
import { InvalidInput, NotFound } from "@cds/core";
import { raiseAlert } from "../alerts/raise";
import { withSuperuser } from "../client";
import { listPages } from "../content/pages";
import { getLibraryItem } from "../media/library/list";
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

type GalleryImage = {
  id: string;
  asset: string;
  alt: string;
  alt_reviewed?: boolean;
  caption: string;
};

/**
 * Change the Gallery page's gallery block and publish the page. Owner/admin only.
 * `change` gets the current photos and returns the new list.
 */
async function changeMainGallery(
  ctx: OrgContext,
  deps: PublishDeps,
  change: (images: GalleryImage[]) => GalleryImage[],
): Promise<void> {
  requireManager(ctx, "write");
  const page = (await listPages(ctx)).find((p) => p.slug === "gallery");
  if (!page) throw new NotFound();
  const grid = (await listSections(ctx, page.id)).find(
    (s) => s.section_type === "gallery",
  );
  if (!grid) throw new NotFound();
  const content = grid.content as { images?: GalleryImage[] };
  const before = content.images ?? [];
  const images = change(before);
  if (images !== before) {
    await saveSection(ctx, deps.sections, {
      id: grid.id,
      pageId: page.id,
      section_type: grid.section_type,
      row_layout: grid.row_layout,
      settings: grid.settings,
      content: { ...content, images },
    });
  }
  const res = await publishPage(ctx, page.id, deps);
  if (res.status !== "published") {
    throw new InvalidInput(
      "The change is saved but didn't go live. Try again.",
    );
  }
}

export type MainGalleryPhoto = {
  id: string;
  asset: string;
  alt: string;
  thumbUrl: string | null;
};

/** The Gallery page's photos, in order, with thumbnails (owner/admin). */
export async function listMainGallery(
  ctx: OrgContext,
): Promise<MainGalleryPhoto[]> {
  requireManager(ctx, "read");
  const page = (await listPages(ctx)).find((p) => p.slug === "gallery");
  if (!page) return [];
  const grid = (await listSections(ctx, page.id)).find(
    (s) => s.section_type === "gallery",
  );
  const images =
    (grid?.content as { images?: GalleryImage[] } | undefined)?.images ?? [];
  return Promise.all(
    images.map(async (i) => ({
      id: i.id,
      asset: i.asset,
      alt: i.alt ?? "",
      thumbUrl: await getLibraryItem(ctx, i.asset)
        .then((m) => m.thumbUrl ?? m.previewUrl)
        .catch(() => null),
    })),
  );
}

/** Add a media asset to the end of the Gallery page (no-op if it is already there). */
export async function addMainGalleryPhoto(
  ctx: OrgContext,
  mediaId: string,
  alt: string,
  deps: PublishDeps,
): Promise<void> {
  await changeMainGallery(ctx, deps, (images) =>
    images.some((i) => i.asset === mediaId)
      ? images
      : [
          ...images,
          {
            id: randomUUID(),
            asset: mediaId,
            alt: alt.slice(0, 250),
            alt_reviewed: true,
            caption: "",
          },
        ],
  );
}

/** Change one Gallery photo's description. */
export async function editMainGalleryPhoto(
  ctx: OrgContext,
  id: string,
  alt: string,
  deps: PublishDeps,
): Promise<void> {
  const text = alt.trim().slice(0, 250);
  if (!text) throw new InvalidInput("Describe the photo first.");
  await changeMainGallery(ctx, deps, (images) => {
    if (!images.some((i) => i.id === id)) throw new NotFound();
    return images.map((i) =>
      i.id === id ? { ...i, alt: text, alt_reviewed: true } : i,
    );
  });
}

/** Take one photo off the Gallery page (the file stays in the media library). */
export async function removeMainGalleryPhoto(
  ctx: OrgContext,
  id: string,
  deps: PublishDeps,
): Promise<void> {
  await changeMainGallery(ctx, deps, (images) =>
    images.filter((i) => i.id !== id),
  );
}

/**
 * Owner/admin only. Add puts the photo on the Gallery page and publishes it. Either way the
 * alert is deleted, so it leaves every recipient's list (the Gallery screen manages it after).
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
    await addMainGalleryPhoto(
      ctx,
      mediaId,
      `Haircut by ${str(seat?.name)}`,
      deps,
    );
  }
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
    for (const r of rows) batch.collection("alerts").delete(r.id);
    await batch.send();
  });
}
