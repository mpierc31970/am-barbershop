// A&M Barber Studio sign-ins (idempotent). Three populations, never one account in two:
//   - Website administrator: AM_ADMIN_EMAIL becomes staff super_admin (/staff/sign-in:
//     password + emailed code). Staff are never shop members, so its shop membership goes.
//   - Shop owner: AM_OWNER_EMAIL owns the shop (/sign-in: password or emailed code):
//     profile, pages, site content, barbers.
//   - Barbers: each other seat signs in as AM_BARBER_EMAIL with {n} = N (default barber{n}@example.com), a
//     renter/staff member who sees only their own seat.
//
//   npm run am:roles
//
// Env (.env.local, never committed): AM_ADMIN_EMAIL, AM_ADMIN_PASSWORD, AM_OWNER_EMAIL,
// AM_OWNER_PASSWORD, AM_BARBER_PASSWORD, plus PB_URL / PB_SUPERUSER_*. Passwords are set on
// every run and are never printed.
import { withSuperuser } from "../src/client";
import { setStaffRole } from "../src/auth";
import { mintOrgContext, mintPlatformContext } from "../src/context";
import { addMember, removeMember, transferOwnership } from "../src/members";
import { updateSeat } from "../src/studio/seats";

const SLUG = "am-barber";
const IP = "am-roles";

