// Studio Booking bookings (step 2; D144, D149 reminders, D177 "Booking"). Ported from
// palm-science's booking flow (service -> date/time -> contact -> confirm), server-side:
//   - Visitors book through the site (createPublicBooking): published barber, one of their
//     services, an open time (re-checked under the studio lock, so two clients can't take
//     the same chair), name + email. It starts as a `requested` booking that holds the time;
//     the client gets a "request received" email; the barber and the owner get a hub alert
//     and approve or decline it (setBookingStatus), which emails the client again.
//   - The hub lists bookings: the owner every barber's, a barber only their own.
//   - runStudioReminders (jobs route) emails each client once, about a day ahead.
// No payments here (CDS never processes tenant payments, D146): price is shown, paid in shop.
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import { isEmail } from "@cds/core/email";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { orgOwnerEmails } from "../members";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { withOrgLock } from "../content/lock";
import { commit } from "../content/shared";
import { mintSystemContext, type OrgContext } from "../context";
import { linkSecret, platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { SlidingWindowLimiter } from "../rate-limit";
import { newRecordId } from "../repository";
import { hoursOf } from "./schedule";
import {
  num,
  requireManager,
  requireStudio,
  seatFor,
  str,
  studioActive,
  studioRead,
  studioWrite,
  visibleSeatIds,
} from "./shared";
import {
  addDays,
  isDate,
  isTime,
  openSlots,
  slotMinutesOf,
  utcToZoned,
  type Busy,
  type Slot,
} from "./slots";

export const BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * True when a booking may move from one status to the other. A request is approved
 * (confirmed) or declined; a confirmed booking is done, a no-show or cancelled.
 */
export function bookingTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  if (from === "requested") return to === "confirmed" || to === "declined";
  if (from === "confirmed") {
    return to === "completed" || to === "no_show" || to === "cancelled";
  }
  return false;
}

const JOB = mintSystemContext({ job: "studio-booking" });
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Per visitor IP: bookings per hour (spam guard; a real client books once or twice). */
const bookLimiter = new SlidingWindowLimiter(6, 3_600_000);
/** A missed-booking alert: once per client + time per 10 minutes, at most 20 per barber an hour. */
const missedLimiter = new SlidingWindowLimiter(1, 600_000);
const missedSeatLimiter = new SlidingWindowLimiter(20, 3_600_000);

export type BookingView = {
  id: string;
  reference: string;
  seatId: string;
  barber: string;
  service: string;
  durationMinutes: number;
  priceCents: number;
  startsAt: string;
  /** Shop wall clock. */
  date: string;
  time: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  note: string;
  status: BookingStatus;
};

type Shop = { tz: string; name: string; phone: string };

async function shopOf(pb: PocketBase, orgId: string): Promise<Shop> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  const profile = await pb
    .collection("business_profile")
    .getFirstListItem(pb.filter("organization = {:org}", { org: orgId }), {
      fields: "time_zone,phone",
    })
    .catch(() => null);
  const tz = str(profile?.time_zone) || "America/Chicago";
  return { tz, name: str(org.name), phone: str(profile?.phone) };
}

/**
 * Client booking mail replies go to the shop owner(s) and the booking's barber, never the
 * site's routed or public address (that is the website admin, for technical issues only).
 */
async function bookingReplyTo(
  pb: PocketBase,
  orgId: string,
  barberUserId: string,
): Promise<string[]> {
  const out = await orgOwnerEmails(pb, orgId);
  if (barberUserId) {
    const barber = await pb
      .collection("users")
      .getOne(barberUserId, { fields: "email" })
      .catch(() => null);
    out.push(str(barber?.email));
  }
  return [...new Set(out.filter((e) => isEmail(e.toLowerCase())))];
}

/** "Reply to this email to reach Sam and the shop, or call 555-0100." */
function contactLine(
  ask: string,
  barber: string,
  shop: Shop,
  canReply: boolean,
): string {
  const call = shop.phone ? `call ${shop.phone}` : "call the shop";
  return canReply
    ? ` ${ask} Reply to this email to reach ${barber || "your barber"} and the shop, or ${call}.`
    : ` ${ask} ${call[0]!.toUpperCase()}${call.slice(1)}.`;
}

function status(v: unknown): BookingStatus {
  return (BOOKING_STATUSES as readonly unknown[]).includes(v)
    ? (v as BookingStatus)
    : "confirmed";
}

