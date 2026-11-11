// Dev tenant seed (DEV ONLY; CONT-08, CONT-30; THEME-01; 03-CONTEXT "Claude's Discretion":
// the Phase 3 exit check, repeatable on dev; 04-14: the Phase 4 side-by-side check). One
// command creates two tenants, "demo" (Almanac theme) and "demo-b" (Tidewater theme), each
// with an owner login and the same published home page (hero, a "Photo left, text right"
// columns block with a countdown), an enabled announcement banner and a delay pop-up, all
// through the normal @cds/db writers. Each theme is read with importThemeDir from
// design/tenants/demo and design/tenants/demo-b (the same importer theme:import uses) and
// written by bootstrapDevTenant({ design }), validated before any write.
//
// Usage:
//   npm run tenants:seed-dev                              seed "demo" and "demo-b"
//   npm run tenants:seed-dev -- --host <hostname>         another preview hostname for demo
//   npm run tenants:seed-dev -- --host-b <hostname>       another preview hostname for demo-b
//   npm run tenants:seed-dev -- --owner-email <email>     another owner login for demo
//   npm run tenants:seed-dev -- --intake complete|minimal|both
//                                                         P8's intake fixtures instead (06-23)
//   npm run tenants:seed-dev -- --intake both --assemble
//                                                         also assemble each fixture's site on
//                                                         its sites.localhost preview host (08-19)
//   npm run tenants:seed-dev -- --stage <stage>           move the seeded "demo" tenant to any
//                                                         stage for walks (11-42; seed it first)
//   npm run tenants:seed-dev -- --dry-run                 print the plan, write nothing
//   npm run tenants:seed-dev -- --help
// The default hosts have no DNS yet (no wildcard): add an A record and a Caddy route first
// (HUMAN-CHECKS P3 / P4).
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD, PB_APP_KEY, SEED_OWNER_PASSWORD
// (required; .env.local is read by the npm script; both owners share it), CDS_ENV (must be
// exactly "dev"; unset, "production" or any other value is refused, so a forgotten variable
// never seeds a production database; IN-R01),
// CDS_STORAGE_DIR / WASABI_* (where the published JSON goes, as for tenants:export).
// Invalidation is recorded, not sent (no Next runtime here): a running app picks the change
// up within its 300 s cache window (theme: 60 s). Output is PLAN / PASS / FAIL lines with ids,
// hosts, theme names and counts only; the owner password is never printed.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { InvalidInput } from "@cds/core";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { importThemeDir, type ThemeImportResult } from "@cds/core/theme/import";
import { bootstrapDevTenant, setDevTenantStage } from "../src/dev-seed";
import { isOrgStage, ORG_STAGES } from "../src/org-stage";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { previewHostSuffix, previewUrl } from "../src/assembly";
import { ASSEMBLY_FIXTURES, seedAssembledIntake } from "./seed-assembly";
import {
  BLOCKS_FIXTURE,
  BLOCKS_HOST,
  BLOCKS_OWNER_EMAIL,
  BLOCKS_SLUG,
  seedBlocksTenant,
} from "../src/dev-seed-blocks";
import {
  createPage,
  getContentScanner,
  getSearchPinger,
  listPages,
  listPopups,
  listSections,
  orgContextFromToken,
  publishPage,
  recordingInvalidator,
  saveBanner,
  savePopup,
  saveSection,
  signInMember,
  type PublishDeps,
} from "../src/index";

