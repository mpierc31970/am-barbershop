// Phase 4 exit (ROADMAP Phase 4 success criterion; THEME-01..06; CONTEXT A4-Q3; T-04-43):
// two organizations render the same published page with visibly different, accessible
// design systems. The proof runs through the same functions the theme:import CLI calls
// (importThemeDir + setOrganizationDesign from a real staff MFA sign-in) and then the real
// tenant layout + page render against the PocketBase 0.39.11 binary.
//
// Org A gets design/tenants/demo (Almanac), org B design/tenants/demo-b (Tidewater). Then:
//   - data-theme differs and equals each import's hash8
//   - all 8 --site-<role> values and both font families differ
//   - every ENFORCED_PAIRS ratio computed from the emitted values meets its minimum
//   - the markup is identical apart from the <style> element and data-theme (and, since
//     07-25, each org's own name and host in the header and footer)
//   - Tidewater recorded exactly one solver adjustment (accent), Almanac none
//   - clearing a design falls back to the neutral preset (00000000)
//
// next/headers supplies the middleware header per case; next/navigation throws sentinels;
// next/cache is a passthrough (every read goes to PB and the object store).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearResolverCache,
  publishPage,
  recordingInvalidator,
  saveSection,
  setOrganizationDesign,
  type OrgContext,
  type PlatformContext,
  type PublishDeps,
} from "@cds/db";
import {
  contrastRatio,
  ENFORCED_PAIRS,
  NEUTRAL_HASH,
  ROLES,
  type OrganizationDesign,
  type Role,
} from "@cds/core/theme";
import { importThemeDir, type ThemeImportResult } from "@cds/core/theme/import";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import {
  bootSeededPb,
  clearOrgDesign,
  staffContext,
  storedOrgDesign,
} from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({ header: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
  // The layout reads cds_consent (07-14); no visitor cookie here.
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const { default: TenantPage } =
  await import("../app/tenant/[host]/[[...path]]/page");
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const HOST_A = "a.example.com";
const HOST_B = "b.example.com";

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let staff: PlatformContext;
let almanac: ThemeImportResult;
let tidewater: ThemeImportResult;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
  };
}

/** The tenant layout wrapping the tenant page, exactly as the route tree renders them. */
async function renderSite(host: string): Promise<string> {
  state.header = host;
  const page = await TenantPage({
    params: Promise.resolve({ host, path: undefined }),
  });
  const el = await TenantLayout({
    children: page as ReactElement,
    params: Promise.resolve({ host }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

function styleText(html: string): string {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
  if (!m) throw new Error("no <style> element in the render");
  return m[1]!;
}

function themeAttr(html: string): string {
  const m = / data-theme="([^"]*)"/.exec(html);
  if (!m) throw new Error("no data-theme attribute in the render");
  return m[1]!;
}

function siteVar(css: string, name: string): string {
  const m = new RegExp(`--site-${name}:([^;]+);`).exec(css);
  if (!m) throw new Error(`--site-${name} not emitted`);
  return m[1]!.trim();
}

function roleValues(css: string): Record<Role, string> {
  return Object.fromEntries(ROLES.map((r) => [r, siteVar(css, r)])) as Record<
    Role,
    string
  >;
}

/** Strip the theme-only parts and the org-specific record ids. */
function normalise(html: string, ids: string[]): string {
  let out = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    // 07-30: the JSON-LD data script carries each org's own business data (not markup).
    .replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, "")
    .replace(/ data-theme="[^"]*"/g, "")
    // 07-25: the header wordmark, footer name and Report link carry each org's own name/host.
    .replace(/Org [AB]/g, "ORG_NAME")
    .replace(/[ab]\.example\.com/g, "HOST");
  for (const id of ids) out = out.split(id).join("RECORD_ID");
  return out;
}

async function publishSamePage(ctx: OrgContext, pageId: string) {
  await saveSection(ctx, SECTION_REGISTRY, {
    pageId,
    section_type: "hero",
    row_layout: "full",
    content: {
      tagline: "Est. 1998",
      heading: "A season of good work",
      subtitle: "The same page, two design systems.",
    },
    afterId: null,
  });
  await saveSection(ctx, SECTION_REGISTRY, {
    pageId,
    section_type: "text-only",
    row_layout: "full",
    content: {
      heading: "About us",
      text: '<p>Visit us any day. <a href="/contact">Get in touch</a>.</p>',
    },
  });
  const res = await publishPage(ctx, pageId, deps());
  expect(res.status).toBe("published");
}

const ids = () => [
  seed.A.popup,
  seed.B.popup,
  seed.A.page,
  seed.B.page,
  seed.A.section,
  seed.B.section,
  seed.A.org,
  seed.B.org,
];

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-theming-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  staff = await staffContext(inst, "super-theming@cds.test", "super_admin");

  // The same two calls the theme:import CLI makes, per org.
  almanac = importThemeDir("design/tenants/demo", { root: REPO_ROOT });
  tidewater = importThemeDir("design/tenants/demo-b", { root: REPO_ROOT });
  await setOrganizationDesign(staff, seed.A.org, almanac.design, {
    invalidator: recordingInvalidator(),
  });
  await setOrganizationDesign(staff, seed.B.org, tidewater.design, {
    invalidator: recordingInvalidator(),
  });

  await publishSamePage(seed.ctxA, seed.A.page);
  await publishSamePage(seed.ctxB, seed.B.page);
}, 120_000);