function toView(r: RecordModel, barber: string, tz: string): BookingView {
  const at = Date.parse(str(r.starts_at));
  const local = utcToZoned(at, tz);
  return {
    id: r.id,
    reference: str(r.reference),
    seatId: str(r.seat),
    barber,
    service: str(r.service_name),
    durationMinutes: num(r.duration_minutes),
    priceCents: num(r.price_cents),
    startsAt: str(r.starts_at),
    date: local.date,
    time: local.time,
    clientName: str(r.client_name),
    clientEmail: str(r.client_email),
    clientPhone: str(r.client_phone),
    note: str(r.note),
    status: status(r.status),
  };
}

/** "Thursday, November 12 at 2:30 pm" on the shop's clock. */
export function whenLabel(startsAtMs: number, tz: string): string {
  const d = new Date(startsAtMs);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace("AM", "am")
    .replace("PM", "pm");
  return `${day} at ${time}`;
}

function priceLabel(cents: number): string {
  if (cents <= 0) return "Ask in the shop";
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

async function confirmedBusy(
  pb: PocketBase,
  orgId: string,
  seatId: string,
  date: string,
): Promise<Busy[]> {
  // A window wide enough for any zone offset around the local date.
  const from = `${addDays(date, -1)}T00:00:00.000Z`;
  const to = `${addDays(date, 2)}T00:00:00.000Z`;
  const rows = await pb.collection("studio_bookings").getFullList({
    filter: pb.filter(
      // A pending request holds the chair like a booking.
      "organization = {:org} && seat = {:s} && (status = 'confirmed' || status = 'requested') && starts_at >= {:from} && starts_at < {:to}",
      { org: orgId, s: seatId, from, to },
    ),
    fields: "starts_at,ends_at",
  });
  return rows.map((r) => ({
    start: Date.parse(str(r.starts_at)),
    end: Date.parse(str(r.ends_at)),
  }));
}

async function timeOffOf(pb: PocketBase, orgId: string, seatId: string) {
  const rows = await pb.collection("studio_time_off").getFullList({
    filter: pb.filter("organization = {:org} && seat = {:s}", {
      org: orgId,
      s: seatId,
    }),
    fields: "start_date,end_date,start_time,end_time",
  });
  return rows.map((r) => ({
    start: str(r.start_date),
    end: str(r.end_date),
    from: str(r.start_time),
    to: str(r.end_time),
  }));
}

// ---------------------------------------------------------------- visitors

async function publishedSeatBySlug(
  pb: PocketBase,
  orgId: string,
  slug: unknown,
): Promise<RecordModel> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,60}$/.test(slug)) {
    throw new NotFound();
  }
  if (!(await studioActive(pb, orgId))) throw new NotFound();
  const res = await pb.collection("studio_seats").getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && slug = {:slug} && is_published = true",
      { org: orgId, slug },
    ),
  });
  if (!res.items[0]) throw new NotFound();
  return res.items[0];
}

async function seatService(
  pb: PocketBase,
  orgId: string,
  seat: RecordModel,
  serviceId: unknown,
): Promise<RecordModel> {
  if (typeof serviceId !== "string" || !/^[a-z0-9]{15}$/.test(serviceId)) {
    throw new NotFound();
  }
  const res = await pb.collection("studio_services").getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org} && seat = {:s}", {
      id: serviceId,
      org: orgId,
      s: seat.id,
    }),
  });
  if (!res.items[0]) throw new NotFound();
  return res.items[0];
}

export type PublicDay = { date: string; label: string; open: boolean };

/**
 * The days a visitor can pick for one barber + service (next BOOK_AHEAD days that have at
 * least one open time) and, when `date` is given, that day's open times.
 */
export async function publicAvailability(
  site: SiteContext,
  input: { barber: string; service: string; date?: string; days?: number },
  now = Date.now(),
): Promise<{ tz: string; days: PublicDay[]; slots: Slot[] }> {
  assertSiteContext(site);
  return studioRead(async (pb) => {
    const seat = await publishedSeatBySlug(pb, site.orgId, input.barber);
    const svc = await seatService(pb, site.orgId, seat, input.service);
    const { tz } = await shopOf(pb, site.orgId);
    const hours = hoursOf(seat);
    const off = await timeOffOf(pb, site.orgId, seat.id);
    const today = utcToZoned(now, tz).date;
    const all = await pb.collection("studio_bookings").getFullList({
      filter: pb.filter(
        "organization = {:org} && seat = {:s} && (status = 'confirmed' || status = 'requested') && starts_at >= {:from}",
        {
          org: site.orgId,
          s: seat.id,
          from: `${addDays(today, -1)}T00:00:00.000Z`,
        },
      ),
      fields: "starts_at,ends_at",
    });
    const busy = all.map((r) => ({
      start: Date.parse(str(r.starts_at)),
      end: Date.parse(str(r.ends_at)),
    }));
    const slotsFor = (date: string) =>
      openSlots({
        date,
        hours,
        timeOff: off,
        busy,
        durationMin: num(svc.duration_minutes),
        tz,
        now,
        stepMin: slotMinutesOf(seat.slot_minutes),
      });
    const days: PublicDay[] = [];
    for (let i = 0; i < Math.min(input.days ?? 14, 30); i++) {
      const date = addDays(today, i);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(`${date}T12:00:00Z`));
      days.push({ date, label, open: slotsFor(date).length > 0 });
    }
    const slots = input.date && isDate(input.date) ? slotsFor(input.date) : [];
    return { tz, days, slots };
  });
}