const USAGE = `tenants:seed-dev - seed two themed dev tenants and publish their home pages (DEV ONLY)

  npm run tenants:seed-dev                          "demo" (Almanac) on demo.cds.needtobeedgy.com
                                                    "demo-b" (Tidewater) on demo-b.cds.needtobeedgy.com
  npm run tenants:seed-dev -- --host <hostname>     preview hostname for demo
  npm run tenants:seed-dev -- --host-b <hostname>   preview hostname for demo-b
  npm run tenants:seed-dev -- --owner-email <email> demo owner login (default owner@demo.test;
                                                    demo-b is always owner@demo-b.test)
  npm run tenants:seed-dev -- --intake <which>      P8's intake fixtures only (no themed tenants):
                                                    complete  "intake-complete", every field, sent to CDS
                                                    minimal   "intake-minimal", required fields only
                                                    both      the two of them
  npm run tenants:seed-dev -- --assemble            with --intake: also assemble the site from the intake (P8)
                                                    (preview host <slug>.<CDS_PREVIEW_HOST_SUFFIX>,
                                                    default sites.localhost; a re-run changes nothing)
  npm run tenants:seed-dev -- --blocks              the every-block tenant "blocks" on blocks.localhost
                                                    (custom host; P7 exit + Lighthouse); --host overrides
  npm run tenants:seed-dev -- --stage <stage>       move the seeded "demo" tenant to a stage (run the
                                                    plain seed first), for walks and human checks:
                                                    ${ORG_STAGES.join(" | ")}
                                                    forward moves go through setOrgStage (live sets
                                                    launched_at); a backward move is a dev-only reset
  npm run tenants:seed-dev -- --dry-run             print the plan, write nothing
  npm run tenants:seed-dev -- --help                this text

Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD, PB_APP_KEY,
     SEED_OWNER_PASSWORD (required; every owner; never printed)
     CDS_ENV=dev (required; anything else is refused)
     CDS_STORAGE_DIR, WASABI_* (optional)
     SEED_PAGE_PASSWORD (optional; --blocks protected page; default SEED_OWNER_PASSWORD)
     CDS_VIDEO_TRANSCODER (--blocks: fake when ffmpeg is absent)
     CDS_PREVIEW_HOST_SUFFIX, CDS_PREVIEW_PORT (--assemble; optional)`;

const REQUIRED_ENV = [
  "PB_URL",
  "PB_SUPERUSER_EMAIL",
  "PB_SUPERUSER_PASSWORD",
  "PB_APP_KEY",
  "SEED_OWNER_PASSWORD",
];
const POPUP_NAME = "Welcome offer";
const CLI_IP = "cli";
const KNOWN_FLAGS = [
  "--host",
  "--host-b",
  "--owner-email",
  "--intake",
  "--stage",
];
const INTAKE_CHOICES = ["complete", "minimal", "both"] as const;
type IntakeChoice = (typeof INTAKE_CHOICES)[number];
const INTAKE_FIXTURES = ASSEMBLY_FIXTURES;

type TenantPlan = {
  slug: string;
  name: string;
  host: string;
  ownerEmail: string;
  themeDir: string;
};

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

function parseArgs(args: string[]): {
  tenants: TenantPlan[];
  dryRun: boolean;
  intake: IntakeChoice | null;
  assemble: boolean;
  blocks: string | null;
  stage: string | null;
} {
  let intake: IntakeChoice | null = null;
  let stage: string | null = null;
  let host = "demo.cds.needtobeedgy.com";
  let hostB = "demo-b.cds.needtobeedgy.com";
  let ownerEmail = "owner@demo.test";
  let dryRun = false;
  let blocks = false;
  let assemble = false;
  let hostSet = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--blocks") {
      blocks = true;
      continue;
    }
    if (a === "--assemble") {
      assemble = true;
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (!KNOWN_FLAGS.includes(name)) fail(`unknown argument ${name}`);
    const value = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (!value || value.startsWith("--")) fail(`${name} needs a value`);
    if (name === "--intake") {
      if (!(INTAKE_CHOICES as readonly string[]).includes(value)) {
        fail("--intake must be complete, minimal or both");
      }
      intake = value as IntakeChoice;
    } else if (name === "--stage") {
      if (!isOrgStage(value)) {
        fail(`--stage must be one of ${ORG_STAGES.join(", ")}`);
      }
      stage = value;
    } else if (name === "--host") {
      host = value;
      hostSet = true;
    } else if (name === "--host-b") hostB = value;
    else ownerEmail = value;
  }
  if (blocks && intake) fail("--blocks and --intake can't be combined");
  if (stage && (blocks || intake || assemble)) {
    fail("--stage can't be combined with --blocks, --intake or --assemble");
  }
  if (assemble && !intake)
    fail("--assemble needs --intake complete|minimal|both");
  if (host.toLowerCase() === hostB.toLowerCase()) {
    fail("--host and --host-b must differ");
  }
  return {
    dryRun,
    intake,
    assemble,
    blocks: blocks ? (hostSet ? host : BLOCKS_HOST) : null,
    stage,
    tenants: [
      {
        slug: "demo",
        name: "Demo",
        host,
        ownerEmail,
        themeDir: "design/tenants/demo",
      },
      {
        slug: "demo-b",
        name: "Demo B",
        host: hostB,
        ownerEmail: "owner@demo-b.test",
        themeDir: "design/tenants/demo-b",
      },
    ],
  };
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function loadTheme(dir: string): ThemeImportResult {
  try {
    return importThemeDir(dir, { root: process.cwd() });
  } catch (err) {
    if (err instanceof InvalidInput) fail(`theme ${dir}: ${err.message}`);
    throw err;
  }
}

