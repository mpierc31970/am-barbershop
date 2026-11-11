"use server";
// Studio Booking hub actions (/hub/studio-booking). Plain <form action> posts: every field
// is untrusted, the org and the person come only from the session (runAction), and @cds/db
// re-checks who may touch which seat (a barber only their own). Each action answers with a
// redirect back to the screen and a one-time note (studioNote cookie) the page shows.
import {
  createSeat,
  inviteSeat,
  removeSeat,
  removeSeatPhoto,
  removeSeatService,
  saveSeatService,
  updateSeat,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runAction } from "../../lib/action";
import { STUDIO_BASE, STUDIO_NOTE_COOKIE, seatHref } from "../../lib/studio";

const ID = /^[a-z0-9]{15}$/;

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function idField(form: FormData, key: string): string {
  const v = field(form, key);
  return ID.test(v) ? v : "";
}

/** "35", "35.5", "$35.00" -> 3500 cents; "" -> 0 (ask for a price); junk -> NaN (refused). */
function cents(raw: string): number {
  const s = raw.replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

async function note(kind: "ok" | "error", text: string): Promise<void> {
  (await cookies()).set(STUDIO_NOTE_COOKIE, `${kind}:${text}`.slice(0, 600), {
    httpOnly: true,
    sameSite: "lax",
    path: "/hub",
    maxAge: 15,
    secure: process.env.NODE_ENV === "production",
  });
}

/** Run one write, leave a note, refresh and go back to `back` (or where the write says). */
async function act(
  back: string,
  ok: string,
  fn: Parameters<typeof runAction<string | void>>[0],
): Promise<never> {
  const res = await runAction(fn);
  if (res.ok) await note("ok", ok);
  else if (res.code === "signed_out") redirect("/sign-in");
  else await note("error", res.message);
  revalidatePath(STUDIO_BASE, "layout");
  redirect(res.ok && typeof res.data === "string" ? res.data : back);
}

export async function addSeatAction(form: FormData): Promise<void> {
  await act(
    STUDIO_BASE,
    "Barber added. Fill in their page, then send the invite.",
    async ({ ctx }) => {
      const { id } = await createSeat(ctx, {
        name: field(form, "name"),
        email: field(form, "email"),
        kind: field(form, "kind"),
      });
      return seatHref(id);
    },
  );
}

export async function updateSeatAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId), "Saved.", async ({ ctx }) => {
    await updateSeat(ctx, seatId, {
      name: field(form, "name"),
      headline: field(form, "headline"),
      bio: field(form, "bio"),
      ...(form.has("email")
        ? {
            email: field(form, "email"),
            kind: field(form, "kind"),
            slug: field(form, "slug"),
            isPublished: field(form, "isPublished") === "on",
          }
        : {}),
    });
  });
}

export async function removeSeatAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(
    STUDIO_BASE,
    "Barber removed. Their sign-in to this site is closed.",
    async ({ ctx }) => {
      await removeSeat(ctx, seatId);
      return STUDIO_BASE;
    },
  );
}

export async function inviteSeatAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(
    seatHref(seatId),
    "Invite sent. The link works for 7 days.",
    async ({ ctx }) => {
      await inviteSeat(ctx, seatId);
    },
  );
}

export async function saveServiceAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId) + "#menu", "Service saved.", async ({ ctx }) => {
    await saveSeatService(ctx, seatId, {
      id: idField(form, "serviceId"),
      name: field(form, "name"),
      description: field(form, "description"),
      durationMinutes: field(form, "duration"),
      priceCents: cents(field(form, "price")),
    });
  });
}

export async function removeServiceAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId) + "#menu", "Service removed.", async ({ ctx }) => {
    await removeSeatService(ctx, seatId, idField(form, "serviceId"));
  });
}

export async function removePhotoAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId) + "#photos", "Photo removed.", async ({ ctx }) => {
    await removeSeatPhoto(ctx, seatId, idField(form, "mediaId"));
  });
}
