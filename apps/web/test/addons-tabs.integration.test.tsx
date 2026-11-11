// Website add-on tabs end to end against the real PocketBase 0.39.11 binary (05-12; ADDON-08,
// ADDON-12..14; CONTEXT A4-Q3; T-05-58..T-05-62). The owner installs Testimonials, opens
// /hub/website?tab=testimonials (empty state, three starts), saves through the bound action,
// imports a CSV through the bound preview + commit (a backup is listed), and after removing
// the add-on the bookmarked tab falls back to Pages with the off notice.
//
// Mocks follow addons-site.integration.test.tsx: next/cache is a passthrough, next/navigation
// supplies the client hooks the panel reads, and the session module returns org A's owner
// (the real session needs a PocketBase sign-in cookie; the actions still go through
// runAction, so the org still comes only from the session).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAddon, uninstallAddon } from "@cds/db";
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/hub/website",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
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

const { default: WebsitePage } =
  await import("../app/(platform)/hub/website/page");
const { boundActions } =
  await import("../app/(platform)/hub/website/AddonPanel");
const { addonDeps } = await import("../lib/addons");

const SLUG = "testimonials";
const QUOTE = "Gentle hands and a calm room.";
const CSV = [
  "Quote,Name,About them,Rating",
  "The bread is wonderful every morning.,Ann Lee,Neighbor,5",
  "Friendly staff and quick service.,Bo Diaz,,4",
  "Our cake arrived exactly on time.,Cy Park,Bride,5",
  "A warm welcome every single visit.,Dee Fox,,",
].join("\n");

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

async function renderTab(tab: string): Promise<string> {
  const el = (await WebsitePage({
    searchParams: Promise.resolve({ tab }),
  })) as ReactElement;
  return renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addons-tabs-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  state.session = {
    ctx: seed.ctxA,
    email: "owner-a@cds.test",
    org: { id: seed.A.org, name: "Org A", primaryHost: "a.example.com" },
  };
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("Website add-on tabs against real PocketBase (05-12)", () => {
  it("install -> the Testimonials tab shows the three-starts empty state", async (t) => {
    if (!inst) return t.skip();
    const res = await installAddon(seed.ctxA, addonDeps(), SLUG);
    expect(res.page?.slug).toBe("testimonials");
    // The fixture seeds one testimonial for org A; clear it through the bound action.
    const actions = boundActions(SLUG, SLUG);
    expect(await actions.remove(seed.A.testimonial)).toEqual({
      ok: true,
      data: null,
    });

    const html = await renderTab(SLUG);
    expect(html).toMatch(
      /<a[^>]*href="\?tab=testimonials"[^>]*aria-current="page"/,
    );
    expect(html).toContain("No testimonials yet");
    expect(html).toContain("Add your first testimonial");
    expect(html).toContain("Import from a spreadsheet");
    expect(html).toContain("How this works");
    expect(html).toContain("Your Testimonials page: /testimonials");
    expect(html).toContain('href="https://a.example.com/testimonials"');
  });

  it("save through the bound action -> the row appears", async (t) => {
    if (!inst) return t.skip();
    const actions = boundActions(SLUG, SLUG);
    const saved = await actions.save({
      quote: QUOTE,
      author_name: "Maria Lopez",
      is_published: true,
      organization: seed.B.org,
    });
    expect(saved).toMatchObject({ ok: true, data: { held: false } });
    const html = await renderTab(SLUG);
    expect(html).toContain(QUOTE);
    expect(html).toContain("1 testimonial · 1 shown on your site");
    // Org B never sees it: the org came from the session, not the payload.
    expect(html).not.toContain("Kind words for org A.");
  });

  it("import preview + commit through the bound actions -> 5 rows and a backup listed", async (t) => {
    if (!inst) return t.skip();
    const actions = boundActions(SLUG, SLUG);
    const preview = await actions.importPreview(CSV, "update");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.counts).toMatchObject({ new: 4, errors: 0 });
    expect(preview.data.changes).toBe(4);

    const commit = await actions.importCommit(CSV, "update");
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.data).toMatchObject({ added: 4, updated: 0, removed: 0 });

    const html = await renderTab(SLUG);
    expect(html).toContain("5 testimonials · 5 shown on your site");
    expect(html).toContain("Friendly staff and quick service.");

    const backups = await actions.listBackups();
    expect(backups.ok).toBe(true);
    if (!backups.ok) return;
    expect(backups.data.map((b) => b.id)).toContain(commit.data.backupId);
    expect(backups.data[0]).toMatchObject({
      reason: "before-import",
      count: 1,
    });

    const exported = await actions.exportCsv();
    expect(exported.ok && exported.data.csv).toContain("Ann Lee");

    // Undo import restores that backup: back to the one saved testimonial.
    expect(await actions.restoreBackup(commit.data.backupId)).toEqual({
      ok: true,
      data: null,
    });
    expect(await renderTab(SLUG)).toContain(
      "1 testimonial · 1 shown on your site",
    );
    // A key or a foreign id is never a backup.
    const bad = await actions.restoreBackup(
      `tenants/${seed.B.org}/addons/testimonials/x.json`,
    );
    expect(bad).toMatchObject({ ok: false, code: "not_found" });
  });

  it("remove add-on -> the bookmarked tab falls back to Pages with the off notice", async (t) => {
    if (!inst) return t.skip();
    expect((await uninstallAddon(seed.ctxA, addonDeps(), SLUG)).outcome).toBe(
      "removed",
    );
    const html = await renderTab(SLUG);
    expect(html).toMatch(/<a[^>]*href="\?tab=pages"[^>]*aria-current="page"/);
    expect(html).not.toContain('href="?tab=testimonials"');
    expect(html).toContain(
      "Testimonials is off. Add it back from Get add-ons to see your testimonials.",
    );
    expect(html).not.toContain(QUOTE);
    // Writes are refused while it is off; the retained list is still exportable.
    const actions = boundActions(SLUG, SLUG);
    const refused = await actions.save({ quote: "x", author_name: "y" });
    expect(refused).toMatchObject({ ok: false, code: "addon_not_active" });
    const exported = await actions.exportCsv();
    expect(exported.ok && exported.data.csv).toContain(QUOTE);
  });
});
