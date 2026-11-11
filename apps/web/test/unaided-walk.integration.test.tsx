// 11-49 Task 2 (DASH-03, DASH-04, DASH-05, DASH-06; CONTEXT exit criterion; T-11-49-01):
// the P11 "unaided" owner walk as one ordered test against the real PocketBase 0.39.11
// binary. Today -> add a page -> add blocks (Hero + the Bio with photo preset) -> reorder
// them -> publish -> publish an edit -> restore the first version -> browse the catalog and
// install Testimonials -> add one testimonial -> it renders on the live site.
//
// The owner drives the same Server Actions the hub calls (session mocked to org A's owner;
// the org still comes only from the session through runAction). The visitor view is the
// real tenant route rendered by Host header. next/cache is a tag-aware memo (as in
// addons-exit): a render only sees fresh data when the writers emit the tags the readers
// registered, so "it is live" is proven through the same invalidation the app uses.
//
// DASH-05 drag + keyboard reorder is covered by the dom tests (choice 3, no duplicate here):
// packages/ui/src/builder/sections-list.test.tsx (block drag handles, Move up / Move down),
// packages/ui/src/hub/record-list.dom.test.tsx (keyboard pick-up announces, Move up/down),
// packages/ui/src/builder/blocks/info-editors.dom.test.tsx (SortableList items Move down),
// packages/ui/src/builder/optimistic-save.dom.test.tsx (item Move up keeps focus). This walk
// covers the server side of a reorder (reorderSectionsAction -> live order).
//
// Skips locally without the PocketBase binary; fails under CI (never a silent green).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { SUGGESTED_PRESETS } from "@cds/core/content/presets";
import { activeAddons, clearResolverCache, setOrgStage } from "@cds/db";
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
  clearOrgRows,
  setOrgStageForTests,
} from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({
  header: null as string | null,
  session: null as unknown,
  tags: [] as string[],
  memo: new Map<string, { value: unknown; tags: readonly string[] }>(),
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
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (
      fn: (...a: unknown[]) => Promise<unknown>,
      keyParts: readonly string[] = [],
      opts: { tags?: readonly string[] } = {},
    ) =>
    async (...a: unknown[]) => {
      const key = JSON.stringify([keyParts, a]);
      const hit = state.memo.get(key);
      if (hit) return hit.value;
      const value = await fn(...a);
      state.memo.set(key, { value, tags: opts.tags ?? [] });
      return value;
    },
  revalidateTag: (tag: string) => {
    state.tags.push(tag);
    for (const [key, entry] of state.memo) {
      if (entry.tags.includes(tag)) state.memo.delete(key);
    }
  },
  revalidatePath: () => {},
}));

vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
  enforceAgreementGate: async () => {},
  agreementBlocks: async () => false,
  requireHubSession: async () => {
    if (!state.session) throw new Error("REDIRECT:/sign-in");
    return state.session;
  },
}));

const { default: TenantPage } =
  await import("../app/tenant/[host]/[[...path]]/page");
const { createPageAction } = await import("../app/actions/pages");
const { saveSectionAction, reorderSectionsAction } =
  await import("../app/actions/sections");
const { publishPageAction } = await import("../app/actions/publish");
const { listPageVersionsAction, restorePageVersionAction } =
  await import("../app/actions/history");
const { addAddonAction } = await import("../app/actions/addons");
const { boundActions } =
  await import("../app/(platform)/hub/website/AddonPanel");
const { startTodayLoads } =
  await import("../app/(platform)/hub/today/today-data");
const { availability } =
  await import("../app/(platform)/hub/add-ons/catalog-logic");

const HOST = "a.example.com";
const SLUG = "about-us";
const HERO = "Fresh bread every morning";
const BIO_V1 = "Ann has baked here since 2009.";
const BIO_V2 = "Ann and Bo run the ovens together now.";
const QUOTE = "The walk test loves this bakery.";

const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let privDir = "";
let pubDir = "";
let inst: PbInstance | null = null;
let seed: TwoOrgs;

/** Captured across the ordered steps. */
let pageId = "";
let heroId = "";
let bioId = "";
let firstVersion = "";

