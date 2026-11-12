// Studio Booking cross-org attacks (TEN-03, invariant 1). Both collections are writes:
// custom, so the generic repo is read-only; org B's owner reaching org A's seat or service
// through the studio module is refused (NotFound on reads; writes never land, which the
// suite's "left every org A row unchanged" check proves).
import { NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  addTimeOff,
  getLease,
  getSchedule,
  listLeases,
  markLeasePaid,
  saveLease,
  undoLeasePayment,
  getSeat,
  listBookings,
  removeTimeOff,
  saveHours,
  setBookingStatus,
  readSeatPhoto,
  removeSeat,
  removeSeatPhoto,
  removeSeatService,
  saveSeatService,
  updateSeat,
} from "../../src/studio";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export function attacks(env: AttackEnv): AttackMap {
  return {
    studio_seats: readOnlyAttack(env, "studio_seats"),
    studio_services: readOnlyAttack(env, "studio_services"),
    studio_time_off: readOnlyAttack(env, "studio_time_off"),
    studio_bookings: readOnlyAttack(env, "studio_bookings"),
    studio_missed: readOnlyAttack(env, "studio_missed"),
    studio_leases: readOnlyAttack(env, "studio_leases"),
    studio_lease_payments: readOnlyAttack(env, "studio_lease_payments"),
    "studio_leases:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(getLease(ctxB, A.studioSeat)).rejects.toThrow(NotFound);
      const rows = await listLeases(ctxB);
      expect(rows.map((r) => r.seatId)).not.toContain(A.studioSeat);
      await expect(
        saveLease(ctxB, A.studioSeat, {
          rentCents: 1,
          cadence: "weekly",
          nextDue: "2030-01-01",
        }),
      ).rejects.toThrow();
      await expect(markLeasePaid(ctxB, A.studioSeat)).rejects.toThrow();
    },
    "studio_lease_payments:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(
        undoLeasePayment(ctxB, A.studioSeat, A.studioLeasePayment),
      ).rejects.toThrow();
    },
    "studio_time_off:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(getSchedule(ctxB, A.studioSeat)).rejects.toThrow(NotFound);
      await expect(saveHours(ctxB, A.studioSeat, {})).rejects.toThrow();
      await expect(
        addTimeOff(ctxB, A.studioSeat, {
          start: "2030-02-01",
          end: "2030-02-01",
        }),
      ).rejects.toThrow();
      await expect(
        removeTimeOff(ctxB, A.studioSeat, A.studioTimeOff),
      ).rejects.toThrow();
    },
    "studio_bookings:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(
        listBookings(ctxB, { seatId: A.studioSeat }),
      ).rejects.toThrow(NotFound);
      const mine = await listBookings(ctxB, { from: "2029-12-01" });
      expect(mine.bookings.map((b) => b.id)).not.toContain(A.studioBooking);
      await expect(
        setBookingStatus(ctxB, A.studioBooking, "cancelled"),
      ).rejects.toThrow();
    },
    "studio_seats:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(getSeat(ctxB, A.studioSeat)).rejects.toThrow(NotFound);
      await expect(
        readSeatPhoto(ctxB, A.studioSeat, A.media, "thumb"),
      ).rejects.toThrow();
      await expect(
        updateSeat(ctxB, A.studioSeat, { name: "Evil" }),
      ).rejects.toThrow();
      await expect(removeSeat(ctxB, A.studioSeat)).rejects.toThrow();
      await expect(
        removeSeatPhoto(ctxB, A.studioSeat, A.media),
      ).rejects.toThrow();
    },
    "studio_services:module": async () => {
      const { A, ctxB } = env.seed();
      await expect(
        saveSeatService(ctxB, A.studioSeat, {
          id: A.studioService,
          name: "Evil",
          durationMinutes: 30,
          priceCents: 0,
        }),
      ).rejects.toThrow();
      await expect(
        removeSeatService(ctxB, A.studioSeat, A.studioService),
      ).rejects.toThrow();
    },
  };
}
