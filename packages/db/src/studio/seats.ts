// Studio Booking seats (D144, D145, D152): each barber's seat, its public page fields, its
// own service menu and photos. See shared.ts for who may touch what.
//   - Owner/Admin: add, edit (every field), remove and invite.
//   - The barber: edit their own seat's page fields (name, headline, bio, shop name, logo,
//     social links, license number, photos) and menu.
//     Email, kind, address (slug) and "Show on site" stay the owner's.
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { mintOrgContext, type OrgContext } from "../context";
import { commit, type Op } from "../content/shared";
import { readVariantOfRow, removeMedia, uploadImage } from "../media/assets";
import { mediaRow, readSocials, type SeatSocial } from "./public";
import { createInvite, type InviteDeps } from "../people/invites";
import { newRecordId } from "../repository";
import {
  isManager,
  num,
  ownSeat,
  requireManager,
  requireStudio,
  seatFor,
  seatRow,
  str,
  studioRead,
  studioWrite,
  STUDIO_SLUG,
} from "./shared";

export const SEAT_KINDS = ["renter", "staff"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];
export const GALLERY_MAX = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export type SeatService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
};

export type SeatView = {
  id: string;
  name: string;
  slug: string;
  email: string;
  kind: SeatKind;
  headline: string;
  bio: string;
  photo: string;
  gallery: string[];
  /** The barber's own shop/chair name, shown only on their page. */
  brandName: string;
  /** Media asset id of their own logo, shown only on their page. */
  logo: string;
  socials: SeatSocial[];
  /** TDLR license number, shown on their page. */
  licenseNumber: string;
  isPublished: boolean;
  /** True once the barber has signed in (the seat is linked to their account). */
  linked: boolean;
  /** True when the caller is a manager (owner-only fields are editable). */
  canManage: boolean;
  services: SeatService[];
};

const ids = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is string => typeof x === "string" && /^[a-z0-9]{15}$/.test(x),
      )
    : [];

function toService(r: RecordModel): SeatService {
  return {
    id: r.id,
    name: str(r.name),
    description: str(r.description),
    durationMinutes: num(r.duration_minutes),
    priceCents: num(r.price_cents),
  };
}

function toView(
  ctx: OrgContext,
  r: RecordModel,
  services: RecordModel[],
): SeatView {
  return {
    id: r.id,
    name: str(r.name),
    slug: str(r.slug),
    email: str(r.email),
    kind: r.kind === "staff" ? "staff" : "renter",
    headline: str(r.headline),
    bio: str(r.bio),
    photo: str(r.photo),
    gallery: ids(r.gallery),
    brandName: str(r.brand_name),
    logo: str(r.logo),
    socials: readSocials(r.socials),
    licenseNumber: str(r.license_number),
    isPublished: r.is_published === true,
    linked: str(r.user) !== "",
    canManage: isManager(ctx),
    services: services.filter((s) => s.seat === r.id).map(toService),
  };
}

async function servicesOf(
  pb: PocketBase,
  orgId: string,
  seatIds: readonly string[],
): Promise<RecordModel[]> {
  if (seatIds.length === 0) return [];
  const rows = await pb.collection("studio_services").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "sort_order,created",
  });
  const keep = new Set(seatIds);
  return rows.filter((r) => keep.has(str(r.seat)));
}

// ---------------------------------------------------------------- validation (pure)

function text(
  v: unknown,
  label: string,
  max: number,
  required = false,
): string {
  const s = str(v).trim();
  if (required && s === "") throw new InvalidInput(`${label} is empty.`);
  if (s.length > max) {
    throw new InvalidInput(`${label} is longer than ${max} characters.`);
  }
  return s;
}

/** Platforms a barber can link, in form order ("other" = their own website). */
export const SEAT_SOCIALS = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "x",
  "other",
] as const;

const HANDLE_URL: Partial<Record<SeatSocial["platform"], string>> = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/@",
  x: "https://x.com/",
};

/** The platform as a person reads it ("other" is their website). */
export function socialName(p: SeatSocial["platform"]): string {
  const names: Record<SeatSocial["platform"], string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    facebook: "Facebook",
    youtube: "YouTube",
    x: "X",
    other: "Website",
  };
  return names[p];
}

