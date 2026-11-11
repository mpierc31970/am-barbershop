// Phase 7 exit (07-33 Task 2; CONT-13, CONT-15, CONT-20, CONT-28, CONT-33, CONT-37; D188,
// D237; the relay table in 07-33-PLAN): one seeded, themed tenant on the custom host
// blocks.localhost, built by seedBlocksTenant (the same fixture the --blocks CLI and the
// Lighthouse runner use), rendered by Host header through the real route tree against the
// PocketBase 0.39.11 binary. Proves every block's markup, one H1 per page, one JSON-LD
// @graph, canonical + icons, consent (nothing third-party before consent), every media URL
// through MediaDelivery (app) and the Bunny adapter's pull-zone URLs, the chrome, the index
// routes, the password gate, the 404, forms (including a soft-deleted one) and an
// idempotent re-seed.
//
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
// next/headers supplies the middleware header, the client IP and a cookie jar per case;
// next/navigation throws sentinels; next/cache is a passthrough.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { PROVIDER_FRAME_HOSTS } from "@cds/core/content";
import { importThemeDir } from "@cds/core/theme/import";
import {
  appDelivery,
  clearResolverCache,
  createBunnyDelivery,
  listLibrary,
  listSections,
  listSiteSettingsVersions,
  listSubmissions,
  getForm,
  orgContextFromToken,
  resolvePublicMedia,
  signInMember,
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
import { thirdPartyLoads } from "../../../packages/ui/src/test-support/consent-scan";
import {
  BLOCKS_FIXTURE,
  BLOCKS_HOST,
  BLOCKS_NAME,
  BLOCKS_OWNER_EMAIL,
  seedBlocksTenant,
  type BlocksSeedResult,
} from "../../../packages/db/test/blocks-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { resetPageGateLimitsForTests } from "../../../packages/db/test/forms-seed";
import { bootSeededPb, orgRowIds } from "../../../packages/db/test/seeded";

type Dom = { window: { document: Document } };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => Dom;
};

