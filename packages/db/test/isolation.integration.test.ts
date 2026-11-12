// TEN-03 cross-tenant isolation suite: the release gate for Invariant 1 (TEN-02, TEN-03,
// TEN-08, TEN-14, LIFE-03). Runs on the real PocketBase 0.39.11 binary.
//
// It iterates Object.keys(allTenantCollections()) plus the test_widgets fixture, so every
// collection added to the registry is attacked here automatically. A registry key without
// an entry in seedRecordFor fails loudly.
//
// P7 (07-01): each P7 writer plan owns one attack module in ./attacks/p7-<area>.ts, merged
// into customWriters below with mergeAttacks (duplicate keys throw). See ./attacks/env.ts
// for the key convention (`<collection>` or `<collection>:<area>`).
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, InvalidContext, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeAddonRegistry } from "@cds/core/addons";
import { fixtureManifest } from "../../core/src/addons/__fixtures__/manifests";
import { addonRepo } from "../src/addons/addon-repo";
import { listOrgAddons } from "../src/addons/entitlements";
import { installAddon, uninstallAddon } from "../src/addons/installer";
import type { AddonDeps, InstallOptions } from "../src/addons/types";
import { appendAudit, listAuditLog } from "../src/audit";
import { resetClientForTests, superuser } from "../src/client";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { createPage, getPage, updatePage } from "../src/content/pages";
import { deletePopup, savePopup, setPopupEnabled } from "../src/content/popups";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import {
  deleteSection,
  listSections,
  reorderSections,
  saveSection,
  setSectionHidden,
  undoDeleteSection,
} from "../src/content/sections";
import { saveBanner } from "../src/content/site-settings";
import {
  commitCoreImport,
  deleteService,
  markStageSaved,
  removeTeamMember,
  reorderServices,
  reorderTeam,
  saveBusinessProfile,
  addEmailRoute,
  removeEmailRoute,
  resendRouteConfirmation,
  setNewsletterSender,
  saveIntakeAnswers,
  saveService,
  saveTeamMember,
} from "../src/intake";
import * as publicApi from "../src/index";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email";
import {
  readMediaVariant,
  removeMedia,
  reorderMedia,
  restoreMedia,
  setMediaAlt,
} from "../src/media";
import {
  addMember,
  changeRole,
  removeMember,
  setAddonGrants,
  transferOwnership,
} from "../src/members";
import { allTenantCollections } from "../src/registry";
import { tenantRepo, type ReadRepo, type WriteRepo } from "../src/repository";
import {
  createTestWidgets,
  seedTwoOrgs,
  TEST_WIDGETS,
  type TwoOrgs,
  type Widgets,
} from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import {
  attackCollection,
  mergeAttacks,
  type AttackEnv,
  type AttackMap,
  type Seeded,
} from "./attacks/env";
import { attacks as p7MediaLibrary } from "./attacks/p7-media-library";
import { attacks as p7MediaVideo } from "./attacks/p7-media-video";
import { attacks as p7Forms } from "./attacks/p7-forms";
import { attacks as p7Contacts } from "./attacks/p7-contacts";
import { attacks as p7SiteChrome } from "./attacks/p7-site-chrome";
import { attacks as p7SiteSettings } from "./attacks/p7-site-settings";
import { attacks as p7SoftDelete } from "./attacks/p7-soft-delete";
import { attacks as p7History } from "./attacks/p7-history";
import { attacks as p7Seo } from "./attacks/p7-seo";
import { attacks as p7Pages } from "./attacks/p7-pages";
import { attacks as p9Legal } from "./attacks/p9-legal";
import { attacks as p10Billing } from "./attacks/p10-billing";
import { attacks as p11People } from "./attacks/p11-people";
import { attacks as p11Site } from "./attacks/p11-site";
import {
  attacks as p12Support,
  P12_SUPPORT_COLLECTIONS,
  seedP12Support,
  type P12SupportSeed,
} from "./attacks/p12-support";
import {
  attacks as p13Staff,
  P13_STAFF_COLLECTIONS,
  seedP13Staff,
  type P13StaffSeed,
} from "./attacks/p13-staff";
import {
  attacks as p14Domains,
  P14_DOMAIN_COLLECTIONS,
  P14_PLATFORM_TABLES,
  seedP14Domains,
  type P14DomainSeed,
} from "./attacks/p14-domains";
import { attacks as p15Studio } from "./attacks/p15-studio";
import { seedBilling, type BillingSeed } from "./billing-seed";
import { seedP11, type P11Seed } from "./p11-seed";

const COLLECTIONS = [...Object.keys(allTenantCollections()), TEST_WIDGETS];

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let widgets: Widgets;
let before: Record<string, unknown[]>;
const savedEnv = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
};
/** P9 legal evidence rows (09-06): superuser inserts, one per org per collection. */
let legal: {
  signature: { A: string; B: string };
  ack: { A: string; B: string };
};
/** P10 billing rows (10-04): superuser inserts, one per org per collection. */
let billing: BillingSeed;
/** P11 rows (11-09): one per org per collection, plus org A's Editor's personal rows. */
let p11: P11Seed;
let p12: P12SupportSeed;
/** P13 rows (13-06): one failsafe_requests row per org. */
let p13: P13StaffSeed;
/** P14 rows (14-09): one launch_review_marks row per org. */
let p14: P14DomainSeed;

const HEX = "c".repeat(64);
const RETAIN = "2033-10-08 00:00:00.000Z";

/** One append-only signature and acknowledgement per org (plain-text ids, Pitfall 5). */
async function seedLegal(): Promise<typeof legal> {
  const sig = async (org: string, owner: string) =>
    (
      await pb.collection("agreement_signatures").create({
        organization: org,
        signer: owner,
        signer_email: "owner@cds.test",
        signer_name: "Owner",
        org_name: "Org",
        policies: [{ key: "terms", version: 1, sha256: HEX }],
        consent: { version: 1, sha256: HEX },
        auth_method: "otp",
        signed_at: new Date().toISOString(),
        document_key: `dev/tenants/${org}/agreements/seed.pdf`,
        document_sha256: HEX,
        evidence_sha256: HEX,
        retain_until: RETAIN,
        kind: "signup",
      })
    ).id;
  const ack = async (org: string, owner: string) =>
    (
      await pb.collection("site_policy_acks").create({
        organization: org,
        user: owner,
        kind: "ack",
        template_version: 1,
        privacy_sha256: HEX,
        terms_sha256: HEX,
        clause_ids: ["core.contact"],
        acked_at: new Date().toISOString(),
        retain_until: RETAIN,
      })
    ).id;
  return {
    signature: {
      A: await sig(seed.A.org, seed.A.owner),
      B: await sig(seed.B.org, seed.B.owner),
    },
    ack: {
      A: await ack(seed.A.org, seed.A.owner),
      B: await ack(seed.B.org, seed.B.owner),
    },
  };
}

