// Two-org fixture for the TEN-03 isolation suite (release gate) and later P2 integration
// tests. Seeds straight through the superuser client (test-only; production code goes
// through the repository) and mints contexts directly: production minting from real
// sign-ins arrives in plan 06.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { mintOrgContext, type OrgContext } from "../src/context";
import { defineTestCollection } from "../src/registry";

export const TEST_WIDGETS = "test_widgets";
const IP = "127.0.0.1";

function secret(): string {
  return randomBytes(18).toString("hex");
}

async function user(pb: PocketBase, email: string): Promise<string> {
  const password = secret();
  const rec = await pb
    .collection("users")
    .create({ email, password, passwordConfirm: password });
  return rec.id;
}

async function endUser(
  pb: PocketBase,
  organization: string,
  email: string,
): Promise<string> {
  // PB requires a password on auth records even with password auth off (plan 01).
  const password = secret();
  const rec = await pb
    .collection("end_users")
    .create({ organization, email, password, passwordConfirm: password });
  return rec.id;
}

export type OrgSeed = {
  org: string;
  owner: string;
  membership: string;
  host: string;
  endUser: string;
  audit: string;
  /** P3 content rows (CONT-01, CONT-30, CONT-11, CONT-12, D248). */
  page: string;
  section: string;
  popup: string;
  siteSettings: string;
  flag: string;
  /** ADDON-05 entitlement row; slug "fixture-seed" is no real or fixture manifest. */
  addon: string;
  /** One Testimonials add-on row (05-07; ADDON-03 isolation). */
  testimonial: string;
  credential: string;
  /** Studio Booking seat and its one service (step 1). */
  studioSeat: string;
  studioService: string;
  /** Studio Booking step 2: a day off and a booking on the seat. */
  studioTimeOff: string;
  studioBooking: string;
  studioMissed: string;
  /** Studio Booking step 3: the seat's lease and one logged payment. */
  studioLease: string;
  studioLeasePayment: string;
  /** P6 intake rows (06-05; ONB-01, ONB-04, ONB-09, ONB-13, EMAIL-01). */
  businessProfile: string;
  media: string;
  teamMember: string;
  service: string;
  intake: string;
  emailRoute: string;
  suppression: string;
  /** P7 rows (07-01; CONT-25, CONTACTS-02). */
  form: string;
  formSubmission: string;
  formDraft: string;
  contact: string;
  contactList: string;
  contactListMember: string;
  contactNote: string;
  contactEvent: string;
};

export type TwoOrgs = {
  A: OrgSeed;
  B: OrgSeed;
  renterA: string;
  renterA2: string;
  ctxA: OrgContext;
  ctxB: OrgContext;
  ctxRenterA: OrgContext;
  ctxRenterA2: OrgContext;
};

