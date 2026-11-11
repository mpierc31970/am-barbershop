// 14-20 (DOM-07, D22; T-14-20-01, -02, -04): draft preview links end to end on the real
// PocketBase 0.39.11 binary. mintPreviewLink audits and returns the preview host; the page on
// that host renders the draft only with a valid, org-matched cds_pv cookie for that page
// (metadata noindex, nofollow); without it, with another org's token or on the custom host, the
// published version renders.
//
// next/headers supplies the middleware header and a cookie jar per case; next/navigation
// throws sentinels; next/cache is a passthrough. Skips locally without the PocketBase binary.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  listAuditLog,
  mintPreviewLink,
  publishPage,
  recordingInvalidator,
  saveSection,
  signPreviewToken,
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
import { seedHost } from "../../../packages/db/test/seo-seed";

const state = vi.hoisted(() => ({
  header: null as string | null,
  jar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
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
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const PREVIEW_HOST = "a-draft.sites.localhost";
const CUSTOM_HOST = "a.example.com";

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
  };
}

async function renderPage(host: string, path?: string[]): Promise<string> {
  state.header = host;
  const el = await TenantPage({ params: Promise.resolve({ host, path }) });
  return renderToStaticMarkup(el as ReactElement);
}

async function metadata(host: string, path?: string[]) {
  state.header = host;
  return pageModule.generateMetadata({
    params: Promise.resolve({ host, path }),
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-draft-preview-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  // Org A's preview host (kind preview, not primary; the custom host stays primary).
  await seedHost(seed.A.org, PREVIEW_HOST, "preview", false);
  const res = await publishPage(seed.ctxA, seed.A.page, deps());
  expect(res.status).toBe("published");
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: seed.A.page,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "DRAFT ONLY CHANGE", text: "<p>not live yet</p>" },
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
  state.jar.clear();
});

describe("draft preview links on the preview host (DOM-07)", () => {
  it("mintPreviewLink returns the preview host and audits preview.link_minted", async (t) => {
    if (!inst) return t.skip();
    const link = await mintPreviewLink(seed.ctxA, seed.A.page);
    expect(link.host).toBe(PREVIEW_HOST);
    expect(link.token.split(".")[1]).toBe(seed.A.org);
    const log = await listAuditLog(seed.ctxA, { perPage: 500 });
    const rows = log.items.filter(
      (r) => r.action === "preview.link_minted" && r.target_id === seed.A.page,
    );
    expect(rows.length).toBe(1);
    // Another org's page is not found (Invariant 1).
    await expect(mintPreviewLink(seed.ctxA, seed.B.page)).rejects.toThrow();
  });

  it("without the cookie the published page renders", async (t) => {
    if (!inst) return t.skip();
    const html = await renderPage(PREVIEW_HOST);
    expect(html).not.toContain("DRAFT ONLY CHANGE");
  });

  it("with a valid cookie the draft renders, and metadata is noindex", async (t) => {
    if (!inst) return t.skip();
    state.jar.set("cds_pv", signPreviewToken(seed.A.org, seed.A.page));
    const html = await renderPage(PREVIEW_HOST);
    expect(html).toContain("DRAFT ONLY CHANGE");
    const meta = await metadata(PREVIEW_HOST);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("another org's token or an expired token shows the published page", async (t) => {
    if (!inst) return t.skip();
    state.jar.set("cds_pv", signPreviewToken(seed.B.org, seed.B.page));
    expect(await renderPage(PREVIEW_HOST)).not.toContain("DRAFT ONLY CHANGE");
    state.jar.set(
      "cds_pv",
      signPreviewToken(seed.A.org, seed.A.page, Date.now() - 61 * 60 * 1000),
    );
    expect(await renderPage(PREVIEW_HOST)).not.toContain("DRAFT ONLY CHANGE");
  });

  it("the custom host never renders a draft, even with a valid cookie", async (t) => {
    if (!inst) return t.skip();
    state.jar.set("cds_pv", signPreviewToken(seed.A.org, seed.A.page));
    expect(await renderPage(CUSTOM_HOST)).not.toContain("DRAFT ONLY CHANGE");
  });
});