async function renderPage(path?: string[]): Promise<string> {
  state.header = HOST;
  const el = await TenantPage({
    params: Promise.resolve({ host: HOST, path }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

function needPb(t: { skip: () => void }): boolean {
  if (inst) return true;
  if (process.env.CI) throw new Error("PocketBase unavailable under CI");
  t.skip();
  return false;
}

/** Version ids are millisecond stamps: never publish twice in the same millisecond. */
const tick = () => new Promise((r) => setTimeout(r, 15));

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-walk-priv-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-walk-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  // The walk starts from a tenant that has never had testimonials (test-only cleanup).
  await clearOrgRows("testimonials", seed.A.org);
  state.session = {
    ctx: seed.ctxA,
    email: "owner-a@cds.test",
    org: { id: seed.A.org, name: "Org A", primaryHost: HOST },
    orgs: [],
    staleOrg: false,
  };
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

describe.sequential("P11 exit: the unaided owner walk (DASH-03..06)", () => {
  it("1. the site goes live, and Today loads for the Owner", async (t) => {
    if (!needPb(t)) return;
    // The Owner's launch approval (launch_approval:run) is the real path to live; the
    // system-context minter is internal to @cds/db (lint: Invariant 1), so it is not used.
    // CDS has built the site; the Owner approves the launch (review 11 WR-B06).
    await setOrgStageForTests(seed.A.org, "ready_for_review");
    const moved = await setOrgStage(seed.ctxA, seed.A.org, "live");
    expect(moved.launchedAt).not.toBeNull();
    const loads = startTodayLoads(seed.ctxA, new Date());
    expect(loads.showNeedsYou).toBe(true);
    const [stage, needsYou] = await Promise.all([loads.stage, loads.needsYou]);
    expect(stage.ok).toBe(true);
    if (stage.ok) {
      expect(stage.data.status.stage).toBe("live");
      expect(stage.data.mode).toBe("full");
    }
    expect(needsYou.ok).toBe(true);
  });

  it("2. Add page: a draft page is created and is not on the live site yet", async (t) => {
    if (!needPb(t)) return;
    const res = await createPageAction({ title: "About us", slug: SLUG });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    pageId = res.data.id;
    await expect(renderPage([SLUG])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("3. add a Hero, then the Bio with photo preset (DASH-06)", async (t) => {
    if (!needPb(t)) return;
    const hero = await saveSectionAction({
      pageId,
      section_type: "hero",
      row_layout: "full",
      content: { heading: HERO },
    });
    expect(hero.ok).toBe(true);
    if (!hero.ok) return;
    heroId = hero.data.id;

    const preset = SUGGESTED_PRESETS.find((p) => p.id === "bio-with-photo")!;
    const [block] = preset.build();
    const bio = await saveSectionAction({
      pageId,
      section_type: block!.section_type,
      row_layout: block!.row_layout,
      content: {
        ...(block!.content as Record<string, unknown>),
        text: `<p>${BIO_V1}</p>`,
      },
      afterId: heroId,
    });
    expect(bio.ok).toBe(true);
    if (!bio.ok) return;
    bioId = bio.data.id;
    expect(bio.data.section_type).toBe("text-image");
  });

  it("4. predefined blocks only: raw HTML and style fields never get through (DASH-04)", async (t) => {
    if (!needPb(t)) return;
    // No free-form block type exists.
    for (const type of ["html", "raw-html", "custom", "canvas"]) {
      const res = await saveSectionAction({
        pageId,
        section_type: type,
        row_layout: "full",
        content: { html: "<div style='color:red'>x</div>" },
      });
      expect(res.ok, type).toBe(false);
    }
    // A predefined block drops smuggled style/markup fields and sanitizes its rich text.
    const res = await saveSectionAction({
      id: bioId,
      pageId,
      section_type: "text-image",
      row_layout: "full",
      content: {
        heading: "About me",
        text: `<p>${BIO_V1}</p><script>alert(1)</script><p style="color:red" onclick="x()">ok</p>`,
        style: "position:fixed",
        className: "evil",
        html: "<iframe src='https://evil.test'></iframe>",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const saved = JSON.stringify(res.data);
    expect(saved).not.toContain("<script");
    expect(saved).not.toContain("onclick");
    expect(saved).not.toContain("position:fixed");
    expect(saved).not.toContain("evil");
    expect(saved).not.toContain("<iframe");
    // A split layout on a full-width-only block is clamped back to full (invariant 6).
    const split = await saveSectionAction({
      id: heroId,
      pageId,
      section_type: "hero",
      row_layout: "40-60",
      content: { heading: HERO },
    });
    expect(split.ok).toBe(true);
    if (split.ok) expect(split.data.row_layout).toBe("full");
  });

  it("5. reorder: Bio first, then Hero; publish; the live page shows that order", async (t) => {
    if (!needPb(t)) return;
    const moved = await reorderSectionsAction(pageId, [bioId, heroId]);
    expect(moved).toEqual({ ok: true, data: null });
    state.tags = [];
    const pub = await publishPageAction(pageId);
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    expect(pub.data.status).not.toBe("held");
    expect(state.tags).toContain(`org:${seed.A.org}:site`);
    const html = await renderPage([SLUG]);
    expect(html).toContain(BIO_V1);
    expect(html).toContain(HERO);
    expect(html.indexOf("About me")).toBeLessThan(html.indexOf(HERO));
  });

  it("6. edit the bio and publish again: the live page changes", async (t) => {
    if (!needPb(t)) return;
    await tick();
    const res = await saveSectionAction({
      id: bioId,
      pageId,
      section_type: "text-image",
      row_layout: "full",
      content: { heading: "About me", text: `<p>${BIO_V2}</p>` },
    });
    expect(res.ok).toBe(true);
    const pub = await publishPageAction(pageId);
    expect(pub.ok).toBe(true);
    const html = await renderPage([SLUG]);
    expect(html).toContain(BIO_V2);
    expect(html).not.toContain(BIO_V1);
  });

  it("7. History lists both versions, newest first; restoring the first puts it back live", async (t) => {
    if (!needPb(t)) return;
    const list = await listPageVersionsAction(pageId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.length).toBeGreaterThanOrEqual(2);
    expect(list.data[0]!.current).toBe(true);
    firstVersion = list.data[list.data.length - 1]!.id;
    await tick();
    const restored = await restorePageVersionAction(pageId, firstVersion);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.data.held).toBe(false);
    const html = await renderPage([SLUG]);
    expect(html).toContain(BIO_V1);
    expect(html).not.toContain(BIO_V2);
    expect(html.indexOf("About me")).toBeLessThan(html.indexOf(HERO));
    // The restore is itself a new version (D184).
    const after = await listPageVersionsAction(pageId);
    expect(after.ok && after.data.length).toBe(list.data.length + 1);
  });

  it("8. browse the catalog and install Testimonials; one testimonial shows on the live site (DASH-03)", async (t) => {
    if (!needPb(t)) return;
    const manifest = ADDON_REGISTRY.get("testimonials")!;
    const view = () =>
      activeAddons(seed.ctxA).then(
        (active) =>
          availability({
            manifest,
            active,
            role: "owner",
            impersonating: false,
            registry: ADDON_REGISTRY,
          }).state,
      );
    expect(await view()).toBe("can-add");
    await expect(renderPage(["testimonials"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    const startedAt = Date.now();
    const added = await addAddonAction("testimonials");
    expect(added.ok).toBe(true);
    expect(await view()).toBe("added");
    const saved = await boundActions("testimonials", "testimonials").save({
      quote: QUOTE,
      author_name: "Walk Tester",
      is_published: true,
    });
    expect(saved).toMatchObject({ ok: true, data: { held: false } });

    const html = await renderPage(["testimonials"]);
    expect(html).toContain(QUOTE);
    expect(Date.now() - startedAt, "live within seconds").toBeLessThan(5000);
    // The walked page is untouched by the install.
    expect(await renderPage([SLUG])).toContain(BIO_V1);
  });
});