async function seedOrg(pb: PocketBase, key: "a" | "b"): Promise<OrgSeed> {
  const org = (
    await pb.collection("organizations").create({
      name: `Org ${key.toUpperCase()}`,
      slug: `org-${key}`,
      status: "active",
    })
  ).id;
  const owner = await user(pb, `owner-${key}@cds.test`);
  const membership = (
    await pb
      .collection("memberships")
      .create({ user: owner, organization: org, role: "owner" })
  ).id;
  const host = (
    await pb.collection("org_hosts").create({
      hostname: `${key}.example.com`,
      organization: org,
      kind: "custom",
      primary: true,
    })
  ).id;
  const eu = await endUser(pb, org, `customer-${key}@cds.test`);
  const audit = (
    await pb.collection("audit_log").create({
      organization: org,
      actor: owner,
      action: "fixture.seed",
      ip: IP,
    })
  ).id;
  const page = (
    await pb.collection("pages").create({
      organization: org,
      slug: "home",
      title: "Home",
      status: "draft",
      kind: "builder",
    })
  ).id;
  const section = (
    await pb.collection("page_sections").create({
      organization: org,
      page,
      page_slug: "home",
      section_type: "text-only",
      row_layout: "full",
      content: {},
      settings: {},
      sort_order: 1,
      is_published: true,
    })
  ).id;
  const popup = (
    await pb.collection("popups").create({
      organization: org,
      name: "Offer",
      trigger: "click",
      frequency: "once-per-visitor",
      show_on: "button-only",
      enabled: true,
      content: { items: [] },
    })
  ).id;
  const siteSettings = (
    await pb.collection("site_settings").create({
      organization: org,
      banner: { enabled: false },
    })
  ).id;
  const flag = (
    await pb.collection("content_flags").create({
      organization: org,
      target_collection: "pages",
      target_id: page,
      verdict: "unsure",
      status: "open",
    })
  ).id;
  const addon = (
    await pb.collection("org_addons").create({
      organization: org,
      addon: "fixture-seed",
      status: "active",
      source: "staff",
      seeded: {},
    })
  ).id;
  const testimonial = (
    await pb.collection("testimonials").create({
      organization: org,
      quote: `Kind words for org ${key.toUpperCase()}.`,
      author_name: `Customer ${key.toUpperCase()}`,
      source: "manual",
      featured: false,
      is_published: true,
      sort_order: 1,
    })
  ).id;
  const credential = (
    await pb.collection("credentials").create({
      organization: org,
      title: `License ${key.toUpperCase()}`,
      issuer: `Board ${key.toUpperCase()}`,
      category: "Licenses",
      credential_number: `NUM-${key.toUpperCase()}`,
      show_number: false,
      is_published: true,
      sort_order: 1,
    })
  ).id;
  const studioSeat = (
    await pb.collection("studio_seats").create({
      organization: org,
      name: `Barber ${key.toUpperCase()}`,
      slug: `barber-${key}`,
      kind: "renter",
      is_published: true,
      sort_order: 1,
    })
  ).id;
  const studioService = (
    await pb.collection("studio_services").create({
      organization: org,
      seat: studioSeat,
      name: `Cut ${key.toUpperCase()}`,
      duration_minutes: 30,
      price_cents: 3000,
      sort_order: 1,
    })
  ).id;
  const studioTimeOff = (
    await pb.collection("studio_time_off").create({
      organization: org,
      seat: studioSeat,
      start_date: "2030-01-01",
      end_date: "2030-01-02",
    })
  ).id;
  const studioBooking = (
    await pb.collection("studio_bookings").create({
      organization: org,
      seat: studioSeat,
      reference: `AM-${key.toUpperCase()}AAAAA`,
      service_name: "Cut",
      duration_minutes: 30,
      price_cents: 3000,
      starts_at: "2030-01-03T15:00:00.000Z",
      ends_at: "2030-01-03T15:30:00.000Z",
      client_name: `Client ${key.toUpperCase()}`,
      client_email: `client-${key}@cds.test`,
      status: "confirmed",
    })
  ).id;
  const studioMissed = (
    await pb.collection("studio_missed").create({
      organization: org,
      seat: studioSeat,
      service_name: "Cut",
      starts_at: "2030-01-03T15:00:00.000Z",
      client_name: `Missed ${key.toUpperCase()}`,
      client_email: `missed-${key}@cds.test`,
    })
  ).id;
  const studioLease = (
    await pb.collection("studio_leases").create({
      organization: org,
      seat: studioSeat,
      rent_cents: 25000,
      cadence: "weekly",
      next_due: "2030-01-07",
      active: true,
    })
  ).id;
  const studioLeasePayment = (
    await pb.collection("studio_lease_payments").create({
      organization: org,
      seat: studioSeat,
      amount_cents: 25000,
      paid_on: "2029-12-31",
      period_due: "2029-12-31",
    })
  ).id;
  const businessProfile = (
    await pb.collection("business_profile").create({
      organization: org,
      tagline: `Org ${key.toUpperCase()} tagline`,
      hours: {},
    })
  ).id;
  const media = (
    await pb.collection("media_assets").create({
      organization: org,
      kind: "logo",
      storage_dir: `tenants/${org}/media/fixture`,
      original_ext: "png",
      source: "intake",
      sort_order: 1,
    })
  ).id;
  const teamMember = (
    await pb.collection("team_members").create({
      organization: org,
      name: `Staff ${key.toUpperCase()}`,
      photo: media,
      sort_order: 1,
      is_published: true,
    })
  ).id;
  const service = (
    await pb.collection("services").create({
      organization: org,
      name: `Service ${key.toUpperCase()}`,
      price_display: "fixed",
      price_cents: 5000,
      sort_order: 1,
      is_published: true,
    })
  ).id;
  const intake = (
    await pb.collection("org_intake").create({
      organization: org,
      selections: {},
      stages_saved: [],
    })
  ).id;
  const emailRoute = (
    await pb.collection("org_email_routes").create({
      organization: org,
      purpose: "default",
      address: `owner-${key}@cds.test`,
      confirmed_at: new Date().toISOString(),
    })
  ).id;
  const suppression = (
    await pb.collection("email_suppressions").create({
      organization: org,
      email: `blocked-${key}@cds.test`,
      reason: "unsubscribe",
      scope: "marketing",
      source_type: "fixture",
    })
  ).id;
  const form = (
    await pb.collection("forms").create({
      organization: org,
      name: "Contact",
      template: "contact",
      layout: "1",
      fields: [],
      notify_route: "inquiries",
    })
  ).id;
  const visitor = `visitor-${key}@cds.test`;
  const contact = (
    await pb.collection("contacts").create({
      organization: org,
      email: visitor,
      email_norm: visitor,
      first_source: "form",
      marketing_consent: { status: "none" },
    })
  ).id;
  const contactList = (
    await pb.collection("contact_lists").create({
      organization: org,
      name: "Everyone",
      kind: "house",
    })
  ).id;
  const now = new Date().toISOString();
  const contactListMember = (
    await pb.collection("contact_list_members").create({
      organization: org,
      list: contactList,
      contact,
      added_at: now,
    })
  ).id;
  const contactNote = (
    await pb.collection("contact_notes").create({
      organization: org,
      contact,
      list: contactList,
      body: "Fixture note",
      author: owner,
    })
  ).id;
  const contactEvent = (
    await pb.collection("contact_events").create({
      organization: org,
      contact,
      kind: "form",
      ref: form,
      summary: "Contact form",
      at: now,
    })
  ).id;
  const formSubmission = (
    await pb.collection("form_submissions").create({
      organization: org,
      form,
      form_name: "Contact",
      page,
      data: {},
      labels: {},
      contact,
      spam: false,
    })
  ).id;
  const formDraft = (
    await pb.collection("form_drafts").create({
      organization: org,
      form,
      email: "draft@cds.test",
      data: {},
      token_hash: randomBytes(32).toString("hex"),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
  ).id;
  return {
    org,
    owner,
    membership,
    host,
    endUser: eu,
    audit,
    page,
    section,
    popup,
    siteSettings,
    flag,
    addon,
    testimonial,
    credential,
    studioSeat,
    studioService,
    studioTimeOff,
    studioBooking,
    studioMissed,
    studioLease,
    studioLeasePayment,
    businessProfile,
    media,
    teamMember,
    service,
    intake,
    emailRoute,
    suppression,
    form,
    formSubmission,
    formDraft,
    contact,
    contactList,
    contactListMember,
    contactNote,
    contactEvent,
  };
}

/** Orgs A and B (active), owners, two renters in A, one host / end user / audit row per org. */
export async function seedTwoOrgs(pb: PocketBase): Promise<TwoOrgs> {
  const A = await seedOrg(pb, "a");
  const B = await seedOrg(pb, "b");
  const renterA = await user(pb, "renter-a@cds.test");
  const renterA2 = await user(pb, "renter-a2@cds.test");
  for (const u of [renterA, renterA2]) {
    await pb
      .collection("memberships")
      .create({ user: u, organization: A.org, role: "renter" });
  }
  // Renters reach the fixture collection through an add-on grant (TEN-07); the
  // ownerField filter then narrows them to their own rows (TEN-14).
  const renterGrants = [TEST_WIDGETS];
  return {
    A,
    B,
    renterA,
    renterA2,
    ctxA: mintOrgContext({
      orgId: A.org,
      actor: A.owner,
      role: "owner",
      grants: [],
      ip: IP,
    }),
    ctxB: mintOrgContext({
      orgId: B.org,
      actor: B.owner,
      role: "owner",
      grants: [],
      ip: IP,
    }),
    ctxRenterA: mintOrgContext({
      orgId: A.org,
      actor: renterA,
      role: "renter",
      grants: renterGrants,
      ip: IP,
    }),
    ctxRenterA2: mintOrgContext({
      orgId: A.org,
      actor: renterA2,
      role: "renter",
      grants: renterGrants,
      ip: IP,
    }),
  };
}

export type Widgets = {
  A: string;
  B: string;
  renterA: string;
  renterA2: string;
};

/**
 * Create the test-only `test_widgets` collection in the throwaway PB and register it with
 * the registry's test extension, so the generic repository path and the renter owner
 * filter are exercised before real add-on collections exist.
 */
export async function createTestWidgets(
  pb: PocketBase,
  seed: TwoOrgs,
): Promise<Widgets> {
  const orgs = await pb.collections.getOne("organizations");
  const users = await pb.collections.getOne("users");
  await pb.collections.create({
    name: TEST_WIDGETS,
    type: "base",
    fields: [
      {
        type: "relation",
        name: "organization",
        required: true,
        collectionId: orgs.id,
        maxSelect: 1,
      },
      {
        type: "relation",
        name: "owner",
        required: false,
        collectionId: users.id,
        maxSelect: 1,
      },
      { type: "text", name: "title" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  defineTestCollection(TEST_WIDGETS, {
    kind: "base",
    feature: `addon:${TEST_WIDGETS}`,
    writes: "generic",
    ownerField: "owner",
    export: ["id", "organization", "owner", "title"],
  });
  const make = async (organization: string, owner: string, title: string) =>
    (await pb.collection(TEST_WIDGETS).create({ organization, owner, title }))
      .id;
  return {
    A: await make(seed.A.org, seed.A.owner, "widget a"),
    B: await make(seed.B.org, seed.B.owner, "widget b"),
    renterA: await make(seed.A.org, seed.renterA, "renter a widget"),
    renterA2: await make(seed.A.org, seed.renterA2, "renter a2 widget"),
  };
}