async function seedTenant(
  plan: TenantPlan,
  theme: ThemeImportResult,
  ownerPassword: string,
): Promise<void> {
  const { slug, name, host, ownerEmail } = plan;

  // 1. org, host, owner, membership and the theme (superuser writes stay inside @cds/db).
  const tenant = await bootstrapDevTenant(
    {
      slug,
      name,
      host,
      ownerEmail,
      ownerPassword,
      design: theme.design,
    },
    { invalidator: recordingInvalidator() },
  );
  console.log(
    `PASS ${slug}: org ${tenant.orgId} ${tenant.created ? "created" : "updated"}; owner ${tenant.ownerId}; host ${host}`,
  );
  console.log(
    `PASS ${slug}: theme ${theme.design.name} (${theme.report.hash8}), ${theme.report.adjustments.length} adjustment(s)`,
  );

  // 2. Everything else as the owner, through the normal writers.
  const { token } = await signInMember(ownerEmail, ownerPassword, CLI_IP);
  const ctx = await orgContextFromToken(token, tenant.orgId, CLI_IP);
  const deps: PublishDeps = {
    sections: composeSectionRegistry(CORE_SECTIONS, []),
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
  };

  const pages = await listPages(ctx);
  const home =
    pages.find((p) => p.slug === "home") ??
    (await createPage(ctx, { title: "Home", slug: "home" }));

  const sections = await listSections(ctx, home.id);
  const heroId = sections.find((s) => s.section_type === "hero")?.id;
  const columnsId = sections.find((s) => s.section_type === "columns")?.id;

  // Both tenants get the same copy so the side-by-side check compares one page, two themes.
  await saveSection(ctx, deps.sections, {
    ...(heroId ? { id: heroId } : {}),
    pageId: home.id,
    section_type: "hero",
    row_layout: "full",
    content: {
      tagline: "Dev tenant",
      heading: "Welcome to Demo",
      subtitle: "A seeded site for checking the page builder end to end.",
    },
  });

  // The "Photo left, text right" suggested preset (packages/ui builder presets), filled in.
  await saveSection(ctx, deps.sections, {
    ...(columnsId ? { id: columnsId } : {}),
    pageId: home.id,
    section_type: "columns",
    row_layout: "40-60",
    content: {
      columns: [
        {
          id: uuid(),
          items: [{ id: uuid(), kind: "image", url: "", alt: "" }],
        },
        {
          id: uuid(),
          items: [
            {
              id: uuid(),
              kind: "heading",
              text: "Our grand opening",
              level: 2,
            },
            {
              id: uuid(),
              kind: "text",
              html: "<p>Join us for the opening week. Doors open soon.</p>",
            },
            {
              id: uuid(),
              kind: "countdown",
              target_at: inDays(30),
              zero_message: "We are open!",
            },
          ],
        },
      ],
    },
  });
  console.log(`PASS ${slug}: home ${home.id}: 2 sections`);

  await saveBanner(ctx, deps, {
    enabled: true,
    message: "Opening week: everything 10% off.",
    link_text: "",
    link_url: "",
    starts_at: null,
    ends_at: null,
  });
  console.log(`PASS ${slug}: banner enabled`);

  const popupId = (await listPopups(ctx)).find(
    (p) => p.name === POPUP_NAME,
  )?.id;
  const { popup } = await savePopup(ctx, deps, {
    ...(popupId ? { id: popupId } : {}),
    name: POPUP_NAME,
    trigger: "delay",
    delay_seconds: 5,
    frequency: "once-per-visitor",
    show_on: "all-pages",
    enabled: true,
    content: {
      items: [
        { id: uuid(), kind: "heading", text: "Welcome!", level: 2 },
        {
          id: uuid(),
          kind: "text",
          html: "<p>Thanks for visiting the demo site.</p>",
        },
      ],
    },
  });
  console.log(`PASS ${slug}: pop-up ${popup.id} (delay)`);

  const res = await publishPage(ctx, home.id, deps);
  if (res.status !== "published") {
    fail(`${slug}: publish held (${res.reasons.length})`);
  }
  console.log(`PASS ${slug}: published home -> ${res.versionKey}`);
}

