"use server";
// Studio Booking hub actions (/hub/studio-booking). Plain <form action> posts: every field
// is untrusted, the org and the person come only from the session (runAction), and @cds/db
// re-checks who may touch which seat (a barber only their own). Each action answers with a
// redirect back to the screen and a one-time note (studioNote cookie) the page shows.
import {
  addTimeOff,
  createSeat,
  decideGalleryPhoto,
  inviteSeat,
  markLeasePaid,
  removeSeat,
  removeSeatPhoto,
  removeSeatService,
  removeTimeOff,
  saveHours,
  saveLease,
  saveSeatService,
  SEAT_SOCIALS,
  setBookingStatus,
  undoLeasePayment,
  updateSeat,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runAction } from "../../lib/action";
import { contentDeps } from "../../lib/content";
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

/**
 * Run one write, leave a note, refresh and go back to `back` (or where the write says).
 * `back: null` stays on the posting screen: Next re-renders it in this same response, so
 * the fresh rows and the note show at once. (A redirect renders the target in a separate
 * internal request that never sees the note cookie set here.)
 */
async function act(
  back: string | null,
  ok: string,
  fn: Parameters<typeof runAction<string | void>>[0],
): Promise<void> {
  const res = await runAction(fn);
  if (res.ok) await note("ok", ok);
  else if (res.code === "signed_out") redirect("/sign-in");
  else await note("error", res.message);
  revalidatePath(STUDIO_BASE, "layout");
  revalidatePath("/hub/alerts"); // its cards show booking status
  const to = res.ok && typeof res.data === "string" ? res.data : back;
  if (to) redirect(to);
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
      brandName: field(form, "brandName"),
      licenseNumber: field(form, "licenseNumber"),
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

/** My Social (A&M fork): the barber's social links, from their own tab. */
export async function saveSocialAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(
    `${STUDIO_BASE}/social?seat=${seatId}`,
    "Social links saved.",
    async ({ ctx }) => {
      await updateSeat(ctx, seatId, {
        socials: Object.fromEntries(
          SEAT_SOCIALS.map((p) => [p, field(form, `social_${p}`)]),
        ),
      });
    },
  );
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
  await act(
    `${STUDIO_BASE}/services?seat=${seatId}`,
    "Service saved.",
    async ({ ctx }) => {
      await saveSeatService(ctx, seatId, {
        id: idField(form, "serviceId"),
        name: field(form, "name"),
        description: field(form, "description"),
        durationMinutes: field(form, "duration"),
        priceCents: cents(field(form, "price")),
      });
    },
  );
}

export async function removeServiceAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(
    `${STUDIO_BASE}/services?seat=${seatId}`,
    "Service removed.",
    async ({ ctx }) => {
      await removeSeatService(ctx, seatId, idField(form, "serviceId"));
    },
  );
}

export async function removePhotoAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId) + "#photos", "Photo removed.", async ({ ctx }) => {
    await removeSeatPhoto(ctx, seatId, idField(form, "mediaId"));
  });
}

// ---------------------------------------------------------------- step 2: schedules, bookings

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveHoursAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  const hours: Record<
    string,
    { open: boolean; ranges: { start: string; end: string }[] }
  > = {};
  for (const d of DAY_KEYS) {
    const open = field(form, `open_${d}`) === "on";
    hours[d] = {
      open,
      ranges: open
        ? [{ start: field(form, `start_${d}`), end: field(form, `end_${d}`) }]
        : [],
    };
  }
  await act(seatHref(seatId) + "#hours", "Hours saved.", async ({ ctx }) => {
    await saveHours(
      ctx,
      seatId,
      hours,
      field(form, "slotMinutes") || undefined,
    );
  });
}

export async function addTimeOffAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(seatHref(seatId) + "#hours", "Time blocked.", async ({ ctx }) => {
    await addTimeOff(ctx, seatId, {
      start: field(form, "start"),
      end: field(form, "end"),
      from: field(form, "from"),
      to: field(form, "to"),
      note: field(form, "note"),
    });
  });
}

export async function removeTimeOffAction(form: FormData): Promise<void> {
  const seatId = idField(form, "seatId");
  await act(
    seatHref(seatId) + "#hours",
    "Time off removed.",
    async ({ ctx }) => {
      await removeTimeOff(ctx, seatId, idField(form, "timeOffId"));
    },
  );
}

const STATUS_DONE: Record<string, string> = {
  confirmed: "Approved. The client was emailed.",
  declined: "Declined. The client was emailed.",
  completed: "Marked done.",
  no_show: "Marked as a no-show.",
  cancelled: "Booking cancelled. The client was emailed.",
};

export async function bookingStatusAction(form: FormData): Promise<void> {
  const status = field(form, "status");
  // The Alerts screen acts in place (no redirect: it re-renders with the new status and
  // the note); only that one other screen is a valid way back.
  const onAlerts = field(form, "back") === "/hub/alerts";
  await act(
    onAlerts ? null : `${STUDIO_BASE}/bookings`,
    STATUS_DONE[status] ?? "Saved.",
    async ({ ctx }) => {
      await setBookingStatus(ctx, idField(form, "bookingId"), status);
    },
  );
}

/** Alerts: a barber's new photo -> Add to Gallery (publishes /gallery) or Skip, in place. */
export async function galleryPhotoAction(form: FormData): Promise<void> {
  const add = field(form, "decision") === "add";
  await act(
    null,
    add ? "Added to the Gallery." : "Skipped.",
    async ({ ctx }) => {
      await decideGalleryPhoto(
        ctx,
        idField(form, "seatId"),
        idField(form, "mediaId"),
        add,
        contentDeps(),
      );
    },
  );
}

// ---------------------------------------------------------------- step 3: chair rent

export async function saveLeaseAction(form: FormData): Promise<void> {
  await act(`${STUDIO_BASE}/rent`, "Rent saved.", async ({ ctx }) => {
    await saveLease(ctx, idField(form, "seatId"), {
      rentCents: cents(field(form, "rent")),
      cadence: field(form, "cadence"),
      nextDue: field(form, "nextDue"),
      active: field(form, "active") === "on",
    });
  });
}

export async function markPaidAction(form: FormData): Promise<void> {
  await act(`${STUDIO_BASE}/rent`, "Payment logged.", async ({ ctx }) => {
    await markLeasePaid(ctx, idField(form, "seatId"), {
      amountCents: cents(field(form, "amount")),
      paidOn: field(form, "paidOn"),
      note: field(form, "note"),
    });
  });
}

export async function undoPaymentAction(form: FormData): Promise<void> {
  await act(`${STUDIO_BASE}/rent`, "Payment removed.", async ({ ctx }) => {
    await undoLeasePayment(
      ctx,
      idField(form, "seatId"),
      idField(form, "paymentId"),
    );
  });
}