afterAll(async () => {
  clearResolverCache();
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  state.header = null;
});

describe("Phase 4 exit: two orgs, one page, two accessible themes", () => {
  it("each org renders its own theme hash, and the hashes differ", async (t) => {
    if (!inst) return t.skip();
    const a = await renderSite(HOST_A);
    const b = await renderSite(HOST_B);
    expect(almanac.design.name).toBe("Almanac");
    expect(tidewater.design.name).toBe("Tidewater");
    expect(themeAttr(a)).toBe(almanac.report.hash8);
    expect(themeAttr(b)).toBe(tidewater.report.hash8);
    expect(themeAttr(a)).not.toBe(themeAttr(b));
    expect(styleText(a)).toContain(
      `[data-site][data-theme="${almanac.report.hash8}"]`,
    );
    expect(styleText(b)).toContain(
      `[data-site][data-theme="${tidewater.report.hash8}"]`,
    );
    // T-04-43: neither render carries the other org's theme.
    expect(a).not.toContain(tidewater.report.hash8);
    expect(b).not.toContain(almanac.report.hash8);
  });

  it("all 8 colour roles and both font families differ", async (t) => {
    if (!inst) return t.skip();
    const cssA = styleText(await renderSite(HOST_A));
    const cssB = styleText(await renderSite(HOST_B));
    const ra = roleValues(cssA);
    const rb = roleValues(cssB);
    for (const role of ROLES) {
      expect(ra[role], role).toMatch(/^#[0-9a-f]{6}$/);
      expect(ra[role], role).not.toBe(rb[role]);
    }
    const headA = siteVar(cssA, "font-heading");
    const headB = siteVar(cssB, "font-heading");
    const bodyA = siteVar(cssA, "font-body");
    const bodyB = siteVar(cssB, "font-body");
    expect(headA).not.toBe(headB);
    expect(bodyA).not.toBe(bodyB);
    expect(almanac.design.typography.headingFamily).toBe("Fraunces");
    expect(almanac.design.typography.bodyFamily).toBe("Source Serif 4");
    expect(tidewater.design.typography.headingFamily).toBe("Archivo");
    expect(tidewater.design.typography.bodyFamily).toBe("Public Sans");
  });

  it("every enforced contrast pair passes on both rendered themes", async (t) => {
    if (!inst) return t.skip();
    for (const host of [HOST_A, HOST_B]) {
      const roles = roleValues(styleText(await renderSite(host)));
      expect(ENFORCED_PAIRS.length).toBeGreaterThanOrEqual(9);
      for (const p of ENFORCED_PAIRS) {
        const ratio = contrastRatio(roles[p.fg], roles[p.bg]);
        expect(ratio, `${host} ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(
          p.min!,
        );
      }
    }
  });

  it("the markup is identical apart from the <style> element and data-theme", async (t) => {
    if (!inst) return t.skip();
    const a = await renderSite(HOST_A);
    const b = await renderSite(HOST_B);
    expect(a).toContain("A season of good work");
    expect(a).toContain("About us");
    expect(a).not.toBe(b);
    expect(normalise(a, ids())).toBe(normalise(b, ids()));
  });

  it("Tidewater stored exactly one solver adjustment (accent); Almanac none", async (t) => {
    if (!inst) return t.skip();
    const a = (await storedOrgDesign(seed.A.org)) as OrganizationDesign;
    const b = (await storedOrgDesign(seed.B.org)) as OrganizationDesign;
    expect(a.name).toBe("Almanac");
    expect(a.contrast.adjustments).toEqual([]);
    expect(b.name).toBe("Tidewater");
    expect(b.contrast.adjustments).toHaveLength(1);
    expect(b.contrast.adjustments[0]!.role).toBe("accent");
    expect(b.contrast.adjustments[0]!.fallback).toBe(false);
    expect(b.roles.accent).toBe(b.contrast.adjustments[0]!.to);
  });

  it("a cleared design renders the neutral preset (00000000); the other org keeps its theme", async (t) => {
    if (!inst) return t.skip();
    await clearOrgDesign(seed.A.org);
    clearResolverCache();
    const a = await renderSite(HOST_A);
    expect(NEUTRAL_HASH).toBe("00000000");
    expect(themeAttr(a)).toBe("00000000");
    expect(a).not.toContain(almanac.report.hash8);
    expect(a).toContain("A season of good work");
    expect(themeAttr(await renderSite(HOST_B))).toBe(tidewater.report.hash8);
  });
});