export type BookingInput = {
  barber: unknown;
  service: unknown;
  date: unknown;
  time: unknown;
  name: unknown;
  email: unknown;
  phone?: unknown;
  note?: unknown;
};

export type BookingDeps = { transport?: EmailTransport; now?: number };

function newReference(): string {
  let out = "AM-";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return out;
}

/** The copy a visitor sees when the time was just taken. */
export const SLOT_TAKEN_COPY = "That time was just taken. Pick another time.";

/**
 * Book one open time. Everything is re-checked under the studio lock (published barber,
 * their service, the time still open); `ip` feeds the per-visitor rate limit.
 */
export async function createPublicBooking(
  site: SiteContext,
  input: BookingInput,
  ip: string,
  deps: BookingDeps = {},
): Promise<{
  reference: string;
  barber: string;
  service: string;
  when: string;
}> {
  assertSiteContext(site);
  const name = str(input?.name).trim();
  const email = str(input?.email).trim().toLowerCase();
  const phone = str(input?.phone).trim();
  const note = str(input?.note).trim();
  if (name === "" || name.length > 80) {
    throw new InvalidInput("Enter your name.");
  }
  if (!isEmail(email) || email.length > 254) {
    throw new InvalidInput("Enter an email address like name@example.com.");
  }
  if (phone.length > 30) throw new InvalidInput("Phone number is too long.");
  if (note.length > 500)
    throw new InvalidInput("Note is longer than 500 characters.");
  if (!isDate(input?.date) || !isTime(input?.time)) {
    throw new InvalidInput("Pick a day and a time.");
  }
  if (bookLimiter.take(`${site.orgId}:${ip || "?"}`) === null) {
    throw new RateLimited("too many bookings from here; call the shop");
  }
  const now = deps.now ?? Date.now();
  const made = await withOrgLock(`studio:${site.orgId}`, () =>
    withSuperuser(async (pb) => {
      const seat = await publishedSeatBySlug(pb, site.orgId, input.barber);
      const svc = await seatService(pb, site.orgId, seat, input.service);
      const shop = await shopOf(pb, site.orgId);
      const date = input.date as string;
      const slotsWith = async (busy: Busy[]) =>
        openSlots({
          date,
          hours: hoursOf(seat),
          timeOff: await timeOffOf(pb, site.orgId, seat.id),
          busy,
          durationMin: num(svc.duration_minutes),
          tz: shop.tz,
          now,
          stepMin: slotMinutesOf(seat.slot_minutes),
        }).find((s) => s.time === input.time);
      const slot = await slotsWith(
        await confirmedBusy(pb, site.orgId, seat.id, date),
      );
      if (!slot) {
        // Open but for another client's booking: a missed booking the barber can follow up.
        const free = await slotsWith([]);
        if (
          free &&
          missedLimiter.take(`${seat.id}:${free.startsAt}:${email}`) !== null &&
          missedSeatLimiter.take(seat.id) !== null
        ) {
          const id = newRecordId();
          await pb.collection("studio_missed").create({
            id,
            organization: site.orgId,
            seat: seat.id,
            service_name: str(svc.name),
            starts_at: new Date(free.startsAt).toISOString(),
            client_name: name,
            client_email: email,
            client_phone: phone,
          });
          return { missed: { id, seat, shop, slot: free } } as const;
        }
        return { missed: null } as const;
      }
      const id = newRecordId();
      const reference = newReference();
      await pb.collection("studio_bookings").create({
        id,
        organization: site.orgId,
        seat: seat.id,
        reference,
        service: svc.id,
        service_name: str(svc.name),
        duration_minutes: num(svc.duration_minutes),
        price_cents: num(svc.price_cents),
        starts_at: new Date(slot.startsAt).toISOString(),
        ends_at: new Date(slot.endsAt).toISOString(),
        client_name: name,
        client_email: email,
        client_phone: phone,
        note,
        status: "requested",
        reminder_sent: false,
      });
      const replyTo = await bookingReplyTo(pb, site.orgId, str(seat.user));
      return {
        missed: undefined,
        id,
        reference,
        seat,
        svc,
        shop,
        slot,
        replyTo,
      };
    }),
  );
  if (made.missed !== undefined) {
    if (made.missed) await raiseMissed(site.orgId, made.missed, name, deps);
    throw new InvalidInput(SLOT_TAKEN_COPY);
  }

  const when = whenLabel(made.slot.startsAt, made.shop.tz);
  const barber = str(made.seat.name);
  const service = str(made.svc.name);
  const facts: [string, string][] = [
    ["Barber", barber],
    ["Service", service],
    ["When", when],
    ["Price", priceLabel(num(made.svc.price_cents))],
    ["Booking", made.reference],
  ];
  // Best effort: the booking stands even if the mail or the alert fails (logged).
  await sendEmail(
    { kind: "org", ctx: JOB, orgId: site.orgId },
    "booking.notice",
    email,
    {
      subject: `Request received: ${barber}, ${when}`,
      lead: `Thanks, ${name}. Your request at ${made.shop.name} is in. ${barber || "Your barber"} will confirm it, and we'll email you when they do.`,
      facts,
      why: `You're getting this because you asked to book online at ${made.shop.name}.${contactLine("Questions?", barber, made.shop, made.replyTo.length > 0)}`,
      ...cancelButton(made.id),
    },
    { transport: deps.transport, replyTo: made.replyTo },
  ).catch((err: unknown) =>
    console.error(
      `[studio] confirmation not sent: ${err instanceof Error ? err.name : "error"}`,
    ),
  );
  const barberUser = str(made.seat.user);
  await raiseAlert(
    { orgId: site.orgId, as: JOB },
    {
      type: "studio-booking.new",
      sourceKey: `booking:${made.id}`,
      title: `Booking request: ${name} with ${barber}, ${when} (${service})`,
      safeTitle: `Booking request with ${barber}, ${when}`,
      href: "/hub/alerts",
      actionLabel: "Approve or decline",
      audience: {
        users: barberUser ? [barberUser] : [],
        roles: ["owner", "admin"],
      },
    },
    deps.transport ? { transport: deps.transport } : {},
  );
  return { reference: made.reference, barber, service, when };
}

