// 07-30 Task 2 (CONT-13, CONT-14, CONT-28; D170, D188, D235; Pitfalls 9, 15; T-07-30-01,
// T-07-30-03, T-07-30-05, T-07-30-11): tenant SEO against the real PocketBase 0.39.11 binary.
// Canonical from the org's primary host (never the Host header), robots by host kind, one
// escaped JSON-LD graph, the Open Graph share image chain, icon links and /_site delivery.
//
// next/headers supplies the middleware header per case; next/navigation throws sentinels;
// next/cache is a passthrough (every read goes to PB and the object stores).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  createPage,
  publishPage,
  recordingInvalidator,
  refreshSiteIcons,
  saveSection,
  saveSiteSettings,
  updatePage,
  uploadLibraryImage,
  type PublishDeps,
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
import {
  pngBytes,
  seedHost,
  setBusinessProfile,
  setOrgName,
} from "../../../packages/db/test/seo-seed";

const state = vi.hoisted(() => ({ header: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
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

const pageModule = await import("../app/tenant/[host]/[[...path]]/page");
const TenantPage = pageModule.default;
const layoutModule = await import("../app/tenant/[host]/layout");
const siteRoute = await import("../app/tenant/[host]/%5Fsite/[file]/route");
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let inst: PbInstance | null = null;
let seed: TwoOrgs;
let privDir = "";
let pubDir = "";
let aboutId = "";

const HOST_A = "a.example.com";
const PREVIEW_A = "a-preview.example.com";
const HOST_B = "b.example.com";
const EVIL = "Rivera </script><script>alert(1)</script> & Co";

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  } as PublishDeps;
}

async function meta(host: string, path?: string[]) {
  state.header = host;
  return pageModule.generateMetadata({
    params: Promise.resolve({ host, path }),
  });
}

async function render(host: string, path?: string[]): Promise<string> {
  state.header = host;
  const el = await TenantPage({ params: Promise.resolve({ host, path }) });
  return renderToStaticMarkup(el as ReactElement);
}

function jsonLdScripts(html: string): string[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => m[1]!);
}

function ogImage(m: Awaited<ReturnType<typeof meta>>): string | undefined {
  const images = m.openGraph?.images;
  const first = Array.isArray(images) ? images[0] : images;
  if (!first) return undefined;
  return typeof first === "string"
    ? first
    : String((first as { url: string | URL }).url);
}

async function layoutMeta(host: string) {
  state.header = host;
  return layoutModule.generateMetadata({ params: Promise.resolve({ host }) });
}

async function siteFile(host: string, file: string, v?: string) {
  state.header = host;
  const url = new URL(`/_site/${file}${v ? `?v=${v}` : ""}`, `https://${host}`);
  return siteRoute.GET(new Request(url), {
    params: Promise.resolve({ host, file }),
  });
}

async function republish(pageId: string): Promise<void> {
  await publishPage(seed.ctxA, pageId, deps());
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-tenant-seo-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-tenant-seo-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  await seedHost(seed.A.org, PREVIEW_A, "preview");
  await setOrgName(seed.A.org, EVIL);
  await setBusinessProfile(seed.A.org, { business_type: "bakery" });

  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: seed.A.page,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Welcome", text: "<p>Fresh bread every morning.</p>" },
  });
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: seed.A.page,
    section_type: "faq",
    row_layout: "full",
    content: {
      heading: "Questions",
      open_first: false,
      items: [
        { id: "q1", question: "Open Sundays?", answer: "<p>Yes, 8 to 2.</p>" },
      ],
    },
  });
  await republish(seed.A.page);

  const about = await createPage(seed.ctxA, {
    title: "About us",
    slug: "about-us",
  });
  aboutId = about.id;
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: aboutId,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Our story", text: "<p>Since 1990.</p>" },
  });
  await republish(aboutId);
});

