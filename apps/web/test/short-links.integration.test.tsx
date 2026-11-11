// 11-36 (DASH-15, D199; Pitfall 19; T-11-36-01, -02): bio short links on the tenant route,
// against the real PocketBase 0.39.11 binary. /ig and /go/<code> redirect to the host's own
// home with UTM tags; a page that owns the slug wins; unknown and foreign codes 404.
//
// next/headers supplies the middleware header per case; next/navigation throws sentinels;
// next/cache is a passthrough.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSocialAccount,
  clearResolverCache,
  createPage,
  publishPage,
  recordingInvalidator,
  saveSection,
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
import { setPageFields } from "../../../packages/db/test/seo-seed";

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
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_307:${to}`);
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

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const A_HOST = "a.example.com";
const B_HOST = "b.example.com";

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: {
      scan: () => Promise.resolve({ verdict: "clean" as const, reasons: [] }),
    },
  } as PublishDeps;
}

async function render(host: string, path?: string[]): Promise<string> {
  state.header = host;
  const el = await TenantPage({ params: Promise.resolve({ host, path }) });
  return renderToStaticMarkup(el as ReactElement);
}

/** The thrown navigation sentinel for a path ("NEXT_NOT_FOUND", "NEXT_REDIRECT_307:/…"). */
async function outcome(host: string, path: string[]): Promise<string> {
  try {
    await render(host, path);
    return "RENDERED";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const bio = (source: string) =>
  `NEXT_REDIRECT_307:/?utm_source=${source}&utm_medium=social&utm_campaign=bio`;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-short-links-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  const ctx = seed.ctxA;
  // A published home for org A; org B has no published page at all.
  await saveSection(ctx, SECTION_REGISTRY, {
    pageId: seed.A.page,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Home A", text: "<p>home</p>" },
  });
  await publishPage(ctx, seed.A.page, deps());
  // A page that owns "ig" (made before the code was reserved), published.
  const ig = await createPage(ctx, { title: "Ig page", slug: "ig-old" });
  await setPageFields(ig.id, { slug: "ig" });
  await saveSection(ctx, SECTION_REGISTRY, {
    pageId: ig.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "OWN IG PAGE", text: "<p>mine</p>" },
  });
  await publishPage(ctx, ig.id, deps());
  // Accounts are added after the page so the short-code cache sees it.
  await addSocialAccount(ctx, {
    platform: "instagram",
    url: "https://instagram.com/a",
  });
  await addSocialAccount(ctx, {
    platform: "facebook",
    url: "https://facebook.com/a",
  });
  await addSocialAccount(ctx, {
    platform: "custom",
    label: "Etsy",
    url: "https://etsy.com/shop/a",
  });
  await addSocialAccount(seed.ctxB, {
    platform: "tiktok",
    url: "https://tiktok.com/@b",
  });
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

describe("bio short links on the tenant route (DASH-15)", () => {
  it("a preset code redirects to the own home with UTM tags", async (t) => {
    if (!inst) return t.skip();
    expect(await outcome(A_HOST, ["fb"])).toBe(bio("facebook"));
    // Case does not matter.
    expect(await outcome(A_HOST, ["FB"])).toBe(bio("facebook"));
    expect(await outcome(A_HOST, ["go", "fb"])).toBe(bio("facebook"));
  });

  it("/go/<custom code> uses the code as the source", async (t) => {
    if (!inst) return t.skip();
    expect(await outcome(A_HOST, ["go", "etsy"])).toBe(bio("etsy"));
  });

  it("a page that owns the slug wins; /go/ig still redirects", async (t) => {
    if (!inst) return t.skip();
    const html = await render(A_HOST, ["ig"]);
    expect(html).toContain("OWN IG PAGE");
    expect(await outcome(A_HOST, ["go", "ig"])).toBe(bio("instagram"));
  });

  it("unknown, missing and foreign codes 404", async (t) => {
    if (!inst) return t.skip();
    // No Instagram account on org B; no X account anywhere.
    expect(await outcome(B_HOST, ["ig"])).toBe("NEXT_NOT_FOUND");
    expect(await outcome(A_HOST, ["x"])).toBe("NEXT_NOT_FOUND");
    expect(await outcome(A_HOST, ["go", "nope"])).toBe("NEXT_NOT_FOUND");
    expect(await outcome(A_HOST, ["etsy"])).toBe("NEXT_NOT_FOUND");
    expect(await outcome(A_HOST, ["go", "etsy", "more"])).toBe(
      "NEXT_NOT_FOUND",
    );
    // Org B's TikTok code never resolves on org A's host (T-11-36-02) ...
    expect(await outcome(A_HOST, ["tt"])).toBe("NEXT_NOT_FOUND");
    expect(await outcome(A_HOST, ["go", "tt"])).toBe("NEXT_NOT_FOUND");
    // ... but does on its own host, even with no published page there.
    expect(await outcome(B_HOST, ["tt"])).toBe(bio("tiktok"));
  });

  it("the home page and normal pages still render", async (t) => {
    if (!inst) return t.skip();
    expect(await render(A_HOST)).toContain("Home A");
  });
});
