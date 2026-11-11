// 07-31 Task 3 (CONT-13, CONT-15, CONT-28, CONT-37; D170, D277; T-07-31-01..04, -06, -09):
// the four index.json readers against the real PocketBase 0.39.11 binary, over both host
// kinds. robots.txt, sitemap.xml, llms.txt (route handlers) and /search (server page).
// Pages are published through the repository, so the hooks write index.json; one page gets a
// raw password (no republish), one a held republish, one the system-404 kind.
//
// next/headers supplies the middleware header per case; next/navigation throws sentinels;
// next/cache is a passthrough; getSiteIndex can be made to throw (state.failIndex).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalUrl } from "@cds/core/seo";
import {
  createPage,
  publishPage,
  recordingInvalidator,
  saveNav,
  saveSection,
  saveService,
  saveSiteSettings,
  type PublishDeps,
} from "@cds/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";
import {
  seedHost,
  setOrgName,
  setPageFields,
} from "../../../packages/db/test/seo-seed";

const state = vi.hoisted(() => ({
  header: null as string | null,
  failIndex: false,
}));

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

vi.mock("../lib/site-cache", async (orig) => {
  const real = await orig<typeof import("../lib/site-cache")>();
  return {
    ...real,
    getSiteIndex: (site: Parameters<typeof real.getSiteIndex>[0]) =>
      state.failIndex
        ? Promise.reject(new Error("index down"))
        : real.getSiteIndex(site),
  };
});

const robots = await import("../app/tenant/[host]/robots.txt/route");
const sitemap = await import("../app/tenant/[host]/sitemap.xml/route");
const llms = await import("../app/tenant/[host]/llms.txt/route");
const searchModule = await import("../app/tenant/[host]/search/page");
const SearchPage = searchModule.default;
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let inst: PbInstance | null = null;
let seed: TwoOrgs;
let privDir = "";
let pubDir = "";

const HOST_A = "a.example.com";
const PREVIEW_A = "a-preview.example.com";
const HOST_B = "b.example.com";
const slugs: Record<string, string> = {};

function deps(held = false): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: {
      scan: () =>
        Promise.resolve(
          held
            ? { verdict: "held" as const, reasons: ["x"] }
            : { verdict: "clean" as const, reasons: [] },
        ),
    },
  } as PublishDeps;
}

async function pageWith(
  ctx: TwoOrgs["ctxA"],
  title: string,
  slug: string,
  text: string,
): Promise<string> {
  const p = await createPage(ctx, { title, slug });
  await saveSection(ctx, SECTION_REGISTRY, {
    pageId: p.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: title, text: `<p>${text}</p>` },
  });
  await publishPage(ctx, p.id, deps());
  slugs[slug] = p.id;
  return p.id;
}

async function route(
  mod: {
    GET: (
      req: Request,
      ctx: { params: Promise<{ host: string }> },
    ) => Promise<Response>;
  },
  host: string,
  path: string,
) {
  state.header = host;
  return mod.GET(new Request(`https://${host}${path}`), {
    params: Promise.resolve({ host }),
  });
}

