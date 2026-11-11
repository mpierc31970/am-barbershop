// The permanent demo tenant (13-31; STAFF-18, D209, D293). Production-safe, unlike the dev
// seeds: no CDS_ENV guard, but it only ever creates or touches the one org whose slug is
// `demo` AND whose `demo` flag is true. An org with that slug that is not the demo is refused
// before anything is written (T-13-31-01).
//
//   ensureDemoOrg(sys, { now })   idempotent by slug: "Bella's Salon", Studio path, demo true,
//                                  status active, stage live (so the preview host renders),
//                                  preview host only (ensurePreviewHost: noindex + strip, D170),
//                                  owner owner@demo.example.com with a random 64-hex password
//                                  that is never returned, printed or stored anywhere else
//                                  (T-13-31-03).
//   seedDemoContent(ctx, deps)     the demo content through the normal chokepoint writers with
//                                  the demo org's owner context: theme, Home / About / Services
//                                  / Contact pages (published), Testimonials (3) and
//                                  Credentials (2) through installAddon records, Builder Pro +
//                                  a "Book a consultation" form on Contact, 6 contacts at
//                                  example.com, and one support conversation (the owner's
//                                  question plus a CDS reply). Fixed fake copy only, example.com
//                                  addresses only (T-13-31-02). Booking / services data arrive
//                                  with the v1.1 add-ons' seed hooks, not here.
//
// The demo installs approve through a free gate (the demo is never billed, D293). Mail for the
// demo org is dropped at sendEmail (13-24), payments are fake, screen() answers clean and the
// pinger skips, so seeding talks to no provider.
import { InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import type { SectionRegistry } from "@cds/core/content";
import {
  evaluatePairs,
  NEUTRAL_DESIGN,
  type OrganizationDesign,
  type RoleMap,
} from "@cds/core/theme";
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type { BillingGate } from "../addons/billing";
import { installAddon } from "../addons/installer";
import { ensurePreviewHost } from "../assembly/preview-host";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { saveContact } from "../contacts/contacts";
import { createPage, listPages } from "../content/pages";
import type { Invalidator, SearchPinger } from "../content/ports";
import { publishPage, type PublishDeps } from "../content/publish";
import { listSections, saveSection } from "../content/sections";
import {
  assertSystemContext,
  mintSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { createForm } from "../forms/forms";
import { setOrgStage } from "../org-stage";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";
import { newRecordId } from "../repository";
import type { ObjectStore } from "../storage";
import { appendMessage } from "../support/shared";
import { fileTicket } from "../support/threads";
import { queueDesignWrite } from "../theme";
import { __clearDemoCacheForTests } from "./flag";

export const DEMO_SLUG = "demo";
export const DEMO_NAME = "Bella's Salon";
export const DEMO_OWNER_EMAIL = "owner@demo.example.com";
export const DEMO_OWNER_NAME = "Bella Moreno";
/** The CDS first name on the seeded support reply. */
export const DEMO_STAFF_NAME = "Mara";
const DEMO_RECORDS_KEY = "demo";

export type DemoOrg = { orgId: string; ownerId: string; created: boolean };

/** What the seed needs from the caller: @cds/db never imports the add-on registry (P13-P7). */
export type DemoSeedDeps = {
  addons: AddonRegistry;
  sections: SectionRegistry;
  invalidator?: Invalidator;
  store?: ObjectStore;
  publicStore?: ObjectStore;
  pinger?: SearchPinger;
  now?: Date;
};

export type DemoSeedResult = {
  pages: number;
  testimonials: number;
  credentials: number;
  contacts: number;
  tickets: number;
};

// ------------------------------------------------------------------ fixed fake content
const SALON_ROLES: RoleMap = {
  surface: "#fbf7f5",
  "surface-raised": "#f3ebe7",
  text: "#2a1f24",
  "text-muted": "#5f4b55",
  primary: "#6d2e46",
  "primary-contrast": "#ffffff",
  accent: "#8c3f5c",
  border: "#e2d4d9",
};

/** The demo theme: the neutral preset's sizes with a warm salon palette. */
export function demoDesign(): OrganizationDesign {
  return {
    ...NEUTRAL_DESIGN,
    name: DEMO_NAME,
    source: {
      designMd: { frontMatter: { name: DEMO_NAME }, body: "" },
      sidecar: null,
    },
    roles: { ...SALON_ROLES },
    contrast: { pairs: evaluatePairs(SALON_ROLES), adjustments: [] },
    importedAt: "2026-10-01T00:00:00.000Z",
    sourceHash: "be11a5" + "0".repeat(58),
  };
}

type PageSpec = {
  slug: string;
  title: string;
  sections: { section_type: string; row_layout: string; content: unknown }[];
};

const text = (id: string, html: string) => ({ id, kind: "text", html });
const heading = (id: string, t: string) => ({
  id,
  kind: "heading",
  text: t,
  level: 2,
});

function demoPages(formId: string): PageSpec[] {
  return [
    {
      slug: "home",
      title: "Home",
      sections: [
        {
          section_type: "hero",
          row_layout: "full",
          content: {
            tagline: "Hair, colour and calm in the heart of Riverside",
            heading: "Bella's Salon",
            subtitle:
              "Cuts, colour and treatments by a small team who take the time to listen.",
            cta_primary_text: "Book a consultation",
            cta_primary_link: "/contact",
            cta_secondary_text: "See our services",
            cta_secondary_link: "/services",
          },
        },
        {
          section_type: "text-only",
          row_layout: "full",
          content: {
            heading: "Welcome in",
            text: "<p>We opened Bella's in 2014 with one chair and a simple idea: nobody should leave a salon feeling rushed. Today four stylists share that idea, and most of our guests have been coming back for years.</p>",
          },
        },
        {
          section_type: "cta-banner",
          row_layout: "full",
          content: {
            heading: "New to Bella's?",
            description:
              "Your first visit starts with a free 15-minute consultation.",
            button_text: "Get in touch",
            button_link: "/contact",
          },
        },
      ],
    },
    {
      slug: "about",
      title: "About us",
      sections: [
        {
          section_type: "text-only",
          row_layout: "full",
          content: {
            heading: "Our story",
            text: "<p>Bella Moreno trained in Chicago and worked in busy downtown salons for ten years before opening a quieter place of her own. The salon is still small on purpose: four chairs, one wash station with a view of the garden, and a team that knows your name.</p><p>We use low-ammonia colour and refillable product bottles, and we are happy to talk you through anything before we start.</p>",
          },
        },
      ],
    },
    {
      slug: "services",
      title: "Services",
      sections: [
        {
          section_type: "columns",
          row_layout: "50-50",
          content: {
            columns: [
              {
                id: "svc-col-a",
                items: [
                  heading("svc-h-cut", "Cuts and styling"),
                  text(
                    "svc-t-cut",
                    "<p>Women's cut and finish from $65. Men's cut from $40. Blow-dry and style from $45.</p>",
                  ),
                ],
              },
              {
                id: "svc-col-b",
                items: [
                  heading("svc-h-colour", "Colour and treatments"),
                  text(
                    "svc-t-colour",
                    "<p>Full colour from $95. Balayage from $160. Gloss and deep-conditioning treatment $40.</p>",
                  ),
                ],
              },
            ],
          },
        },
      ],
    },
    {
      slug: "contact",
      title: "Contact",
      sections: [
        {
          section_type: "columns",
          row_layout: "50-50",
          content: {
            columns: [
              {
                id: "contact-col-a",
                items: [
                  heading("contact-h", "Book a consultation"),
                  { id: "contact-form", kind: "form", form_id: formId },
                ],
              },
              {
                id: "contact-col-b",
                items: [
                  heading("contact-h-visit", "Visit us"),
                  text(
                    "contact-t-visit",
                    "<p>Tuesday to Saturday, 9am to 7pm. Closed Sunday and Monday.</p><p>Call (555) 010-4477 or email hello@demo.example.com.</p>",
                  ),
                ],
              },
            ],
          },
        },
      ],
    },
  ];
}

const TESTIMONIALS: readonly Record<string, unknown>[] = [
  {
    quote:
      "Bella listened to exactly what I wanted and talked me out of what I didn't need. Best colour I've had in years.",
    author_name: "Jordan P.",
    author_detail: "Guest since 2019",
    rating: 5,
    featured: true,
  },
  {
    quote:
      "Calm, friendly and never rushed. I book my next appointment before I leave every time.",
    author_name: "Priya S.",
    author_detail: "Monthly regular",
    rating: 5,
  },
  {
    quote:
      "They fixed a box-dye disaster in one visit and gave me honest advice for keeping it healthy.",
    author_name: "Alex R.",
    rating: 4,
  },
];

const CREDENTIALS: readonly Record<string, unknown>[] = [
  {
    title: "Licensed Cosmetologist",
    issuer: "State Board of Cosmetology",
    category: "License",
    issued_on: "2012-06-01",
  },
  {
    title: "Advanced Colour Specialist",
    issuer: "Colour Academy",
    category: "Certification",
    issued_on: "2018-03-15",
  },
];

const CONTACTS: readonly { name: string; email: string; tags: string[] }[] = [
  { name: "Jordan Park", email: "jordan.park@example.com", tags: ["regular"] },
  { name: "Priya Shah", email: "priya.shah@example.com", tags: ["regular"] },
  { name: "Alex Rivera", email: "alex.rivera@example.com", tags: ["colour"] },
  { name: "Sam Lee", email: "sam.lee@example.com", tags: ["new"] },
  { name: "Morgan Diaz", email: "morgan.diaz@example.com", tags: ["colour"] },
  { name: "Casey Kim", email: "casey.kim@example.com", tags: ["new"] },
];

const TICKET = {
  type: "question" as const,
  subject: "Can I add a gift card page?",
  body: "Hi! A few guests have asked about gift cards for the holidays. Could we add a page that explains how to buy one at the front desk?",
};
const TICKET_REPLY =
  "Hi Bella, good idea for the season. You can add a page from Pages, then use the Text block for the details. If you'd like, we can set up a starter page for you this week. Just reply here.";

// ------------------------------------------------------------------ the org
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

/** The demo org's id, or null when it does not exist yet. Never returns a non-demo org. */
export async function findDemoOrgId(): Promise<string | null> {
  return withSuperuser(async (pb) => {
    const row = await firstOrNull(
      pb,
      "organizations",
      pb.filter("slug = {:slug}", { slug: DEMO_SLUG }),
    );
    if (!row) return null;
    if (row.demo !== true) {
      throw new InvalidInput(
        'refusing: an organization with slug "demo" exists and is not the demo tenant',
      );
    }
    return row.id;
  });
}

/** platform_meta: the id of the users row the demo seed created as the demo Owner (WR-A09). */
export const DEMO_OWNER_ID_KEY = "demo:owner_id";

/**
 * Create the demo org (or find it). Idempotent by slug; refuses an existing `demo` slug whose
 * org is not flagged demo, and an owner email that belongs to someone else.
 */
export async function ensureDemoOrg(
  sys: SystemContext,
  opts: { now?: Date } = {},
): Promise<DemoOrg> {
  assertSystemContext(sys);
  void opts;
  const ownerMarker = (await readPlatformMeta(DEMO_OWNER_ID_KEY)) ?? "";
  const org = await withSuperuser(async (pb) => {
    let created = false;
    const existing = await firstOrNull(
      pb,
      "organizations",
      pb.filter("slug = {:slug}", { slug: DEMO_SLUG }),
    );
    if (existing && existing.demo !== true) {
      throw new InvalidInput(
        'refusing: an organization with slug "demo" exists and is not the demo tenant',
      );
    }
    let orgId: string;
    if (existing) {
      orgId = existing.id;
    } else {
      // Created with the flag set in the same batch (src/demo is the only demo writer, 13-24),
      // so a half-made org can never be refused as "not the demo" on the next run.
      orgId = newRecordId();
      const batch = pb.createBatch();
      batch.collection("organizations").create({
        id: orgId,
        name: DEMO_NAME,
        slug: DEMO_SLUG,
        status: "active",
        path: "studio",
        demo: true,
      });
      batch.collection("audit_log").create(
        auditBody(sys, {
          action: "demo.org_created",
          organization: orgId,
          targetCollection: "organizations",
          targetId: orgId,
          meta: { demo: true },
        }),
      );
      await batch.send();
      created = true;
    }

    // The owner: a fresh account with a password nobody knows (never returned or logged).
    const found = await firstOrNull(
      pb,
      "users",
      pb.filter("email = {:e}", { e: DEMO_OWNER_EMAIL }),
    );
    let owner: RecordModel;
    if (found) {
      owner = found;
      // WR-A09: adopt only the account this seed created (its id is kept in platform_meta
      // demo:owner_id). Before the marker existed, the account already owning this demo org
      // is the seed's own; any other account with the demo email is refused.
      if (ownerMarker !== "" && ownerMarker !== owner.id) {
        throw new InvalidInput(
          "the demo owner email belongs to an account the demo seed did not create",
        );
      }
      if (ownerMarker === "") {
        const owns = await pb.collection("memberships").getList(1, 1, {
          filter: pb.filter(
            "user = {:u} && organization = {:o} && role = 'owner'",
            { u: owner.id, o: orgId },
          ),
          fields: "id",
        });
        if (created || owns.totalItems === 0) {
          throw new InvalidInput(
            "the demo owner email belongs to an account the demo seed did not create",
          );
        }
      }
      if (owner.staff_role) {
        throw new InvalidInput(
          "the demo owner email belongs to a staff account",
        );
      }
      const elsewhere = await pb.collection("memberships").getList(1, 1, {
        filter: pb.filter("user = {:u} && organization != {:o}", {
          u: owner.id,
          o: orgId,
        }),
        fields: "id",
      });
      if (elsewhere.totalItems > 0) {
        throw new InvalidInput(
          "the demo owner email belongs to an account outside the demo",
        );
      }
      // A fresh password nobody knows on every run; changing it also ends the account's
      // existing sessions (PocketBase rotates the token key).
      const password = randomBytes(32).toString("hex");
      owner = await pb.collection("users").update(owner.id, {
        password,
        passwordConfirm: password,
        verified: true,
      });
    } else {
      const password = randomBytes(32).toString("hex");
      owner = await pb.collection("users").create({
        email: DEMO_OWNER_EMAIL,
        password,
        passwordConfirm: password,
        name: DEMO_OWNER_NAME,
        verified: true,
      });
    }
    const membership = await firstOrNull(
      pb,
      "memberships",
      pb.filter("user = {:u} && organization = {:o}", {
        u: owner.id,
        o: orgId,
      }),
    );
    if (!membership) {
      await pb
        .collection("memberships")
        .create({ user: owner.id, organization: orgId, role: "owner" });
    } else if (membership.role !== "owner") {
      await pb
        .collection("memberships")
        .update(membership.id, { role: "owner" });
    }
    return { orgId, ownerId: owner.id, created };
  });
  if (ownerMarker !== org.ownerId) {
    await writePlatformMeta(sys, DEMO_OWNER_ID_KEY, org.ownerId);
  }
  __clearDemoCacheForTests();
  await ensurePreviewHost(org.orgId);
  // Live, so the preview host renders the site (preview = noindex + strip, D170).
  await setOrgStage(sys, org.orgId, "live");
  return org;
}

/** The demo is never billed: installs for the demo org approve at no charge. */
function demoBillingGate(orgId: string): BillingGate {
  return {
    approve(input) {
      if (input.orgId !== orgId) {
        return Promise.resolve({
          approved: false,
          reason: "demo installs are for the demo org only",
        });
      }
      return Promise.resolve({ approved: true, chargeCents: 0 });
    },
    release() {
      return Promise.resolve();
    },
  };
}

// ------------------------------------------------------------------ the content
async function seedPage(
  ctx: OrgContext,
  deps: PublishDeps,
  spec: PageSpec,
): Promise<void> {
  const existing = (await listPages(ctx)).find((p) => p.slug === spec.slug);
  const page =
    existing ??
    (await createPage(ctx, { title: spec.title, slug: spec.slug }, deps.store));
  // A new page may come with a starter block: reuse matching types in order.
  const current = await listSections(ctx, page.id);
  const used = new Set<string>();
  for (const s of spec.sections) {
    const reuse = current.find(
      (c) => c.section_type === s.section_type && !used.has(c.id),
    );
    if (reuse) used.add(reuse.id);
    await saveSection(ctx, deps.sections, {
      ...(reuse ? { id: reuse.id } : {}),
      pageId: page.id,
      section_type: s.section_type,
      row_layout: s.row_layout,
      content: s.content,
    });
  }
  const res = await publishPage(ctx, page.id, deps);
  if (res.status !== "published") {
    throw new Error(`demo page ${spec.slug} was held`);
  }
}

/**
 * Seed the demo content into a freshly wiped demo org (resetDemoOrg) or a new one. Every write
 * goes through the normal writer with the demo owner's context.
 */
export async function seedDemoContent(
  ctx: OrgContext,
  deps: DemoSeedDeps,
): Promise<DemoSeedResult> {
  const now = deps.now ?? new Date();
  const sys = mintSystemContext({ job: "demo-seed" });
  const pdeps: PublishDeps = {
    sections: deps.sections,
    invalidator: deps.invalidator ?? { invalidate: () => undefined },
    addons: deps.addons,
    ...(deps.store ? { store: deps.store } : {}),
    ...(deps.publicStore ? { publicStore: deps.publicStore } : {}),
    ...(deps.pinger ? { pinger: deps.pinger } : {}),
  };

  // Theme (organization.design, through the one design writer).
  await withSuperuser(async (pb) => {
    const row = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "id,design,demo" });
    if (row.demo !== true) throw new InvalidInput("not the demo org");
    const batch = pb.createBatch();
    queueDesignWrite(
      batch,
      sys,
      ctx.orgId,
      row.design,
      demoDesign(),
      "demo-seed",
    );
    await batch.send();
  });

  // Add-ons: Testimonials and Credentials with their records, Builder Pro for the form.
  const adeps = {
    ...pdeps,
    addons: deps.addons,
    billing: demoBillingGate(ctx.orgId),
    now: () => now,
  };
  let testimonials = 0;
  let credentials = 0;
  if (deps.addons.get("testimonials")) {
    await installAddon(ctx, adeps, "testimonials", {
      records: TESTIMONIALS,
      recordsKey: DEMO_RECORDS_KEY,
    });
    testimonials = TESTIMONIALS.length;
  }
  if (deps.addons.get("credentials")) {
    await installAddon(ctx, adeps, "credentials", {
      records: CREDENTIALS,
      recordsKey: DEMO_RECORDS_KEY,
    });
    credentials = CREDENTIALS.length;
  }
  if (deps.addons.get("builder-pro")) {
    await installAddon(ctx, adeps, "builder-pro");
  }
  const { form } = await createForm(ctx, pdeps, {
    template: "contact",
    name: "Book a consultation",
  });

  // Pages, published.
  const pages = demoPages(form.id);
  for (const spec of pages) await seedPage(ctx, pdeps, spec);

  // Contacts (example.com only).
  for (const c of CONTACTS) await saveContact(ctx, c);

  // One support conversation: the owner's question, then a CDS reply.
  const ticket = await fileTicket(
    ctx,
    { type: TICKET.type, subject: TICKET.subject, body: TICKET.body },
    { clock: { now: () => now } },
  );
  await withSuperuser(async (pb) => {
    const thread = await pb.collection("support_threads").getOne(ticket.id);
    const at = new Date(now.getTime() + 60_000);
    const batch = pb.createBatch();
    appendMessage(
      pb,
      batch,
      {
        orgId: ctx.orgId,
        thread,
        authorKind: "staff",
        authorStaff: "",
        authorName: DEMO_STAFF_NAME,
        body: TICKET_REPLY,
        visibility: "public",
      },
      at,
    );
    // WR-A08: seeded already closed and marked CDS-opened, so the nightly reseed never lands
    // in staff Tickets "waiting on CDS", the Today counts or the first-reply SLA report.
    batch.collection("support_threads").update(thread.id, {
      first_replied_at: at.toISOString(),
      status: "closed",
      resolved_at: at.toISOString(),
      closed_at: at.toISOString(),
      opened_by_cds: true,
    });
    await batch.send();
  });

  return {
    pages: pages.length,
    testimonials,
    credentials,
    contacts: CONTACTS.length,
    tickets: 1,
  };
}
