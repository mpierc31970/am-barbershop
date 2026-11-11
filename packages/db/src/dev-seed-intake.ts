// Dev intake fixtures (DEV ONLY; ONB-01..ONB-05, ONB-09, ONB-13; CONTEXT A3-Q4; 06-23). P8's
// assembly work needs two realistic intakes to build from:
//   seedCompleteIntake: every core field provided (profile, hours, 3 services, 2 team members,
//     logo / hero / gallery / mood board images, a confirmed inquiries route, Testimonials
//     records, the-rest answers), then Send to CDS: stage ready_for_build.
//   seedMinimalIntake: only org_name, path, time_zone and public_email; stage intake, not sent.
//     Everything else comes back from getIntakeForAssembly as a fallback.
//
// The org, owner, membership, first business_profile, org_intake and confirmed default route
// are written the way Submit writes them (one batch); everything after that goes through the
// public intake and media chokepoints as the owner, so validation and isolation are the real
// ones. Refuses unless CDS_ENV is exactly "dev" (assertDevEnvironment, T-06-106). Not exported
// from the @cds/db root: only the seed script imports it by relative path.
//
// Idempotent by slug: an org that already has the slug is returned untouched (created:
// false), so a second run never duplicates team, services or images.
import { InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type PocketBase from "pocketbase";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import { mintOrgContext, mintSystemContext, type OrgContext } from "./context";
import { assertDevEnvironment } from "./dev-seed";
import { captureTransport } from "./email";
import {
  addEmailRoute,
  confirmEmailRoute,
  saveAddonIntakeRecord,
  saveBusinessProfile,
  saveIntakeAnswers,
  saveService,
  saveTeamMember,
  sendToCds,
} from "./intake";
import { uploadImage, type MediaKind } from "./media";
import { newRecordId } from "./repository";
import type { ObjectStore } from "./storage";

export type IntakeSeedOptions = {
  slug: string;
  ownerEmail: string;
  /** Omitted = a random password nobody knows (sign in with an emailed code). */
  ownerPassword?: string;
};

export type IntakeSeedDeps = {
  /** The composed add-on registry (Testimonials intake + Send to CDS rules). */
  registry: AddonRegistry;
  store?: ObjectStore;
};

export type IntakeSeedResult = { orgId: string; created: boolean };

const SEED_IP = "dev-seed";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Base = {
  name: string;
  businessType: string;
  description: string;
  publicEmail: string;
  addons: string[];
};

async function firstOrNull(
  pb: PocketBase,
  collection: string,
  filter: string,
): Promise<RecordModel | null> {
  try {
    return await pb.collection(collection).getFirstListItem(filter);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

/** The org as Submit leaves it, plus its owner. null when the slug already exists. */
async function createSubmittedOrg(
  opts: IntakeSeedOptions,
  base: Base,
): Promise<{ orgId: string; ctx: OrgContext } | { orgId: string; ctx: null }> {
  assertDevEnvironment();
  const slug = opts.slug.trim().toLowerCase();
  const email = opts.ownerEmail.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new InvalidInput("slug must be lowercase letters, numbers, hyphens");
  }
  if (!email.includes("@")) throw new InvalidInput("owner email is invalid");
  const password = opts.ownerPassword ?? randomBytes(24).toString("hex");
  if (password.length < 10) {
    throw new InvalidInput("owner password must be at least 10 characters");
  }

  return withSuperuser(async (pb) => {
    const existing = await firstOrNull(
      pb,
      "organizations",
      pb.filter("slug = {:slug}", { slug }),
    );
    if (existing) return { orgId: existing.id, ctx: null };

    // The owner must be a new account: the seed never takes over an existing one (WR-A05).
    const user = await firstOrNull(
      pb,
      "users",
      pb.filter("email = {:e}", { e: email }),
    );
    if (user) {
      throw new InvalidInput(
        "owner email already has an account: pick another --owner-email",
      );
    }
    const owner = await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
      verified: true,
    });

    const orgId = newRecordId();
    const now = new Date().toISOString();
    const system = mintSystemContext({ job: "dev-seed" });
    const batch = pb.createBatch();
    batch.collection("organizations").create({
      id: orgId,
      name: base.name,
      slug,
      status: "active",
      path: "standard",
      stage: "intake",
    });
    batch.collection("memberships").create({
      user: owner.id,
      organization: orgId,
      role: "owner",
    });
    batch.collection("business_profile").create({
      organization: orgId,
      business_type: base.businessType,
      description: base.description,
      public_email: base.publicEmail,
    });
    batch.collection("org_intake").create({
      organization: orgId,
      selections: {
        addons: base.addons,
        extras: [],
        carePlan: false,
        cadence: "monthly",
      },
    });
    batch.collection("org_email_routes").create({
      organization: orgId,
      purpose: "default",
      address: base.publicEmail,
      confirmed_at: now,
    });
    batch.collection("audit_log").create(
      auditBody(system, {
        action: "dev_seed.intake",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { slug },
      }),
    );
    await batch.send();

    const ctx = mintOrgContext({
      orgId,
      actor: owner.id,
      role: "owner",
      grants: [],
      ip: SEED_IP,
    });
    return { orgId, ctx };
  });
}

