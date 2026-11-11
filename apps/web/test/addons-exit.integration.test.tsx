// Phase 5 exit, end to end against the real PocketBase 0.39.11 binary (ROADMAP P5 exit;
// ADDON-03, ADDON-05, ADDON-08, ADDON-11; T-05-64). "Installing Testimonials on a live tenant
// surfaces it on their site within seconds, and uninstalling then reinstalling restores their
// records." The owner drives the real hub Server Actions (session mocked to org A's owner,
// the org still comes only from the session through runAction) and the visitor view is the
// real tenant route rendered by Host header. next/cache is a tag-aware memo (C-WR-07): each
// unstable_cache entry is kept until revalidateTag evicts a tag it carries, so a render after
// add or remove only sees fresh data if the writers emit the same tags the readers register.
// revalidateTag also records every tag, so the test sees exactly what each step invalidates.
// With no PocketBase binary the steps skip locally, but fail under CI (never a silent green).
//
// One ordered scenario: before install -> add -> import 5 -> render within 5000 ms -> training
// -> remove (404, training gone, export keeps rows) -> add back (same ids) -> Credentials.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getObjectStore,
  clearResolverCache,
  exportTenant,
  type TenantBundle,
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
import {
  bootSeededPb,
  clearOrgRows,
  collectionNames,
  orgRowIds,
} from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({
  header: null as string | null,
  session: null as unknown,
  tags: [] as string[],
  /** Every tag an unstable_cache entry registered (reader side). */
  registered: new Set<string>(),
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
      const tags = opts.tags ?? [];
      for (const t of tags) state.registered.add(t);
      const value = await fn(...a);
      state.memo.set(key, { value, tags });
      return value;
    },
  revalidateTag: (tag: string) => {
    state.tags.push(tag);
    for (const [key, entry] of state.memo) {
      if (entry.tags.includes(tag)) state.memo.delete(key);
    }
  },
}));

vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
  // Re-acceptance gate (09-15): the fixture org has no signing yet; not under test here.
  enforceAgreementGate: async () => {},
  agreementBlocks: async () => false,
  requireHubSession: async () => {
    if (!state.session) throw new Error("REDIRECT:/sign-in");
    return state.session;
  },
}));

const { default: TenantPage } =
  await import("../app/tenant/[host]/[[...path]]/page");
const { addAddonAction, removeAddonAction, importCommitAction } =
  await import("../app/actions/addons");
const { boundActions } =
  await import("../app/(platform)/hub/website/AddonPanel");
const { getTrainingFor } = await import("../lib/training");

const HOST = "a.example.com";
const QUOTES = [
  "The bread is wonderful every morning.",
  "Friendly staff and quick service.",
  "Our cake arrived exactly on time.",
  "A warm welcome every single visit.",
  "They remembered my name on day two.",
];
const CSV = [
  "Quote,Name,About them,Rating",
  `${QUOTES[0]},Ann Lee,Neighbor,5`,
  `${QUOTES[1]},Bo Diaz,,4`,
  `${QUOTES[2]},Cy Park,Bride,5`,
  `${QUOTES[3]},Dee Fox,,`,
  `${QUOTES[4]},Eli Moss,Regular,5`,
].join("\n");
const CREDENTIAL = "Licensed Massage Therapist";

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

/** Captured across the ordered steps. */
let collectionsBefore: string[] = [];
let startedAt = 0;
let idsOnSite: string[] = [];

