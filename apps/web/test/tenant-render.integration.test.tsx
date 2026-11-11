// Phase 3 exit (CONT-08, CONT-11, CONT-31; D22, D187, D254; T-03-49): a seeded tenant's
// page publishes through @cds/db and renders by Host header against the real PocketBase
// 0.39.11 binary. Drafts, hidden blocks and unpublished edits never reach the tenant host.
//
// next/headers supplies the middleware header per case; next/navigation throws sentinels;
// next/cache is a passthrough (every read goes to PB and the object store).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  publishPage,
  recordingInvalidator,
  saveBanner,
  saveSection,
  setSectionHidden,
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

async function renderLayout(host: string): Promise<string> {
  state.header = host;
  const el = await TenantLayout({
    children: <p>page</p>,
    params: Promise.resolve({ host }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-tenant-render-"));
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

describe("tenant render by hostname (exit, CONT-08)", () => {
  it("exit: publish then render by hostname; drafts stay private", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = seed.A.page; // "home"

    const hero = await saveSection(ctx, SECTION_REGISTRY, {
      pageId,
      section_type: "hero",
      row_layout: "full",
      content: { heading: "Welcome to A" },
      afterId: null,
    });
    await saveSection(ctx, SECTION_REGISTRY, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { text: "<p>hello<script>x()</script></p>" },
    });
    const hidden = await saveSection(ctx, SECTION_REGISTRY, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "SECRET DRAFT BLOCK", text: "<p>secret</p>" },
    });
    await setSectionHidden(ctx, hidden.id, true);

    const res = await publishPage(ctx, pageId, deps());
    expect(res.status).toBe("published");

    const html = await renderPage("a.example.com");
    expect(html).toMatch(/<h1[^>]*>[^<]*Welcome to A/);
    expect(html).toContain("<p>hello</p>");
    // 07-30: the one JSON-LD data script is expected; no other script may reach the page.
    expect(
      html.replace(/<script type="application\/ld\+json">[^<]*<\/script>/, ""),
    ).not.toContain("<script");
    expect(html).not.toContain("SECRET DRAFT BLOCK");
    // The seeded button-only pop-up is mounted on every page (CONT-12).
    expect(html).toContain(`data-cds-popup="${seed.A.popup}"`);

    // An unpublished edit is preview-only (CONT-08, D254).
    await saveSection(ctx, SECTION_REGISTRY, {
      id: hero.id,
      pageId,
      section_type: "hero",
      row_layout: "full",
      content: { heading: "DRAFT EDIT" },
    });
    const after = await renderPage("a.example.com");
    expect(after).toContain("Welcome to A");
    expect(after).not.toContain("DRAFT EDIT");
  });

  it("an org that never published shows the placeholder", async (t) => {
    if (!inst) return t.skip();
    expect(await renderPage("b.example.com")).toContain("No site here yet");
  });

  it("a host that is not in org_hosts 404s", async (t) => {
    if (!inst) return t.skip();
    await expect(renderPage("nobody.example.com")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("an unknown slug on a published site 404s", async (t) => {
    if (!inst) return t.skip();
    await expect(renderPage("a.example.com", ["missing"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("an enabled banner renders in the layout (CONT-11)", async (t) => {
    if (!inst) return t.skip();
    expect(await renderLayout("a.example.com")).not.toContain(
      'aria-label="Announcement"',
    );
    await saveBanner(seed.ctxA, deps(), {
      enabled: true,
      message: "Open late on Friday",
      link_text: "",
      link_url: "",
      starts_at: null,
      ends_at: null,
    });
    const html = await renderLayout("a.example.com");
    expect(html).toContain('<aside aria-label="Announcement"');
    expect(html).toContain("Open late on Friday");
    expect(await renderLayout("b.example.com")).not.toContain(
      "Open late on Friday",
    );
  });
});