/** A generated image: a soft two-colour gradient, so it is a real decodable file. */
async function image(
  width: number,
  height: number,
  from: string,
  to: string,
  format: "png" | "jpeg" = "jpeg",
): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  const s = sharp(Buffer.from(svg));
  const buf =
    format === "png" ? await s.png().toBuffer() : await s.jpeg().toBuffer();
  return new Uint8Array(buf);
}

const OPEN = (start: string, end: string) => ({
  open: true,
  ranges: [{ start, end }],
});
const CLOSED = { open: false, ranges: [] };

/**
 * DEV ONLY. A fully completed intake, sent to CDS (stage ready_for_build, submitted_at set).
 * Every core intake field is provided; Testimonials has 3 records.
 */
export async function seedCompleteIntake(
  opts: IntakeSeedOptions,
  deps: IntakeSeedDeps,
): Promise<IntakeSeedResult> {
  const made = await createSubmittedOrg(opts, {
    name: "Rivera Bakery",
    businessType: "bakery",
    description: "Fresh bread and cakes baked every morning in Austin.",
    publicEmail: "hello@riverabakery.test",
    addons: ["testimonials"],
  });
  if (!made.ctx) return { orgId: made.orgId, created: false };
  const ctx = made.ctx;
  const upload = async (kind: MediaKind, bytes: Uint8Array, alt: string) =>
    uploadImage(ctx, bytes, kind, {
      alt,
      filename: `${kind}.jpg`,
      ...(deps.store ? { store: deps.store } : {}),
    });

  // 1 · Your business + 2 · Contact & hours + 5 · the words.
  await saveBusinessProfile(ctx, {
    org_name: "Rivera Bakery",
    tagline: "Baked fresh at dawn",
    font_pairing: "warm-classic",
    phone: "(512) 555-0142",
    public_email: "hello@riverabakery.test",
    address: {
      street: "1200 South Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78704",
    },
    service_area: "Austin and Travis County",
    time_zone: "America/Chicago",
    hours: {
      mon: CLOSED,
      tue: OPEN("07:00", "15:00"),
      wed: OPEN("07:00", "15:00"),
      thu: OPEN("07:00", "15:00"),
      fri: {
        open: true,
        ranges: [
          { start: "07:00", end: "11:30" },
          { start: "13:00", end: "18:00" },
        ],
      },
      sat: OPEN("08:00", "14:00"),
      sun: CLOSED,
    },
    // 11-35: saveBusinessProfile writes these as social_accounts rows (ig, fb).
    socials: [
      { platform: "instagram", url: "https://instagram.com/riverabakery" },
      { platform: "facebook", url: "https://facebook.com/riverabakery" },
    ],
    about:
      "Rivera Bakery is a family bakery in Austin. Every loaf is shaped by hand and baked before sunrise.",
    mission: "Good bread, made slowly, for the whole neighborhood.",
    headline: "Bread worth getting up for",
    ga4_id: "G-DEVSEED01",
    legal_name: "Rivera Bakery LLC",
    privacy_contact: "privacy@riverabakery.test",
    legal_region: "Texas",
  });

  // 3 · Email: a confirmed inquiries address (the confirm email is captured, not sent).
  const mail = captureTransport();
  await addEmailRoute(
    ctx,
    { purpose: "inquiries", address: "orders@riverabakery.test" },
    { transport: mail },
  );
  const m = /\/start\/confirm-email\?t=([A-Za-z0-9_-]{43})/.exec(
    mail.sent.at(-1)?.text ?? "",
  );
  if (!m || !(await confirmEmailRoute(m[1]!))) {
    throw new Error("dev seed: inquiries route could not be confirmed");
  }

  // 4 · People & proof: team, services, Testimonials.
  await saveTeamMember(ctx, {
    name: "Ana Rivera",
    role: "Head baker",
    bio: "Ana has been baking sourdough for twenty years and still starts at 4 a.m.",
    is_published: true,
  });
  await saveTeamMember(ctx, {
    name: "Sam Ortiz",
    role: "Cake decorator",
    bio: "Sam designs every celebration cake with the family who orders it.",
    is_published: true,
  });
  await saveService(ctx, {
    name: "Custom celebration cake",
    description: "Designed with you, serves 12 to 40.",
    price_display: "from",
    price_cents: 6500,
    duration_minutes: null,
    is_published: true,
  });
  await saveService(ctx, {
    name: "Weekly bread box",
    description: "Three loaves every Saturday, picked up at the shop.",
    price_display: "fixed",
    price_cents: 2400,
    duration_minutes: null,
    is_published: true,
  });
  await saveService(ctx, {
    name: "Bread class",
    description: "Learn to shape and bake a sourdough loaf.",
    price_display: "fixed",
    price_cents: 8500,
    duration_minutes: 120,
    is_published: true,
  });
  for (const [quote, author_name] of [
    ["The sourdough is the best in town.", "Jordan P."],
    [
      "Our wedding cake was perfect, and they listened to every idea.",
      "Casey L.",
    ],
    ["The bread box is the highlight of my week.", "Riley M."],
  ] as const) {
    await saveAddonIntakeRecord(ctx, deps.registry, "testimonials", {
      quote,
      author_name,
      rating: 5,
    });
  }

  // 4 · Photos & look: logo, hero, gallery (described) and three mood boards.
  await upload(
    "logo",
    await image(600, 600, "#7a3e1d", "#e8b27a", "png"),
    "Rivera Bakery logo",
  );
  await upload(
    "hero",
    await image(2400, 1350, "#e8b27a", "#fff4e6"),
    "Fresh loaves cooling on the bakery counter",
  );
  const gallery: [string, string, string][] = [
    ["#c9844f", "#f6dcc0", "Sourdough loaves with a dark crust"],
    ["#f2c6d0", "#fff1f4", "A three-tier celebration cake"],
    ["#8a5a3b", "#e9cfa9", "The bakery front on South Congress"],
  ];
  for (const [a, b, alt] of gallery) {
    await upload("gallery", await image(1600, 1200, a, b), alt);
  }
  const moods: [string, string][] = [
    ["#7a3e1d", "#f6dcc0"],
    ["#5b6b4a", "#efe6d2"],
    ["#b04a3a", "#fbe9dc"],
  ];
  for (const [a, b] of moods) {
    await upload("moodboard", await image(1200, 900, a, b), "Mood board");
  }

  // 5 · The rest.
  await saveIntakeAnswers(ctx, {
    domain_choice: "have",
    domain: "riverabakery.com",
    registrar: "hostinger",
    gbp: "yes",
  });

  await sendToCds(ctx, deps.registry);
  return { orgId: made.orgId, created: true };
}

/**
 * DEV ONLY. The smallest intake that can be sent: only org_name, path, time_zone and
 * public_email. Left in stage intake (not sent), so P8's fallbacks carry everything else.
 */
export async function seedMinimalIntake(
  opts: IntakeSeedOptions,
): Promise<IntakeSeedResult> {
  const made = await createSubmittedOrg(opts, {
    name: "Juniper Tutoring",
    businessType: "",
    description: "",
    publicEmail: "juniper.tutoring@gmail.com",
    addons: [],
  });
  if (!made.ctx) return { orgId: made.orgId, created: false };
  await saveBusinessProfile(made.ctx, { time_zone: "America/Denver" });
  return { orgId: made.orgId, created: true };
}
