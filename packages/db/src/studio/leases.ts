// Studio Booking seat leases (step 3; D152, D162 "fixed rent" house fee, simplified for one
// shop). Each chair has a rent amount, a cadence and the next due date; the owner records
// payments by hand ("Mark paid": CDS never moves money, D146). A barber reads their own lease
// and payments only (seatFor); every write is the owner's (or an Admin's).
// runLeaseOverdue (jobs route) alerts the owner once per missed due date: hub bell + email.
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { withSuperuser } from "../client";
import { commit, type Op } from "../content/shared";
import { mintSystemContext, type OrgContext } from "../context";
import { newRecordId } from "../repository";
import {
  num,
  requireManager,
  requireStudio,
  seatFor,
  str,
  studioActive,
  studioRead,
  studioWrite,
} from "./shared";
import { addDays, isDate, utcToZoned } from "./slots";

export const CADENCES = ["weekly", "biweekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];
const JOB = mintSystemContext({ job: "studio-leases" });

export type LeasePayment = {
  id: string;
  amountCents: number;
  paidOn: string;
  periodDue: string;
  note: string;
};

export type LeaseView = {
  seatId: string;
  seatName: string;
  rentCents: number;
  cadence: Cadence;
  nextDue: string;
  active: boolean;
  /** Days past the due date (0 when not overdue or inactive). */
  daysLate: number;
  payments: LeasePayment[];
};

/** The next due date after `date` (monthly keeps the day, clamped to the month's end). */
export function advanceDue(date: string, cadence: Cadence): string {
  if (cadence === "weekly") return addDays(date, 7);
  if (cadence === "biweekly") return addDays(date, 14);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function daysLate(
  nextDue: string,
  today: string,
  active: boolean,
): number {
  if (!active || !isDate(nextDue) || nextDue >= today) return 0;
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${nextDue}T00:00:00Z`)) /
      86_400_000,
  );
}

async function shopToday(
  pb: PocketBase,
  orgId: string,
  now: number,
): Promise<string> {
  const p = await pb
    .collection("business_profile")
    .getFirstListItem(pb.filter("organization = {:org}", { org: orgId }), {
      fields: "time_zone",
    })
    .catch(() => null);
  return utcToZoned(now, str(p?.time_zone) || "America/Chicago").date;
}

async function leaseRow(
  pb: PocketBase,
  orgId: string,
  seatId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection("studio_leases").getList(1, 1, {
    filter: pb.filter("organization = {:org} && seat = {:s}", {
      org: orgId,
      s: seatId,
    }),
  });
  return res.items[0] ?? null;
}

function cadence(v: unknown): Cadence {
  return (CADENCES as readonly unknown[]).includes(v)
    ? (v as Cadence)
    : "weekly";
}

async function view(
  pb: PocketBase,
  orgId: string,
  seat: RecordModel,
  row: RecordModel | null,
  today: string,
): Promise<LeaseView | null> {
  if (!row) return null;
  const pays = await pb.collection("studio_lease_payments").getFullList({
    filter: pb.filter("organization = {:org} && seat = {:s}", {
      org: orgId,
      s: seat.id,
    }),
    sort: "-period_due,-created",
  });
  const active = row.active === true;
  return {
    seatId: seat.id,
    seatName: str(seat.name),
    rentCents: num(row.rent_cents),
    cadence: cadence(row.cadence),
    nextDue: str(row.next_due),
    active,
    daysLate: daysLate(str(row.next_due), today, active),
    payments: pays.map((p) => ({
      id: p.id,
      amountCents: num(p.amount_cents),
      paidOn: str(p.paid_on),
      periodDue: str(p.period_due),
      note: str(p.note),
    })),
  };
}

/** One seat's lease (the owner, or the seat's own barber), or null when none is set. */
export async function getLease(
  ctx: OrgContext,
  seatId: string,
  now = Date.now(),
): Promise<LeaseView | null> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const today = await shopToday(pb, ctx.orgId, now);
    return view(
      pb,
      ctx.orgId,
      seat,
      await leaseRow(pb, ctx.orgId, seat.id),
      today,
    );
  });
}

/** Every chair renter seat with its lease (null = not set yet). Owner and Admin. */
export async function listLeases(
  ctx: OrgContext,
  now = Date.now(),
): Promise<{ seatId: string; seatName: string; lease: LeaseView | null }[]> {
  requireManager(ctx, "read");
  return studioRead(async (pb) => {
    const today = await shopToday(pb, ctx.orgId, now);
    const seats = await pb.collection("studio_seats").getFullList({
      filter: pb.filter("organization = {:org} && kind = 'renter'", {
        org: ctx.orgId,
      }),
      sort: "sort_order,created",
    });
    const out = [];
    for (const s of seats) {
      out.push({
        seatId: s.id,
        seatName: str(s.name),
        lease: await view(
          pb,
          ctx.orgId,
          s,
          await leaseRow(pb, ctx.orgId, s.id),
          today,
        ),
      });
    }
    return out;
  });
}

export type LeaseInput = {
  rentCents: unknown;
  cadence: unknown;
  nextDue: unknown;
  active?: unknown;
};

export async function saveLease(
  ctx: OrgContext,
  seatId: string,
  input: LeaseInput,
): Promise<void> {
  requireManager(ctx, "write");
  const rent = typeof input?.rentCents === "number" ? input.rentCents : NaN;
  if (!Number.isInteger(rent) || rent <= 0 || rent > 10_000_000) {
    throw new InvalidInput("Rent must be more than $0 and at most $100,000.");
  }
  if (!(CADENCES as readonly unknown[]).includes(input?.cadence)) {
    throw new InvalidInput("Pick weekly, every two weeks or monthly.");
  }
  if (!isDate(input?.nextDue))
    throw new InvalidInput("Pick the next due date.");
  const body = {
    rent_cents: rent,
    cadence: input.cadence,
    next_due: input.nextDue,
    active: input.active !== false,
  };
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const row = await leaseRow(pb, ctx.orgId, seat.id);
    const id = row?.id ?? newRecordId();
    const op: Op = row
      ? { collection: "studio_leases", op: "update", id, body }
      : {
          collection: "studio_leases",
          op: "create",
          id,
          body: {
            ...body,
            organization: ctx.orgId,
            seat: seat.id,
            overdue_alerted: "",
          },
        };
    await commit(pb, ctx, [op], {
      action: "studio.lease.save",
      targetCollection: "studio_leases",
      targetId: id,
    });
  });
}

/**
 * Record the rent for the current due date as paid (amount defaults to the rent) and move
 * the due date one period on.
 */
export async function markLeasePaid(
  ctx: OrgContext,
  seatId: string,
  input: { amountCents?: unknown; paidOn?: unknown; note?: unknown } = {},
  now = Date.now(),
): Promise<void> {
  requireManager(ctx, "write");
  const note = str(input.note).trim();
  if (note.length > 120)
    throw new InvalidInput("Note is longer than 120 characters.");
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const row = await leaseRow(pb, ctx.orgId, seat.id);
    if (!row) throw new InvalidInput("Set the rent first.");
    const amount =
      input.amountCents === undefined || input.amountCents === 0
        ? num(row.rent_cents)
        : (input.amountCents as number);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) {
      throw new InvalidInput("Amount must be more than $0.");
    }
    const paidOn = isDate(input.paidOn)
      ? input.paidOn
      : await shopToday(pb, ctx.orgId, now);
    const due = str(row.next_due);
    const pid = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_lease_payments",
          op: "create",
          id: pid,
          body: {
            organization: ctx.orgId,
            seat: seat.id,
            amount_cents: amount,
            paid_on: paidOn,
            period_due: due,
            note,
          },
        },
        {
          collection: "studio_leases",
          op: "update",
          id: row.id,
          body: { next_due: advanceDue(due, cadence(row.cadence)) },
        },
      ],
      {
        action: "studio.lease.paid",
        targetCollection: "studio_leases",
        targetId: row.id,
      },
    );
  });
}

/** Undo the latest payment: it goes and the due date moves back to the date it paid. */
export async function undoLeasePayment(
  ctx: OrgContext,
  seatId: string,
  paymentId: string,
): Promise<void> {
  requireManager(ctx, "write");
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const row = await leaseRow(pb, ctx.orgId, seat.id);
    const latest = await pb.collection("studio_lease_payments").getList(1, 1, {
      filter: pb.filter("organization = {:org} && seat = {:s}", {
        org: ctx.orgId,
        s: seat.id,
      }),
      sort: "-period_due,-created",
    });
    const p = latest.items[0];
    if (!row || !p || p.id !== paymentId) throw new NotFound();
    await commit(
      pb,
      ctx,
      [
        { collection: "studio_lease_payments", op: "delete", id: p.id },
        {
          collection: "studio_leases",
          op: "update",
          id: row.id,
          body: { next_due: str(p.period_due), overdue_alerted: "" },
        },
      ],
      {
        action: "studio.lease.undo",
        targetCollection: "studio_leases",
        targetId: row.id,
      },
    );
  });
}

/**
 * Alert the owner (hub bell + email) once for each active lease whose due date has passed
 * on the shop's clock; the alert names the barber, amount and days late.
 */
export async function runLeaseOverdue(
  now = Date.now(),
): Promise<{ alerted: number }> {
  const leases = await withSuperuser((pb) =>
    pb.collection("studio_leases").getFullList({ filter: "active = true" }),
  );
  let alerted = 0;
  for (const l of leases) {
    const orgId = str(l.organization);
    const due = str(l.next_due);
    const facts = await withSuperuser(async (pb) => {
      if (!(await studioActive(pb, orgId))) return null;
      const today = await shopToday(pb, orgId, now);
      const late = daysLate(due, today, true);
      if (late <= 0 || str(l.overdue_alerted) === due) return null;
      const seat = await pb
        .collection("studio_seats")
        .getOne(str(l.seat), { fields: "id,name" });
      await pb
        .collection("studio_leases")
        .update(l.id, { overdue_alerted: due });
      return { name: str(seat.name), late, seatId: seat.id };
    });
    if (!facts) continue;
    const amount = `$${(num(l.rent_cents) / 100).toFixed(2).replace(/\.00$/, "")}`;
    const r = await raiseAlert(
      { orgId, as: JOB },
      {
        type: "studio-booking.lease_overdue",
        sourceKey: `lease:${facts.seatId}:${due}`,
        title: `${facts.name}'s chair rent (${amount}) is ${facts.late} day${facts.late === 1 ? "" : "s"} late`,
        safeTitle: `A chair rent payment is late`,
        href: "/hub/studio-booking/rent",
        actionLabel: "Open Rent",
        audience: { roles: ["owner"] },
      },
    );
    if (r.recipients > 0) alerted++;
  }
  return { alerted };
}
