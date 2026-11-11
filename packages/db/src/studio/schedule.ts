// Studio Booking schedules (step 2; D144, D145): each seat's weekly hours and whole-day time
// off. The owner and the seat's own barber edit them (seatFor: another barber's seat is
// NotFound). Hours use the intake WeeklyHours shape and its validator.
import { InvalidInput } from "@cds/core";
import { validateHours, type WeeklyHours } from "@cds/core/intake";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { commit } from "../content/shared";
import { newRecordId } from "../repository";
import {
  requireStudio,
  seatFor,
  seatRow,
  str,
  studioRead,
  studioWrite,
} from "./shared";
import { isDate, type TimeOff } from "./slots";

export type TimeOffView = TimeOff & { id: string; note: string };
export type ScheduleView = {
  hours: WeeklyHours | null;
  timeOff: TimeOffView[];
};

export function hoursOf(r: RecordModel): WeeklyHours | null {
  try {
    return r.hours ? validateHours(r.hours) : null;
  } catch {
    return null;
  }
}

function toTimeOff(r: RecordModel): TimeOffView {
  return {
    id: r.id,
    start: str(r.start_date),
    end: str(r.end_date),
    note: str(r.note),
  };
}

export async function getSchedule(
  ctx: OrgContext,
  seatId: string,
): Promise<ScheduleView> {
  requireStudio(ctx, "read");
  return studioRead(async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const off = await pb.collection("studio_time_off").getFullList({
      filter: pb.filter("organization = {:org} && seat = {:s}", {
        org: ctx.orgId,
        s: seat.id,
      }),
      sort: "start_date",
    });
    return { hours: hoursOf(seat), timeOff: off.map(toTimeOff) };
  });
}

export async function saveHours(
  ctx: OrgContext,
  seatId: string,
  raw: unknown,
): Promise<void> {
  requireStudio(ctx, "write");
  const hours = validateHours(raw);
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_seats",
          op: "update",
          id: seat.id,
          body: { hours },
        },
      ],
      {
        action: "studio.seat.hours",
        targetCollection: "studio_seats",
        targetId: seat.id,
      },
    );
  });
}

export async function addTimeOff(
  ctx: OrgContext,
  seatId: string,
  input: { start: unknown; end: unknown; note?: unknown },
): Promise<{ id: string }> {
  requireStudio(ctx, "write");
  const start = input?.start;
  const end = input?.end === "" || input?.end === undefined ? start : input.end;
  if (!isDate(start) || !isDate(end)) {
    throw new InvalidInput("Pick the first and last day off.");
  }
  if (end < start) {
    throw new InvalidInput("The last day off is before the first.");
  }
  const note = str(input?.note).trim();
  if (note.length > 120) {
    throw new InvalidInput("Note is longer than 120 characters.");
  }
  return studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const id = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: "studio_time_off",
          op: "create",
          id,
          body: {
            organization: ctx.orgId,
            seat: seat.id,
            start_date: start,
            end_date: end,
            note,
          },
        },
      ],
      {
        action: "studio.time_off.create",
        targetCollection: "studio_time_off",
        targetId: id,
      },
    );
    return { id };
  });
}

export async function removeTimeOff(
  ctx: OrgContext,
  seatId: string,
  id: string,
): Promise<void> {
  requireStudio(ctx, "write");
  await studioWrite(ctx, async (pb) => {
    const seat = await seatFor(pb, ctx, seatId);
    const row = await seatRow(pb, ctx, "studio_time_off", seat, id);
    await commit(
      pb,
      ctx,
      [{ collection: "studio_time_off", op: "delete", id: row.id }],
      {
        action: "studio.time_off.delete",
        targetCollection: "studio_time_off",
        targetId: row.id,
      },
    );
  });
}