function env(k: string): string {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is not set`);
  return v;
}

async function main(): Promise<void> {
  const adminEmail = env("AM_ADMIN_EMAIL").toLowerCase();
  const ownerEmail = env("AM_OWNER_EMAIL").toLowerCase();
  const adminPassword = env("AM_ADMIN_PASSWORD");
  const ownerPassword = env("AM_OWNER_PASSWORD");
  if (adminEmail === ownerEmail) {
    throw new Error("admin and owner must be different emails");
  }

  // Users (created or found) with their passwords set.
  const { orgId, adminId, ownerId } = await withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getFirstListItem(pb.filter("slug = {:s}", { s: SLUG }));
    const ensure = async (email: string, name: string, password: string) => {
      const found = (
        await pb.collection("users").getList(1, 1, {
          filter: pb.filter("email = {:e}", { e: email }),
        })
      ).items[0];
      const body = { password, passwordConfirm: password, verified: true };
      if (found) {
        await pb.collection("users").update(found.id, body);
        return found.id;
      }
      return (await pb.collection("users").create({ email, name, ...body })).id;
    };
    return {
      orgId: org.id,
      adminId: await ensure(adminEmail, "Website admin", adminPassword),
      ownerId: await ensure(ownerEmail, "Shop owner", ownerPassword),
    };
  });

  const memberships = () =>
    withSuperuser(
      async (pb) =>
        await pb.collection("memberships").getFullList({
          filter: pb.filter("organization = {:o}", { o: orgId }),
        }),
    );
  const ctxFor = (actor: string) =>
    mintOrgContext({ orgId, actor, role: "owner", grants: [], ip: IP });

  // Ownership to the shop owner.
  let rows = await memberships();
  const currentOwner = rows.find((m) => m.role === "owner");
  if (!currentOwner) throw new Error("the shop has no owner");
  if (!rows.some((m) => m.role === "owner" && m.user === ownerId)) {
    let target = rows.find((m) => m.user === ownerId);
    if (!target) {
      await addMember(ctxFor(String(currentOwner.user)), {
        userId: ownerId,
        role: "admin",
      });
      target = (await memberships()).find((m) => m.user === ownerId)!;
    }
    await transferOwnership(ctxFor(String(currentOwner.user)), target.id);
    console.log("PASS shop ownership moved to the shop owner");
  } else console.log("PASS shop owner unchanged");

  // A&M: an optional second owner (AM_COOWNER_EMAIL / _PASSWORD / _NAME, e.g. Mike), with
  // the same owner role; no seat of their own.
  const coEmail = process.env.AM_COOWNER_EMAIL?.trim().toLowerCase() || "";
  if (coEmail !== "") {
    const coPassword = env("AM_COOWNER_PASSWORD");
    const coName = process.env.AM_COOWNER_NAME?.trim() || "Co-owner";
    await withSuperuser(async (pb) => {
      const body = {
        name: coName,
        password: coPassword,
        passwordConfirm: coPassword,
        verified: true,
      };
      const found = (
        await pb.collection("users").getList(1, 1, {
          filter: pb.filter("email = {:e}", { e: coEmail }),
        })
      ).items[0];
      const userId = found
        ? (await pb.collection("users").update(found.id, body)).id
        : (await pb.collection("users").create({ email: coEmail, ...body })).id;
      const row = (await memberships()).find((m) => m.user === userId);
      if (row) {
        if (row.role !== "owner")
          await pb.collection("memberships").update(row.id, { role: "owner" });
      } else {
        await pb.collection("memberships").create({
          organization: orgId,
          user: userId,
          role: "owner",
          addon_grants: [],
        });
      }
    });
    console.log(`PASS ${coName}: second shop owner (${coEmail})`);
  }

  // The admin leaves the shop, then becomes staff super_admin.
  rows = await memberships();
  const adminRow = rows.find((m) => m.user === adminId);
  if (adminRow) {
    await removeMember(ctxFor(ownerId), adminRow.id);
    console.log("PASS website admin removed from the shop's members");
  }
  await setStaffRole(
    mintPlatformContext({ actor: adminId, staffRole: "super_admin", ip: IP }),
    adminId,
    "super_admin",
  );
  console.log("PASS website admin is staff super_admin");

  // Barbers. The owner's own seat (AM_OWNER_SEAT, e.g. Miguel) belongs to the shop owner's
  // account and is an Employee seat (no chair rent). Every other seat, in the owner's order,
  // signs in as AM_BARBER_EMAIL (barber{n}@example.com) with a renter/staff membership (the seat's kind)
  // and the Studio Booking grant; the seat links itself on first sign-in (email match,
  // studio/shared ownSeat). Leftover barber<N> accounts are removed.
  const pattern =
    process.env.AM_BARBER_EMAIL?.trim() || "barber{n}@example.com";
  const barberEmail = (k: number) =>
    pattern.replace("{n}", String(k)).toLowerCase();
  const ownerSeat = process.env.AM_OWNER_SEAT?.trim().toLowerCase() || "";
  const barberPassword = env("AM_BARBER_PASSWORD");
  const seats = await withSuperuser((pb) =>
    pb.collection("studio_seats").getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
      sort: "sort_order,created",
    }),
  );
  const owner = ctxFor(ownerId);
  let n = 0;
  for (const seat of seats) {
    const name = String(seat.name);
    if (ownerSeat !== "" && name.toLowerCase() === ownerSeat) {
      await updateSeat(owner, seat.id, { email: ownerEmail, kind: "staff" });
      await withSuperuser(async (pb) => {
        await pb.collection("studio_seats").update(seat.id, { user: ownerId });
        await pb.collection("users").update(ownerId, { name });
      });
      console.log(`PASS ${name}: the shop owner's own seat (${ownerEmail})`);
      continue;
    }
    n += 1;
    const email = barberEmail(n);
    const kind = seat.kind === "staff" ? "staff" : "renter";
    const userId = await withSuperuser(async (pb) => {
      const found = (
        await pb.collection("users").getList(1, 1, {
          filter: pb.filter("email = {:e}", { e: email }),
        })
      ).items[0];
      const body = {
        name,
        password: barberPassword,
        passwordConfirm: barberPassword,
        verified: true,
      };
      if (found) {
        await pb.collection("users").update(found.id, body);
        return found.id;
      }
      return (await pb.collection("users").create({ email, ...body })).id;
    });
    if (!(await memberships()).some((m) => m.user === userId)) {
      await addMember(owner, {
        userId,
        role: kind,
        addonGrants: ["studio-booking"],
      });
    }
    if (seat.email !== email) await updateSeat(owner, seat.id, { email });
    if (seat.user && seat.user !== userId) {
      await withSuperuser((pb) =>
        pb.collection("studio_seats").update(seat.id, { user: "" }),
      );
    }
    console.log(`PASS ${name}: ${email} (${kind})`);
  }

  // barber<N> accounts past the last seat leave the shop and are deleted.
  for (let k = n + 1; k <= n + 20; k++) {
    const email = barberEmail(k);
    const user = await withSuperuser(
      async (pb) =>
        (
          await pb.collection("users").getList(1, 1, {
            filter: pb.filter("email = {:e}", { e: email }),
          })
        ).items[0],
    );
    if (!user) break;
    const row = (await memberships()).find((m) => m.user === user.id);
    if (row) await removeMember(owner, row.id);
    await withSuperuser((pb) => pb.collection("users").delete(user.id));
    console.log(`PASS removed ${email}`);
  }
}

main().catch((err: unknown) => {
  console.error(
    `FAIL ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`,
  );
  process.exit(1);
});
