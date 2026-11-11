// Studio Booking visitor reads (D145, D187 deny by default). The public barber pages read
// only published seats of the site's own org, and only these allowlisted fields: never the
// barber's email, account, kind or the shop's notes. Nothing shows while the add-on is off.
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { readVariantOfRow } from "../media/assets";
import { num, str, studioActive, studioRead } from "./shared";

export type PublicSeatService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
};

export type SeatSocial = {
  platform: "instagram" | "tiktok" | "facebook" | "youtube" | "x" | "other";
  url: string;
};

const SOCIAL_KEYS: ReadonlySet<string> = new Set([
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "x",
  "other",
]);

/** Stored social links, re-checked on read (known platform, http(s) URL only). */
export function readSocials(v: unknown): SeatSocial[] {
  if (!Array.isArray(v)) return [];
  const out: SeatSocial[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) continue;
    const { platform, url } = x as { platform?: unknown; url?: unknown };
    if (typeof platform !== "string" || !SOCIAL_KEYS.has(platform)) continue;
    if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url)) continue;
    out.push({ platform: platform as SeatSocial["platform"], url });
  }
  return out;
}

export type PublicSeat = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  bio: string;
  /** Media asset ids, served at /_media/<id>/web. */
  photo: string;
  gallery: string[];
  brandName: string;
  /** Media asset id of the barber's own logo ("" = none). */
  logo: string;
  socials: SeatSocial[];
  licenseNumber: string;
  services: PublicSeatService[];
};

function toPublic(r: RecordModel, services: RecordModel[]): PublicSeat {
  return {
    id: r.id,
    slug: str(r.slug),
    name: str(r.name),
    headline: str(r.headline),
    bio: str(r.bio),
    photo: str(r.photo),
    gallery: Array.isArray(r.gallery)
      ? r.gallery.filter((g): g is string => typeof g === "string")
      : [],
    brandName: str(r.brand_name),
    logo: str(r.logo),
    socials: readSocials(r.socials),
    licenseNumber: str(r.license_number),
    services: services
      .filter((s) => s.seat === r.id)
      .map((s) => ({
        id: s.id,
        name: str(s.name),
        description: str(s.description),
        durationMinutes: num(s.duration_minutes),
        priceCents: num(s.price_cents),
      })),
  };
}

async function publishedSeats(
  pb: PocketBase,
  orgId: string,
  slug?: string,
): Promise<PublicSeat[]> {
  if (!(await studioActive(pb, orgId))) return [];
  const seats = await pb.collection("studio_seats").getFullList({
    filter:
      slug === undefined
        ? pb.filter("organization = {:org} && is_published = true", {
            org: orgId,
          })
        : pb.filter(
            "organization = {:org} && is_published = true && slug = {:slug}",
            { org: orgId, slug },
          ),
    sort: "sort_order,created",
  });
  if (seats.length === 0) return [];
  const services = await pb.collection("studio_services").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "sort_order,created",
  });
  return seats.map((s) => toPublic(s, services));
}

/** Every published barber of the site, in the owner's order. */
export async function listPublicSeats(
  site: SiteContext,
): Promise<PublicSeat[]> {
  assertSiteContext(site);
  return studioRead((pb) => publishedSeats(pb, site.orgId));
}

/** One published barber by their web address, or null. */
export async function getPublicSeat(
  site: SiteContext,
  slug: string,
): Promise<PublicSeat | null> {
  assertSiteContext(site);
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  return studioRead(
    async (pb) => (await publishedSeats(pb, site.orgId, slug))[0] ?? null,
  );
}

/**
 * A published barber's photo for visitors: only an image that is the portrait, logo or a
 * gallery photo of a published seat of this site's org; anything else is NotFound.
 */
export async function readPublicSeatPhoto(
  site: SiteContext,
  mediaId: string,
  variant: "web" | "thumb",
): Promise<{ bytes: Uint8Array; mime: string }> {
  assertSiteContext(site);
  if (
    !/^[a-z0-9]{15}$/.test(mediaId) ||
    (variant !== "web" && variant !== "thumb")
  ) {
    throw new NotFound();
  }
  const row = await studioRead(async (pb) => {
    const seats = await publishedSeats(pb, site.orgId);
    if (
      !seats.some(
        (s) =>
          s.photo === mediaId ||
          s.logo === mediaId ||
          s.gallery.includes(mediaId),
      )
    ) {
      throw new NotFound();
    }
    return mediaRow(pb, site.orgId, mediaId);
  });
  return readVariantOfRow(site.orgId, row, variant);
}

/** A ready, not-removed media row of the org (else NotFound). */
export async function mediaRow(
  pb: PocketBase,
  orgId: string,
  mediaId: string,
): Promise<RecordModel> {
  const res = await pb.collection("media_assets").getList(1, 1, {
    filter: pb.filter(
      "id = {:id} && organization = {:org} && status = 'ready' && removed_at = '' && deleted_at = ''",
      { id: mediaId, org: orgId },
    ),
  });
  const row = res.items[0];
  if (!row) throw new NotFound();
  return row;
}