/** Org A's and org B's record in each collection, plus valid create data. */
function seedRecordFor(name: string): Seeded {
  const map: Record<string, () => Seeded> = {
    memberships: () => ({
      a: seed.A.membership,
      b: seed.B.membership,
      create: {},
    }),
    org_hosts: () => ({
      a: seed.A.host,
      b: seed.B.host,
      create: { hostname: "evil.example.com", kind: "custom" },
    }),
    audit_log: () => ({ a: seed.A.audit, b: seed.B.audit, create: {} }),
    end_users: () => ({
      a: seed.A.endUser,
      b: seed.B.endUser,
      create: { email: "evil@cds.test" },
    }),
    pages: () => ({ a: seed.A.page, b: seed.B.page, create: {} }),
    page_sections: () => ({ a: seed.A.section, b: seed.B.section, create: {} }),
    popups: () => ({ a: seed.A.popup, b: seed.B.popup, create: {} }),
    site_settings: () => ({
      a: seed.A.siteSettings,
      b: seed.B.siteSettings,
      create: {},
    }),
    content_flags: () => ({ a: seed.A.flag, b: seed.B.flag, create: {} }),
    org_addons: () => ({
      a: seed.A.addon,
      b: seed.B.addon,
      create: { addon: "fixture-x", status: "active", source: "hub" },
    }),
    testimonials: () => ({
      a: seed.A.testimonial,
      b: seed.B.testimonial,
      create: {},
    }),
    credentials: () => ({
      a: seed.A.credential,
      b: seed.B.credential,
      create: {},
    }),
    studio_seats: () => ({
      a: seed.A.studioSeat,
      b: seed.B.studioSeat,
      create: {},
    }),
    studio_services: () => ({
      a: seed.A.studioService,
      b: seed.B.studioService,
      create: {},
    }),
    studio_time_off: () => ({
      a: seed.A.studioTimeOff,
      b: seed.B.studioTimeOff,
      create: {},
    }),
    studio_bookings: () => ({
      a: seed.A.studioBooking,
      b: seed.B.studioBooking,
      create: {},
    }),
    studio_missed: () => ({
      a: seed.A.studioMissed,
      b: seed.B.studioMissed,
      create: {},
    }),
    studio_leases: () => ({
      a: seed.A.studioLease,
      b: seed.B.studioLease,
      create: {},
    }),
    studio_lease_payments: () => ({
      a: seed.A.studioLeasePayment,
      b: seed.B.studioLeasePayment,
      create: {},
    }),
    // P6 intake collections (06-05). Their writers arrive in 06-11/12/13; until then the
    // generic repo is read-only and the customWriters attack proves it.
    business_profile: () => ({
      a: seed.A.businessProfile,
      b: seed.B.businessProfile,
      create: { tagline: "Evil" },
    }),
    media_assets: () => ({
      a: seed.A.media,
      b: seed.B.media,
      create: { kind: "logo", storage_dir: "tenants/evil/media/x" },
    }),
    team_members: () => ({
      a: seed.A.teamMember,
      b: seed.B.teamMember,
      create: { name: "Evil" },
    }),
    services: () => ({
      a: seed.A.service,
      b: seed.B.service,
      create: { name: "Evil", price_display: "free" },
    }),
    org_intake: () => ({ a: seed.A.intake, b: seed.B.intake, create: {} }),
    org_email_routes: () => ({
      a: seed.A.emailRoute,
      b: seed.B.emailRoute,
      create: { purpose: "default", address: "evil@cds.test" },
    }),
    email_suppressions: () => ({
      a: seed.A.suppression,
      b: seed.B.suppression,
      create: { email: "evil@cds.test", reason: "staff", scope: "all" },
    }),
    // P7 collections (07-01). Read-only until their writer plans fill ./attacks/p7-*.ts.
    forms: () => ({
      a: seed.A.form,
      b: seed.B.form,
      create: { name: "Evil", layout: "1" },
    }),
    form_submissions: () => ({
      a: seed.A.formSubmission,
      b: seed.B.formSubmission,
      create: { form_name: "Evil", data: {} },
    }),
    // 10-37: Forms Pro drafts. Writes are custom (forms/drafts.ts), so the generic write
    // attack proves the repo refuses them.
    form_drafts: () => ({
      a: seed.A.formDraft,
      b: seed.B.formDraft,
      create: {
        form: seed.B.form,
        email: "evil@cds.test",
        token_hash: "e".repeat(64),
        expires_at: new Date().toISOString(),
      },
    }),
    contacts: () => ({
      a: seed.A.contact,
      b: seed.B.contact,
      create: { email: "evil@cds.test", email_norm: "evil@cds.test" },
    }),
    contact_lists: () => ({
      a: seed.A.contactList,
      b: seed.B.contactList,
      create: { name: "Evil", kind: "renter" },
    }),
    contact_list_members: () => ({
      a: seed.A.contactListMember,
      b: seed.B.contactListMember,
      create: { list: seed.B.contactList, contact: seed.B.contact },
    }),
    contact_notes: () => ({
      a: seed.A.contactNote,
      b: seed.B.contactNote,
      create: {
        contact: seed.B.contact,
        list: seed.B.contactList,
        body: "Evil",
      },
    }),
    contact_events: () => ({
      a: seed.A.contactEvent,
      b: seed.B.contactEvent,
      create: {
        contact: seed.B.contact,
        kind: "manual",
        at: new Date().toISOString(),
      },
    }),
    // P9 legal evidence (09-06). Read-only here; the write attacks live with the writers in
    // ./attacks/p9-legal.ts (09-10 signatures: done; 09-16 acknowledgements).
    agreement_signatures: () => ({
      a: legal.signature.A,
      b: legal.signature.B,
      create: {},
    }),
    site_policy_acks: () => ({ a: legal.ack.A, b: legal.ack.B, create: {} }),
    // P10 billing (10-04). Read-only here; custom writers carry their own cross-tenant
    // attacks in their plans' tests (choice 4).
    billing_accounts: () => ({
      a: billing.billing_accounts.A,
      b: billing.billing_accounts.B,
      create: { provider: "fake", status: "active" },
    }),
    billing_invoices: () => ({
      a: billing.billing_invoices.A,
      b: billing.billing_invoices.B,
      create: {
        provider_invoice_id: "in_evil",
        issued_at: new Date().toISOString(),
      },
    }),
    gateway_accounts: () => ({
      a: billing.gateway_accounts.A,
      b: billing.gateway_accounts.B,
      create: {
        provider: "fake",
        account_id: "acct_evil",
        status: "connected",
      },
    }),
    work_orders: () => ({
      a: billing.work_orders.A,
      b: billing.work_orders.B,
      create: {
        kind: "polish",
        title: "Evil",
        total_cents: 1,
        status: "draft",
      },
    }),
    care_plan_time: () => ({
      a: billing.care_plan_time.A,
      b: billing.care_plan_time.B,
      create: {
        minutes: 1,
        note: "Evil",
        staff: "evil@cds.test",
        logged_at: new Date().toISOString(),
      },
    }),
    // P11 (11-09). Read-only here; per-person collections are also attacked from a
    // same-org Editor in ./attacks/p11-people.ts (Pitfall 6).
    ...Object.fromEntries(
      (
        [
          "member_prefs",
          "alerts",
          "push_subscriptions",
          "social_accounts",
          "site_daily_stats",
          "member_invites",
          "data_exports",
        ] as const
      ).map((n) => [
        n,
        (): Seeded => ({ a: p11.rows[n].A, b: p11.rows[n].B, create: {} }),
      ]),
    ),
    // P12 (12-04). Read-only here; the function-level attacks (12-32) live in
    // ./attacks/p12-support.ts.
    ...Object.fromEntries(
      P12_SUPPORT_COLLECTIONS.map((n) => [
        n,
        (): Seeded => ({ a: p12.rows[n].A, b: p12.rows[n].B, create: {} }),
      ]),
    ),
    // P13 (13-06). Read-only here; the function-level attacks (13-18) live in
    // ./attacks/p13-staff.ts.
    ...Object.fromEntries(
      P13_STAFF_COLLECTIONS.map((n) => [
        n,
        (): Seeded => ({ a: p13.rows[n].A, b: p13.rows[n].B, create: {} }),
      ]),
    ),
    // P14 (14-09). Read-only here; the function-level attacks (14-33, 14-50) live in
    // ./attacks/p14-domains.ts.
    ...Object.fromEntries(
      P14_DOMAIN_COLLECTIONS.map((n) => [
        n,
        (): Seeded => ({ a: p14.rows[n].A, b: p14.rows[n].B, create: {} }),
      ]),
    ),
    [TEST_WIDGETS]: () => ({
      a: widgets.A,
      b: widgets.B,
      create: { title: "x" },
    }),
  };
  const fn = map[name];
  if (!fn) throw new Error(`seedRecordFor has no entry for ${name}`);
  return fn();
}