const state = vi.hoisted(() => ({
  header: null as string | null,
  ip: "203.0.113.33",
  jar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(state.header === null ? {} : { "x-cds-tenant-host": state.header }),
      "x-real-ip": state.ip,
    }),
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
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
const { default: TenantLayout, generateMetadata: layoutMetadata } =
  await import("../app/tenant/[host]/layout");
const { default: RootLayout } = await import("../app/layout");
const notFoundModule = await import("../app/tenant/[host]/not-found");
const siteRoute = await import("../app/tenant/[host]/%5Fsite/[file]/route");
const mediaRoute =
  await import("../app/tenant/[host]/%5Fmedia/[id]/[variant]/route");
const robotsRoute = await import("../app/tenant/[host]/robots.txt/route");
const sitemapRoute = await import("../app/tenant/[host]/sitemap.xml/route");
const llmsRoute = await import("../app/tenant/[host]/llms.txt/route");
const searchModule = await import("../app/tenant/[host]/search/page");
const gateRoute = await import("../app/tenant/[host]/api/gate/[pageId]/route");
const formsRoute =
  await import("../app/tenant/[host]/api/forms/[formId]/route");
const { siteForRoute } = await import("../lib/tenant");

const HOST = BLOCKS_HOST;
const OWNER_PW = `owner-${Math.random().toString(36).slice(2)}-pw`;
const PAGE_PW = `page-${Math.random().toString(36).slice(2)}-pw`;
const FAKE_PULL_ZONE = "cdn-blocks.b-cdn.net";
const PUBLIC_PAGES = ["home", "gallery", "visit"] as const;
type PublicKey = (typeof PUBLIC_PAGES)[number];
const PATHS: Record<PublicKey, string[] | undefined> = {
  home: undefined,
  gallery: ["gallery"],
  visit: ["visit"],
};

let inst: PbInstance | null = null;
let privDir = "";
let pubDir = "";
let design: unknown;
let seeded: BlocksSeedResult;
let ctx: OrgContext;
const libraryIds = new Set<string>();
const html = {} as Record<PublicKey, string>;

function dom(markup: string): Document {
  return new JSDOM(markup).window.document;
}

/** Root layout > tenant layout > tenant page, exactly as the route tree nests them. */
async function renderFull(
  path?: string[],
  sp?: Record<string, string>,
): Promise<string> {
  state.header = HOST;
  const page = await TenantPage({
    params: Promise.resolve({ host: HOST, path }),
    ...(sp ? { searchParams: Promise.resolve(sp) } : {}),
  });
  const site = await TenantLayout({
    children: page as ReactElement,
    params: Promise.resolve({ host: HOST }),
  });
  const root = await RootLayout({ children: site as ReactElement });
  return renderToStaticMarkup(root as ReactElement);
}

async function meta(path?: string[]) {
  state.header = HOST;
  return pageModule.generateMetadata({
    params: Promise.resolve({ host: HOST, path }),
  });
}

async function render404(): Promise<string> {
  state.header = HOST;
  const el = await notFoundModule.default();
  return renderToStaticMarkup(el as ReactElement);
}

type HostRoute = {
  GET: (
    req: Request,
    ctx: { params: Promise<{ host: string }> },
  ) => Promise<Response>;
};

async function routeText(mod: HostRoute, path: string): Promise<string> {
  state.header = HOST;
  const res = await mod.GET(new Request(`https://${HOST}${path}`), {
    params: Promise.resolve({ host: HOST }),
  });
  expect(res.status, path).toBe(200);
  return res.text();
}

async function search(q: string): Promise<string> {
  state.header = HOST;
  const el = await searchModule.default({
    params: Promise.resolve({ host: HOST }),
    searchParams: Promise.resolve({ q }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

async function fetchMedia(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  state.header = HOST;
  const u = new URL(url, `https://${HOST}`);
  const [, , id, variant] = u.pathname.split("/");
  return mediaRoute.GET(new Request(u, { headers }), {
    params: Promise.resolve({ host: HOST, id: id!, variant: variant! }),
  });
}

/** Every src, srcset candidate, poster and media-looking href in the markup. */
function mediaUrls(doc: Document): string[] {
  const out: string[] = [];
  for (const el of doc.querySelectorAll("[src]")) {
    out.push(el.getAttribute("src")!);
  }
  for (const el of doc.querySelectorAll("[srcset]")) {
    for (const c of el.getAttribute("srcset")!.split(",")) {
      const u = c.trim().split(/\s+/)[0];
      if (u) out.push(u);
    }
  }
  for (const el of doc.querySelectorAll("[poster]")) {
    out.push(el.getAttribute("poster")!);
  }
  for (const el of doc.querySelectorAll("[href]")) {
    const href = el.getAttribute("href")!;
    if (/_media|_site|\.(jpe?g|png|webp|mp4|mp3)(\?|$)/i.test(href)) {
      out.push(href);
    }
  }
  return out;
}

function jsonLd(doc: Document): string[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].map(
    (s) => s.textContent ?? "",
  );
}

type GraphNode = Record<string, unknown>;
function graphOf(doc: Document): GraphNode[] {
  const scripts = jsonLd(doc);
  expect(scripts).toHaveLength(1);
  return (JSON.parse(scripts[0]!) as { "@graph": GraphNode[] })["@graph"];
}

function sectionMarkup(doc: Document): Element {
  const main = doc.querySelector("main#content");
  expect(main).not.toBeNull();
  return main!;
}

function setCookieFrom(res: Response): { name: string; value: string } {
  const raw = res.headers.get("set-cookie")!;
  const [pair] = raw.split(";");
  const i = pair!.indexOf("=");
  return { name: pair!.slice(0, i), value: pair!.slice(i + 1) };
}

async function postForm(formId: string, itemId: string): Promise<Response> {
  const form = await getForm(ctx, formId);
  const fields: Record<string, string> = {
    website_url: "",
    _started: String(Date.now() - 5_000),
    _item: itemId,
  };
  for (const f of form.fields) {
    if (f.type === "email") fields[f.id] = "maria@example.com";
    else if (f.type === "name" || f.type === "short_text") {
      fields[f.id] = "Maria Lopez";
    } else if (f.type === "long_text") fields[f.id] = "A cake for 20, please.";
    else if (f.type === "phone") fields[f.id] = "5125550100";
  }
  state.header = HOST;
  state.ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  const req = new Request(`https://${HOST}/api/forms/${formId}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(fields).toString(),
  });
  return formsRoute.POST(req, {
    params: Promise.resolve({ host: HOST, formId }),
  });
}

async function seed(): Promise<BlocksSeedResult> {
  return seedBlocksTenant(
    { ownerPassword: OWNER_PW, pagePassword: PAGE_PW, design },
    { registry: ADDON_REGISTRY },
  );
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-blocks-exit-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-blocks-exit-pub-"));
  vi.stubEnv("CDS_STORAGE_DIR", privDir);
  vi.stubEnv("CDS_PUBLIC_STORAGE_DIR", pubDir);
  vi.stubEnv("CDS_ENV", "dev");
  vi.stubEnv("CDS_VIDEO_TRANSCODER", "fake");
  vi.stubEnv("CDS_MEDIA_TOKEN_SECRET", "blocks-exit-".padEnd(48, "s"));
  vi.stubEnv("CDS_MEDIA_CDN", "");
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  design = importThemeDir("design/tenants/demo", {
    root: join(import.meta.dirname, "../../.."),
  }).design;
  seeded = await seed();
  const { token } = await signInMember(
    BLOCKS_OWNER_EMAIL,
    OWNER_PW,
    "203.0.113.9",
  );
  ctx = await orgContextFromToken(token, seeded.orgId, "203.0.113.9");
  for (let page = 1; ; page += 1) {
    const res = await listLibrary(ctx, { page, perPage: 100 });
    for (const a of res.items) libraryIds.add(a.id);
    if (res.items.length < 100) break;
  }
  clearResolverCache();
  for (const key of PUBLIC_PAGES) html[key] = await renderFull(PATHS[key]);
}, 180_000);

afterAll(async () => {
  await inst?.stop();
  vi.unstubAllEnvs();
  rmSync(privDir, { recursive: true, force: true });
  rmSync(pubDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  resetPageGateLimitsForTests();
  state.header = null;
  state.jar.clear();
});

describe("Phase 7 exit: the every-block tenant on blocks.localhost", () => {
  it("the host is custom + primary, so pages index (07-30 relay)", async (t) => {
    if (!inst) return t.skip();
    state.header = HOST;
    const site = await siteForRoute(HOST);
    expect(site?.hostKind).toBe("custom");
    expect(site?.primaryHost).toBe(HOST);
    expect(await orgRowIds("org_hosts", seeded.orgId)).toHaveLength(1);
  });

  it("home renders the text and data blocks", async (t) => {
    if (!inst) return t.skip();
    const doc = dom(html.home);
    const main = sectionMarkup(doc);
    const text = main.textContent ?? "";
    // hero, text-only, text-image, columns items
    expect(text).toContain("Bread worth getting up for");
    expect(text).toContain("Our story");
    expect(text).toContain("Slow dough, big flavor");
    expect(main.querySelector("h2, h3")).not.toBeNull();
    expect(text).toContain("Our grand reopening");
    expect([...main.querySelectorAll("li")].map((l) => l.textContent)).toEqual(
      expect.arrayContaining(["Sourdough", "Rye", "Croissants"]),
    );
    expect(main.querySelector("hr")).not.toBeNull();
    expect(text).toContain("See the gallery");
    expect(main.querySelector('a[href="/gallery"]')).not.toBeNull();
    expect(main.innerHTML).toMatch(/countdown/i);
    // tabs
    expect(main.querySelector("[data-cds-tabs]")).not.toBeNull();
    expect(main.querySelector('[role="tablist"]')).not.toBeNull();
    // table with a header row and a link cell
    const table = main.querySelector("table")!;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("th").length).toBeGreaterThan(0);
    expect(
      table.querySelector('a[href="https://example.com/order"]'),
    ).not.toBeNull();
    // 10-44: Builder Pro is on, so the table is a Pro table (sort + search island)
    expect(main.innerHTML).toContain("data-table-pro");
    // FAQ, icon list, stats (final numbers in SSR), CTA banner
    expect(main.querySelectorAll("details")).toHaveLength(3);
    expect(text).toContain("Why people come back");
    expect(text).toContain("Local flour");
    expect(text).toContain("1,200");
    expect(text).toContain("4.9");
    expect(text).toContain("Years baking");
    expect(text).toContain("Order a cake");
    expect(text).toContain("Get in touch");
  });

  it("gallery renders slider, gallery pages, logos, MP4 and audio", async (t) => {
    if (!inst) return t.skip();
    const doc = dom(html.gallery);
    const main = sectionMarkup(doc);
    const slider = main.querySelector("[data-cds-slider]")!;
    expect(slider).not.toBeNull();
    expect(slider.querySelectorAll("[data-slide]")).toHaveLength(3);
    expect(main.querySelector("[data-slider-controls]")).not.toBeNull();
    expect(main.querySelectorAll("[data-gallery-photo]")).toHaveLength(12);
    expect(
      main.querySelector('nav[aria-label="Gallery pages"]'),
    ).not.toBeNull();
    const sections = await listSections(ctx, seeded.pages.gallery);
    const galleryId = sections.find((s) => s.section_type === "gallery")!.id;
    expect(main.querySelector(`#gallery-${galleryId}`)).not.toBeNull();
    const page2 = dom(
      await renderFull(["gallery"], { [`g${galleryId}`]: "2" }),
    );
    expect(page2.querySelectorAll("[data-gallery-photo]")).toHaveLength(2);
    // logo strip: 4 logos, one linked
    const logoImgs = [...main.querySelectorAll("img")].filter((i) =>
      BLOCKS_FIXTURE.logoNames.some((n) => (i.getAttribute("alt") ?? "") === n),
    );
    expect(logoImgs).toHaveLength(4);
    expect(
      main.querySelectorAll('a[href="https://example.com/grain"]'),
    ).toHaveLength(1);
    // MP4 with a poster; audio element
    const videos = [...main.querySelectorAll("video")];
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.some((v) => v.getAttribute("poster"))).toBe(true);
    expect(main.querySelector("audio")).not.toBeNull();
    // the click pop-up's dialog holds the MP4 (07-23: every video carries the popup-play hook)
    const dialog = doc.querySelector("dialog[data-cds-popup]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("video[data-cds-popup-play]")).not.toBeNull();
  });

  it("visit renders forms, map, hours, social and consent placeholders", async (t) => {
    if (!inst) return t.skip();
    const doc = dom(html.visit);
    const main = sectionMarkup(doc);
    expect(html.visit).not.toContain("output=embed");
    expect(main.textContent).toContain("1200 South Congress Ave");
    expect(main.textContent).toContain("Opening hours");
    expect(main.querySelector("table, dl")).not.toBeNull();
    // 10-44: "Contact us" is a two-step Pro form (no-JS markup: every step shows)
    expect(main.querySelectorAll("fieldset[data-step]")).toHaveLength(2);
    expect(
      main.querySelector('fieldset[data-step="step-you"] legend h3')
        ?.textContent,
    ).toBe("About you");
    expect(
      main.querySelector('a[href="https://instagram.com/blocksbakery"]'),
    ).not.toBeNull();
    expect(
      main.querySelector('a[href="https://facebook.com/blocksbakery"]'),
    ).not.toBeNull();
    expect(main.textContent).toMatch(/share/i);
    const forms = [...main.querySelectorAll("form")].map((f) =>
      f.getAttribute("action"),
    );
    expect(forms).toContain(`/api/forms/${seeded.formId}`);
    expect(forms).toContain(`/api/forms/${seeded.deletedFormId}`);
    for (const f of main.querySelectorAll("form")) {
      for (const host of PROVIDER_FRAME_HOSTS) {
        expect(f.outerHTML).not.toContain(host);
      }
    }
    // Calendly and YouTube sit behind consent placeholders, no frame yet
    expect(main.querySelector("iframe")).toBeNull();
    expect(main.textContent).toContain("Book a tasting");
    expect(main.textContent).toContain("Plays from YouTube");
  });

  it("exactly one H1 per page (07-05 relay)", async (t) => {
    if (!inst) return t.skip();
    const home = dom(html.home).querySelectorAll("h1");
    expect(home).toHaveLength(1);
    expect(home[0]!.textContent).toBe("Bread worth getting up for");
    for (const key of ["gallery", "visit"] as const) {
      const h1s = dom(html[key]).querySelectorAll("h1");
      expect(h1s, key).toHaveLength(1);
      expect(h1s[0]!.hasAttribute("data-page-title"), key).toBe(true);
      expect(h1s[0]!.textContent).toBe(BLOCKS_FIXTURE.pages[key].title);
    }
    const gate = dom(await renderFull(["members"])).querySelectorAll("h1");
    expect(gate).toHaveLength(1);
    expect(gate[0]!.textContent).toContain("Members");
    const nf = dom(await render404()).querySelectorAll("h1");
    expect(nf).toHaveLength(1);
    expect(nf[0]!.textContent).toBe("Oops, that page has gone stale");
  });

  it("on-theme: theme variables, no raw colours in section markup", async (t) => {
    if (!inst) return t.skip();
    for (const key of PUBLIC_PAGES) {
      const doc = dom(html[key]);
      expect(doc.querySelector("[data-site]"), key).not.toBeNull();
      const css = [...doc.querySelectorAll("style")]
        .map((s) => s.textContent)
        .join("\n");
      expect(css, key).toMatch(/--site-[a-z-]+:/);
      for (const el of sectionMarkup(doc).querySelectorAll("[style]")) {
        expect(el.getAttribute("style"), key).not.toMatch(
          /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i,
        );
      }
    }
  });

  it("JSON-LD: one escaped @graph with the business, FAQ and video", async (t) => {
    if (!inst) return t.skip();
    for (const key of PUBLIC_PAGES) {
      const doc = dom(html[key]);
      const raw = jsonLd(doc)[0] ?? "";
      expect(raw, key).not.toContain("</");
      const graph = graphOf(doc);
      const biz = graph.find((n) => n["@type"] === "Bakery");
      expect(biz, key).toBeDefined();
      expect(biz!.sameAs).toEqual(
        expect.arrayContaining([
          "https://instagram.com/blocksbakery",
          "https://facebook.com/blocksbakery",
        ]),
      );
      expect(JSON.stringify(biz!.makesOffer)).toContain("Weekly bread box");
      expect(JSON.stringify(biz!.makesOffer)).toContain(
        "Custom celebration cake",
      );
      expect(JSON.stringify(biz!.employee)).toContain("Ana Rivera");
      expect(JSON.stringify(biz!.employee)).toContain("Sam Ortiz");
    }
    const home = graphOf(dom(html.home));
    const faq = home.find((n) => n["@type"] === "FAQPage")!;
    expect(faq).toBeDefined();
    expect(faq.mainEntity as unknown[]).toHaveLength(3);
    const gallery = graphOf(dom(html.gallery));
    const video = gallery.find((n) => n["@type"] === "VideoObject")!;
    expect(video).toBeDefined();
    expect(video.name).toBe("How we bake our sourdough");
  });

  it("head: canonical on blocks.localhost, indexable, icons resolve", async (t) => {
    if (!inst) return t.skip();
    const home = await meta();
    expect(home.alternates?.canonical).toBe(`https://${HOST}/`);
    const gallery = await meta(["gallery"]);
    expect(gallery.alternates?.canonical).toBe(`https://${HOST}/gallery`);
    for (const p of [undefined, ["gallery"], ["visit"]]) {
      expect((await meta(p)).robots).toEqual({ index: true, follow: true });
    }
    state.header = HOST;
    const lm = await layoutMetadata({
      params: Promise.resolve({ host: HOST }),
    });
    const icons = lm.icons as {
      icon: { url: string }[];
      apple: { url: string }[];
    };
    const urls = [...icons.icon, ...icons.apple].map((i) => i.url);
    expect(urls.length).toBe(3);
    for (const url of urls) {
      expect(url.startsWith("/_site/")).toBe(true);
      const u = new URL(url, `https://${HOST}`);
      const file = u.pathname.slice("/_site/".length);
      state.header = HOST;
      const res = await siteRoute.GET(new Request(u), {
        params: Promise.resolve({ host: HOST, file }),
      });
      expect(res.status, url).toBe(200);
    }
  });

  it("consent: nothing third-party loads before consent", async (t) => {
    if (!inst) return t.skip();
    for (const key of PUBLIC_PAGES) {
      expect(thirdPartyLoads(html[key]), key).toEqual([]);
      for (const el of dom(html[key]).querySelectorAll("[src]")) {
        const src = el.getAttribute("src")!;
        for (const host of PROVIDER_FRAME_HOSTS) {
          expect(src, key).not.toContain(host);
        }
      }
    }
  });

  it("media: every URL through MediaDelivery; the route serves them", async (t) => {
    if (!inst) return t.skip();
    const all: string[] = [];
    for (const key of PUBLIC_PAGES) {
      for (const url of mediaUrls(dom(html[key]))) {
        expect(url, key).not.toMatch(/\/hub\/media|\.storage|tenants\//);
        if (url.startsWith("/_site/")) continue;
        if (url.startsWith("data:")) continue;
        const m = /^\/_media\/([a-z0-9]{15})\/([a-z0-9.-]+)(\?.*)?$/.exec(url);
        expect(m, `${key}: ${url}`).not.toBeNull();
        expect(libraryIds.has(m![1]!), `${key}: ${url}`).toBe(true);
        all.push(url);
      }
    }
    expect(all.length).toBeGreaterThan(20);
    const photo = all.find((u) => u.includes(seeded.assets.photos[0]!))!;
    const logo = all.find((u) => u.includes(seeded.assets.logos[0]!))!;
    const audio = all.find((u) => u.includes(seeded.assets.audio))!;
    for (const u of [photo, logo, audio]) {
      expect((await fetchMedia(u)).status, u).toBe(200);
    }
    const mp4 = all.find(
      (u) => u.includes(seeded.assets.video) && u.includes(".mp4"),
    )!;
    expect(mp4).toBeDefined();
    const ranged = await fetchMedia(mp4, { range: "bytes=0-99" });
    expect(ranged.status).toBe(206);
  });

  it("media: the Bunny adapter gives pull-zone URLs for the same assets", async (t) => {
    if (!inst) return t.skip();
    state.header = HOST;
    const site = (await siteForRoute(HOST))!;
    expect(site).not.toBeNull();
    const ids = [
      ...seeded.assets.photos,
      ...seeded.assets.logos,
      seeded.assets.video,
      seeded.assets.audio,
    ];
    const resolved = await resolvePublicMedia(site, ids, {
      delivery: createBunnyDelivery({
        env: {
          BUNNY_PULL_ZONE_HOST: FAKE_PULL_ZONE,
          BUNNY_TOKEN_KEY: "fake-token-key",
          BUNNY_API_KEY: "fake-api-key",
        },
        privateDelivery: appDelivery,
      }),
    });
    for (const id of ids) {
      const r = resolved[id];
      expect(r, id).toBeDefined();
      expect(r!.src.startsWith(`https://${FAKE_PULL_ZONE}/`), r!.src).toBe(
        true,
      );
      expect(r!.src).toContain(id);
    }
  });

  it("chrome: language, menu, footer, translate and search links", async (t) => {
    if (!inst) return t.skip();
    for (const key of PUBLIC_PAGES) {
      const doc = dom(html[key]);
      expect(doc.documentElement.getAttribute("lang"), key).toBe("es");
      const nav = doc.querySelector('nav[aria-label="Main"]')!;
      expect(nav, key).not.toBeNull();
      expect(nav.textContent).toContain("About");
      expect(nav.querySelector('a[href="/members"]')).not.toBeNull();
      expect(
        nav.querySelector('a[href="https://example.com/order"]'),
      ).not.toBeNull();
      expect(doc.querySelector('header a[href="/visit"]')).not.toBeNull();
      const footer = doc.querySelector("footer")!;
      expect(
        footer.querySelector('a[href="https://example.com/press"]'),
      ).not.toBeNull();
      expect(footer.textContent).toMatch(/Report/);
      expect(html[key]).not.toContain("translate.google.com");
      expect(html[key]).toMatch(/Translate/);
      expect(
        doc.querySelector('a[aria-label="Search this site"][href="/search"]'),
      ).not.toBeNull();
    }
    // Consent needs are site-wide (07-14 choice 3): visit has third-party frames, so the
    // banner is mounted on every page of this site.
    expect(html.visit).toContain("Cookie");
  });

  it("nav history: two versions, one current (07-29 relay)", async (t) => {
    if (!inst) return t.skip();
    const versions = await listSiteSettingsVersions(ctx, "nav");
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.filter((v) => v.current)).toHaveLength(1);
  });

  it("index routes: robots, sitemap, llms and search", async (t) => {
    if (!inst) return t.skip();
    const robots = await routeText(robotsRoute, "/robots.txt");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots.trimEnd()).toMatch(
      new RegExp(
        `Sitemap: https?://${HOST.replace(".", "\\.")}/sitemap\\.xml$`,
      ),
    );
    const sitemap = await routeText(sitemapRoute, "/sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      (m) => new URL(m[1]!).pathname,
    );
    expect(locs).toEqual(expect.arrayContaining(["/", "/gallery", "/visit"]));
    expect(locs).not.toContain("/members");
    expect(locs.some((l) => l.includes("system-404"))).toBe(false);
    const llms = await routeText(llmsRoute, "/llms.txt");
    expect(llms.startsWith(`# ${BLOCKS_NAME}`)).toBe(true);
    const found = await search(BLOCKS_FIXTURE.words.faq);
    expect(found).toContain('href="/"');
    const sourdough = await search("sourdough");
    expect(sourdough).toContain('href="/"');
    const hidden = dom(await search(BLOCKS_FIXTURE.words.protectedOnly));
    expect(hidden.querySelector('a[href="/members"]')).toBeNull();
    expect(hidden.body.textContent).toMatch(/0 results|No results|no pages/i);
  });

  it("gate: no page content, noindex; the cookie unlocks with tokenized media", async (t) => {
    if (!inst) return t.skip();
    expect(BLOCKS_FIXTURE.words.protectedOnly).toBe("quokka");
    const locked = await renderFull(["members"]);
    expect(locked).toContain("data-cds-gate");
    expect(locked).not.toContain(BLOCKS_FIXTURE.words.protectedOnly);
    expect(locked).not.toContain("Members corner");
    const m = await meta(["members"]);
    expect(m.robots).toEqual({ index: false, follow: true });
    state.header = HOST;
    const res = await gateRoute.POST(
      new Request(`https://${HOST}/api/gate/${seeded.pages.members}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `password=${encodeURIComponent(PAGE_PW)}`,
      }),
      { params: Promise.resolve({ host: HOST, pageId: seeded.pages.members }) },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const c = setCookieFrom(res);
    state.jar.set(c.name, c.value);
    const open = await renderFull(["members"]);
    expect(open).toContain(BLOCKS_FIXTURE.words.protectedOnly);
    for (const url of mediaUrls(dom(open))) {
      if (!url.startsWith("/_media/")) continue;
      expect(url).toMatch(/[?&]e=/);
      expect(url).toMatch(/[?&]t=/);
    }
  });

  it("404: unknown paths and /system-404; the edited page with Popular pages", async (t) => {
    if (!inst) return t.skip();
    await expect(renderFull(["no-such-page"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(renderFull(["system-404"])).rejects.toThrow("NEXT_NOT_FOUND");
    const doc = dom(await render404());
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.body.textContent).toContain("Oops, that page has gone stale");
    expect(doc.body.textContent).toContain("Popular pages");
    expect(doc.querySelector('a[href="/"]')).not.toBeNull();
    expect(
      doc.querySelector('form[role="search"][action="/search"]'),
    ).not.toBeNull();
  });

  it("forms: the main and the soft-deleted form accept a JSON post", async (t) => {
    if (!inst) return t.skip();
    const before = (await listSubmissions(ctx)).totalItems;
    const main = await postForm(seeded.formId, "visit-form");
    expect(main.status).toBe(200);
    const old = await postForm(seeded.deletedFormId, "visit-form-old");
    expect(old.status).toBe(200);
    const after = await listSubmissions(ctx);
    expect(after.totalItems).toBe(before + 2);
    const forms = after.items.map((i) => i.form);
    expect(forms).toContain(seeded.formId);
    expect(forms).toContain(seeded.deletedFormId);
  });

  it("re-seed is idempotent: same org, host, pages and sections", async (t) => {
    if (!inst) return t.skip();
    const sectionsBefore = await orgRowIds("page_sections", seeded.orgId);
    const mediaBefore = await orgRowIds("media_assets", seeded.orgId);
    // The same call the CLI makes on a second run.
    const again = await seedBlocksTenant(
      { ownerPassword: OWNER_PW, pagePassword: PAGE_PW, design },
      { registry: ADDON_REGISTRY },
    );
    expect(again.orgId).toBe(seeded.orgId);
    expect(again.created).toBe(false);
    expect(again.pages).toEqual(seeded.pages);
    expect(again.formId).toBe(seeded.formId);
    expect(again.deletedFormId).toBe(seeded.deletedFormId);
    expect(again.assets.photos).toEqual(seeded.assets.photos);
    expect(await orgRowIds("org_hosts", seeded.orgId)).toHaveLength(1);
    expect(await orgRowIds("page_sections", seeded.orgId)).toEqual(
      sectionsBefore,
    );
    expect(await orgRowIds("media_assets", seeded.orgId)).toHaveLength(
      mediaBefore.length,
    );
  }, 120_000);
});
