// Studio Booking seat isolation on the real PocketBase binary: inside one shop, a barber
// (renter/staff member holding the studio-booking grant) reaches only their own seat; the
// owner manages every seat; visitors see only published seats of that site's org.
// Registers add-on collections before anything reads the composed registry.
import "@cds/addon-registry/server";
import { Forbidden, NotFound } from "@cds/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { siteContextForHost } from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
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
  removeSeat,
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