/** 06-23: P8's intake fixtures (complete and / or minimal); 08-19: --assemble builds them. */
async function seedIntakes(
  which: IntakeChoice,
  dryRun: boolean,
  assemble: boolean,
): Promise<void> {
  const kinds: ("complete" | "minimal")[] =
    which === "both" ? ["complete", "minimal"] : [which];
  if (dryRun) {
    for (const k of kinds) {
      const f = INTAKE_FIXTURES[k];
      console.log(
        `PLAN intake ${k}: org "${f.slug}", owner ${f.ownerEmail} (secret read from env, never printed)`,
      );
      if (assemble) {
        console.log(
          `PLAN assemble ${f.slug}: send to CDS, build Home and About on ${f.slug}.${previewHostSuffix()}`,
        );
      }
    }
    console.log("DRY RUN nothing written");
    return;
  }
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  const ownerPassword = process.env.SEED_OWNER_PASSWORD!;
  if (assemble) {
    for (const k of kinds) {
      const f = INTAKE_FIXTURES[k];
      const r = await seedAssembledIntake(k, {
        slug: f.slug,
        ownerEmail: f.ownerEmail,
        ownerPassword,
      });
      console.log(
        `PASS intake ${k}: org ${r.orgId} ${r.created ? "created" : "already there, left untouched"}; owner ${f.ownerEmail}`,
      );
      const url = previewUrl(r.previewHost, "/");
      console.log(
        r.result.status === "already"
          ? `PASS ${f.slug}: already assembled, nothing changed: ${url}`
          : `Assembled ${f.slug}: ${url}`,
      );
    }
    return;
  }
  for (const k of kinds) {
    const f = INTAKE_FIXTURES[k];
    const opts = { slug: f.slug, ownerEmail: f.ownerEmail, ownerPassword };
    const r =
      k === "complete"
        ? await seedCompleteIntake(opts, { registry: ADDON_REGISTRY })
        : await seedMinimalIntake(opts);
    console.log(
      `PASS intake ${k}: org ${r.orgId} ${r.created ? "created" : "already there, left untouched"}; owner ${f.ownerEmail}`,
    );
  }
}