async function search(host: string, sp: Record<string, string>) {
  state.header = host;
  const el = await SearchPage({
    params: Promise.resolve({ host }),
    searchParams: Promise.resolve(sp),
  });
  return renderToStaticMarkup(el as ReactElement);
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-site-index-routes-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-site-index-routes-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  await seedHost(seed.A.org, PREVIEW_A, "preview");
  await setOrgName(seed.A.org, "Crumb [Bakery]");
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

describe("before anything is published", () => {
  it("robots.txt falls back to defaults; sitemap is empty; llms.txt 404s", async (t) => {
    if (!inst) return t.skip();
    const r = await route(robots, HOST_B, "/robots.txt");
    expect(r.status).toBe(200);
    const txt = await r.text();
    expect(txt).toContain("Allow: /");
    expect(txt).not.toContain("GPTBot");
    const s = await route(sitemap, HOST_B, "/sitemap.xml");
    expect(locs(await s.text())).toEqual([]);
    expect((await route(llms, HOST_B, "/llms.txt")).status).toBe(404);
    const html = await search(HOST_B, { q: "anything" });
    expect(html).toContain("No results for “anything”");
  });
});

describe("with a published site", () => {
  beforeAll(async () => {
    if (!inst) return;
    // Home is the seeded page; give it text and publish.
    await saveSection(seed.ctxA, SECTION_REGISTRY, {
      pageId: seed.A.page,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Welcome", text: "<p>We bake sourdough daily.</p>" },
    });
    await publishPage(seed.ctxA, seed.A.page, deps());
    slugs.home = seed.A.page;
    await pageWith(seed.ctxA, "About us", "about", "Since 1990 in Austin.");
    const members = await pageWith(
      seed.ctxA,
      "Members",
      "members",
      "zanzibarquince recipes.",
    );
    const promo = await pageWith(
      seed.ctxA,
      "Promo",
      "promo",
      "promowordxylo deal.",
    );
    const oops = await pageWith(seed.ctxA, "Oops", "oops", "notfoundwordqq.");
    await setPageFields(members, { password_hash: "x$hash" });
    await publishPage(seed.ctxA, promo, deps(true));
    await setPageFields(oops, { kind: "system-404" });
    await saveService(seed.ctxA, {
      name: "Sourdough class",
      description: "Hands-on baking.",
      price_display: "fixed",
      price_cents: 4500,
    });
    for (let i = 0; i < 23; i++) {
      await saveService(seed.ctxA, {
        name: `Muffin ${String(i).padStart(2, "0")}`,
        price_display: "free",
      });
    }
    await saveNav(
      seed.ctxA,
      { sections: SECTION_REGISTRY, invalidator: recordingInvalidator() },
      {
        items: [
          { id: "n1", label: "Home", target: `page:${seed.A.page}` },
          { id: "n2", label: "About", target: `page:${slugs.about}` },
        ],
      },
    );
    await saveSiteSettings(
      seed.ctxA,
      { sections: SECTION_REGISTRY, invalidator: recordingInvalidator() },
      { allow_ai_crawlers: true },
    );
    await pageWith(seed.ctxB, "B Only", "b-only", "betaonlyword.");
  });

  it("robots.txt: custom AI on, preview disallow-all, unknown 404", async (t) => {
    if (!inst) return t.skip();
    const r = await route(robots, HOST_A, "/robots.txt");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const txt = await r.text();
    expect(txt).toContain("User-agent: *\nAllow: /");
    expect(
      txt.trimEnd().endsWith("Sitemap: https://a.example.com/sitemap.xml"),
    ).toBe(true);
    expect(txt).not.toContain("members");
    const p = await route(robots, PREVIEW_A, "/robots.txt");
    expect(await p.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(
      (await route(robots, "nope.example.com", "/robots.txt")).status,
    ).toBe(404);
  });

  it("sitemap.xml lists public pages at their canonical; preview is noindex", async (t) => {
    if (!inst) return t.skip();
    const r = await route(sitemap, HOST_A, "/sitemap.xml");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(r.headers.get("x-robots-tag")).toBeNull();
    const xml = await r.text();
    const want = ["home", "about"].map((slug) =>
      canonicalUrl({ primaryHost: HOST_A, fallbackHost: HOST_A, slug }),
    );
    expect(locs(xml).sort()).toEqual(want.sort());
    for (const leak of ["members", "promo", "oops", "b-only"]) {
      expect(xml).not.toContain(leak);
    }
    const p = await route(sitemap, PREVIEW_A, "/sitemap.xml");
    expect(p.status).toBe(200);
    expect(p.headers.get("x-robots-tag")).toBe("noindex");
    expect(locs(await p.text()).sort()).toEqual(want.sort());
    expect(
      (await route(sitemap, "nope.example.com", "/sitemap.xml")).status,
    ).toBe(404);
    // org B's host lists only org B
    const b = await route(sitemap, HOST_B, "/sitemap.xml");
    expect(locs(await b.text())).toEqual(["https://b.example.com/b-only"]);
  });

  it("llms.txt: custom + AI on only", async (t) => {
    if (!inst) return t.skip();
    const r = await route(llms, HOST_A, "/llms.txt");
    expect(r.status).toBe(200);
    const txt = await r.text();
    expect(txt.split("\n")[0]).toBe("# Crumb [Bakery]");
    expect(txt).toContain("## Pages");
    expect(txt).toContain("## Services");
    expect(txt).not.toContain("zanzibarquince");
    expect((await route(llms, PREVIEW_A, "/llms.txt")).status).toBe(404);
  });

  it("/search: empty, results, marks, kind, relative links", async (t) => {
    if (!inst) return t.skip();
    const empty = await search(HOST_A, {});
    expect(empty).toContain(">Search</h1>");
    expect(empty).toContain('role="search"');
    expect(empty).toContain("Type a word or two to search this site.");
    const html = await search(HOST_A, { q: "sourdough" });
    expect(html).toContain("2 results for “sourdough”");
    expect(html).toMatch(/<mark[^>]*>sourdough<\/mark>/i);
    expect(html).toContain(" · Service");
    const hrefs = [...html.matchAll(/<h2[^>]*><a href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs.length).toBe(2);
    for (const h of hrefs) expect(h!.startsWith("/")).toBe(true);
  });

  it("/search: paging, clamping and the shared Pagination", async (t) => {
    if (!inst) return t.skip();
    const p1 = await search(HOST_A, { q: "muffin" });
    expect(p1).toContain("23 results for “muffin”");
    expect((p1.match(/<h2/g) ?? []).length).toBe(10);
    expect(p1).toContain('aria-label="Search results pages"');
    const p3 = await search(HOST_A, { q: "muffin", page: "3" });
    expect((p3.match(/<h2/g) ?? []).length).toBe(3);
    const p99 = await search(HOST_A, { q: "muffin", page: "99" });
    expect((p99.match(/<h2/g) ?? []).length).toBe(3);
  });

  it("/search: no results shows Popular pages; excluded words find nothing", async (t) => {
    if (!inst) return t.skip();
    const html = await search(HOST_A, { q: "qwertyzzz" });
    expect(html).toContain(
      "No results for “qwertyzzz”. Try a shorter word, or one of these pages:",
    );
    expect(html).toContain('href="/about"');
    expect(html).toContain("data-popular-pages");
    for (const word of [
      "zanzibarquince",
      "promowordxylo",
      "notfoundwordqq",
      "betaonlyword",
    ]) {
      expect(await search(HOST_A, { q: word })).toContain(
        `No results for “${word}”`,
      );
    }
  });

  it("/search: error state, noindex metadata, hostile query as text", async (t) => {
    if (!inst) return t.skip();
    state.failIndex = true;
    try {
      const err = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const html = await search(HOST_A, { q: "bread" });
      err.mockRestore();
      expect(html).toContain(
        "Search isn&#x27;t working right now. Try again in a minute.",
      );
    } finally {
      state.failIndex = false;
    }
    expect(searchModule.generateMetadata()).toEqual({
      title: "Search",
      robots: { index: false, follow: true },
    });
    const xss = await search(HOST_A, { q: "<script>alert(1)</script>" });
    expect(xss).not.toContain("<script>alert(1)</script>");
    expect(xss).toContain("&lt;script&gt;");
  });

  it("AI toggle off: robots blocks AI crawlers and llms.txt 404s", async (t) => {
    if (!inst) return t.skip();
    await saveSiteSettings(
      seed.ctxA,
      { sections: SECTION_REGISTRY, invalidator: recordingInvalidator() },
      { allow_ai_crawlers: false },
    );
    const txt = await (await route(robots, HOST_A, "/robots.txt")).text();
    expect(txt).toContain("User-agent: GPTBot");
    expect(txt).toContain("User-agent: ClaudeBot");
    expect(txt).toMatch(/User-agent: Applebot-Extended\nDisallow: \/\n/);
    expect((await route(llms, HOST_A, "/llms.txt")).status).toBe(404);
  });
});
