// Studio Booking bookings (step 2; D144, D149 reminders, D177 "Booking"). Ported from
// palm-science's booking flow (service -> date/time -> contact -> confirm), server-side:
//   - Visitors book through the site (createPublicBooking): published barber, one of their
//     services, an open time (re-checked under the studio lock, so two clients can't take
//     the same chair), name + email. The client gets a confirmation email; the barber and
//     the owner get a hub alert (bell + email).
//   - The hub lists bookings: the owner every barber's, a barber only their own.
//   - runStudioReminders (jobs route) emails each client once, about a day ahead.
// No payments here (CDS never processes tenant payments, D146): price is shown, paid in shop.
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import { isEmail } from "@cds/core/email";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { withOrgLock } from "../content/lock";
import { commit } from "../content/shared";
import { mintSystemContext, type OrgContext } from "../context";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { SlidingWindowLimiter } from "../rate-limit";
import { newRecordId } from "../repository";
import { hoursOf } from "./schedule";
import {
  num,
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
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const JOB = mintSystemContext({ job: "studio-booking" });
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Per visitor IP: bookings per hour (spam guard; a real client books once or twice). */
const bookLimiter = new SlidingWindowLimiter(6, 3_600_000);

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
      "organization = {:org} && seat = {:s} && status = 'confirmed' && starts_at >= {:from} && starts_at < {:to}",
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
        "organization = {:org} && seat = {:s} && status = 'confirmed' && starts_at >= {:from}",
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
      const slot = openSlots({
        date,
        hours: hoursOf(seat),
        timeOff: await timeOffOf(pb, site.orgId, seat.id),
        busy: await confirmedBusy(pb, site.orgId, seat.id, date),
        durationMin: num(svc.duration_minutes),
        tz: shop.tz,
        now,
        stepMin: slotMinutesOf(seat.slot_minutes),
      }).find((s) => s.time === input.time);
      if (!slot) throw new InvalidInput(SLOT_TAKEN_COPY);
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
        status: "confirmed",
        reminder_sent: false,
      });
      return { id, reference, seat, svc, shop, slot };
    }),
  );

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
      subject: `You're booked with ${barber}, ${when}`,
      lead: `Thanks, ${name}. You're booked at ${made.shop.name}.`,
      facts,
      why: `You're getting this because you booked online at ${made.shop.name}.${made.shop.phone ? ` Need to change it? Call ${made.shop.phone}.` : " Need to change it? Call the shop."}`,
    },
    { transport: deps.transport },
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
      title: `New booking: ${name} with ${barber}, ${when} (${service})`,
      safeTitle: `New booking with ${barber}, ${when}`,
      href: "/hub/studio-booking/bookings",
      actionLabel: "See bookings",
      audience: {
        users: barberUser ? [barberUser] : [],
        roles: ["owner", "admin"],
      },
    },
    deps.transport ? { transport: deps.transport } : {},
  );
  return { reference: made.reference, barber, service, when };
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

/** Mark a booking done / no-show / cancelled (the owner, or the booking's own barber). */
export async function setBookingStatus(
  ctx: OrgContext,
  bookingId: string,
  next: unknown,
  deps: BookingDeps = {},
): Promise<void> {
  requireStudio(ctx, "write");
  if (!(BOOKING_STATUSES as readonly unknown[]).includes(next)) {
    throw new InvalidInput("Pick done, no-show or cancel.");
  }
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
    if (r.status === next) return null;
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
  if (!row || next !== "cancelled") return;
  const when = whenLabel(Date.parse(str(row.r.starts_at)), row.shop.tz);
  await sendEmail(
    { kind: "org", ctx, orgId: ctx.orgId },
    "booking.notice",
    str(row.r.client_email),
    {
      subject: `Your booking with ${str(row.seat.name)} was cancelled`,
      lead: `Your booking at ${row.shop.name} on ${when} was cancelled by the shop.`,
      facts: [
        ["Barber", str(row.seat.name)],
        ["Service", str(row.r.service_name)],
        ["Booking", str(row.r.reference)],
      ],
      why: `You're getting this because you booked at ${row.shop.name}.${row.shop.phone ? ` Questions? Call ${row.shop.phone}.` : ""}`,
    },
    { transport: deps.transport },
  ).catch(() => console.error("[studio] cancellation not sent"));
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
        .getOne(str(r.seat), { fields: "name" });
      return { seat: str(seat.name), shop: await shopOf(pb, orgId) };
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
          why: `You're getting this because you booked at ${facts.shop.name}.${facts.shop.phone ? ` Can't make it? Call ${facts.shop.phone}.` : ""}`,
        },
        { transport: deps.transport },
      );
      reminded++;
    } catch {
      console.error("[studio] reminder not sent");
    }
  }
  return { reminded };
}