/** 07-33: the every-block tenant (P7 exit fixture and Lighthouse target). */
async function seedBlocks(host: string, dryRun: boolean): Promise<void> {
  const theme = loadTheme("design/tenants/demo");
  if (dryRun) {
    console.log(`PLAN org "${BLOCKS_SLUG}", host ${host} (custom)`);
    console.log(
      `PLAN ${BLOCKS_SLUG}: owner ${BLOCKS_OWNER_EMAIL} (secret read from env, never printed); theme ${theme.design.name}`,
    );
    for (const [key, p] of Object.entries(BLOCKS_FIXTURE.pages)) {
      console.log(
        `PLAN ${BLOCKS_SLUG}: ${key}: ${p.sections.map((s) => s.type).join(", ")}${key === "members" ? " (password)" : ""}`,
      );
    }
    console.log(
      `PLAN ${BLOCKS_SLUG}: system-404 (edited title), pop-up "${BLOCKS_FIXTURE.popup.name}" (click)`,
    );
    console.log(
      `PLAN ${BLOCKS_SLUG}: media: 14 photos, 4 logos, 1 share image, 1 site logo, 1 MP3, 1 MP4; 2 forms (1 soft-deleted); 2 nav saves`,
    );
    console.log("DRY RUN nothing written");
    return;
  }
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  const ownerPassword = process.env.SEED_OWNER_PASSWORD!;
  const r = await seedBlocksTenant(
    {
      host,
      ownerPassword,
      pagePassword: process.env.SEED_PAGE_PASSWORD || ownerPassword,
      design: theme.design,
    },
    { registry: ADDON_REGISTRY },
  );
  console.log(
    `PASS ${BLOCKS_SLUG}: org ${r.orgId} ${r.created ? "created" : "updated"}; host ${r.host} (custom)`,
  );
  for (const [key, id] of Object.entries(r.pages)) {
    console.log(`PASS ${BLOCKS_SLUG}: page ${key} ${id}`);
  }
  console.log(
    `PASS ${BLOCKS_SLUG}: media ${r.assets.photos.length} photos, ${r.assets.logos.length} logos, video ${r.assets.video}, audio ${r.assets.audio}; nav versions ${r.navVersions}`,
  );
}

/** 11-42: move the seeded "demo" tenant to any stage (walks and human checks). */
async function seedStage(stage: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(
      `PLAN demo: stage -> ${stage} (forward through setOrgStage; backward = dev-only reset)`,
    );
    console.log("DRY RUN nothing written");
    return;
  }
  for (const name of [
    "PB_URL",
    "PB_SUPERUSER_EMAIL",
    "PB_SUPERUSER_PASSWORD",
  ]) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  const r = await setDevTenantStage(stage, "demo");
  const how =
    r.moved === "same"
      ? "already there, nothing changed"
      : r.moved === "forward"
        ? "moved forward"
        : "reset backwards (dev only)";
  console.log(
    `PASS demo: org ${r.orgId} ${r.from || "(no stage)"} -> ${r.to}: ${how}${r.launchedAt ? `; launched_at ${r.launchedAt}` : ""}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  // The operator must say this is dev: CDS_ENV has to be exactly "dev". An unset variable
  // is not proof of a dev database (the seed resets an owner password), so it is refused
  // like production and any other value (WR-A05, IN-R01).
  const env = process.env.CDS_ENV;
  if (env === "production") fail("refusing to seed in production");
  if (env !== "dev") {
    fail(
      env === undefined || env === ""
        ? "refusing to seed: set CDS_ENV=dev to confirm a dev database"
        : `refusing to seed: CDS_ENV is "${env}", not dev`,
    );
  }
  const { tenants, dryRun, intake, assemble, blocks, stage } = parseArgs(args);
  if (stage) return seedStage(stage, dryRun);
  if (intake) return seedIntakes(intake, dryRun, assemble);
  if (blocks) return seedBlocks(blocks, dryRun);

  // Both themes are read, mapped and solved before anything is written or signed in.
  const themes = tenants.map((t) => loadTheme(t.themeDir));

  if (dryRun) {
    tenants.forEach((t, i) => {
      const theme = themes[i]!;
      console.log(`PLAN org "${t.slug}" (${t.name}), preview host ${t.host}`);
      console.log(
        `PLAN ${t.slug}: owner ${t.ownerEmail} (secret read from env, never printed)`,
      );
      console.log(
        `PLAN ${t.slug}: theme ${theme.design.name} from ${t.themeDir}, ${theme.report.adjustments.length} adjustment(s)`,
      );
      console.log(
        `PLAN ${t.slug}: home: hero, columns 40-60 (photo | heading, text, countdown)`,
      );
      console.log(
        `PLAN ${t.slug}: banner (enabled), pop-up "${POPUP_NAME}" (delay), publish home`,
      );
    });
    console.log("DRY RUN nothing written");
    return;
  }

  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  const ownerPassword = process.env.SEED_OWNER_PASSWORD!;

  for (let i = 0; i < tenants.length; i++) {
    await seedTenant(tenants[i]!, themes[i]!, ownerPassword);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
