// Studio Booking seat isolation on the real PocketBase binary: inside one shop, a barber
// (renter/staff member holding the studio-booking grant) reaches only their own seat; the
// owner manages every seat; visitors see only published seats of that site's org.
// Registers add-on collections before anything reads the composed registry.
import "@cds/addon-registry/server";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { siteContextForHost } from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email";
import { tenantRepo } from "../src/repository";
import { clearResolverCache } from "../src/resolve";
import {
  createSeat,
  getPublicSeat,
  getSeat,
  inviteSeat,
  listPublicSeats,
  listSeats,
  mySeatId,
  createPublicBooking,
  getLease,
  listLeases,
  markLeasePaid,
  runLeaseOverdue,
  saveLease,
  undoLeasePayment,
  listBookings,
  publicAvailability,
  removeSeat,
  runStudioReminders,
  saveHours,
  getSchedule,
  setBookingStatus,
  SLOT_TAKEN_COPY,
  removeSeatService,
  saveSeatService,
  updateSeat,
} from "../src/studio";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

let seat1 = "";
let seat2 = "";
let svc2 = "";
let barber1: OrgContext;
let barber2: OrgContext;

async function barber(
  email: string,
  role: "renter" | "staff",
): Promise<OrgContext> {
  const password = "pw-" + Math.random().toString(36).slice(2) + "xyz123";
  const user = await pb
    .collection("users")
    .create({ email, password, passwordConfirm: password });
  await pb.collection("memberships").create({
    organization: seed.A.org,
    user: user.id,
    role,
    addon_grants: ["studio-booking"],
  });
  return mintOrgContext({
    orgId: seed.A.org,
    actor: user.id,
    role,
    grants: ["studio-booking"],
    ip: "127.0.0.1",
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-studio-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await pb.collection("org_addons").create({
    organization: seed.A.org,
    addon: "studio-booking",
    status: "active",
    source: "staff",
    seeded: {},
  });
  seat1 = (
    await createSeat(seed.ctxA, {
      name: "Ana",
      email: "ana@cds.test",
      kind: "renter",
    })
  ).id;
  seat2 = (
    await createSeat(seed.ctxA, {
      name: "Beto",
      email: "beto@cds.test",
      kind: "staff",
    })
  ).id;
  svc2 = (
    await saveSeatService(seed.ctxA, seat2, {
      name: "Fade",
      durationMinutes: 45,
      priceCents: 3500,
    })
  ).id;
  barber1 = await barber("ana@cds.test", "renter");
  barber2 = await barber("beto@cds.test", "staff");
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("Studio Booking seat isolation", () => {
  it("a barber's seat links to their account by email and is the only one they list", async (t) => {
    if (!inst) return t.skip();
    expect(await mySeatId(barber1)).toBe(seat1);
    expect((await listSeats(barber1)).map((s) => s.id)).toEqual([seat1]);
    expect((await listSeats(barber2)).map((s) => s.id)).toEqual([seat2]);
    expect((await listSeats(seed.ctxA)).map((s) => s.id).sort()).toEqual(
      [seed.A.studioSeat, seat1, seat2].sort(),
    );
  });

  it("a barber cannot read or write another barber's seat or menu", async (t) => {
    if (!inst) return t.skip();
    await expect(getSeat(barber1, seat2)).rejects.toThrow(NotFound);
    await expect(updateSeat(barber1, seat2, { bio: "hijack" })).rejects.toThrow(
      NotFound,
    );
    await expect(
      saveSeatService(barber1, seat2, {
        name: "x",
        durationMinutes: 30,
        priceCents: 0,
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      saveSeatService(barber1, seat2, {
        id: svc2,
        name: "x",
        durationMinutes: 30,
        priceCents: 0,
      }),
    ).rejects.toThrow(NotFound);
    await expect(removeSeatService(barber1, seat2, svc2)).rejects.toThrow(
      NotFound,
    );
    // Their own seat id with the other barber's service id is NotFound too.
    await expect(removeSeatService(barber1, seat1, svc2)).rejects.toThrow(
      NotFound,
    );
    expect((await pb.collection("studio_seats").getOne(seat2)).bio).toBe("");
    expect((await pb.collection("studio_services").getOne(svc2)).name).toBe(
      "Fade",
    );
  });

  it("a barber edits their own page but not the owner's fields", async (t) => {
    if (!inst) return t.skip();
    await updateSeat(barber1, seat1, {
      bio: "Fades all day",
      isPublished: true,
      email: "evil@cds.test",
      slug: "evil",
    });
    const row = await pb.collection("studio_seats").getOne(seat1);
    expect(row.bio).toBe("Fades all day");
    expect(row.is_published).toBe(false);
    expect(row.email).toBe("ana@cds.test");
    expect(row.slug).toBe("ana");
  });

  it("only the owner adds, removes and invites barbers", async (t) => {
    if (!inst) return t.skip();
    await expect(
      createSeat(barber1, { name: "X", email: "", kind: "renter" }),
    ).rejects.toThrow(Forbidden);
    await expect(removeSeat(barber1, seat2)).rejects.toThrow(Forbidden);
    await expect(inviteSeat(barber1, seat2)).rejects.toThrow(Forbidden);
  });

  it("the generic repo refuses renters on menus and pins seats to their own", async (t) => {
    if (!inst) return t.skip();
    await expect(tenantRepo("studio_services").list(barber1)).rejects.toThrow(
      Forbidden,
    );
    const seats = await tenantRepo("studio_seats").list(barber1);
    expect(seats.items.map((s) => s.id)).toEqual([seat1]);
  });

  it("visitors see only published seats of the site's org", async (t) => {
    if (!inst) return t.skip();
    await updateSeat(seed.ctxA, seat2, { isPublished: true });
    clearResolverCache();
    const site = await siteContextForHost(
      String((await pb.collection("org_hosts").getOne(seed.A.host)).hostname),
    );
    if (!site) throw new Error("no site");
    const pub = await listPublicSeats(site);
    // The fixture seat (published) and seat2; never seat1 (hidden) or org B's.
    expect(pub.map((s) => s.id).sort()).toEqual(
      [seed.A.studioSeat, seat2].sort(),
    );
    expect(Object.keys(pub[0]!)).not.toContain("email");
    expect(await getPublicSeat(site, "ana")).toBeNull();
    expect(await getPublicSeat(site, "barber-b")).toBeNull();
  });

  it("schedules and bookings stay with their own barber", async (t) => {
    if (!inst) return t.skip();
    const allDays = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
        d,
        { open: true, ranges: [{ start: "09:00", end: "17:00" }] },
      ]),
    );
    await saveHours(barber1, seat1, allDays);
    await expect(saveHours(barber2, seat1, allDays)).rejects.toThrow(NotFound);
    await expect(getSchedule(barber2, seat1)).rejects.toThrow(NotFound);
    await updateSeat(seed.ctxA, seat1, { isPublished: true });
    const svc = (
      await saveSeatService(barber1, seat1, {
        name: "Cut",
        durationMinutes: 30,
        priceCents: 3000,
      })
    ).id;
    clearResolverCache();
    const site = await siteContextForHost(
      String((await pb.collection("org_hosts").getOne(seed.A.host)).hostname),
    );
    if (!site) throw new Error("no site");
    // Monday 2030-01-07 6:00 am Chicago; book Tuesday 10:00.
    const now = Date.parse("2030-01-07T12:00:00Z");
    const avail = await publicAvailability(
      site,
      { barber: "ana", service: svc, date: "2030-01-08" },
      now,
    );
    expect(avail.slots.map((s) => s.time)).toContain("10:00");
    const mail = captureTransport();
    const input = {
      barber: "ana",
      service: svc,
      date: "2030-01-08",
      time: "10:00",
      name: "Client One",
      email: "one@cds.test",
    };
    const made = await createPublicBooking(site, input, "203.0.113.1", {
      now,
      transport: mail,
    });
    expect(made.reference).toMatch(/^AM-/);
    // The client's confirmation, plus the hub alert email to the barber and the owner.
    const to = mail.sent.map((m) => m.to);
    expect(to).toContain("one@cds.test");
    expect(to).toContain("ana@cds.test");
    expect(to).not.toContain("beto@cds.test");
    expect(mail.sent.find((m) => m.to === "one@cds.test")?.type).toBe(
      "booking.notice",
    );
    await expect(
      createPublicBooking(
        site,
        { ...input, email: "two@cds.test" },
        "203.0.113.2",
        { now },
      ),
    ).rejects.toThrow(SLOT_TAKEN_COPY);
    const after = await publicAvailability(
      site,
      { barber: "ana", service: svc, date: "2030-01-08" },
      now,
    );
    expect(after.slots.map((s) => s.time)).not.toContain("10:00");

    const own = await listBookings(barber1, { from: "2030-01-07" }, now);
    expect(own.bookings.map((b) => b.reference)).toEqual([made.reference]);
    const id = own.bookings[0]!.id;
    const other = await listBookings(barber2, { from: "2030-01-07" }, now);
    expect(other.bookings).toHaveLength(0);
    await expect(
      listBookings(barber2, { from: "2030-01-07", seatId: seat1 }, now),
    ).rejects.toThrow(NotFound);
    await expect(setBookingStatus(barber2, id, "cancelled")).rejects.toThrow(
      NotFound,
    );
    const owner = await listBookings(seed.ctxA, { from: "2030-01-07" }, now);
    expect(owner.bookings.map((b) => b.id)).toContain(id);

    // A request holds the time (above) and waits for its barber: no reminder, no "done".
    expect(own.bookings[0]!.status).toBe("requested");
    expect(
      (await runStudioReminders({ now: Date.parse("2030-01-07T18:00:00Z") }))
        .reminded,
    ).toBe(0);
    await expect(setBookingStatus(barber1, id, "completed")).rejects.toThrow(
      InvalidInput,
    );
    const approve = captureTransport();
    await setBookingStatus(barber1, id, "confirmed", { transport: approve });
    expect(approve.sent.map((m) => m.to)).toEqual(["one@cds.test"]);

    const r1 = await runStudioReminders({
      now: Date.parse("2030-01-07T18:00:00Z"),
      transport: mail,
    });
    expect(r1.reminded).toBe(1);
    const r2 = await runStudioReminders({
      now: Date.parse("2030-01-07T18:15:00Z"),
    });
    expect(r2.reminded).toBe(0);
    await setBookingStatus(barber1, id, "completed");
    expect((await pb.collection("studio_bookings").getOne(id)).status).toBe(
      "completed",
    );
  });

  it("chair rent: the owner keeps it, a barber only reads their own", async (t) => {
    if (!inst) return t.skip();
    const lease = {
      rentCents: 25000,
      cadence: "weekly",
      nextDue: "2030-01-07",
    };
    await saveLease(seed.ctxA, seat1, lease);
    await expect(saveLease(barber1, seat1, lease)).rejects.toThrow(Forbidden);
    await expect(markLeasePaid(barber1, seat1)).rejects.toThrow(Forbidden);
    await expect(listLeases(barber1)).rejects.toThrow(Forbidden);
    expect((await getLease(barber1, seat1))?.rentCents).toBe(25000);
    await expect(getLease(barber2, seat1)).rejects.toThrow(NotFound);

    await markLeasePaid(seed.ctxA, seat1, { paidOn: "2030-01-06" });
    const paid = await getLease(
      seed.ctxA,
      seat1,
      Date.parse("2030-01-08T18:00:00Z"),
    );
    expect(paid?.nextDue).toBe("2030-01-14");
    expect(paid?.payments.map((p) => p.periodDue)).toEqual(["2030-01-07"]);
    expect(paid?.daysLate).toBe(0);
    await expect(
      undoLeasePayment(barber1, seat1, paid!.payments[0]!.id),
    ).rejects.toThrow(Forbidden);
    await undoLeasePayment(seed.ctxA, seat1, paid!.payments[0]!.id);
    expect((await getLease(seed.ctxA, seat1))?.nextDue).toBe("2030-01-07");

    // Three days late on the shop's clock: one owner alert, once.
    const now = Date.parse("2030-01-10T18:00:00Z");
    expect((await getLease(seed.ctxA, seat1, now))?.daysLate).toBe(3);
    const first = await runLeaseOverdue(now);
    expect(first.alerted).toBeGreaterThanOrEqual(1);
    expect((await runLeaseOverdue(now)).alerted).toBe(0);
    const alerts = await pb.collection("alerts").getFullList({
      filter: pb.filter(
        "organization = {:o} && type = 'studio-booking.lease_overdue'",
        {
          o: seed.A.org,
        },
      ),
    });
    expect(alerts.map((a) => a.user)).toContain(seed.A.owner);
    expect(alerts.map((a) => a.user)).not.toContain(barber1.actor);
  });

  it("removing a barber closes their sign-in", async (t) => {
    if (!inst) return t.skip();
    await removeSeat(seed.ctxA, seat2);
    const left = await pb.collection("memberships").getFullList({
      filter: pb.filter("organization = {:o} && user = {:u}", {
        o: seed.A.org,
        u: barber2.actor,
      }),
    });
    expect(left).toHaveLength(0);
    await expect(
      pb.collection("studio_services").getOne(svc2),
    ).rejects.toThrow();
  });
});