async function renderPage(path?: string[]): Promise<string> {
  state.header = HOST;
  const el = await TenantPage({
    params: Promise.resolve({ host: HOST, path }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

/** Skip without a PocketBase binary locally; under CI that is a failure, not a green run. */
function needPb(t: { skip: () => void }): boolean {
  if (inst) return true;
  if (process.env.CI) throw new Error("PocketBase unavailable under CI");
  t.skip();
  return false;
}

async function trainingIds(): Promise<string[]> {
  return (await getTrainingFor(seed.ctxA)).map((e) => e.id);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addons-exit-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  // The shared fixture seeds one testimonial per org; the exit starts from a tenant that has
  // never had testimonials, so org A's fixture row is cleared (test-only superuser write).
  await clearOrgRows("testimonials", seed.A.org);
  state.session = {
    ctx: seed.ctxA,
    email: "owner-a@cds.test",
    org: { id: seed.A.org, name: "Org A", primaryHost: HOST },
  };
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

describe.sequential("P5 exit: add, see, remove, add back (ROADMAP P5)", () => {
  it("1. before install: /testimonials is not found, no rows, the table already exists", async (t) => {
    if (!needPb(t)) return;
    await expect(renderPage(["testimonials"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    // The not-found answer is now cached; only the add's invalidation can clear it.
    expect(state.memo.size).toBeGreaterThan(0);
    expect(state.registered).toContain(`org:${seed.A.org}:site`);
    expect(await orgRowIds("testimonials", seed.A.org)).toEqual([]);
    collectionsBefore = await collectionNames();
    // ADDON-03: the collection ships from day one; install never adds one.
    expect(collectionsBefore).toContain("testimonials");
    expect(collectionsBefore).toContain("credentials");
  });

  it("2. Add to site: ok, lands on the tab, invalidates addons + site + addon tags", async (t) => {
    if (!needPb(t)) return;
    state.tags = [];
    startedAt = Date.now();
    const res = await addAddonAction("testimonials");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tabHref).toBe("/hub/website?tab=testimonials");
    expect(res.data.pageUrl).toBe(`https://${HOST}/testimonials`);
    expect(state.tags).toEqual(
      expect.arrayContaining([
        `org:${seed.A.org}:addons`,
        `org:${seed.A.org}:site`,
        `org:${seed.A.org}:addon:testimonials`,
      ]),
    );
    // Not a migration: the PocketBase schema is identical after install.
    expect(await collectionNames()).toEqual(collectionsBefore);
  });

  it("3. import a 5-row CSV through the hub action: 5 added", async (t) => {
    if (!needPb(t)) return;
    const res = await importCommitAction(
      "testimonials",
      "testimonials",
      CSV,
      "update",
    );
    expect(res).toMatchObject({
      ok: true,
      data: { added: 5, updated: 0, removed: 0 },
    });
  });

  it("4. the tenant host renders all 5 quotes within 5000 ms of the add", async (t) => {
    if (!needPb(t)) return;
    const html = await renderPage(["testimonials"]);
    for (const q of QUOTES) expect(html).toContain(q);
    const elapsed = Date.now() - startedAt;
    expect(elapsed, "within seconds of Add to site").toBeLessThan(5000);
    idsOnSite = await orgRowIds("testimonials", seed.A.org);
    expect(idsOnSite).toHaveLength(5);
    // The reader side registers the same tags the writers emit (no drift between
    // site-cache.ts and the installer / importer).
    for (const tag of [
      `org:${seed.A.org}:addons`,
      `org:${seed.A.org}:site`,
      `org:${seed.A.org}:addon:testimonials`,
    ]) {
      expect(state.registered, tag).toContain(tag);
    }
  });

  it("5. training includes Testimonials while it is on (ADDON-11)", async (t) => {
    if (!needPb(t)) return;
    expect(await trainingIds()).toContain("addon-testimonials");
  });

  it("6. Remove from site: page 404s, training gone, export keeps the 5 rows (ADDON-05)", async (t) => {
    if (!needPb(t)) return;
    state.tags = [];
    const res = await removeAddonAction("testimonials");
    expect(res).toEqual({ ok: true, data: { slug: "testimonials" } });
    expect(state.tags).toEqual(
      expect.arrayContaining([
        `org:${seed.A.org}:addons`,
        `org:${seed.A.org}:site`,
        `org:${seed.A.org}:addon:testimonials`,
      ]),
    );
    // The page rendered (and cached) in step 4; only the remove's invalidation 404s it.
    await expect(renderPage(["testimonials"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(await trainingIds()).not.toContain("addon-testimonials");

    const store = getObjectStore();
    const { key, counts } = await exportTenant(seed.ctxA, seed.A.org, {
      store,
    });
    expect(counts.testimonials).toBe(5);
    const bundle = JSON.parse(
      new TextDecoder().decode((await store.get(key))!),
    ) as TenantBundle;
    const exported = bundle.collections.testimonials!;
    expect(exported.map((r) => r.id).sort()).toEqual(idsOnSite);
    for (const q of QUOTES) {
      expect(exported.map((r) => r.quote)).toContain(q);
    }
    // Retained, never deleted (invariant 9).
    expect(await orgRowIds("testimonials", seed.A.org)).toEqual(idsOnSite);
  });

  it("7. Add it back: the same 5 quotes with the same ids", async (t) => {
    if (!needPb(t)) return;
    state.tags = [];
    const res = await addAddonAction("testimonials");
    expect(res.ok).toBe(true);
    expect(state.tags).toEqual(
      expect.arrayContaining([
        `org:${seed.A.org}:addons`,
        `org:${seed.A.org}:site`,
        `org:${seed.A.org}:addon:testimonials`,
      ]),
    );
    const html = await renderPage(["testimonials"]);
    for (const q of QUOTES) expect(html).toContain(q);
    expect(
      await orgRowIds("testimonials", seed.A.org),
      "same ids after add back",
    ).toEqual(idsOnSite);
    expect(await trainingIds()).toContain("addon-testimonials");
  });

  it("8. Credentials: add, save one license, /credentials shows it grouped", async (t) => {
    if (!needPb(t)) return;
    const res = await addAddonAction("credentials");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tabHref).toBe("/hub/website?tab=credentials");
    const saved = await boundActions("credentials", "credentials").save({
      title: CREDENTIAL,
      issuer: "Texas Department of Licensing and Regulation",
      category: "Licenses",
      is_published: true,
    });
    expect(saved).toMatchObject({ ok: true, data: { held: false } });
    const html = await renderPage(["credentials"]);
    expect(html).toContain(">Licenses</h3>");
    expect(html).toContain(CREDENTIAL);
    // Still no schema change after two installs.
    expect(await collectionNames()).toEqual(collectionsBefore);
  });
});
