// A&M Barber Studio: the one site record (the single-site fork's only org). Modeled on
// packages/db/src/demo/seed.ts (production-safe, idempotent by slug) and dev-seed-intake.ts
// (intake through the real chokepoints, then Send to CDS and assembly).
//
//   npm run am:seed                         seed / re-seed against PB_URL (.env.local)
//   AM_HOST=am-barber.localhost npm run am:seed   another primary host (local dev)
//
// Re-runs never duplicate: the org, owner, services, media, form, Contact page, host and stage
// are all found first. The owner gets a random password nobody knows (never printed); they
// sign in on the hub with an emailed code.
//
// Storage: published pages and media go to the ObjectStore (CDS_STORAGE_DIR /
// CDS_PUBLIC_STORAGE_DIR). Running this from a workstation writes there, so copy those two
// folders into the app's /data volume afterwards (see CLAUDE.md "Seeding").
//
// TODO(owner): real services and prices, hours, team, photos, booking link, Messenger URL.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { importThemeDir } from "@cds/core/theme/import";
import { TEMPLATES } from "@cds/templates";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { installAddon } from "../src/addons/installer";
import { listOrgAddons } from "../src/addons/entitlements";
import { getCopyWriter } from "../src/assembly/copy-writer";
import { runAssemblyForOrg } from "../src/assembly/run";
import { auditBody } from "../src/audit";
import { withSuperuser } from "../src/client";
import { addPageToNav } from "../src/content/chrome/nav";
import { createPage, listPages, updatePage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import {
  deleteSection,
  listSections,
  saveSection,
} from "../src/content/sections";
import { mintOrgContext, mintSystemContext } from "../src/context";
import { createForm, listForms, saveForm } from "../src/forms/forms";
import { saveBusinessProfile } from "../src/intake/business-profile";
import { sendToCds } from "../src/intake/send";
import { listServices, saveService } from "../src/intake/services";
import { listMedia, removeMedia, uploadImage } from "../src/media/assets";
import { setOrgStage } from "../src/org-stage";
import { newRecordId } from "../src/repository";
import { queueDesignWrite } from "../src/theme";

const SLUG = "am-barber";
const NAME = "A&M Barber Studio";
const OWNER_EMAIL = "matthew@metaphysicalevents.com";
const OWNER_NAME = "Matthew";
const HOST = (process.env.AM_HOST || "barber.needtobeedgy.com").toLowerCase();
const PHONE = "(214) 518-6852";
const TEL = "tel:+12145186852";
const ADDRESS = {
  street: "2505 S Carrier Pkwy",
  city: "Grand Prairie",
  state: "TX",
  zip: "75052",
};
const DIRECTIONS =
  "https://www.google.com/maps/dir/?api=1&destination=" +
  encodeURIComponent(
    "A&M Barber Studio, 2505 S Carrier Pkwy, Grand Prairie, TX 75052",
  );
const LOGO = "apps/web/public/am-barber/logo.png";
const LOGO_ALT =
  "A&M Barber Studio logo: a red A and a blue M over Barber Studio, with a straight razor, est. 2020";
const IP = "am-seed";

// TODO(owner): replace with the real menu and prices ("ask" shows "Ask for a price").
const SERVICES = [
  [
    "Haircut",
    "Classic cut, clippers and shears, finished with a hot-towel neck shave.",
  ],
  ["Skin fade", "Bald to blended, any height on top."],
  ["Beard trim and line-up", "Shape, line and condition."],
  ["Hot towel shave", "Straight-razor shave with hot towels."],
  ["Kids cut", "For the young ones, 12 and under."],
] as const;

// One photo per service, same order (Unsplash License; apps/web/public/am-barber/services/
// CREDITS.md). Uploaded to the media library so the owner can swap them in the builder.
const SERVICE_PHOTOS = [
  ["haircut.webp", "A barber cutting a client's hair with scissors"],
  ["skin-fade.webp", "A barber taking a skin fade down with clippers"],
  ["beard-trim.webp", "A barber trimming a full beard with scissors"],
  [
    "hot-towel-shave.webp",
    "A client under a hot towel for a straight-razor shave",
  ],
  ["kids-cut.webp", "A young boy in the barber's chair after his cut"],
] as const;

function log(line: string): void {
  console.log(line);
}

// ------------------------------------------------------------------ org, owner, host
async function ensureOrg(): Promise<{ orgId: string; ownerId: string }> {
  return withSuperuser(async (pb) => {
    const first = async (col: string, filter: string) =>
      (await pb.collection(col).getList(1, 1, { filter })).items[0] ?? null;

    let org = await first(
      "organizations",
      pb.filter("slug = {:s}", { s: SLUG }),
    );
    let owner = await first(
      "users",
      pb.filter("email = {:e}", { e: OWNER_EMAIL }),
    );
    if (owner?.staff_role)
      throw new Error("owner email belongs to a staff account");
    if (!owner) {
      const password = randomBytes(32).toString("hex");
      owner = await pb.collection("users").create({
        email: OWNER_EMAIL,
        password,
        passwordConfirm: password,
        name: OWNER_NAME,
        verified: true,
      });
      log(`PASS owner ${owner.id} created (sign in with an emailed code)`);
    }

    if (!org) {
      const orgId = newRecordId();
      const sys = mintSystemContext({ job: "am-seed" });
      const batch = pb.createBatch();
      batch.collection("organizations").create({
        id: orgId,
        name: NAME,
        slug: SLUG,
        status: "active",
        path: "studio",
        stage: "intake",
      });
      batch.collection("memberships").create({
        user: owner.id,
        organization: orgId,
        role: "owner",
      });
      batch.collection("business_profile").create({
        organization: orgId,
        business_type: "barbershop",
        description:
          "Barbershop in Grand Prairie, Texas. Cuts, fades, beards and shaves.",
        public_email: OWNER_EMAIL,
      });
      batch.collection("org_intake").create({
        organization: orgId,
        selections: {
          addons: [],
          extras: [],
          carePlan: false,
          cadence: "monthly",
        },
      });
      batch.collection("org_email_routes").create({
        organization: orgId,
        purpose: "default",
        address: OWNER_EMAIL,
        confirmed_at: new Date().toISOString(),
      });
      batch.collection("audit_log").create(
        auditBody(sys, {
          action: "am_seed.org_created",
          organization: orgId,
          targetCollection: "organizations",
          targetId: orgId,
          meta: { slug: SLUG },
        }),
      );
      await batch.send();
      org = await pb.collection("organizations").getOne(orgId);
      log(`PASS org ${orgId} created`);
    } else {
      const m = await first(
        "memberships",
        pb.filter("user = {:u} && organization = {:o}", {
          u: owner.id,
          o: org.id,
        }),
      );
      if (!m) {
        await pb
          .collection("memberships")
          .create({ user: owner.id, organization: org.id, role: "owner" });
      } else if (m.role !== "owner") {
        throw new Error("owner email is a non-owner member of the org");
      }
      log(`PASS org ${org.id} already there`);
    }

    // The primary custom host, verified (the edge only serves a verified custom row).
    const host = await first(
      "org_hosts",
      pb.filter("hostname = {:h}", { h: HOST }),
    );
    if (host && host.organization !== org.id) {
      throw new Error(`${HOST} belongs to another organization`);
    }
    const others = await pb.collection("org_hosts").getFullList({
      filter: pb.filter(
        "organization = {:o} && primary = true && hostname != {:h}",
        {
          o: org.id,
          h: HOST,
        },
      ),
    });
    for (const o of others) {
      await pb.collection("org_hosts").update(o.id, { primary: false });
    }
    const row = {
      kind: "custom",
      primary: true,
      verified_at: host?.verified_at || new Date().toISOString(),
    };
    if (host) await pb.collection("org_hosts").update(host.id, row);
    else
      await pb
        .collection("org_hosts")
        .create({ hostname: HOST, organization: org.id, ...row });
    log(`PASS host ${HOST} (custom, primary)`);
    return { orgId: org.id, ownerId: owner.id };
  });
}

async function orgRow(
  orgId: string,
): Promise<{ stage: string; design: unknown }> {
  return withSuperuser(async (pb) => {
    const r = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,stage,design" });
    return { stage: String(r.stage ?? ""), design: r.design };
  });
}

// ------------------------------------------------------------------ images
async function ogImage(): Promise<Uint8Array> {
  const logo = await sharp(readFileSync(LOGO))
    .resize(760, 520, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
  const buf = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: "#0a0a0c" },
  })
    .composite([{ input: logo, top: 55, left: 220 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  return new Uint8Array(buf);
}

// ------------------------------------------------------------------ main
async function main(): Promise<void> {
  for (const k of ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"]) {
    if (!process.env[k]) throw new Error(`${k} is not set`);
  }
  const theme = importThemeDir("design/tenants/am-barber", {
    root: process.cwd(),
  });
  const { orgId, ownerId } = await ensureOrg();
  const ctx = mintOrgContext({
    orgId,
    actor: ownerId,
    role: "owner",
    grants: [],
    ip: IP,
  });
  const sections = composeSectionRegistry(
    CORE_SECTIONS,
    ADDON_REGISTRY.sections(),
  );
  const pdeps: PublishDeps = {
    sections,
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
  };

  // Theme (only when the authored source changed).
  const before = await orgRow(orgId);
  const stored = before.design as { sourceHash?: string } | null;
  if (stored?.sourceHash !== theme.design.sourceHash) {
    await withSuperuser(async (pb) => {
      const batch = pb.createBatch();
      queueDesignWrite(
        batch,
        mintSystemContext({ job: "am-seed" }),
        orgId,
        before.design,
        theme.design,
        "import",
      );
      await batch.send();
    });
    log(`PASS theme ${theme.design.name} (${theme.report.hash8}) written`);
  } else log(`PASS theme ${theme.design.name} unchanged`);

  // Intake: business facts, services, logo / hero (read by the template).
  await saveBusinessProfile(ctx, {
    org_name: NAME,
    tagline: "Est. 2020",
    font_pairing: "bold-clear",
    phone: PHONE,
    public_email: OWNER_EMAIL,
    address: ADDRESS,
    service_area: "Grand Prairie and the DFW Mid-Cities",
    time_zone: "America/Chicago",
    about:
      "A&M Barber Studio has been cutting hair on South Carrier Parkway in Grand Prairie since 2020. Classic cuts, sharp fades, clean beards and straight-razor shaves, done right the first time.",
    mission: "Leave sharper than you came in.",
    headline: "Sharp cuts. Clean fades. Since 2020.",
    legal_name: NAME,
    privacy_contact: OWNER_EMAIL,
    legal_region: "Texas",
  });
  if ((await listServices(ctx)).length === 0) {
    for (const [name, description] of SERVICES) {
      await saveService(ctx, {
        name,
        description,
        price_display: "ask",
        price_cents: null,
        duration_minutes: null,
        is_published: true,
      });
    }
  }
  // Media are keyed by their alt text: a new logo gets a new alt, so a re-run uploads it once
  // (the newest logo row is the site logo and drives the favicon set).
  const logoBytes = new Uint8Array(readFileSync(LOGO));
  const ensureImage = async (
    kind: "logo" | "hero" | "moodboard",
    alt: string,
    bytes: () => Promise<Uint8Array>,
    filename: string,
  ): Promise<string> =>
    (await listMedia(ctx, kind)).find((m) => m.alt === alt)?.id ??
    (
      await uploadImage(ctx, await bytes(), kind, {
        alt,
        filename,
        ...(kind === "logo" ? { invalidator: pdeps.invalidator } : {}),
      })
    ).asset.id;
  await ensureImage("logo", LOGO_ALT, async () => logoBytes, "logo.png");
  const heroId = await ensureImage(
    "hero",
    LOGO_ALT,
    async () => logoBytes,
    "hero.png",
  );
  // Moodboard kind: an image row the template never places on a page (only the share card).
  const share = await ensureImage(
    "moodboard",
    "A&M Barber Studio colour logo on black",
    ogImage,
    "share.jpg",
  );
  log("PASS intake: profile, services, logo, hero, share image");

  if ((await orgRow(orgId)).stage === "intake") {
    const sent = await sendToCds(ctx, ADDON_REGISTRY);
    if (sent.stage !== "ready_for_build") {
      throw new Error(`Send to CDS held the site (stage ${sent.stage})`);
    }
    log("PASS sent to CDS");
  }

  // Assembly: Home + About from the studio template (once; a live site is never rebuilt).
  if (!(await listPages(ctx)).some((p) => p.slug === "home")) {
    await assemble(orgId, sections, pdeps);
  }
  await afterAssembly(ctx, orgId, sections, pdeps, share, heroId);
}

async function assemble(
  orgId: string,
  sections: PublishDeps["sections"],
  pdeps: PublishDeps,
): Promise<void> {
  const result = await runAssemblyForOrg(orgId, {
    templates: TEMPLATES,
    sections,
    copy: getCopyWriter(),
    invalidator: pdeps.invalidator,
    scanner: pdeps.scanner!,
    pinger: pdeps.pinger!,
    registry: ADDON_REGISTRY,
  });
  if (result.status !== "done" && result.status !== "already") {
    throw new Error(
      `assembly ended ${result.status} ${result.ledger.error?.code ?? ""}`,
    );
  }
  log(`PASS assembly ${result.status}`);
}

async function afterAssembly(
  ctx: ReturnType<typeof mintOrgContext>,
  orgId: string,
  sections: PublishDeps["sections"],
  pdeps: PublishDeps,
  share: string,
  heroId: string,
): Promise<void> {
  // Builder Pro (free before checkout).
  const addons = await listOrgAddons(ctx);
  if (!addons.some((r) => r.addon === "builder-pro" && r.status === "active")) {
    await installAddon(ctx, pdeps as never, "builder-pro");
  }
  log("PASS builder-pro active");

  // The one booking form: the one assembly placed (or a new one), rewritten with Pro auto-reply.
  const forms = await listForms(ctx);
  const formId =
    forms[0]?.id ??
    (
      await createForm(ctx, pdeps, {
        template: "contact",
        name: "Book a chair",
      })
    ).form.id;
  const field = (
    id: string,
    type: string,
    label: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type,
    label,
    placeholder: "",
    help: "",
    required: true,
    full_width: false,
    options: [],
    content: "",
    value: "",
    ...extra,
  });
  await saveForm(ctx, pdeps, {
    id: formId,
    name: "Book a chair",
    layout: "2",
    fields: [
      field("name", "name", "Name"),
      field("phone", "phone", "Phone"),
      field("email", "email", "Email", {
        placeholder: "We send your confirmation here",
      }),
      field("service", "dropdown", "Service", {
        options: [...SERVICES.map(([n]) => n), "Not sure yet"],
      }),
      field("preferred-time", "short_text", "Preferred day and time", {
        placeholder: "e.g. Saturday morning",
        full_width: true,
      }),
    ],
    after_submit: {
      kind: "message",
      message: `Got it. We'll call or text you to lock in your time. Need it sooner? Call ${PHONE}.`,
      page: "",
      button_text: "",
    },
    notify_route: "default",
    newsletter_checkbox: false,
    newsletter_wording: "",
    pro: {
      rules: [],
      steps: [],
      auto_reply: {
        enabled: true,
        subject: "We got your request",
        body: `Hi {name},\n\nThanks for reaching out to A&M Barber Studio. We'll get back to you shortly to confirm your time.\n\nNeed us now? Call ${PHONE}.\n2505 S Carrier Pkwy, Grand Prairie, TX 75052\n\nA&M Barber Studio`,
      },
      routing: [],
      save_resume: false,
    },
  });
  log(`PASS form ${formId} (Book a chair, auto-reply on)`);

  // Home hero: the logo alone (the h1 stays for screen readers; am-barber.css hides it).
  const pages = await listPages(ctx);
  const home = pages.find((p) => p.slug === "home");
  if (!home) throw new Error("assembly made no Home page");
  const homeSections = await listSections(ctx, home.id);
  const hero = homeSections.find((s) => s.section_type === "hero");
  if (hero) {
    await saveSection(ctx, sections, {
      id: hero.id,
      pageId: home.id,
      section_type: "hero",
      row_layout: hero.row_layout,
      content: {
        ...(hero.content as Record<string, unknown>),
        heading: NAME,
        heading_accent: "",
        tagline: "",
        subtitle: "",
        trust_text: "",
        cta_primary_text: "",
        cta_primary_link: "",
        cta_secondary_text: "",
        cta_secondary_link: "",
        image_asset: heroId,
        image_alt: LOGO_ALT,
      },
    });
  }
  // The block under the logo: heading, the intro paragraph, then Book Now / Get Directions /
  // More About Us (am-barber.css lays the three out as one equal-width row). Owner-editable
  // in the page builder like any columns block.
  // TODO(owner): swap TEL for the booking tool link when there is one.
  const intro = homeSections.find(
    (s) =>
      s.section_type === "columns" &&
      JSON.stringify(s.content).includes('"link":"/about"'),
  );
  if (intro) {
    const content = intro.content as {
      columns: { id: string; items: Record<string, unknown>[] }[];
    };
    const col = content.columns[content.columns.length - 1]!;
    const keep = (kind: string) => col.items.find((it) => it.kind === kind);
    const button = (n: number, text: string, link: string, style: string) => ({
      ...(col.items.find((it) => it.kind === "button" && it.link === link) ??
        {}),
      id: `a3b00000-0000-4000-8000-00000000000${n}`,
      kind: "button",
      action: "link",
      text,
      link,
      style,
      popup_id: "",
    });
    col.items = [
      {
        ...keep("heading"),
        kind: "heading",
        level: 2,
        text: "Sharp cuts. Clean fades. Est. 2020.",
      },
      {
        ...keep("text"),
        kind: "text",
        html: "<p>A&amp;M Barber Studio has been cutting hair on South Carrier Parkway in Grand Prairie since 2020. Classic cuts, sharp fades, clean beards and straight-razor shaves, done right the first time.</p>",
      },
      button(1, "Book Now", TEL, "primary"),
      button(2, "Get Directions", DIRECTIONS, "secondary"),
      button(3, "More About Us", "/about", "secondary"),
    ];
    await saveSection(ctx, sections, {
      id: intro.id,
      pageId: home.id,
      section_type: "columns",
      row_layout: intro.row_layout,
      content,
    });
  }
  // Services: a heading block, then one 40-60 row per service (photo left, name /
  // description / price right; am-barber.css crops the photo to the hexagon frame). Plain
  // columns blocks, so the owner edits text and swaps photos in the builder. Rows are found
  // again by their fixed column ids; the generic Services list block is removed.
  // TODO(owner): real descriptions and prices.
  const gallery = await listMedia(ctx, "gallery");
  const svcId = (n: number, part: number) =>
    `a3b00000-0000-4000-8${part}00-0000000000${String(n).padStart(2, "0")}`;
  let after = intro?.id;
  const headSpec = {
    section_type: "text-only",
    row_layout: "full",
    content: {
      heading: "Services",
      text: `<p>Walk in or call ahead: ${PHONE}. Ask about prices in the shop.</p>`,
    },
  };
  const current = await listSections(ctx, home.id);
  const head = current.find(
    (s) =>
      s.section_type === "text-only" &&
      (s.content as { heading?: string }).heading === "Services",
  );
  const headRow = await saveSection(ctx, sections, {
    ...(head ? { id: head.id } : after ? { afterId: after } : {}),
    pageId: home.id,
    ...headSpec,
  });
  after = headRow.id;
  for (let n = 0; n < SERVICES.length; n++) {
    const [name, description] = SERVICES[n]!;
    const [file, alt] = SERVICE_PHOTOS[n]!;
    const asset =
      gallery.find((m) => m.alt === alt)?.id ??
      (
        await uploadImage(
          ctx,
          new Uint8Array(
            readFileSync(`apps/web/public/am-barber/services/${file}`),
          ),
          "gallery",
          { alt, filename: file },
        )
      ).asset.id;
    const existingRow = current.find(
      (s) =>
        s.section_type === "columns" &&
        JSON.stringify(s.content).includes(svcId(n, 1)),
    );
    const row = await saveSection(ctx, sections, {
      ...(existingRow ? { id: existingRow.id } : { afterId: after }),
      pageId: home.id,
      section_type: "columns",
      row_layout: "40-60",
      content: {
        columns: [
          {
            id: svcId(n, 1),
            items: [{ id: svcId(n, 2), kind: "image", url: "", alt, asset }],
          },
          {
            id: svcId(n, 3),
            items: [
              { id: svcId(n, 4), kind: "heading", text: name, level: 3 },
              {
                id: svcId(n, 5),
                kind: "text",
                html: `<p>${description}</p><p><strong>Ask for a price</strong></p>`,
              },
            ],
          },
        ],
      },
    });
    after = row.id;
  }
  const oldList = current.find((s) => s.section_type === "services");
  if (oldList) await deleteSection(ctx, oldList.id);

  await updatePage(ctx, home.id, {
    seo: {
      meta_title: "A&M Barber Studio | Barbershop in Grand Prairie, TX",
      meta_description:
        "Haircuts, skin fades, beard trims and hot towel shaves at 2505 S Carrier Pkwy, Grand Prairie, TX. Call (214) 518-6852. Est. 2020.",
      share_image: share,
    },
  });
  const homeRes = await publishPage(ctx, home.id, pdeps);
  if (homeRes.status !== "published") throw new Error("Home publish held");

  // Contact page: the form + map/details blocks Home carries, plus directions.
  const contact =
    pages.find((p) => p.slug === "contact") ??
    (await createPage(ctx, { title: "Contact", slug: "contact" }));
  const existing = await listSections(ctx, contact.id);
  const used = new Set<string>();
  const copy = homeSections.filter(
    (s) =>
      s.section_type === "map" ||
      (s.section_type === "columns" &&
        JSON.stringify(s.content).includes('"kind":"form"')),
  );
  const specs = [
    {
      section_type: "text-only",
      row_layout: "full",
      content: {
        heading: "Book a chair",
        text: `<p>Tell us what you need and when. We'll call or text to confirm. In a hurry? <a href="${TEL}">Call ${PHONE}</a>.</p><p>2505 S Carrier Pkwy, Grand Prairie, TX 75052 · <a href="${DIRECTIONS}">Get directions</a> · <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a></p>`,
      },
    },
    ...copy.map((s) => ({
      section_type: s.section_type,
      row_layout: s.row_layout,
      content: s.content,
    })),
  ];
  for (const s of specs) {
    const reuse = existing.find(
      (c) => c.section_type === s.section_type && !used.has(c.id),
    );
    if (reuse) used.add(reuse.id);
    await saveSection(ctx, sections, {
      ...(reuse ? { id: reuse.id } : {}),
      pageId: contact.id,
      ...s,
    });
  }
  await updatePage(ctx, contact.id, {
    seo: {
      meta_title: "Contact A&M Barber Studio | Grand Prairie, TX",
      meta_description:
        "Book a chair at A&M Barber Studio, 2505 S Carrier Pkwy, Grand Prairie, TX 75052. Call (214) 518-6852.",
    },
  });
  const cRes = await publishPage(ctx, contact.id, pdeps);
  if (cRes.status !== "published") throw new Error("Contact publish held");
  await addPageToNav(ctx, pdeps, contact.id);
  log("PASS pages: Home (hero), Contact published; Contact in the menu");

  // Only the colour logo is ever used: retire any other logo / hero / share image rows (the
  // first black-background logo). Runs after the pages point at the new ids.
  let retired = 0;
  for (const kind of ["logo", "hero", "moodboard"] as const) {
    for (const m of await listMedia(ctx, kind)) {
      if (m.id !== heroId && m.id !== share && m.alt !== LOGO_ALT) {
        await removeMedia(ctx, m.id, { invalidator: pdeps.invalidator });
        retired++;
      }
    }
  }
  if (retired > 0) log(`PASS retired ${retired} old logo image(s)`);

  // Live.
  await setOrgStage(mintSystemContext({ job: "am-seed" }), orgId, "live");
  log(`PASS stage live: https://${HOST}/`);
}

main().catch((err: unknown) => {
  console.error(
    `FAIL ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`,
  );
  if (err && typeof err === "object" && "data" in err) {
    console.error(
      JSON.stringify((err as { data: unknown }).data).slice(0, 800),
    );
  }
  process.exit(1);
});