/**
 * One link per platform: a full URL, a bare domain ("instagram.com/me") or an @handle
 * (Instagram, TikTok, X). Blank = no link. Only http(s) URLs are kept.
 */
export function cleanSocials(
  input: Partial<Record<SeatSocial["platform"], unknown>>,
): SeatSocial[] {
  const out: SeatSocial[] = [];
  for (const platform of SEAT_SOCIALS) {
    let v = str(input[platform]).trim();
    if (v === "") continue;
    const handle = /^@?([A-Za-z0-9._]{1,30})$/.exec(v);
    const base = HANDLE_URL[platform];
    if (handle && base && (v.startsWith("@") || !v.includes("."))) {
      v = base + handle[1];
    } else if (!/^https?:\/\//i.test(v)) {
      v = `https://${v}`;
    }
    const bad = new InvalidInput(
      `That ${socialName(platform)} link isn't a web address.`,
    );
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw bad;
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname.includes(".") ||
      url.href.length > 300
    ) {
      throw bad;
    }
    out.push({ platform, url: url.href });
  }
  return out;
}

/** A TDLR license number: letters, digits and dashes, up to 20. Blank allowed. */
export function cleanLicense(v: unknown): string {
  const s = str(v).trim().toUpperCase();
  if (s !== "" && !/^[A-Z0-9-]{1,20}$/.test(s)) {
    throw new InvalidInput("License number: letters, numbers and dashes only.");
  }
  return s;
}

export function cleanEmail(v: unknown): string {
  const e = str(v).trim().toLowerCase();
  if (e === "") return "";
  if (e.length > 254 || !EMAIL_RE.test(e)) {
    throw new InvalidInput("Enter an email address like name@example.com.");
  }
  return e;
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "barber";
}

/** Minutes, 5 to 480 in steps of 5. */
export function cleanDuration(v: unknown): number {
  const n = typeof v === "number" ? v : Number(str(v).trim());
  if (!Number.isInteger(n) || n < 5 || n > 480 || n % 5 !== 0) {
    throw new InvalidInput("Length must be 5 to 480 minutes, in steps of 5.");
  }
  return n;
}