/** The barber's (and owners') alert for a client who lost the time to someone else. */
async function raiseMissed(
  orgId: string,
  m: { id: string; seat: RecordModel; shop: Shop; slot: Slot },
  name: string,
  deps: BookingDeps,
): Promise<void> {
  const [day, time] = whenLabel(m.slot.startsAt, m.shop.tz).split(" at ");
  const barber = str(m.seat.name);
  const barberUser = str(m.seat.user);
  await raiseAlert(
    { orgId, as: JOB },
    {
      type: "studio-booking.missed",
      sourceKey: `missed:${m.id}`,
      title: `Missed booking: ${name} wanted ${time} ${day} with ${barber}`,
      safeTitle: `Missed booking with ${barber}, ${time} ${day}`,
      href: "/hub/alerts",
      actionLabel: "Reach out",
      audience: {
        users: barberUser ? [barberUser] : [],
        roles: ["owner", "admin"],
      },
    },
    deps.transport ? { transport: deps.transport } : {},
  ).catch((err: unknown) =>
    console.error(
      `[studio] missed alert failed: ${err instanceof Error ? err.name : "error"}`,
    ),
  );
}

export type MissedView = {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
};

/** Missed bookings of the last 30 days this person may see (a barber their own seat). */
export async function listMissedBookings(
  ctx: OrgContext,
  now = Date.now(),
): Promise<MissedView[]> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    const visible = await visibleSeatIds(pb, ctx);
    if (visible !== "all" && visible.length === 0) return [];
    const rows = await pb.collection("studio_missed").getFullList({
      filter: pb.filter("organization = {:org} && created >= {:from}", {
        org: ctx.orgId,
        from: new Date(now - 30 * 86_400_000).toISOString().replace("T", " "),
      }),
      fields: "id,seat,client_name,client_email,client_phone",
    });
    const keep = visible === "all" ? null : new Set(visible);
    return rows
      .filter((r) => !keep || keep.has(str(r.seat)))
      .map((r) => ({
        id: r.id,
        clientName: str(r.client_name),
        clientEmail: str(r.client_email),
        clientPhone: str(r.client_phone),
      }));
  });
}

// ---------------------------------------------------------------- hub

