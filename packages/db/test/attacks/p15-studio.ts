// Studio Booking cross-org attacks (TEN-03, invariant 1). Both collections are writes:
// custom, so the generic repo is read-only; org B's owner reaching org A's seat or service
// through the studio module is refused (NotFound on reads; writes never land, which the
// suite's "left every org A row unchanged" check proves).
import { NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  getSeat,
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
