// Add-on blocks on the tenant host against the real PocketBase 0.39.11 binary (ADDON-04,
// ADDON-05, ADDON-08; D253; CONTEXT A2-Q3; Pitfall 9; T-05-49). Install surfaces the seeded
// page with live testimonials; uninstall 404s that page and draws nothing where the block
// sits elsewhere, while published JSON stays untouched; reinstall brings it all back. Only a
// hero owns the page h1 (CONT-35): add-on block headings are h2 and every page has one h1.
//
// Mocks copied from tenant-render.integration.test.tsx: next/headers supplies the middleware
// header, next/navigation throws sentinels, next/cache is a passthrough.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addonRepo,
  clearResolverCache,
  installAddon,
  publishPage,
  recordingInvalidator,
  saveSection,
  uninstallAddon,
  type AddonDeps,
  type OrgContext,
} from "@cds/db";
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
import { bootSeededPb } from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({ header: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
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
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const SLUG = "testimonials";
const QUOTE_1 = "Gentle hands and a calm room.";
const QUOTE_2 = "Booked again the same week.";

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(): AddonDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    addons: ADDON_REGISTRY,
  };
}

const repoFor = (ctx: OrgContext) =>
  addonRepo(ctx, deps(), SLUG).collection(SLUG);

async function renderPage(host: string, path?: string[]): Promise<string> {
  state.header = host;
  const el = await TenantPage({ params: Promise.resolve({ host, path }) });
  return renderToStaticMarkup(el as ReactElement);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addons-site-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  state.header = null;
});

describe("add-on blocks on the tenant host (ADDON-04, ADDON-05, ADDON-08)", () => {
  it("install: /testimonials renders the owner's live published testimonials", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const res = await installAddon(ctx, deps(), SLUG);
    expect(res.page?.slug).toBe("testimonials");
    const repo = repoFor(ctx);
    await repo.save({ quote: QUOTE_1, author_name: "Ann" });
    await repo.save({ quote: QUOTE_2, author_name: "Bo" });

    const html = await renderPage("a.example.com", ["testimonials"]);
    expect(html).toContain(QUOTE_1);
    expect(html).toContain(QUOTE_2);
    expect(html).toMatch(/<h2[^>]*>What people say<\/h2>/);
    expect(html.match(/<h1/g)?.length).toBe(1);
    // Visitor reads stay in the org: B's seeded quote never shows on A.
    expect(html).not.toContain("Kind words for org B.");

    // A Testimonials block placed on the home page, above a text block.
    const home = seed.A.page;
    await saveSection(ctx, SECTION_REGISTRY, {
      pageId: home,
      section_type: "testimonials",
      row_layout: "full",
      content: {
        heading: "Home quotes",
        layout: "grid",
        show: "all",
        limit: 6,
      },
      afterId: null,
    });
    await saveSection(ctx, SECTION_REGISTRY, {
      pageId: home,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "About A", text: "<p>Welcome</p>" },
    });
    expect((await publishPage(ctx, home, deps())).status).toBe("published");
    const homeHtml = await renderPage("a.example.com");
    expect(homeHtml).toContain(QUOTE_1);
    expect(homeHtml).toMatch(/<h2[^>]*>Home quotes<\/h2>/);
    expect(homeHtml.match(/<h1/g)?.length).toBe(1);
  });

  it("uninstall: the seeded page 404s and the home block draws nothing", async (t) => {
    if (!inst) return t.skip();
    expect((await uninstallAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "removed",
    );
    await expect(renderPage("a.example.com", ["testimonials"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    const homeHtml = await renderPage("a.example.com");
    expect(homeHtml).not.toContain(QUOTE_1);
    expect(homeHtml).not.toContain("Home quotes");
    // Home still renders, with exactly one h1; the next block keeps its h2.
    expect(homeHtml).toMatch(/<h2[^>]*>About A<\/h2>/);
    expect(homeHtml.match(/<h1/g)?.length).toBe(1);
  });

  it("reinstall: the same quotes render again", async (t) => {
    if (!inst) return t.skip();
    expect((await installAddon(seed.ctxA, deps(), SLUG)).outcome).toBe(
      "reinstalled",
    );
    const html = await renderPage("a.example.com", ["testimonials"]);
    expect(html).toContain(QUOTE_1);
    expect(html).toContain(QUOTE_2);
    const homeHtml = await renderPage("a.example.com");
    expect(homeHtml).toMatch(/<h2[^>]*>Home quotes<\/h2>/);
    expect(homeHtml.match(/<h1/g)?.length).toBe(1);
  });

  it("an empty Testimonials block is absent and the page keeps exactly one h1", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxB;
    await installAddon(ctx, deps(), SLUG);
    const repo = repoFor(ctx);
    for (const r of await repo.list()) {
      if (r.is_published === true) await repo.setPublished(r.id, false);
    }
    const home = seed.B.page;
    await saveSection(ctx, SECTION_REGISTRY, {
      pageId: home,
      section_type: "testimonials",
      row_layout: "full",
      content: {
        heading: "Empty quotes",
        layout: "grid",
        show: "all",
        limit: 6,
      },
      afterId: null,
    });
    await saveSection(ctx, SECTION_REGISTRY, {
      pageId: home,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "About B", text: "<p>Hi</p>" },
    });
    expect((await publishPage(ctx, home, deps())).status).toBe("published");
    const html = await renderPage("b.example.com");
    expect(html).not.toContain("Empty quotes");
    expect(html).not.toContain("<blockquote");
    expect(html).toMatch(/<h2[^>]*>About B<\/h2>/);
    expect(html.match(/<h1/g)?.length).toBe(1);
  });
});