/**
 * Bookings from `from` (a local date; default today) for 60 days, oldest first. Managers see
 * every barber (or one, with `seatId`); a barber only their own seat.
 */
export async function listBookings(
  ctx: OrgContext,
  opts: { from?: string; seatId?: string } = {},
  now = Date.now(),
): Promise<{ tz: string; bookings: BookingView[] }> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    const visible = await visibleSeatIds(pb, ctx);
    const { tz } = await shopOf(pb, ctx.orgId);
    const from =
      opts.from && isDate(opts.from) ? opts.from : utcToZoned(now, tz).date;
    let seatIds: string[] | "all" = visible;
    if (opts.seatId) {
      // Another org's or (for a barber) another barber's seat is NotFound.
      await seatFor(pb, ctx, opts.seatId);
      seatIds = [opts.seatId];
    }
    if (seatIds !== "all" && seatIds.length === 0) return { tz, bookings: [] };
    const seats = await pb.collection("studio_seats").getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: "id,name",
    });
    const names = new Map(seats.map((s) => [s.id, str(s.name)]));
    const rows = await pb.collection("studio_bookings").getFullList({
      filter: pb.filter(
        "organization = {:org} && starts_at >= {:from} && starts_at < {:to}",
        {
          org: ctx.orgId,
          from: `${addDays(from, -1)}T00:00:00.000Z`,
          to: `${addDays(from, 61)}T00:00:00.000Z`,
        },
      ),
      sort: "starts_at",
    });
    const keep = seatIds === "all" ? null : new Set(seatIds);
    const bookings = rows
      .filter((r) => !keep || keep.has(str(r.seat)))
      .map((r) => toView(r, names.get(str(r.seat)) ?? "", tz))
      .filter((b) => b.date >= from);
    return { tz, bookings };
  });
}

/** The client email each status change sends (none for done / no-show). */
function statusMail(
  next: BookingStatus,
  shop: Shop,
  barber: string,
  when: string,
): { subject: string; lead: string } | null {
  if (next === "confirmed") {
    return {
      subject: `You're booked with ${barber}, ${when}`,
      lead: `Good news: ${barber || "your barber"} confirmed your booking at ${shop.name} on ${when}. We'll remind you the day before.`,
    };
  }
  if (next === "declined") {
    return {
      subject: `${barber || "Your barber"} can't take your booking request`,
      lead: `Sorry, ${barber || "your barber"} can't take your request at ${shop.name} on ${when}. Pick another time online or get in touch.`,
    };
  }
  if (next === "cancelled") {
    return {
      subject: `Your booking with ${barber} was cancelled`,
      lead: `Your booking at ${shop.name} on ${when} was cancelled by the shop.`,
    };
  }
  return null;
}

/**
 * Approve or decline a request, or mark a booking done / no-show / cancelled (the owner or an
 * admin on any booking, a barber on their own). The client is emailed on approve, decline
 * and cancel; replies go to the barber and the shop owner.
 */
export async function setBookingStatus(
  ctx: OrgContext,
  bookingId: string,
  next: unknown,
  deps: BookingDeps = {},
): Promise<void> {
  requireStudio(ctx, "write");
  if (!(BOOKING_STATUSES as readonly unknown[]).includes(next)) {
    throw new InvalidInput("Pick approve, decline, done, no-show or cancel.");
  }
  const to = next as BookingStatus;
  const row = await studioWrite(ctx, async (pb) => {
    const r = await pb
      .collection("studio_bookings")
      .getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id: bookingId,
          org: ctx.orgId,
        }),
      )
      .catch(() => {
        throw new NotFound();
      });
    // The barber's own seat only (another barber's booking is NotFound).
    const seat = await seatFor(pb, ctx, str(r.seat));
    if (r.status === to) return null;
    if (!bookingTransition(status(r.status), to)) {
      throw new InvalidInput("That booking can't change that way any more.");
    }
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_bookings",
          op: "update",
          id: r.id,
          body: { status: next },
        },
      ],
      {
        action: "studio.booking.status",
        targetCollection: "studio_bookings",
        targetId: r.id,
        meta: { status: next },
      },
    );
    return { r, seat, shop: await shopOf(pb, ctx.orgId) };
  });
  if (!row) return;
  const when = whenLabel(Date.parse(str(row.r.starts_at)), row.shop.tz);
  const mail = statusMail(to, row.shop, str(row.seat.name), when);
  if (!mail) return;
  const replyTo = await withSuperuser((pb) =>
    bookingReplyTo(pb, ctx.orgId, str(row.seat.user)),
  ).catch(() => [] as string[]);
  await sendEmail(
    { kind: "org", ctx, orgId: ctx.orgId },
    "booking.notice",
    str(row.r.client_email),
    {
      ...mail,
      facts: [
        ["Barber", str(row.seat.name)],
        ["Service", str(row.r.service_name)],
        ["When", when],
        ["Booking", str(row.r.reference)],
      ],
      why: `You're getting this because you booked at ${row.shop.name}.${contactLine("Questions?", str(row.seat.name), row.shop, replyTo.length > 0)}`,
      ...(to === "confirmed" ? cancelButton(row.r.id) : {}),
    },
    { transport: deps.transport, replyTo },
  ).catch(() => console.error(`[studio] ${to} email not sent`));
}