afterAll(async () => {
  await inst?.stop();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(privDir, { recursive: true, force: true });
  rmSync(pubDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  state.header = null;
});

describe("canonical and robots (D170, Pitfall 9)", () => {
  it("canonical is the primary host, on every host; home is /", async (t) => {
    if (!inst) return t.skip();
    const custom = await meta(HOST_A, ["about-us"]);
    expect(custom.alternates?.canonical).toBe("https://a.example.com/about-us");
    const preview = await meta(PREVIEW_A, ["about-us"]);
    expect(preview.alternates?.canonical).toBe(
      "https://a.example.com/about-us",
    );
    expect(String(preview.alternates?.canonical)).not.toContain("?");
    const home = await meta(PREVIEW_A);
    expect(home.alternates?.canonical).toBe("https://a.example.com/");
  });

  it("preview hosts are noindex, nofollow; custom hosts index", async (t) => {
    if (!inst) return t.skip();
    expect((await meta(PREVIEW_A, ["about-us"])).robots).toEqual({
      index: false,
      follow: false,
    });
    expect((await meta(HOST_A, ["about-us"])).robots).toEqual({
      index: true,
      follow: true,
    });
  });

  it("titles and descriptions fall back to the suggestions", async (t) => {
    if (!inst) return t.skip();
    const m = await meta(HOST_A, ["about-us"]);
    expect(m.title).toBe(`About us | ${EVIL}`);
    expect(m.description).toBe("Since 1990.");
  });

  it("the empty-site placeholder is noindex and has no JSON-LD", async (t) => {
    if (!inst) return t.skip();
    const m = await meta(HOST_B);
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(jsonLdScripts(await render(HOST_B))).toHaveLength(0);
  });
});

describe("JSON-LD (CONT-13, Pitfall 15)", () => {
  it("one escaped @graph script with the business, FAQ and page", async (t) => {
    if (!inst) return t.skip();
    const html = await render(HOST_A);
    const scripts = jsonLdScripts(html);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toContain("<");
    expect(html).not.toContain("<script>alert(1)");
    const graph = JSON.parse(scripts[0]!) as {
      "@graph": Record<string, unknown>[];
    };
    const types = graph["@graph"].map((n) => n["@type"]);
    expect(types).toContain("Bakery");
    expect(types).toContain("WebPage");
    expect(types).toContain("FAQPage");
    expect(types).not.toContain("BreadcrumbList");
    const biz = graph["@graph"].find((n) => n["@type"] === "Bakery")!;
    expect(biz.name).toBe(EVIL);
    expect(biz["@id"]).toBe("https://a.example.com/#business");
    expect(biz.makesOffer).toBeDefined();
    expect(biz.employee).toBeDefined();
  });

  it("an inner page gets breadcrumbs on the canonical origin", async (t) => {
    if (!inst) return t.skip();
    const [script] = jsonLdScripts(await render(PREVIEW_A, ["about-us"]));
    const graph = JSON.parse(script!) as {
      "@graph": Record<string, unknown>[];
    };
    const page = graph["@graph"].find((n) => n["@type"] === "WebPage")!;
    expect(page.url).toBe("https://a.example.com/about-us");
    expect(graph["@graph"].some((n) => n["@type"] === "BreadcrumbList")).toBe(
      true,
    );
  });
});

describe("site icons and the share image chain (CONT-14, CONT-28)", () => {
  it("before generation: no icon links and /_site is 404", async (t) => {
    if (!inst) return t.skip();
    expect(await layoutMeta(HOST_A)).toEqual({});
    expect((await siteFile(HOST_A, "icon-32.png")).status).toBe(404);
  });

  it("generated: icon links with ?v= and the generated share image", async (t) => {
    if (!inst) return t.skip();
    const icons = await refreshSiteIcons(seed.ctxA);
    expect(icons?.source).toBe("wordmark");
    const v = icons!.v;
    const lm = await layoutMeta(HOST_A);
    const iconList = (lm.icons as { icon: { url: string; sizes: string }[] })
      .icon;
    expect(iconList.map((i) => i.url)).toEqual([
      `/_site/icon-32.png?v=${v}`,
      `/_site/icon-512.png?v=${v}`,
    ]);
    expect((lm.icons as { apple: { url: string }[] }).apple[0]!.url).toBe(
      `/_site/icon-180.png?v=${v}`,
    );
    expect(ogImage(await meta(HOST_A, ["about-us"]))).toBe(
      `https://a.example.com/_site/share.png?v=${v}`,
    );
  });

  it("/_site serves allowlisted files with the right cache, refuses the rest", async (t) => {
    if (!inst) return t.skip();
    const v = (await refreshSiteIcons(seed.ctxA))!.v;
    const hit = await siteFile(HOST_A, "icon-180.png", v);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toBe("image/png");
    expect(hit.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(hit.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await hit.arrayBuffer()).slice(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );
    const stale = await siteFile(HOST_A, "share.png", "000000000000");
    expect(stale.headers.get("cache-control")).toBe("public, max-age=300");
    for (const bad of ["manifest.json", "icon-64.png", "..%2Fx", "../x"]) {
      expect((await siteFile(HOST_A, bad)).status, bad).toBe(404);
    }
    expect((await siteFile(HOST_B, "icon-32.png")).status).toBe(404);
    expect((await siteFile("nobody.example.com", "icon-32.png")).status).toBe(
      404,
    );
  });

  it("og:image: site photo, then page link, then page photo", async (t) => {
    if (!inst) return t.skip();
    const sitePhoto = (
      await uploadLibraryImage(seed.ctxA, await pngBytes(1200, 630), {
        alt: "Shop front",
      })
    ).asset.id;
    await saveSiteSettings(seed.ctxA, deps(), { share_image: sitePhoto });
    const siteOg = ogImage(await meta(HOST_A, ["about-us"]));
    expect(siteOg).toContain(sitePhoto);
    expect(siteOg?.startsWith("https://a.example.com/")).toBe(true);

    await updatePage(seed.ctxA, aboutId, {
      seo: { og_image: "https://images.unsplash.com/photo-123" },
    });
    await republish(aboutId);
    expect(ogImage(await meta(HOST_A, ["about-us"]))).toBe(
      "https://images.unsplash.com/photo-123",
    );

    const pagePhoto = (
      await uploadLibraryImage(seed.ctxA, await pngBytes(1200, 630), {
        alt: "Loaves",
      })
    ).asset.id;
    await updatePage(seed.ctxA, aboutId, { seo: { share_image: pagePhoto } });
    await republish(aboutId);
    const m = await meta(HOST_A, ["about-us"]);
    expect(ogImage(m)).toContain(pagePhoto);
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