/** Cents, 0 (ask for a price) to $10,000. */
export function cleanPrice(v: unknown): number {
  const n = typeof v === "number" ? v : Number(str(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
    throw new InvalidInput("Price must be between $0 and $10,000.");
  }
  return n;
}

async function uniqueSlug(
  pb: PocketBase,
  orgId: string,
  base: string,
  exceptId = "",
): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base.slice(0, 56)}-${i}`;
    const hit = await pb.collection("studio_seats").getList(1, 1, {
      filter: pb.filter("organization = {:org} && slug = {:s} && id != {:id}", {
        org: orgId,
        s: slug,
        id: exceptId,
      }),
      fields: "id",
    });
    if (hit.items.length === 0) return slug;
  }
  throw new InvalidInput("Choose a different web address for this barber.");
}

// ---------------------------------------------------------------- reads

/** Seats the caller may see (managers: all; a barber: their own), with their menus. */
export async function listSeats(ctx: OrgContext): Promise<SeatView[]> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    let rows: RecordModel[];
    if (isManager(ctx)) {
      rows = await pb.collection("studio_seats").getFullList({
        filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
        sort: "sort_order,created",
      });
    } else {
      const own = await ownSeat(pb, ctx);
      rows = own ? [own] : [];
    }
    const services = await servicesOf(
      pb,
      ctx.orgId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toView(ctx, r, services));
  });
}

export async function getSeat(
  ctx: OrgContext,
  seatId: string,
): Promise<SeatView> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    return toView(ctx, seat, await servicesOf(pb, ctx.orgId, [seat.id]));
  });
}

/** The caller's own seat id, or null (managers without a seat, unlinked barbers). */
export async function mySeatId(ctx: OrgContext): Promise<string | null> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => (await ownSeat(pb, ctx))?.id ?? null);
}

// ---------------------------------------------------------------- owner writes

export type NewSeatInput = { name: unknown; email: unknown; kind: unknown };

export async function createSeat(
  ctx: OrgContext,
  input: NewSeatInput,
): Promise<{ id: string }> {
  requireManager(ctx, "write");
  const name = text(input?.name, "Name", 80, true);
  const email = cleanEmail(input?.email);
  const kind: SeatKind = input?.kind === "staff" ? "staff" : "renter";
  return studioWrite(ctx, async (pb) => {
    if (email) {
      const dup = await pb.collection("studio_seats").getList(1, 1, {
        filter: pb.filter("organization = {:org} && email = {:e}", {
          org: ctx.orgId,
          e: email,
        }),
        fields: "id",
      });
      if (dup.items.length > 0) {
        throw new InvalidInput(`${email} already has a seat.`);
      }
    }
    const last = await pb.collection("studio_seats").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      sort: "-sort_order",
      fields: "sort_order",
    });
    const id = newRecordId();
    const body = {
      organization: ctx.orgId,
      name,
      email,
      kind,
      slug: await uniqueSlug(pb, ctx.orgId, slugify(name)),
      headline: "",
      bio: "",
      photo: "",
      gallery: [],
      brand_name: "",
      logo: "",
      socials: [],
      license_number: "",
      is_published: false,
      sort_order: num(last.items[0]?.sort_order) + 1,
    };
    await commit(
      pb,
      ctx,
      [{ collection: "studio_seats", op: "create", id, body }],
      {
        action: "studio.seat.create",
        targetCollection: "studio_seats",
        targetId: id,
      },
    );
    return { id };
  });
}

export type SeatUpdate = {
  name?: unknown;
  headline?: unknown;
  bio?: unknown;
  brandName?: unknown;
  /** Keyed by SEAT_SOCIALS platform. */
  socials?: Partial<Record<SeatSocial["platform"], unknown>>;
  licenseNumber?: unknown;
  /** Owner only. */
  email?: unknown;
  kind?: unknown;
  slug?: unknown;
  isPublished?: unknown;
};

/** Page fields for the barber or the owner; owner-only fields are ignored for barbers. */
export async function updateSeat(
  ctx: OrgContext,
  seatId: string,
  input: SeatUpdate,
): Promise<void> {
  requireStudio(ctx, "write");
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("That change couldn't be read. Try again.");
  }
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = text(input.name, "Name", 80, true);
  if (input.headline !== undefined) {
    body.headline = text(input.headline, "Headline", 120);
  }
  if (input.bio !== undefined) body.bio = text(input.bio, "Bio", 2000);
  if (input.brandName !== undefined) {
    body.brand_name = text(input.brandName, "Shop or chair name", 80);
  }
  if (input.socials !== undefined) body.socials = cleanSocials(input.socials);
  if (input.licenseNumber !== undefined) {
    body.license_number = cleanLicense(input.licenseNumber);
  }
  const manager = isManager(ctx);
  if (manager && input.email !== undefined)
    body.email = cleanEmail(input.email);
  if (manager && input.kind !== undefined) {
    body.kind = input.kind === "staff" ? "staff" : "renter";
  }
  if (manager && input.isPublished !== undefined) {
    body.is_published = input.isPublished === true;
  }
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    if (manager && input.slug !== undefined) {
      const slug = str(input.slug).trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        throw new InvalidInput(
          "Web address: use lowercase letters, numbers and dashes.",
        );
      }
      body.slug = await uniqueSlug(pb, ctx.orgId, slug, seat.id);
    }
    if (Object.keys(body).length === 0) return;
    await commit(
      pb,
      ctx,
      [{ collection: "studio_seats", op: "update", id: seat.id, body }],
      {
        action: "studio.seat.update",
        targetCollection: "studio_seats",
        targetId: seat.id,
      },
    );
  });
}

/**
 * Remove a barber: the seat and its menu go, and their sign-in to this site closes (their
 * renter/staff membership is removed; an owner or admin membership is never touched).
 */
export async function removeSeat(
  ctx: OrgContext,
  seatId: string,
): Promise<void> {
  requireManager(ctx, "write");
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const ops: Op[] = [];
    const user = str(seat.user);
    if (user) {
      const members = await pb.collection("memberships").getFullList({
        filter: pb.filter(
          "organization = {:org} && user = {:u} && (role = 'renter' || role = 'staff')",
          { org: ctx.orgId, u: user },
        ),
        fields: "id",
      });
      for (const m of members) {
        ops.push({ collection: "memberships", op: "delete", id: m.id });
      }
    }
    // Services cascade with the seat (relation cascadeDelete).
    ops.push({ collection: "studio_seats", op: "delete", id: seat.id });
    await commit(pb, ctx, ops, {
      action: "studio.seat.delete",
      targetCollection: "studio_seats",
      targetId: seat.id,
      meta: { closedAccess: ops.length > 1 },
    });
  });
}

/**
 * Email the barber a join link: they sign in as a `renter` (chair renter) or `staff`
 * (employee) member holding only the Studio Booking grant, so they reach their own seat and
 * nothing else in the hub. Owner only (createInvite refuses Admins and impersonating staff).
 */
export async function inviteSeat(
  ctx: OrgContext,
  seatId: string,
  deps: InviteDeps = {},
): Promise<{ inviteId: string }> {
  requireManager(ctx, "write");
  const seat = await studioRead((pb) => seatFor(pb, ctx, seatId));
  const email = str(seat.email);
  if (!email) {
    throw new InvalidInput(
      "Add the barber's email first, then send the invite.",
    );
  }
  return createInvite(
    ctx,
    {
      email,
      role: seat.kind === "staff" ? "staff" : "renter",
      grants: [STUDIO_SLUG],
    },
    deps,
  );
}

// ---------------------------------------------------------------- menu (owner or barber)

export type ServiceInput = {
  id?: unknown;
  name: unknown;
  description?: unknown;
  durationMinutes: unknown;
  priceCents: unknown;
};

export async function saveSeatService(
  ctx: OrgContext,
  seatId: string,
  input: ServiceInput,
): Promise<{ id: string }> {
  requireStudio(ctx, "write");
  const body = {
    name: text(input?.name, "Service name", 80, true),
    description: text(input?.description, "Description", 300),
    duration_minutes: cleanDuration(input?.durationMinutes),
    price_cents: cleanPrice(input?.priceCents),
  };
  return studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const audit = { targetCollection: "studio_services" };
    if (input.id !== undefined && input.id !== "") {
      const row = await seatRow(pb, ctx, "studio_services", seat, input.id);
      await commit(
        pb,
        ctx,
        [{ collection: "studio_services", op: "update", id: row.id, body }],
        {
          ...audit,
          action: "studio.service.update",
          targetId: row.id,
        },
      );
      return { id: row.id };
    }
    const count = await pb.collection("studio_services").getList(1, 1, {
      filter: pb.filter("organization = {:org} && seat = {:s}", {
        org: ctx.orgId,
        s: seat.id,
      }),
      fields: "id",
    });
    if (count.totalItems >= 40) {
      throw new InvalidInput("A menu holds up to 40 services.");
    }
    const id = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_services",
          op: "create",
          id,
          body: {
            ...body,
            organization: ctx.orgId,
            seat: seat.id,
            sort_order: count.totalItems + 1,
          },
        },
      ],
      { ...audit, action: "studio.service.create", targetId: id },
    );
    return { id };
  });
}

export async function removeSeatService(
  ctx: OrgContext,
  seatId: string,
  serviceId: string,
): Promise<void> {
  requireStudio(ctx, "write");
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const row = await seatRow(pb, ctx, "studio_services", seat, serviceId);
    await commit(
      pb,
      ctx,
      [{ collection: "studio_services", op: "delete", id: row.id }],
      {
        action: "studio.service.delete",
        targetCollection: "studio_services",
        targetId: row.id,
      },
    );
  });
}

// ---------------------------------------------------------------- photos (owner or barber)

/** The shop context a barber's photo write runs under (after seatFor proved the seat). */
function asShop(ctx: OrgContext): OrgContext {
  return mintOrgContext({
    orgId: ctx.orgId,
    actor: ctx.actor,
    role: "admin",
    grants: [],
    ip: ctx.ip,
    systemJob: "studio-seat-photo",
    ...(ctx.impersonator ? { impersonator: ctx.impersonator } : {}),
  });
}

/** Best effort: an old photo left in the library is harmless, a failed save is not. */
async function retire(ctx: OrgContext, mediaId: string): Promise<void> {
  await removeMedia(asShop(ctx), mediaId).catch(() => undefined);
}

/**
 * Upload the seat's portrait ("photo") or add a gallery photo. The image goes through the
 * normal media pipeline (verify, strip, resize, moderate) as a "team" photo, on the barber's
 * behalf: a barber has no media-library access of their own, so the write runs under a
 * context minted for this one upload after seatFor() proved the seat is theirs.
 */
export async function uploadSeatPhoto(
  ctx: OrgContext,
  seatId: string,
  bytes: Uint8Array,
  target: "photo" | "gallery" | "logo",
  opts: { filename?: string } = {},
): Promise<{ mediaId: string }> {
  requireStudio(ctx, "write");
  const seat = await studioRead((pb) => seatFor(pb, ctx, seatId));
  if (target === "gallery" && ids(seat.gallery).length >= GALLERY_MAX) {
    throw new InvalidInput(
      `A gallery holds up to ${GALLERY_MAX} photos. Remove one first.`,
    );
  }
  const { asset } = await uploadImage(asShop(ctx), bytes, "team", {
    alt: (target === "logo"
      ? `${str(seat.brand_name) || str(seat.name)} logo`
      : `${str(seat.name)}${target === "photo" ? "" : ", work by"} at the shop`
    ).slice(0, 250),
    ...(opts.filename ? { filename: opts.filename } : {}),
  });
  let replaced = "";
  await studioWrite(ctx, async (pb) => {
    const fresh = await seatFor(pb, ctx, seatId);
    const body: Record<string, unknown> = {};
    if (target === "photo" || target === "logo") {
      replaced = str(fresh[target]);
      body[target] = asset.id;
    } else {
      const gallery = ids(fresh.gallery);
      if (gallery.length >= GALLERY_MAX) {
        throw new InvalidInput(
          `A gallery holds up to ${GALLERY_MAX} photos. Remove one first.`,
        );
      }
      body.gallery = [...gallery, asset.id];
    }
    await commit(
      pb,
      ctx,
      [{ collection: "studio_seats", op: "update", id: fresh.id, body }],
      {
        action: "studio.seat.photo",
        targetCollection: "studio_seats",
        targetId: fresh.id,
      },
    );
  });
  if (replaced) await retire(ctx, replaced);
  return { mediaId: asset.id };
}

/** Take a photo off the seat (portrait or gallery); the media row goes to Recently deleted. */
export async function removeSeatPhoto(
  ctx: OrgContext,
  seatId: string,
  mediaId: string,
): Promise<void> {
  requireStudio(ctx, "write");
  let removed = false;
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const gallery = ids(seat.gallery);
    const body: Record<string, unknown> = {};
    if (str(seat.photo) === mediaId) body.photo = "";
    if (str(seat.logo) === mediaId) body.logo = "";
    if (gallery.includes(mediaId))
      body.gallery = gallery.filter((g) => g !== mediaId);
    if (Object.keys(body).length === 0) throw new NotFound();
    await commit(
      pb,
      ctx,
      [{ collection: "studio_seats", op: "update", id: seat.id, body }],
      {
        action: "studio.seat.photo_remove",
        targetCollection: "studio_seats",
        targetId: seat.id,
      },
    );
    removed = true;
  });
  if (removed) await retire(ctx, mediaId);
}

/** One of the seat's own photos for the hub preview (portrait or gallery), else NotFound. */
export async function readSeatPhoto(
  ctx: OrgContext,
  seatId: string,
  mediaId: string,
  variant: "web" | "thumb",
): Promise<{ bytes: Uint8Array; mime: string }> {
  requireStudio(ctx, "read");
  const row = await studioRead(async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    if (
      str(seat.photo) !== mediaId &&
      str(seat.logo) !== mediaId &&
      !ids(seat.gallery).includes(mediaId)
    ) {
      throw new NotFound();
    }
    return mediaRow(pb, ctx.orgId, mediaId);
  });
  return readVariantOfRow(ctx.orgId, row, variant === "web" ? "web" : "thumb");
}