/**
 * A&M fork: the owner (or an admin) hands a coming booking (requested or confirmed) to another
 * barber, e.g. when he is double booked from another platform. Same time, service and status;
 * refused if that barber already has a booking then. The new barber gets the booking alert,
 * the client an email naming their new barber.
 */
export async function transferBooking(
  ctx: OrgContext,
  bookingId: string,
  toSeatId: string,
  deps: BookingDeps = {},
): Promise<{ barber: string }> {
  requireManager(ctx, "write");
  const now = deps.now ?? Date.now();
  const done = await studioWrite(ctx, async (pb) => {
    const r = await pb
      .collection("studio_bookings")
      .getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id: bookingId,
          org: ctx.orgId,
        }),
      )
      .catch(() => {
        throw new NotFound();
      });
    const st = status(r.status);
    if (st !== "requested" && st !== "confirmed") {
      throw new InvalidInput("Only a coming booking can move.");
    }
    if (Date.parse(str(r.ends_at)) <= now) {
      throw new InvalidInput("That booking is over.");
    }
    if (str(r.seat) === toSeatId) {
      throw new InvalidInput("Pick another barber.");
    }
    const seat = await seatFor(pb, ctx, toSeatId);
    const clash = await pb.collection("studio_bookings").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && seat = {:s} && (status = 'confirmed' || status = 'requested') && starts_at < {:end} && ends_at > {:start}",
        {
          org: ctx.orgId,
          s: seat.id,
          start: str(r.starts_at),
          end: str(r.ends_at),
        },
      ),
      fields: "id",
    });
    if (clash.items[0]) {
      throw new InvalidInput(`${str(seat.name)} already has a booking then.`);
    }
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_bookings",
          op: "update",
          id: r.id,
          body: { seat: seat.id },
        },
      ],
      {
        action: "studio.booking.transfer",
        targetCollection: "studio_bookings",
        targetId: r.id,
        meta: { from: str(r.seat), to: seat.id },
      },
    );
    return {
      r,
      seat,
      shop: await shopOf(pb, ctx.orgId),
      replyTo: await bookingReplyTo(pb, ctx.orgId, str(seat.user)),
    };
  });
  const barber = str(done.seat.name);
  const when = whenLabel(Date.parse(str(done.r.starts_at)), done.shop.tz);
  const name = str(done.r.client_name);
  const service = str(done.r.service_name);
  const barberUser = str(done.seat.user);
  if (barberUser) {
    await raiseAlert(
      ctx,
      {
        type: "studio-booking.new",
        sourceKey: `booking:${done.r.id}`,
        title: `Booking moved to you: ${name}, ${when} (${service})`,
        safeTitle: `Booking moved to you, ${when}`,
        href: "/hub/alerts",
        actionLabel: "Open",
        audience: { users: [barberUser] },
      },
      deps.transport
        ? { transport: deps.transport, renotify: true }
        : { renotify: true },
    );
  }
  await sendEmail(
    { kind: "org", ctx, orgId: ctx.orgId },
    "booking.notice",
    str(done.r.client_email),
    {
      subject: `Your barber is now ${barber}, ${when}`,
      lead: `Same time, new barber: ${barber} will take your booking at ${done.shop.name} on ${when}.`,
      facts: [
        ["Barber", barber],
        ["Service", service],
        ["When", when],
        ["Booking", str(done.r.reference)],
      ],
      why: `You're getting this because you booked at ${done.shop.name}.${contactLine("Questions?", barber, done.shop, done.replyTo.length > 0)}`,
      ...cancelButton(done.r.id),
    },
    { transport: deps.transport, replyTo: done.replyTo },
  ).catch(() => console.error("[studio] transfer email not sent"));
  return { barber };
}

// ---------------------------------------------------------------- jobs

/**
 * Email each confirmed client once, when their booking starts within the next 24 hours.
 * Marked before sending (a crash never double-sends; a failed send is logged and skipped).
 */