async function snapshotOrgA(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) {
    out[name] = await pb.collection(name).getFullList({
      filter: pb.filter("organization = {:org}", { org: seed.A.org }),
      sort: "id",
    });
  }
  // 14-50 (choice 3): the P14 platform tables carry the site as org_id (P13-P5).
  for (const name of P14_PLATFORM_TABLES) {
    out[name] = await pb.collection(name).getFullList({
      filter: pb.filter("org_id = {:org}", { org: seed.A.org }),
      sort: "id",
    });
  }
  return out;
}

function isWrite(repo: ReadRepo | WriteRepo): repo is WriteRepo {
  return "create" in repo;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  widgets = await createTestWidgets(pb, seed);
  legal = await seedLegal();
  billing = await seedBilling(pb, seed.A.org, seed.B.org);
  p11 = await seedP11(pb, seed);
  p12 = await seedP12Support(pb, seed);
  p13 = await seedP13Staff(pb, seed);
  p14 = await seedP14Domains(pb, seed);
  before = await snapshotOrgA();
});

afterAll(async () => {
  await inst?.stop();
  // 14-50: seedP14Domains sets these when unset (move snapshots, staff alerts).
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("TEN-03 cross-tenant isolation (release gate)", () => {
  it("has a seed for every registry collection", (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of COLLECTIONS) {
      expect(() => seedRecordFor(name)).not.toThrow();
    }
  });

  describe.each(COLLECTIONS)("%s from org B", (name) => {
    it("get(A id) throws NotFound", async (ctx) => {
      if (!inst) return ctx.skip();
      const { a } = seedRecordFor(name);
      await expect(tenantRepo(name).get(seed.ctxB, a)).rejects.toThrow(
        NotFound,
      );
    });

    it("get(absent id) throws the same NotFound", async (ctx) => {
      if (!inst) return ctx.skip();
      await expect(
        tenantRepo(name).get(seed.ctxB, "zzzzzzzzzzzzzzz"),
      ).rejects.toThrow(NotFound);
    });

    it("list returns only B's rows", async (ctx) => {
      if (!inst) return ctx.skip();
      const { a, b } = seedRecordFor(name);
      const res = await tenantRepo(name).list(seed.ctxB, { perPage: 500 });
      const ids = res.items.map((r) => r.id);
      expect(ids).not.toContain(a);
      expect(ids).toContain(b);
      for (const r of res.items) expect(r.organization).toBe(seed.B.org);
    });

    const spec = (allTenantCollections() as Record<string, { writes: string }>)[
      name
    ];
    if (spec && spec.writes === "custom") {
      it("exposes no write methods", (ctx) => {
        if (!inst) return ctx.skip();
        const repo = tenantRepo(name);
        expect("create" in repo).toBe(false);
        expect("update" in repo).toBe(false);
        expect("delete" in repo).toBe(false);
      });
      return;
    }

    it("update(A id) throws NotFound", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { a } = seedRecordFor(name);
      await expect(repo.update(seed.ctxB, a, {})).rejects.toThrow(NotFound);
    });

    it("delete(A id) throws NotFound", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { a } = seedRecordFor(name);
      await expect(repo.delete(seed.ctxB, a)).rejects.toThrow(NotFound);
    });

    it("create with organization A throws InvalidInput", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { create } = seedRecordFor(name);
      await expect(
        repo.create(seed.ctxB, { ...create, organization: seed.A.org }),
      ).rejects.toThrow(InvalidInput);
    });

    it("moving B's own record to org A throws InvalidInput", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { b } = seedRecordFor(name);
      await expect(
        repo.update(seed.ctxB, b, { organization: seed.A.org }),
      ).rejects.toThrow(InvalidInput);
      const still = await pb.collection(name).getOne(b);
      expect(still.organization).toBe(seed.B.org);
    });

    // CR-01: PB field modifiers (`x+` replaces a single relation) must never reach PB.
    const MODIFIER_KEYS = [
      "organization+",
      "+organization",
      "organization-",
      "organization:each",
    ];

    it("update with an organization modifier key throws InvalidInput", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { b } = seedRecordFor(name);
      for (const key of MODIFIER_KEYS) {
        await expect(
          repo.update(seed.ctxB, b, { [key]: seed.A.org }),
        ).rejects.toThrow(InvalidInput);
      }
      const still = await pb.collection(name).getOne(b);
      expect(still.organization).toBe(seed.B.org);
    });

    it("create with an organization modifier key throws InvalidInput", async (ctx) => {
      if (!inst) return ctx.skip();
      const repo = tenantRepo(name);
      if (!isWrite(repo)) throw new Error("expected write repo");
      const { create } = seedRecordFor(name);
      for (const key of MODIFIER_KEYS) {
        await expect(
          repo.create(seed.ctxB, { ...create, [key]: seed.A.org }),
        ).rejects.toThrow(InvalidInput);
      }
    });
  });

  // writes:"custom" collections have no generic write methods; their dedicated writers are
  // attacked here. A custom-write registry key without an entry fails loudly.
  // P3 content collections (03-06): the pages/sections/pop-ups/banner chokepoint writers,
  // called from org B with org A's ids or organization. The final snapshot test proves
  // org A's rows are unchanged.
  const registry = composeSectionRegistry(CORE_SECTIONS, []);
  const contentDeps = (): ContentDeps => ({
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { async ping() {} },
  });
  const textBlock = {
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Evil", text: "<p>evil</p>" },
  };

  // Getters, never values: seed and pb exist only after beforeAll.
  const env: AttackEnv = {
    seed: () => seed,
    pb: () => pb,
    seedRecordFor,
  };
  const P7_MODULES: [string, (e: AttackEnv) => AttackMap][] = [
    ["p7-media-library", p7MediaLibrary],
    ["p7-media-video", p7MediaVideo],
    ["p7-forms", p7Forms],
    ["p7-contacts", p7Contacts],
    ["p7-site-chrome", p7SiteChrome],
    ["p7-site-settings", p7SiteSettings],
    ["p7-soft-delete", p7SoftDelete],
    ["p7-history", p7History],
    ["p7-seo", p7Seo],
    ["p7-pages", p7Pages],
  ];
  // P9 attack modules: 09-10 replaced the signatures body in p9-legal.ts; 09-16 replaces
  // the acknowledgements one.
  const P9_MODULES: [string, (e: AttackEnv) => AttackMap][] = [
    ["p9-legal", p9Legal],
    // P10 (10-04): read-only attacks for the five billing collections.
    ["p10-billing", p10Billing],
    // P11 (11-09): cross-org read-only attacks for the seven P11 collections, plus
    // same-org other-user attacks for member_prefs, alerts and push_subscriptions.
    ["p11-people", (e) => p11People(e, () => p11)],
    ["p11-site", p11Site],
    // P12 (12-04): cross-org read-only attacks for the seven support collections, plus
    // org A's own internal note hidden by the support_messages rowFilter. 12-32 adds the
    // function-level attacks (ticket by number, reply, post, file and document links, votes,
    // another person's held draft, impersonated writes, incident view).
    ["p12-support", (e) => p12Support(e, () => p12)],
    // P13 (13-06): cross-org read-only attack for failsafe_requests; 13-18 added the
    // function-level attacks (list, convert, dismiss scoped to org B; tenant pending read).
    ["p13-staff", p13Staff],
    // P14 (14-09): cross-org read-only and list attacks for launch_review_marks; 14-33 and
    // 14-50 add the function-level attacks (P14-P34).
    // 14-50: the function-level attacks for the rest of the P14 owner surface read the
    // seeded domain world (org A's move, zone, record, offboarding).
    ["p14-domains", (e) => p14Domains(e, () => p14)],
    // Studio Booking: cross-org attacks on seats, menus and photos.
    ["p15-studio", p15Studio],
  ];

  const baseWriters: AttackMap = {
    pages: async () => {
      await expect(
        createPage(seed.ctxB, {
          title: "Evil",
          slug: "evil",
          organization: seed.A.org,
        } as unknown as { title: string; slug: string }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        updatePage(seed.ctxB, seed.A.page, { title: "Owned" }),
      ).rejects.toThrow(NotFound);
      await expect(
        updatePage(seed.ctxB, seed.B.page, {
          title: "Moved",
          organization: seed.A.org,
        } as unknown as { title: string }),
      ).rejects.toThrow(InvalidInput);
      await expect(getPage(seed.ctxB, seed.A.page)).rejects.toThrow(NotFound);
    },
    page_sections: async () => {
      await expect(
        saveSection(seed.ctxB, registry, { pageId: seed.A.page, ...textBlock }),
      ).rejects.toThrow(NotFound);
      await expect(
        saveSection(seed.ctxB, registry, {
          id: seed.A.section,
          pageId: seed.B.page,
          ...textBlock,
        }),
      ).rejects.toThrow(NotFound);
      await expect(
        setSectionHidden(seed.ctxB, seed.A.section, true),
      ).rejects.toThrow(NotFound);
      await expect(deleteSection(seed.ctxB, seed.A.section)).rejects.toThrow(
        NotFound,
      );
      await expect(
        reorderSections(seed.ctxB, seed.A.page, [seed.A.section]),
      ).rejects.toThrow(NotFound);
      await expect(listSections(seed.ctxB, seed.A.page)).rejects.toThrow(
        NotFound,
      );
      await expect(
        undoDeleteSection(seed.ctxB, registry, {
          id: "zzzzzzzzzzzzzz1",
          page: seed.A.page,
          section_type: "text-only",
          row_layout: "full",
          content: {},
          settings: { background_variant: "main" },
          sort_order: 1,
          is_published: true,
        }),
      ).rejects.toThrow(NotFound);
    },
    popups: async () => {
      const deps = contentDeps();
      const input = {
        name: "Evil",
        trigger: "click",
        enabled: true,
        content: { items: [] },
      };
      await expect(
        savePopup(seed.ctxB, deps, { ...input, id: seed.A.popup }),
      ).rejects.toThrow(NotFound);
      await expect(
        savePopup(seed.ctxB, deps, { ...input, organization: seed.A.org }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        setPopupEnabled(seed.ctxB, deps, seed.A.popup, false),
      ).rejects.toThrow(NotFound);
      await expect(deletePopup(seed.ctxB, deps, seed.A.popup)).rejects.toThrow(
        NotFound,
      );
    },
    site_settings: async () => {
      const deps = contentDeps();
      await expect(
        saveBanner(seed.ctxB, deps, {
          enabled: true,
          message: "Evil",
          organization: seed.A.org,
        }),
      ).rejects.toThrow(InvalidInput);
      // A plain save from B touches B's row only (the snapshot test checks A's).
      await saveBanner(seed.ctxB, deps, { enabled: true, message: "B only" });
      const b = await pb
        .collection("site_settings")
        .getOne(seed.B.siteSettings);
      expect((b.banner as { message: string }).message).toBe("B only");
    },
    content_flags: async () => {
      // No caller can write a flag: the writer is internal to @cds/db.
      expect(publicApi).not.toHaveProperty("recordContentFlag");
      expect(publicApi).not.toHaveProperty("withOrgLock");
      const repo = tenantRepo("content_flags");
      expect("create" in repo).toBe(false);
    },
    org_addons: async () => {
      // Entitlement writes live only in the installer chokepoint; the generic repo stays
      // read-only.
      const repo = tenantRepo("org_addons");
      expect("create" in repo).toBe(false);
      expect("update" in repo).toBe(false);
      expect("delete" in repo).toBe(false);
      // Read: B's entitlement list never holds A's row.
      const aBefore = await pb.collection("org_addons").getOne(seed.A.addon);
      expect((await listOrgAddons(seed.ctxB)).map((r) => r.id)).not.toContain(
        seed.A.addon,
      );
      await expect(
        tenantRepo("org_addons").get(seed.ctxB, seed.A.addon),
      ).rejects.toThrow(NotFound);
      // Write: the installer takes the org from B's context only; an organization in the
      // options is ignored, and A's row is untouched (05-05).
      const deps: AddonDeps = {
        ...contentDeps(),
        addons: composeAddonRegistry(
          [fixtureManifest({ slug: "fixture-iso" })],
          {
            fileExists: () => true,
          },
        ),
      };
      const res = await installAddon(seed.ctxB, deps, "fixture-iso", {
        organization: seed.A.org,
      } as unknown as InstallOptions);
      expect(res.outcome).toBe("installed");
      const created = await pb
        .collection("org_addons")
        .getFirstListItem(pb.filter("addon = 'fixture-iso'", {}));
      expect(created.organization).toBe(seed.B.org);
      expect(
        (await uninstallAddon(seed.ctxB, deps, "fixture-iso")).outcome,
      ).toBe("removed");
      expect(await pb.collection("org_addons").getOne(seed.A.addon)).toEqual(
        aBefore,
      );
    },
    testimonials: async () => {
      // Add-on records are written only through addonRepo (05-05). Activate Testimonials
      // for B directly, so the refusals below are the org scope, not AddonNotActive.
      await pb.collection("org_addons").create({
        organization: seed.B.org,
        addon: "testimonials",
        status: "active",
        source: "staff",
        seeded: {},
      });
      const deps: AddonDeps = {
        ...contentDeps(),
        sections: composeSectionRegistry(
          CORE_SECTIONS,
          ADDON_REGISTRY.sections(),
        ),
        addons: ADDON_REGISTRY,
      };
      const repo = addonRepo(seed.ctxB, deps, "testimonials").collection(
        "testimonials",
      );
      const input = { quote: "Evil", author_name: "Evil" };
      await expect(repo.get(seed.A.testimonial)).rejects.toThrow(NotFound);
      expect((await repo.list()).map((r) => r.id)).not.toContain(
        seed.A.testimonial,
      );
      await expect(
        repo.save({ ...input, id: seed.A.testimonial }),
      ).rejects.toThrow(NotFound);
      await expect(
        repo.save({ ...input, organization: seed.A.org }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        repo.setPublished(seed.A.testimonial, false),
      ).rejects.toThrow(NotFound);
      await expect(repo.remove(seed.A.testimonial)).rejects.toThrow(NotFound);
      await expect(
        repo.reorder([seed.B.testimonial, seed.A.testimonial]),
      ).rejects.toThrow(InvalidInput);
      // A plain save from B lands in B only.
      const { id } = await repo.save(input);
      expect(
        (await pb.collection("testimonials").getOne(id)).organization,
      ).toBe(seed.B.org);
    },
    credentials: async () => {
      // Same shape as testimonials: Credentials on for B, then every write and read aimed
      // at A's credential is refused by the org scope (T-05-46).
      await pb.collection("org_addons").create({
        organization: seed.B.org,
        addon: "credentials",
        status: "active",
        source: "staff",
        seeded: {},
      });
      const deps: AddonDeps = {
        ...contentDeps(),
        sections: composeSectionRegistry(
          CORE_SECTIONS,
          ADDON_REGISTRY.sections(),
        ),
        addons: ADDON_REGISTRY,
      };
      const repo = addonRepo(seed.ctxB, deps, "credentials").collection(
        "credentials",
      );
      const input = { title: "Evil", issuer: "Evil" };
      await expect(repo.get(seed.A.credential)).rejects.toThrow(NotFound);
      expect((await repo.list()).map((r) => r.id)).not.toContain(
        seed.A.credential,
      );
      await expect(
        repo.save({ ...input, id: seed.A.credential }),
      ).rejects.toThrow(NotFound);
      await expect(
        repo.save({ ...input, organization: seed.A.org }),
      ).rejects.toThrow(InvalidInput);
      await expect(repo.setPublished(seed.A.credential, false)).rejects.toThrow(
        NotFound,
      );
      await expect(repo.remove(seed.A.credential)).rejects.toThrow(NotFound);
      await expect(
        repo.reorder([seed.B.credential, seed.A.credential]),
      ).rejects.toThrow(InvalidInput);
      const { id } = await repo.save(input);
      expect((await pb.collection("credentials").getOne(id)).organization).toBe(
        seed.B.org,
      );
    },
    memberships: async () => {
      const a = seed.A.membership;
      await expect(changeRole(seed.ctxB, a, "viewer")).rejects.toThrow(
        NotFound,
      );
      await expect(setAddonGrants(seed.ctxB, a, ["events"])).rejects.toThrow(
        NotFound,
      );
      await expect(removeMember(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(transferOwnership(seed.ctxB, a)).rejects.toThrow(NotFound);
      const password = "pw-isolation-member-1234";
      const u = (
        await pb.collection("users").create({
          email: "iso-member@cds.test",
          password,
          passwordConfirm: password,
        })
      ).id;
      await expect(
        addMember(seed.ctxB, {
          userId: u,
          role: "viewer",
          organization: seed.A.org,
        } as unknown as Parameters<typeof addMember>[1]),
      ).rejects.toThrow(InvalidInput);
      const id = await addMember(seed.ctxB, { userId: u, role: "viewer" });
      expect((await pb.collection("memberships").getOne(id)).organization).toBe(
        seed.B.org,
      );
    },
    // P6 intake collections (06-05): no writer exists yet, so the only write path is the
    // generic repo, which must stay read-only; B's read of A's row is refused.
    ...Object.fromEntries(
      (
        [
          "business_profile",
          "media_assets",
          "team_members",
          "services",
          "org_intake",
          "org_email_routes",
          "email_suppressions",
        ] as const
      ).map((name) => [
        name,
        async () => {
          const repo = tenantRepo(name);
          expect("create" in repo).toBe(false);
          expect("update" in repo).toBe(false);
          expect("delete" in repo).toBe(false);
          await expect(
            repo.get(seed.ctxB, seedRecordFor(name).a),
          ).rejects.toThrow(NotFound);
        },
      ]),
    ),
    // 06-11: the intake writers exist now. The generic repo stays read-only (above) and
    // every writer from org B is refused on A's rows or writes only B's (T-06-53, T-06-54).
    business_profile: async () => {
      expect("update" in tenantRepo("business_profile")).toBe(false);
      await expect(
        saveBusinessProfile(seed.ctxB, {
          organization: seed.A.org,
          tagline: "Evil",
        }),
      ).rejects.toThrow(InvalidInput);
      await saveBusinessProfile(seed.ctxB, { tagline: "B's own" });
    },
    org_intake: async () => {
      expect("update" in tenantRepo("org_intake")).toBe(false);
      await expect(
        saveIntakeAnswers(seed.ctxB, { organization: seed.A.org, gbp: "no" }),
      ).rejects.toThrow(InvalidInput);
      await markStageSaved(seed.ctxB, "business");
    },
    team_members: async () => {
      expect("update" in tenantRepo("team_members")).toBe(false);
      const a = seedRecordFor("team_members").a;
      await expect(
        saveTeamMember(seed.ctxB, { name: "Evil" }, a),
      ).rejects.toThrow(NotFound);
      await expect(removeTeamMember(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(
        reorderTeam(seed.ctxB, [a, seedRecordFor("team_members").b]),
      ).rejects.toThrow(InvalidInput);
      await expect(
        saveTeamMember(seed.ctxB, {
          name: "Evil",
          organization: seed.A.org,
        }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        saveTeamMember(seed.ctxB, { name: "X", photoId: seed.A.media }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        commitCoreImport(
          seed.ctxB,
          "team_members",
          `id,Name
${a},Evil`,
          "add",
        ),
      ).rejects.toThrow();
    },
    services: async () => {
      expect("update" in tenantRepo("services")).toBe(false);
      const a = seedRecordFor("services").a;
      await expect(
        saveService(seed.ctxB, { price_cents: 1 }, a),
      ).rejects.toThrow(NotFound);
      await expect(deleteService(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(
        reorderServices(seed.ctxB, [a, seedRecordFor("services").b]),
      ).rejects.toThrow(InvalidInput);
    },
    // 06-12: email routes. A's route id is NotFound from B; B's add writes only B's rows.
    org_email_routes: async () => {
      expect("update" in tenantRepo("org_email_routes")).toBe(false);
      const a = seedRecordFor("org_email_routes").a;
      await expect(removeEmailRoute(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(
        resendRouteConfirmation(seed.ctxB, a, {
          transport: captureTransport(),
        }),
      ).rejects.toThrow(NotFound);
      await expect(
        addEmailRoute(
          seed.ctxB,
          {
            purpose: "inquiries",
            address: "x@cds.test",
            organization: seed.A.org,
          } as never,
          { transport: captureTransport() },
        ),
      ).rejects.toThrow(InvalidInput);
      await addEmailRoute(
        seed.ctxB,
        { purpose: "inquiries", address: "b-own@cds.test" },
        { transport: captureTransport() },
      );
      await expect(setNewsletterSender(seed.ctxB, "Evil")).rejects.toThrow(
        InvalidInput,
      );
    },
    // 06-13: the media writers. A's asset id is NotFound from B for every read and write.
    media_assets: async () => {
      expect("update" in tenantRepo("media_assets")).toBe(false);
      const a = seedRecordFor("media_assets").a;
      await expect(readMediaVariant(seed.ctxB, a, "thumb")).rejects.toThrow(
        NotFound,
      );
      await expect(setMediaAlt(seed.ctxB, a, "Evil")).rejects.toThrow(NotFound);
      await expect(removeMedia(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(restoreMedia(seed.ctxB, a)).rejects.toThrow(NotFound);
      await expect(reorderMedia(seed.ctxB, "gallery", [a])).rejects.toThrow(
        InvalidInput,
      );
    },
    audit_log: async () => {
      await expect(
        appendAudit(seed.ctxB, {
          action: "evil.write",
          organization: seed.A.org,
        }),
      ).rejects.toThrow(InvalidInput);
    },
  };

  const customWriters: AttackMap = mergeAttacks(
    baseWriters,
    ...P7_MODULES.map(([, attacks]) => attacks(env)),
    ...P9_MODULES.map(([, attacks]) => attacks(env)),
  );

  it("every P7 attack module contributes at least one key", () => {
    expect(P7_MODULES).toHaveLength(10);
    for (const [name, attacks] of [...P7_MODULES, ...P9_MODULES]) {
      expect(Object.keys(attacks(env)).length, name).toBeGreaterThan(0);
    }
    expect(() =>
      mergeAttacks({ x: async () => {} }, { x: async () => {} }),
    ).toThrow("duplicate attack key x");
  });

  it("has a customWriters attack for every writes:custom collection", (ctx) => {
    if (!inst) return ctx.skip();
    const custom = Object.entries(
      allTenantCollections() as Record<string, { writes: string }>,
    )
      .filter(([, spec]) => spec.writes === "custom")
      .map(([name]) => name);
    expect(custom.length).toBeGreaterThan(0);
    const covered = new Set(Object.keys(customWriters).map(attackCollection));
    for (const name of custom) expect(covered.has(name), name).toBe(true);
  });

  it.for(Object.keys(customWriters))(
    "custom writer for %s from org B cannot touch org A",
    async (name, ctx) => {
      if (!inst) return ctx.skip();
      await customWriters[name]!();
    },
  );

  it("left every org A row unchanged", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await snapshotOrgA()).toEqual(before);
  });

  it("a filter-injection payload returns no org A rows", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo(TEST_WIDGETS);
    const res = await repo.list(seed.ctxB, {
      filter: "title = {:t}",
      params: { t: `x" || organization != "` },
    });
    expect(res.items).toEqual([]);
    const loose = await repo.list(seed.ctxB, {
      filter: "title != {:t}",
      params: { t: `x' || organization != '` },
    });
    expect(loose.items.map((r) => r.organization)).toEqual([seed.B.org]);
  });

  it("an unbalanced caller filter is rejected", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo(TEST_WIDGETS);
    for (const filter of [
      "title != '') || (title != ''",
      "title != '' // comment",
    ]) {
      await expect(repo.list(seed.ctxB, { filter })).rejects.toThrow(
        InvalidInput,
      );
    }
  });

  it("caller filters cannot reach other collections or hidden fields (CR-02)", async (ctx) => {
    if (!inst) return ctx.skip();
    const widgetsRepo = tenantRepo(TEST_WIDGETS);
    for (const filter of [
      `@collection._superusers.password ~ "$2a%"`,
      `title != '' && (@collection._superusers.password ~ "$2a%")`,
      "@collection.users.tokenKey != ''",
      "@request.auth.id = ''",
      "owner.password ~ '$2a%'",
      "owner.tokenKey != ''",
      "organization.status = 'active'",
      "title:lower = 'x'",
    ]) {
      await expect(widgetsRepo.list(seed.ctxB, { filter })).rejects.toThrow(
        InvalidInput,
      );
    }
    const endUsers = tenantRepo("end_users");
    for (const filter of [
      "password ~ '$2a%'",
      "tokenKey != ''",
      "email != '' && tokenKey ~ 'a%'",
    ]) {
      await expect(endUsers.list(seed.ctxB, { filter })).rejects.toThrow(
        InvalidInput,
      );
    }
    for (const sort of ["owner.password", "tokenKey", "-organization.name"]) {
      await expect(widgetsRepo.list(seed.ctxB, { sort })).rejects.toThrow(
        InvalidInput,
      );
    }
    // Allowlisted plain fields still work.
    const ok = await endUsers.list(seed.ctxB, {
      filter: "email != {:e}",
      params: { e: "" },
      sort: "-email",
    });
    for (const r of ok.items) expect(r.organization).toBe(seed.B.org);
  });

  it("a cast context throws InvalidContext on every method", async (ctx) => {
    if (!inst) return ctx.skip();
    const forged = {
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    } as unknown as OrgContext;
    const copied = { ...seed.ctxA } as OrgContext;
    for (const bad of [forged, copied]) {
      for (const name of COLLECTIONS) {
        const repo = tenantRepo(name);
        const { a, create } = seedRecordFor(name);
        await expect(repo.get(bad, a)).rejects.toThrow(InvalidContext);
        await expect(repo.list(bad)).rejects.toThrow(InvalidContext);
        if (isWrite(repo)) {
          await expect(repo.create(bad, create)).rejects.toThrow(
            InvalidContext,
          );
          await expect(repo.update(bad, a, {})).rejects.toThrow(InvalidContext);
          await expect(repo.delete(bad, a)).rejects.toThrow(InvalidContext);
        }
      }
      await expect(listAuditLog(bad)).rejects.toThrow(InvalidContext);
    }
  });

  it("listAuditLog shows only the caller's org", async (ctx) => {
    if (!inst) return ctx.skip();
    // 14-50: org B's own P14 attack calls add audit rows; read past the first page of 50.
    const res = await listAuditLog(seed.ctxB, { perPage: 500 });
    expect(res.items.map((r) => r.id)).toContain(seed.B.audit);
    expect(res.items.map((r) => r.id)).not.toContain(seed.A.audit);
  });

  it("CDS-sender suppressions (empty organization) are unreachable from an OrgContext", async (ctx) => {
    if (!inst) return ctx.skip();
    // EMAIL-01 / D138: an empty organization means CDS itself is the sender.
    const cds = await pb.collection("email_suppressions").create({
      organization: "",
      email: "cds-only@cds.test",
      reason: "unsubscribe",
      scope: "marketing",
    });
    try {
      for (const c of [seed.ctxA, seed.ctxB]) {
        const res = await tenantRepo("email_suppressions").list(c, {
          perPage: 500,
        });
        expect(res.items.map((r) => r.id)).not.toContain(cds.id);
        await expect(
          tenantRepo("email_suppressions").get(c, cds.id),
        ).rejects.toThrow(NotFound);
      }
      const b = await tenantRepo("email_suppressions").list(seed.ctxB);
      expect(b.items.map((r) => r.id)).toEqual([seed.B.suppression]);
    } finally {
      await pb.collection("email_suppressions").delete(cds.id);
    }
  });
});

describe("TEN-14 renter scope", () => {
  it("lists only the renter's own widget", async (ctx) => {
    if (!inst) return ctx.skip();
    const res = await tenantRepo(TEST_WIDGETS).list(seed.ctxRenterA);
    expect(res.items.map((r) => r.id)).toEqual([widgets.renterA]);
  });

  it("cannot get, update or delete another renter's widget", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo(TEST_WIDGETS);
    if (!isWrite(repo)) throw new Error("expected write repo");
    await expect(repo.get(seed.ctxRenterA, widgets.renterA2)).rejects.toThrow(
      NotFound,
    );
    await expect(
      repo.update(seed.ctxRenterA, widgets.renterA2, { title: "mine" }),
    ).rejects.toThrow(NotFound);
    await expect(
      repo.delete(seed.ctxRenterA, widgets.renterA2),
    ).rejects.toThrow(NotFound);
    const still = await pb.collection(TEST_WIDGETS).getOne(widgets.renterA2);
    expect(still.title).toBe("renter a2 widget");
  });

  it("create forces owner to the renter", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo(TEST_WIDGETS);
    if (!isWrite(repo)) throw new Error("expected write repo");
    const rec = await repo.create(seed.ctxRenterA, { title: "new" });
    expect(rec.owner).toBe(seed.renterA);
    expect(rec.organization).toBe(seed.A.org);
    await expect(
      repo.create(seed.ctxRenterA, { title: "gift", owner: seed.renterA2 }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      repo.update(seed.ctxRenterA, widgets.renterA, { owner: seed.renterA2 }),
    ).rejects.toThrow(InvalidInput);
  });

  it("cannot reassign rows with owner modifier keys (CR-01)", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo(TEST_WIDGETS);
    if (!isWrite(repo)) throw new Error("expected write repo");
    for (const data of [
      { "owner+": seed.renterA2 },
      { "+owner": seed.renterA2 },
      { "owner-": seed.renterA },
    ]) {
      await expect(
        repo.update(seed.ctxRenterA, widgets.renterA, data),
      ).rejects.toThrow(InvalidInput);
      await expect(
        repo.create(seed.ctxRenterA, { title: "gift", ...data }),
      ).rejects.toThrow(InvalidInput);
    }
    const still = await pb.collection(TEST_WIDGETS).getOne(widgets.renterA);
    expect(still.owner).toBe(seed.renterA);
  });

  it("is refused on a collection without an owner field (fail closed)", async (ctx) => {
    if (!inst) return ctx.skip();
    await expect(tenantRepo("end_users").list(seed.ctxRenterA)).rejects.toThrow(
      Forbidden,
    );
  });
});

describe("TEN-08 impersonated writes are audited atomically", () => {
  function impersonated(): OrgContext {
    return mintOrgContext({
      orgId: seed.A.org,
      actor: seed.B.owner,
      role: "owner",
      grants: [],
      impersonator: seed.B.owner,
      ip: "10.0.0.9",
    });
  }

  async function auditRows(): Promise<{ id: string; target_id: string }[]> {
    return pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:org} && action = {:a}", {
        org: seed.A.org,
        a: "org_hosts.create",
      }),
    });
  }

  it("writes the record and exactly one audit row", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo("org_hosts");
    const beforeRows = await auditRows();
    const rec = await repo.create(impersonated(), {
      hostname: "Imp.Example.com",
      kind: "custom",
    });
    expect(rec.id).toMatch(/^[a-z0-9]{15}$/);
    expect(rec.hostname).toBe("imp.example.com");
    const after = await auditRows();
    expect(after.length).toBe(beforeRows.length + 1);
    const row = await pb
      .collection("audit_log")
      .getFirstListItem(pb.filter("target_id = {:id}", { id: rec.id }));
    expect(row.impersonator).toBe(seed.B.owner);
    expect(row.organization).toBe(seed.A.org);
    expect(row.action).toBe("org_hosts.create");
    expect(row.target_collection).toBe("org_hosts");
    expect(row.ip).toBe("10.0.0.9");
  });

  it("a failing batch leaves neither the record nor the audit row", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo("org_hosts");
    const beforeRows = await auditRows();
    const beforeHosts = await pb.collection("org_hosts").getFullList();
    await expect(
      repo.create(impersonated(), {
        hostname: "a.example.com",
        kind: "custom",
      }),
    ).rejects.toThrow(InvalidInput);
    expect((await auditRows()).length).toBe(beforeRows.length);
    expect((await pb.collection("org_hosts").getFullList()).length).toBe(
      beforeHosts.length,
    );
  });

  it("a non-impersonated write adds no audit row", async (ctx) => {
    if (!inst) return ctx.skip();
    const beforeRows = await auditRows();
    await tenantRepo("org_hosts").create(seed.ctxA, {
      hostname: "plain.example.com",
      kind: "custom",
    });
    expect((await auditRows()).length).toBe(beforeRows.length);
  });

  it("rejects invalid, IP and platform hostnames", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const hostname of ["not a host", "127.0.0.1", "localhost", 42]) {
      await expect(
        tenantRepo("org_hosts").create(seed.ctxA, { hostname, kind: "custom" }),
      ).rejects.toThrow(InvalidInput);
    }
  });

  it("tenants cannot claim reserved or preview hosts (WR-04)", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo("org_hosts");
    for (const hostname of [
      "x.localhost",
      "evil.cds.needtobeedgy.com",
      "connectionsdesignstudios.com",
      "org-b.sites.connectionsdesignstudios.com",
    ]) {
      await expect(
        repo.create(seed.ctxA, { hostname, kind: "custom" }),
      ).rejects.toThrow(InvalidInput);
    }
    await expect(
      repo.create(seed.ctxA, { hostname: "pv.example.com", kind: "preview" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      repo.update(seed.ctxA, seed.A.host, { kind: "preview" }),
    ).rejects.toThrow(InvalidInput);
    // A platform-assigned preview row cannot be renamed or deleted by the tenant.
    const preview = await pb.collection("org_hosts").create({
      hostname: "org-a.sites.connectionsdesignstudios.com",
      organization: seed.A.org,
      kind: "preview",
      primary: false,
    });
    await expect(
      repo.update(seed.ctxA, preview.id, { hostname: "mine.example.com" }),
    ).rejects.toThrow(InvalidInput);
    await expect(repo.delete(seed.ctxA, preview.id)).rejects.toThrow(
      InvalidInput,
    );
    // kind defaults to custom.
    const rec = await repo.create(seed.ctxA, { hostname: "shop.example.org" });
    expect(rec.kind).toBe("custom");
  });
});
