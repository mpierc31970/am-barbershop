// A&M Barber Studio: Studio Booking seed (idempotent). Installs the add-on (no charge: the
// shop owns this fork), adds the five placeholder barber seats with their AI placeholder
// portraits and a starter menu, and puts "Barbers" in the site menu.
//
//   npm run am:studio-seed
//
// Same storage note as am:seed: photos go to CDS_STORAGE_DIR, so for production run with a
// temp storage dir and copy it into the app's /data volume (CLAUDE.md "Seeding").
//
// TODO(owner): every seat below is a PLACEHOLDER: real names, emails, bios, photos and prices.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { readFileSync } from "node:fs";
import { withSuperuser } from "../src/client";
import { getNav, saveNav } from "../src/content/chrome/nav";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import { mintOrgContext } from "../src/context";
import { newRecordId } from "../src/repository";
import {
  createSeat,
  getSchedule,
  listSeats,
  saveHours,
  saveSeatService,
  updateSeat,
  uploadSeatPhoto,
} from "../src/studio";

const HOST = (process.env.AM_HOST || "barber.needtobeedgy.com").toLowerCase();
const PLACEHOLDER_BIO =
  "Placeholder profile. This barber's real name, photo and bio are coming soon.";

// TODO(owner): placeholder first names (4 Latino men, 1 Black woman, per the owner).
const SEATS = [
  ["Carlos", "Skin fades and sharp line-ups", "barber-1.webp"],
  ["Miguel", "Beard sculpting and buzz cuts", "barber-2.webp"],
  ["Luis", "Tapers and curly tops", "barber-3.webp"],
  ["Diego", "Classic and modern fades", "barber-4.webp"],
  ["Keisha", "Tapered natural cuts and shape-ups", "barber-5.webp"],
] as const;

// TODO(owner): real prices; 0 shows "Ask" on the site.
const MENU = [
  ["Haircut", 30, "Clippers and shears, finished with a hot-towel neck shave."],
  ["Skin fade", 45, "Bald to blended, any height on top."],
  ["Beard trim and line-up", 20, "Shape, line and condition."],
  ["Kids cut", 30, "12 and under."],
] as const;

function log(line: string): void {
  console.log(line);
}

async function main(): Promise<void> {
  const { orgId, ownerId } = await withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getFirstListItem(pb.filter("slug = 'am-barber'"));
    const m = await pb
      .collection("memberships")
      .getFirstListItem(
        pb.filter("organization = {:o} && role = 'owner'", { o: org.id }),
      );
    return { orgId: org.id, ownerId: String(m.user) };
  });
  const ctx = mintOrgContext({
    orgId,
    actor: ownerId,
    role: "owner",
    grants: [],
    ip: "am-seed",
  });
  const deps = {
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
  };

  // Private add-on (not in the catalog): the shop's entitlement row is written directly,
  // as staff would (installing seeds nothing, invariant 3).
  await withSuperuser(async (pb) => {
    const rows = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:o} && addon = 'studio-booking'", {
        o: orgId,
      }),
    });
    if (rows[0]?.status === "active") return;
    if (rows[0])
      await pb
        .collection("org_addons")
        .update(rows[0].id, { status: "active" });
    else {
      await pb.collection("org_addons").create({
        organization: orgId,
        addon: "studio-booking",
        status: "active",
        source: "staff",
        seeded: {},
      });
    }
  });
  log("PASS studio-booking active");

  const existing = await listSeats(ctx);
  for (const [name, headline, file] of SEATS) {
    if (existing.some((s) => s.name === name)) continue;
    const { id } = await createSeat(ctx, { name, email: "", kind: "renter" });
    await updateSeat(ctx, id, {
      headline,
      bio: PLACEHOLDER_BIO,
      isPublished: true,
    });
    await uploadSeatPhoto(
      ctx,
      id,
      new Uint8Array(readFileSync(`apps/web/public/am-barber/staff/${file}`)),
      "photo",
      { filename: file },
    );
    for (const [svc, min, desc] of MENU) {
      await saveSeatService(ctx, id, {
        name: svc,
        description: desc,
        durationMinutes: min,
        priceCents: 0,
      });
    }
    log(`PASS seat ${name} (placeholder)`);
  }

  // Step 2: every seat without hours gets the shop's opening hours (TODO(owner): each
  // barber's own hours), so the placeholder seats can be booked.
  const shopHours = await withSuperuser(async (pb) => {
    const p = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }), {
        fields: "hours",
      })
      .catch(() => null);
    return p?.hours ?? null;
  });
  const fallback = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
      d,
      d === "sun" || d === "mon"
        ? { open: false, ranges: [] }
        : { open: true, ranges: [{ start: "10:00", end: "19:00" }] },
    ]),
  );
  for (const seat of await listSeats(ctx)) {
    const schedule = await getSchedule(ctx, seat.id);
    if (schedule.hours) continue;
    try {
      const anyOpen =
        shopHours !== null &&
        typeof shopHours === "object" &&
        Object.values(shopHours as Record<string, { open?: boolean }>).some(
          (d) => d?.open === true,
        );
      await saveHours(ctx, seat.id, anyOpen ? shopHours : fallback);
    } catch {
      await saveHours(ctx, seat.id, fallback);
    }
    log(`PASS hours for ${seat.name}`);
  }

  const url = `https://${HOST}/barbers`;
  const nav = await getNav(ctx);
  if (nav && !nav.items.some((i) => i.target === url)) {
    await saveNav(ctx, deps, {
      ...nav,
      items: [
        ...nav.items,
        {
          id: newRecordId(),
          label: "Barbers",
          target: url,
          new_tab: false,
          children: [],
        },
      ],
    });
  }
  log("PASS Barbers in the site menu");
}

main().catch((err: unknown) => {
  console.error(
    `FAIL ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`,
  );
  process.exit(1);
});