export async function runStudioReminders(
  deps: BookingDeps = {},
): Promise<{ reminded: number }> {
  const now = deps.now ?? Date.now();
  const from = new Date(now + 60 * 60_000).toISOString();
  const to = new Date(now + 24 * 60 * 60_000).toISOString();
  const due = await withSuperuser((pb) =>
    pb.collection("studio_bookings").getFullList({
      filter: pb.filter(
        "status = 'confirmed' && reminder_sent = false && starts_at >= {:from} && starts_at < {:to}",
        { from, to },
      ),
    }),
  );
  let reminded = 0;
  for (const r of due) {
    const orgId = str(r.organization);
    const facts = await withSuperuser(async (pb) => {
      if (!(await studioActive(pb, orgId))) return null;
      await pb
        .collection("studio_bookings")
        .update(r.id, { reminder_sent: true });
      const seat = await pb
        .collection("studio_seats")
        .getOne(str(r.seat), { fields: "name,user" });
      return {
        seat: str(seat.name),
        shop: await shopOf(pb, orgId),
        replyTo: await bookingReplyTo(pb, orgId, str(seat.user)),
      };
    });
    if (!facts) continue;
    const when = whenLabel(Date.parse(str(r.starts_at)), facts.shop.tz);
    try {
      await sendEmail(
        { kind: "org", ctx: JOB, orgId },
        "booking.notice",
        str(r.client_email),
        {
          subject: `Reminder: ${facts.seat}, ${when}`,
          lead: `See you soon at ${facts.shop.name}.`,
          facts: [
            ["Barber", facts.seat],
            ["Service", str(r.service_name)],
            ["When", when],
            ["Booking", str(r.reference)],
          ],
          why: `You're getting this because you booked at ${facts.shop.name}.${contactLine("Can't make it?", facts.seat, facts.shop, facts.replyTo.length > 0)}`,
          ...cancelButton(r.id),
        },
        { transport: deps.transport, replyTo: facts.replyTo },
      );
      reminded++;
    } catch {
      console.error("[studio] reminder not sent");
    }
  }
  return { reminded };
}

// ---------------------------------------------------------------- client self-cancel

/** A client may cancel online up to this long before the start; after that, call the shop. */
export const CANCEL_CUTOFF_MS = 2 * 60 * 60_000;
const BOOKING_ID_RE = /^[a-z0-9]{15}$/;
const CANCEL_TOKEN_RE = /^v1\.([a-z0-9]{15})\.([A-Za-z0-9_-]{43})$/;
/** Per visitor IP: cancel attempts per hour (tokens are unguessable; this caps hammering). */
const cancelLimiter = new SlidingWindowLimiter(10, 3_600_000);

function cancelMac(id: string): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`booking-cancel.v1.${id}`)
    .digest();
}

/** "v1.<bookingId>.<mac>": the unguessable cancel token in the client's emails (no PII). */
export function bookingCancelToken(id: string): string {
  if (!BOOKING_ID_RE.test(id)) throw new InvalidInput("invalid booking id");
  return `v1.${id}.${cancelMac(id).toString("base64url")}`;
}

/** The booking id a cancel token stands for; null when malformed or tampered. Never throws. */
export function verifyCancelToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const m = CANCEL_TOKEN_RE.exec(token);
  if (!m) return null;
  try {
    const got = Buffer.from(m[2]!, "base64url");
    const want = cancelMac(m[1]!);
    return got.length === want.length && timingSafeEqual(got, want)
      ? m[1]!
      : null;
  } catch {
    return null;
  }
}

/** The email button; nothing when the link can't be built (logged, never blocks the mail). */
function cancelButton(id: string): {
  button?: { label: string; href: string };
} {
  try {
    const t = encodeURIComponent(bookingCancelToken(id));
    return {
      button: {
        label: "Cancel this appointment",
        href: platformUrl(`/book/cancel?t=${t}`),
      },
    };
  } catch {
    console.error("[studio] cancel link not built");
    return {};
  }
}

/** A request or a confirmed booking may be cancelled by its client until the cutoff. */
export function clientCanCancel(
  st: BookingStatus,
  startsAtMs: number,
  now: number,
): "ok" | "late" | "closed" {
  if (st !== "requested" && st !== "confirmed") return "closed";
  return startsAtMs - now > CANCEL_CUTOFF_MS ? "ok" : "late";
}

export type CancelView =
  | { state: "notfound" }
  | {
      /** ok: can cancel; cancelled: is cancelled; late: inside the cutoff; closed: declined, done, no-show. */
      state: "ok" | "cancelled" | "late" | "closed";
      barber: string;
      service: string;
      when: string;
      reference: string;
      shopName: string;
      shopPhone: string;
    };

type CancelTarget = { r: RecordModel; seat: RecordModel; shop: Shop };

async function cancelTarget(
  pb: PocketBase,
  orgId: string,
  token: unknown,
): Promise<CancelTarget | null> {
  const id = verifyCancelToken(token);
  if (!id) return null;
  const r = await pb
    .collection("studio_bookings")
    .getFirstListItem(
      pb.filter("id = {:id} && organization = {:org}", { id, org: orgId }),
    )
    .catch(() => null);
  if (!r) return null;
  const seat = await pb
    .collection("studio_seats")
    .getOne(str(r.seat), { fields: "id,name,user" });
  return { r, seat, shop: await shopOf(pb, orgId) };
}

function cancelView(t: CancelTarget, now: number): CancelView {
  const st = status(t.r.status);
  const at = Date.parse(str(t.r.starts_at));
  return {
    state: st === "cancelled" ? "cancelled" : clientCanCancel(st, at, now),
    barber: str(t.seat.name),
    service: str(t.r.service_name),
    when: whenLabel(at, t.shop.tz),
    reference: str(t.r.reference),
    shopName: t.shop.name,
    shopPhone: t.shop.phone,
  };
}

/** What the client's cancel link shows. A GET never changes anything (mail scanners prefetch). */
export async function publicCancelView(
  site: SiteContext,
  token: unknown,
  now = Date.now(),
): Promise<CancelView> {
  assertSiteContext(site);
  const t = await withSuperuser((pb) => cancelTarget(pb, site.orgId, token));
  return t ? cancelView(t, now) : { state: "notfound" };
}

/**
 * The client cancels their own request or confirmed booking (the POST behind the link), up
 * to CANCEL_CUTOFF_MS before it starts. The time frees at once; the client gets the
 * cancellation email; their barber and the owners get `studio-booking.client_cancelled`.
 */
export async function cancelPublicBooking(
  site: SiteContext,
  token: unknown,
  ip: string,
  deps: BookingDeps = {},
): Promise<CancelView> {
  assertSiteContext(site);
  if (cancelLimiter.take(`${site.orgId}:${ip || "?"}`) === null) {
    throw new RateLimited("too many tries from here; call the shop");
  }
  const now = deps.now ?? Date.now();
  const done = await withOrgLock(`studio:${site.orgId}`, () =>
    withSuperuser(async (pb) => {
      const t = await cancelTarget(pb, site.orgId, token);
      if (!t) return null;
      const view = cancelView(t, now);
      if (view.state !== "ok") return { t, view, replyTo: null };
      await pb
        .collection("studio_bookings")
        .update(t.r.id, { status: "cancelled" });
      const replyTo = await bookingReplyTo(pb, site.orgId, str(t.seat.user));
      return { t, view: { ...view, state: "cancelled" as const }, replyTo };
    }),
  );
  if (!done) return { state: "notfound" };
  if (done.replyTo === null) return done.view;
  const { t, view, replyTo } = done;
  await sendEmail(
    { kind: "org", ctx: JOB, orgId: site.orgId },
    "booking.notice",
    str(t.r.client_email),
    {
      subject: `Cancelled: ${view.barber}, ${view.when}`,
      lead: `You cancelled your booking at ${view.shopName} on ${view.when}. Book again any time online.`,
      facts: [
        ["Barber", view.barber],
        ["Service", view.service],
        ["When", view.when],
        ["Booking", view.reference],
      ],
      why: `You're getting this because you cancelled online at ${view.shopName}.${contactLine("Questions?", view.barber, t.shop, replyTo.length > 0)}`,
    },
    { transport: deps.transport, replyTo },
  ).catch(() => console.error("[studio] client cancel email not sent"));
  const barberUser = str(t.seat.user);
  await raiseAlert(
    { orgId: site.orgId, as: JOB },
    {
      type: "studio-booking.client_cancelled",
      sourceKey: `cancelled:${t.r.id}`,
      title: `Cancelled by client: ${str(t.r.client_name)} with ${view.barber}, ${view.when} (${view.service})`,
      safeTitle: `Booking cancelled with ${view.barber}, ${view.when}`,
      href: "/hub/alerts",
      actionLabel: "Open",
      audience: {
        users: barberUser ? [barberUser] : [],
        roles: ["owner", "admin"],
      },
    },
    deps.transport ? { transport: deps.transport } : {},
  ).catch(() => console.error("[studio] client cancel alert failed"));
  return view;
}
