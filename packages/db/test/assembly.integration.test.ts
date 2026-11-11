// P8 (08-16): end-to-end site assembly on the real PocketBase 0.39.11 binary (TMPL-02,
// TMPL-03, TMPL-04; CONTEXT A1-Q5, A2-Q2..Q5, A3-Q5, A4-Q1, A4-Q2; RESEARCH R-2, R-5, R-7,
// Pitfalls 3-6; invariants 1, 9, 10; T-08-16-01..08). A fresh seeded org per case.
// Registers add-on collections before anything reads the composed registry (05-04).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import {
  templateCopy,
  type AssemblyIntake,
  type SiteTemplate,
  type Slot,
} from "@cds/core/templates";
import { heroSlot, readFacts, TEMPLATES } from "@cds/templates";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installAddon } from "../src/addons/installer";
import {
  assembleSite,
  assemblyLockKey,
  type AssemblyDeps,
} from "../src/assembly/assemble";
import { readLedger, writeLedger } from "../src/assembly/ledger";
import {
  assembleSiteAsStaff,
  runAssemblyForOrg,
  type AssemblyRunDeps,
} from "../src/assembly/run";
import { assemblyVersionKeys } from "../src/assembly";
import { resetClientForTests, superuser } from "../src/client";
import { getNav, removePageFromNav } from "../src/content/chrome/nav";
import { createPage, listPages } from "../src/content/pages";
import {
  recordingInvalidator,
  type ContentScanner,
} from "../src/content/ports";
import { listPageVersions, publishPage } from "../src/content/publish";
import { listSections, saveSection } from "../src/content/sections";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
} from "../src/context";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { captureTransport } from "../src/email";
import { getIntakeForAssembly } from "../src/intake";
import { acquirePlatformLock, releasePlatformLock } from "../src/platform-meta";
import { resetConfirmSendLimitsForTests } from "../src/rate-limit";
import { COMPLETE_INTAKE, MINIMAL_INTAKE } from "../../templates/test/fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir: string;
let n = 0;
let staffUser = "";
const saved: Record<string, string | undefined> = {};
const ENV = {
  CDS_ENV: "dev",
  CDS_PREVIEW_HOST_SUFFIX: "sites.localhost",
  CDS_STAFF_ALERT_EMAIL: "staff@cds.test",
  CDS_PREVIEW_PORT: "3000",
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-assembly-"));
  for (const [k, v] of Object.entries({
    ...ENV,
    CDS_STORAGE_DIR: storageDir,
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  const pw = "staff-password-123";
  staffUser = (
    await pb.collection("users").create({
      email: "assembler@cds.test",
      password: pw,
      passwordConfirm: pw,
      staff_role: "support_agent",
      verified: true,
    })
  ).id;
});

afterAll(async () => {
  await inst?.stop();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(storageDir, { recursive: true, force: true });
});

type Mail = ReturnType<typeof captureTransport>;

function deps(
  extra: Partial<AssemblyRunDeps> = {},
): AssemblyRunDeps & { mail: Mail } {
  const mail = captureTransport();
  return {
    templates: TEMPLATES,
    sections,
    copy: templateCopy,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    registry: ADDON_REGISTRY,
    email: { transport: mail },
    mail,
    ...extra,
  };
}

const sentOf = (mail: Mail, type: string) =>
  mail.sent.filter((m) => m.type === type);

async function ownerCtx(orgId: string): Promise<OrgContext> {
  const m = await pb
    .collection("memberships")
    .getFirstListItem(
      pb.filter("organization = {:o} && role = 'owner'", { o: orgId }),
    );
  return mintOrgContext({
    orgId,
    actor: String(m.user),
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

async function complete(): Promise<{ orgId: string; slug: string }> {
  n += 1;
  resetConfirmSendLimitsForTests();
  const slug = `asm-full-${n}`;
  const { orgId } = await seedCompleteIntake(
    { slug, ownerEmail: `${slug}@cds.test` },
    { registry: ADDON_REGISTRY },
  );
  const org = await pb.collection("organizations").getOne(orgId);
  expect(org.stage).toBe("ready_for_build");
  return { orgId, slug };
}

async function minimal(): Promise<{ orgId: string; slug: string }> {
  n += 1;
  const slug = `asm-min-${n}`;
  const { orgId } = await seedMinimalIntake({
    slug,
    ownerEmail: `${slug}@cds.test`,
  });
  await pb
    .collection("organizations")
    .update(orgId, { stage: "ready_for_build" });
  return { orgId, slug };
}

const byOrg = (orgId: string) => pb.filter("organization = {:o}", { o: orgId });

async function counts(orgId: string) {
  const c = async (col: string) =>
    (await pb.collection(col).getList(1, 1, { filter: byOrg(orgId) }))
      .totalItems;
  const intake = await pb
    .collection("org_intake")
    .getFirstListItem(byOrg(orgId));
  return {
    pages: await c("pages"),
    sections: await c("page_sections"),
    forms: await c("forms"),
    hosts: await c("org_hosts"),
    audit: await c("audit_log"),
    settings: JSON.stringify(
      (
        await pb
          .collection("site_settings")
          .getList(1, 1, { filter: byOrg(orgId) })
      ).items.map((r) => [r.nav, r.footer]),
    ),
    ledger: JSON.stringify(intake.assembly ?? null),
  };
}

async function pagesBySlug(orgId: string) {
  return (
    await pb.collection("pages").getFullList({ filter: byOrg(orgId) })
  ).map((p) => String(p.slug));
}

async function sectionTypes(ctx: OrgContext, pageId: string) {
  return (await listSections(ctx, pageId)).map((s) => s.section_type);
}

async function contactForms(orgId: string) {
  return (
    await pb.collection("forms").getFullList({
      filter: pb.filter("organization = {:o} && template = 'contact'", {
        o: orgId,
      }),
    })
  ).length;
}

describe("assembleSite: complete fixture (TMPL-02, TMPL-04)", () => {
  it("assembles Home and About, publishes version 1, sets nav, stage, audit and email", async (t) => {
    if (!inst) return t.skip();
    const { orgId, slug } = await complete();
    const designBefore = JSON.stringify(
      (await pb.collection("organizations").getOne(orgId)).design ?? null,
    );
    const d = deps();
    const res = await runAssemblyForOrg(orgId, d);
    expect(res.status).toBe("done");
    expect(res.previewHost).toBe(`${slug}.sites.localhost`);

    const ctx = await ownerCtx(orgId);
    const pages = await listPages(ctx);
    const home = pages.find((p) => p.slug === "home")!;
    const about = pages.find((p) => p.slug === "about")!;
    expect(home.status).toBe("published");
    expect(about.status).toBe("published");
    expect(await listPageVersions(ctx, home.id)).toHaveLength(1);
    expect(await listPageVersions(ctx, about.id)).toHaveLength(1);
    expect(res.ledger.pages.home!.versionKey).toBeTruthy();
    expect(res.ledger.pages.about!.versionKey).toBeTruthy();
    expect(res.ledger.pages.home!.pending).toBeUndefined();
    expect(assemblyVersionKeys(res.ledger)).toEqual({
      home: res.ledger.pages.home!.versionKey,
      about: res.ledger.pages.about!.versionKey,
    });

    const homeRows = await listSections(ctx, home.id);
    expect(homeRows.map((s) => s.section_type)).toEqual([
      "hero",
      "columns",
      "services",
      "hours",
      "map",
      "columns",
      "cta-banner",
    ]);
    const bands = homeRows.map(
      (s) => (s.settings as { background_variant?: string }).background_variant,
    );
    expect(bands[0]).toBe("alternate");
    expect(bands[1]).toBe("main");
    expect(bands[2]).toBe("alternate");
    expect(bands[3]).toBe(bands[4]); // hours + map share one slot band
    expect(await sectionTypes(ctx, about.id)).toEqual([
      "text-only",
      "text-only",
      "team",
      "gallery",
      "faq",
      "columns",
      "map",
    ]);

    const nav = await getNav(ctx);
    const targets = nav!.items.map((i) => i.target);
    expect(targets).toContain(`page:${home.id}`);
    expect(targets).toContain(`page:${about.id}`);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "being_built",
    );
    const hosts = await pb
      .collection("org_hosts")
      .getFullList({ filter: byOrg(orgId) });
    expect(hosts.map((h) => h.hostname)).toEqual([`${slug}.sites.localhost`]);
    expect(await contactForms(orgId)).toBe(1);

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'site.assembled'", {
        o: orgId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect((audit[0]!.meta as { job?: string }).job).toBe("assembly");
    expect(audit[0]!.actor).toBe("");

    // WR-A07: a system run's content audit rows are CDS's, never the owner's.
    const owner = (await ownerCtx(orgId)).actor;
    const publishes = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'page.publish'", {
        o: orgId,
      }),
    });
    expect(publishes).toHaveLength(2);
    for (const row of publishes) {
      expect(row.actor).toBe("");
      expect(row.actor).not.toBe(owner);
      expect(row.impersonator).toBe("");
      expect(row.ip).toBe("system:assembly");
      expect((row.meta as { job?: string }).job).toBe("assembly");
    }

    const mails = sentOf(d.mail, "site.assembled");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain(
      `http://${slug}.sites.localhost:3000/about`,
    );
    expect(
      JSON.stringify(
        (await pb.collection("organizations").getOne(orgId)).design ?? null,
      ),
    ).toBe(designBefore);
    expect(res.report!.polish).toContain(
      "Theme: import the impeccable theme (D45)",
    );
  });

  it("places the intake alt on the hero and gallery; one photo line per unreviewed asset", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    const intake = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    const target = intake.media.gallery[intake.media.gallery.length - 1]!;
    await pb.collection("media_assets").update(target.id, { alt: "" });
    const res = await runAssemblyForOrg(orgId, deps());
    expect(res.status).toBe("done");
    const pages = await listPages(ctx);
    const home = pages.find((p) => p.slug === "home")!;
    const about = pages.find((p) => p.slug === "about")!;
    const hero = (await listSections(ctx, home.id)).find(
      (s) => s.section_type === "hero",
    )!;
    expect((hero.content as { image_alt?: string }).image_alt).toBe(
      intake.media.hero!.alt,
    );
    const gallery = (await listSections(ctx, about.id)).find(
      (s) => s.section_type === "gallery",
    )!;
    const items = (
      gallery.content as { images: { alt: string; alt_reviewed: boolean }[] }
    ).images;
    expect(items.map((i) => [i.alt, i.alt_reviewed])).toEqual(
      intake.media.gallery.map((g) =>
        g.id === target.id ? ["", false] : [g.alt, g.alt_reviewed],
      ),
    );
    const photoLines = res.report!.polish.filter((l) =>
      l.startsWith("Photos ·"),
    );
    expect(photoLines).toEqual(["Photos · 1 need a reviewed description"]);
  });

  it("the seeded intakes match the template fixtures (facts and media alt, ids aside)", async (t) => {
    if (!inst) return t.skip();
    const pairs: [Promise<{ orgId: string }>, AssemblyIntake][] = [
      [complete(), COMPLETE_INTAKE],
      [minimal(), MINIMAL_INTAKE],
    ];
    for (const [seeded, fixture] of pairs) {
      const { orgId } = await seeded;
      const real = await getIntakeForAssembly(
        await ownerCtx(orgId),
        ADDON_REGISTRY,
      );
      const a = readFacts(real);
      const b = readFacts(fixture);
      expect(a.businessName).toBe(b.businessName);
      expect(a.businessTypeId).toBe(b.businessTypeId);
      expect(a.services.length).toBe(b.services.length);
      expect(a.team.length).toBe(b.team.length);
      expect(a.heroAsset !== null).toBe(b.heroAsset !== null);
      const noId = (r: { alt: string; alt_reviewed: boolean } | null) =>
        r ? { alt: r.alt, alt_reviewed: r.alt_reviewed } : null;
      expect(noId(real.media.hero)).toEqual(noId(fixture.media.hero));
      expect(real.media.gallery.map(noId)).toEqual(
        fixture.media.gallery.map(noId),
      );
    }
  });
});

describe("assembleSite: minimal fixture", () => {
  it("text-only hero and contact on Home; FAQ and contact on About; no logo line", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await minimal();
    const res = await runAssemblyForOrg(orgId, deps());
    expect(res.status).toBe("done");
    const ctx = await ownerCtx(orgId);
    const pages = await listPages(ctx);
    const home = pages.find((p) => p.slug === "home")!;
    const about = pages.find((p) => p.slug === "about")!;
    const homeTypes = await sectionTypes(ctx, home.id);
    expect(homeTypes[0]).toBe("hero");
    const hero = (await listSections(ctx, home.id))[0]!;
    expect((hero.content as { image?: string }).image ?? "").toBe("");
    expect(homeTypes).toContain("columns");
    expect(await sectionTypes(ctx, about.id)).toContain("faq");
    const placed = (page: string) =>
      res
        .report!.slots.filter((s) => s.page === page && s.source !== "omitted")
        .map((s) => s.slot);
    expect(placed("home")).toEqual(["hero", "contact"]);
    expect(placed("about")).toEqual(["faq", "contact"]);
    expect(
      res.report!.slots.find((s) => s.page === "home" && s.slot === "hero")!
        .source,
    ).toBe("fallback");
    expect(res.report!.polish).toContain(
      "Logo · None: business name shown instead",
    );
  });
});

describe("assembleSite: re-runs and resume (A2-Q3, A2-Q4)", () => {
  it("re-run: a second call is already; --rerun rebuilds untouched pages once", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await runAssemblyForOrg(orgId, deps());
    const d2 = deps();
    const again = await runAssemblyForOrg(orgId, d2);
    expect(again.status).toBe("already");
    expect(d2.mail.sent).toHaveLength(0);
    const home = (await listPages(ctx)).find((p) => p.slug === "home")!;
    expect(await listPageVersions(ctx, home.id)).toHaveLength(1);

    const d3 = deps();
    const rerun = await runAssemblyForOrg(orgId, d3, { rerun: true });
    expect(rerun.status).toBe("done");
    expect(rerun.report!.pages.map((p) => p.outcome)).toEqual([
      "rebuilt",
      "rebuilt",
    ]);
    expect((await pagesBySlug(orgId)).sort()).toEqual(["about", "home"]);
    expect(await contactForms(orgId)).toBe(1);
    expect(await listPageVersions(ctx, home.id)).toHaveLength(2);
    expect(sentOf(d3.mail, "site.assembled")).toHaveLength(1);
  });

  it("edited: an About the owner changed is left alone on re-run; Home is rebuilt", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await runAssemblyForOrg(orgId, deps());
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    await saveSection(ctx, sections, {
      pageId: about.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Owner note", text: "<p>Mine</p>" },
    });
    const before = await sectionTypes(ctx, about.id);
    const res = await runAssemblyForOrg(orgId, deps(), { rerun: true });
    expect(res.status).toBe("done");
    const out = Object.fromEntries(
      res.report!.pages.map((p) => [p.key, p.outcome]),
    );
    expect(out).toEqual({ home: "rebuilt", about: "edited" });
    expect(await sectionTypes(ctx, about.id)).toEqual(before);
  });

  it("edited: a re-run that only finds edited pages sends no email", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await runAssemblyForOrg(orgId, deps());
    for (const p of await listPages(ctx)) {
      await saveSection(ctx, sections, {
        pageId: p.id,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Owner note", text: "<p>Mine</p>" },
      });
    }
    const d = deps();
    const res = await runAssemblyForOrg(orgId, d, { rerun: true });
    expect(res.status).toBe("done");
    expect(res.report!.pages.map((p) => p.outcome)).toEqual([
      "edited",
      "edited",
    ]);
    expect(d.mail.sent).toHaveLength(0);
  });

  it("WR-A01: a re-run leaves the owner's menu alone (a removed About stays out)", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await runAssemblyForOrg(orgId, deps());
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    const d = deps();
    await removePageFromNav(
      ctx,
      { sections, invalidator: recordingInvalidator() },
      about.id,
    );
    const before = await getNav(ctx);
    expect(before!.items.map((i) => i.target)).not.toContain(
      `page:${about.id}`,
    );
    const res = await runAssemblyForOrg(orgId, d, { rerun: true });
    expect(res.status).toBe("done");
    expect(await getNav(ctx)).toEqual(before);
  });

  it("WR-A02: a re-run never binds contact blocks to a held contact form", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const first = await runAssemblyForOrg(orgId, deps());
    const heldId = first.ledger.form_id!;
    expect(heldId).toBeTruthy();
    await pb.collection("content_flags").create({
      organization: orgId,
      target_collection: "forms",
      target_id: heldId,
      verdict: "held",
      status: "open",
    });
    const res = await runAssemblyForOrg(orgId, deps(), { rerun: true });
    expect(res.status).toBe("done");
    expect(res.ledger.form_id).toBeTruthy();
    expect(res.ledger.form_id).not.toBe(heldId);
    const ctx = await ownerCtx(orgId);
    const home = (await listPages(ctx)).find((p) => p.slug === "home")!;
    const rows = JSON.stringify(
      (await listSections(ctx, home.id)).map((s) => s.content),
    );
    expect(rows).not.toContain(heldId);
    expect(rows).toContain(res.ledger.form_id!);
  });

  it("deleted: an About someone deleted is never recreated; nav keeps Home", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await runAssemblyForOrg(orgId, deps());
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    for (const row of await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: about.id }),
    })) {
      await pb.collection("page_sections").delete(row.id);
    }
    await pb.collection("pages").delete(about.id);
    const res = await runAssemblyForOrg(orgId, deps(), { rerun: true });
    expect(res.status).toBe("done");
    expect(res.report!.pages.find((p) => p.key === "about")!.outcome).toBe(
      "deleted",
    );
    expect(await pagesBySlug(orgId)).toEqual(["home"]);
    const home = (await listPages(ctx)).find((p) => p.slug === "home")!;
    const nav = await getNav(ctx);
    expect(nav!.items.map((i) => i.target)).toContain(`page:${home.id}`);
  });

  it("resume: a publish failure on About keeps Home; the next run finishes without duplicates", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    let calls = 0;
    const failing: AssemblyDeps["publish"] = async (c, id, pd) => {
      calls += 1;
      if (calls === 2) throw new Error("store down");
      return publishPage(c, id, pd);
    };
    const first = await runAssemblyForOrg(orgId, deps({ publish: failing }));
    expect(first.status).toBe("failed");
    expect(first.ledger.status).toBe("failed");
    expect(first.ledger.error).toEqual({
      code: "PUBLISH_FAILED",
      page: "about",
    });
    expect(first.ledger.attempts).toBe(1);
    expect(first.ledger.pages.home!.published).toBe(true);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "ready_for_build",
    );

    const second = await runAssemblyForOrg(orgId, deps());
    expect(second.status).toBe("done");
    expect((await pagesBySlug(orgId)).sort()).toEqual(["about", "home"]);
    expect(await contactForms(orgId)).toBe(1);
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    expect(about.status).toBe("published");
  });

  it("WR-A03: a success resets attempts; a failed re-run after it sends no failure email", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const broken: AssemblyDeps["publish"] = () =>
      Promise.reject(new Error("down"));
    for (let i = 0; i < 2; i++) {
      await runAssemblyForOrg(orgId, deps({ publish: broken }));
    }
    const ok = await runAssemblyForOrg(orgId, deps());
    expect(ok.status).toBe("done");
    expect(ok.ledger.attempts).toBe(0);
    const d = deps({ publish: broken });
    const failed = await runAssemblyForOrg(orgId, d, { rerun: true });
    expect(failed.status).toBe("failed");
    expect(failed.ledger.attempts).toBe(1);
    expect(sentOf(d.mail, "site.assembly_failed")).toHaveLength(0);
  });

  it("WR-A05: another process's fresh claim makes the run busy; a stale one is taken over", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const key = assemblyLockKey(orgId);
    const lockRows = async () =>
      (
        await pb.collection("platform_meta").getFullList({
          filter: pb.filter("key = {:key}", { key }),
        })
      ).length;
    const now = new Date();
    // The site:assemble CLI (another process) holds a fresh claim.
    const held = await pb.collection("platform_meta").create({
      key,
      value: `other ${new Date(now.getTime() - 60_000).toISOString()}`,
    });
    const before = await counts(orgId);
    const busy = await runAssemblyForOrg(orgId, deps(), { now });
    expect(busy.status).toBe("busy");
    expect(await counts(orgId)).toEqual(before);
    expect(await lockRows()).toBe(1);

    // The holder crashed 31 minutes ago: the claim is stale and taken over.
    await pb.collection("platform_meta").update(held.id, {
      value: `other ${new Date(now.getTime() - 31 * 60_000).toISOString()}`,
    });
    const res = await runAssemblyForOrg(orgId, deps(), { now });
    expect(res.status).toBe("done");
    expect((await pagesBySlug(orgId)).sort()).toEqual(["about", "home"]);
    // Released after the run.
    expect(await lockRows()).toBe(0);
  });

  it("WR-A05: the lock row is unique per org and released after a failed run", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const key = assemblyLockKey(orgId);
    const now = new Date();
    const a = await acquirePlatformLock(key, { now, staleMs: 60_000 });
    expect(a).not.toBeNull();
    expect(await acquirePlatformLock(key, { now, staleMs: 60_000 })).toBeNull();
    // A wrong token never releases someone else's claim.
    await releasePlatformLock(key, "not-the-holder");
    expect(await acquirePlatformLock(key, { now, staleMs: 60_000 })).toBeNull();
    await releasePlatformLock(key, a!);

    const broken: AssemblyDeps["publish"] = () =>
      Promise.reject(new Error("down"));
    const failed = await runAssemblyForOrg(orgId, deps({ publish: broken }));
    expect(failed.status).toBe("failed");
    const again = await acquirePlatformLock(key, { now, staleMs: 60_000 });
    expect(again).not.toBeNull();
    await releasePlatformLock(key, again!);
  });

  it("three failed tries send one site.assembly_failed; a fourth sends none", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const broken: AssemblyDeps["publish"] = () =>
      Promise.reject(new Error("down"));
    const mails: number[] = [];
    let last = null as Awaited<ReturnType<typeof runAssemblyForOrg>> | null;
    for (let i = 0; i < 4; i++) {
      const d = deps({ publish: broken });
      last = await runAssemblyForOrg(orgId, d);
      mails.push(sentOf(d.mail, "site.assembly_failed").length);
    }
    expect(mails).toEqual([0, 0, 1, 0]);
    expect(last!.ledger.failure_emailed).toBe(true);
    const { ledger } = await readLedger(await ownerCtx(orgId));
    expect(ledger.failure_emailed).toBe(true);
    expect(ledger.attempts).toBe(4);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "ready_for_build",
    );
  });
});

describe("assembleSite: held publish, existing pages, stage guard", () => {
  it("held: a content check that holds About is reported, not failed", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const scanner: ContentScanner = {
      scan: ({ texts }) =>
        Promise.resolve(
          texts.some((x) => x.includes("Our work"))
            ? { verdict: "held", reasons: ["test hold"] }
            : { verdict: "clean", reasons: [] },
        ),
    };
    const res = await runAssemblyForOrg(orgId, deps({ scanner }));
    expect(res.status).toBe("done");
    expect(res.report!.pages.find((p) => p.key === "about")!.outcome).toBe(
      "held",
    );
    expect(res.report!.polish).toContain("About · Held by the content check");
    expect(res.ledger.pages.about!.published).toBe(false);
    expect(res.ledger.attempts).toBe(0);
    const ctx = await ownerCtx(orgId);
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    expect(about.status).not.toBe("published");
    // WR-A01: a held (unpublished) page is not linked from the menu.
    const targets = (await getNav(ctx))!.items.map((i) => i.target);
    expect(targets).not.toContain(`page:${about.id}`);
    expect(targets).toContain(`page:${res.ledger.pages.home!.id}`);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "being_built",
    );
  });

  it("an existing Home with blocks is left alone; an empty about page is adopted", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    const home = await createPage(ctx, { title: "Home", slug: "home" });
    await saveSection(ctx, sections, {
      pageId: home.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Mine", text: "<p>Hi</p>" },
    });
    const about = await createPage(ctx, { title: "About", slug: "about" });
    const res = await runAssemblyForOrg(orgId, deps());
    expect(res.status).toBe("done");
    const out = Object.fromEntries(
      res.report!.pages.map((p) => [p.key, p.outcome]),
    );
    expect(out).toEqual({ home: "skipped_existing", about: "created" });
    expect(await sectionTypes(ctx, home.id)).toEqual(["text-only"]);
    // WR-A06: the empty about page is used, never a second one at about-2.
    expect(res.ledger.pages.about!.id).toBe(about.id);
    expect((await pagesBySlug(orgId)).sort()).toEqual(["about", "home"]);
    expect(res.report!.polish).toContain("Home · Already existed: left alone");
  });

  it("WR-A06: an existing About with the owner's blocks is left alone: no about-2, no second menu link", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    const about = await createPage(ctx, { title: "About", slug: "about" });
    await saveSection(ctx, sections, {
      pageId: about.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Mine", text: "<p>Hi</p>" },
    });
    const dry = await runAssemblyForOrg(orgId, deps(), { dryRun: true });
    expect(dry.report!.pages.find((p) => p.key === "about")!.outcome).toBe(
      "skipped_existing",
    );
    const res = await runAssemblyForOrg(orgId, deps());
    expect(res.status).toBe("done");
    expect(res.report!.pages.find((p) => p.key === "about")!.outcome).toBe(
      "skipped_existing",
    );
    expect(res.report!.polish).toContain("About · Already existed: left alone");
    expect(res.ledger.pages.about).toBeUndefined();
    expect((await pagesBySlug(orgId)).sort()).toEqual(["about", "home"]);
    expect(await sectionTypes(ctx, about.id)).toEqual(["text-only"]);
    const labels = (await getNav(ctx))!.items.map((i) => i.label);
    expect(labels.filter((l) => l === "About").length).toBeLessThanOrEqual(1);
  });

  it("stage guard: intake and fit_review are not_ready and nothing is written", async (t) => {
    if (!inst) return t.skip();
    for (const stage of ["intake", "fit_review"]) {
      const { orgId } = await complete();
      await pb.collection("organizations").update(orgId, { stage });
      const before = await counts(orgId);
      const res = await runAssemblyForOrg(orgId, deps());
      expect(res.status).toBe("not_ready");
      expect(await counts(orgId)).toEqual(before);
    }
  });
});

describe("assembleSite: isolation, add-ons, second template, dry run", () => {
  it("cross-tenant: assembling A never touches B; A's context cannot write B's ledger", async (t) => {
    if (!inst) return t.skip();
    const A = await complete();
    const B = await complete();
    const before = await counts(B.orgId);
    expect((await runAssemblyForOrg(A.orgId, deps())).status).toBe("done");
    expect(await counts(B.orgId)).toEqual(before);
    const bRow = await pb
      .collection("org_intake")
      .getFirstListItem(byOrg(B.orgId));
    const ctxA = await ownerCtx(A.orgId);
    const { ledger } = await readLedger(ctxA);
    await expect(writeLedger(ctxA, bRow.id, ledger)).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(await counts(B.orgId)).toEqual(before);
  });

  it("an active add-on fills the proof slot (registry contribution)", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const ctx = await ownerCtx(orgId);
    await installAddon(
      ctx,
      {
        sections,
        invalidator: recordingInvalidator(),
        pinger: { ping: () => Promise.resolve() },
        addons: ADDON_REGISTRY,
      },
      "testimonials",
    );
    const res = await runAssemblyForOrg(orgId, deps());
    expect(res.status).toBe("done");
    const proof = res.report!.slots.find(
      (s) => s.page === "home" && s.slot === "proof",
    )!;
    expect(proof.source).toBe("provided");
    const home = (await listPages(ctx)).find((p) => p.slug === "home")!;
    const types = await sectionTypes(ctx, home.id);
    expect(
      types.some((x) => ADDON_REGISTRY.ownerOf(x) === "testimonials"),
    ).toBe(true);
  });

  it("second template: a fake shop template provisions through the same function (TMPL-03)", async (t) => {
    if (!inst) return t.skip();
    const def = (type: string) => sections.get(type)!;
    const block = (type: string, content?: unknown) => ({
      section_type: type,
      row_layout: def(type).layouts[0]!,
      content: content ?? def(type).defaultContent(),
    });
    const welcome: Slot = {
      name: "welcome",
      label: "Welcome",
      fill: () => ({
        blocks: [
          block("text-only", { heading: "Welcome", text: "<p>Shop</p>" }),
        ],
        source: "provided",
      }),
    };
    const catalog: Slot = {
      name: "catalog",
      label: "Catalog",
      fill: () => ({ blocks: [block("services")], source: "fallback" }),
    };
    const FAKE_SHOP: SiteTemplate = {
      id: "shop-test",
      version: 1,
      label: "Shop (test)",
      paths: ["shop"],
      pages: [
        {
          key: "home",
          slug: "home",
          title: () => "Home",
          navLabel: "Home",
          inNav: true,
          slots: [heroSlot, welcome],
        },
        {
          key: "products",
          slug: "products",
          title: () => "Products",
          navLabel: "Products",
          inNav: true,
          slots: [catalog],
        },
      ],
    };
    const { orgId } = await complete();
    await pb.collection("organizations").update(orgId, { path: "shop" });

    const none = await runAssemblyForOrg(orgId, deps());
    expect(none.status).toBe("no_template");
    expect(none.ledger.attempts).toBe(0);

    const ctx = await ownerCtx(orgId);
    const fn = assembleSite;
    const res = await fn(ctx, ADDON_REGISTRY, deps({ templates: [FAKE_SHOP] }));
    expect(res.status).toBe("done");
    expect(res.ledger.template_id).toBe("shop-test");
    const pages = await listPages(ctx);
    const home = pages.find((p) => p.slug === "home")!;
    const products = pages.find((p) => p.slug === "products")!;
    expect(home.status).toBe("published");
    expect(products.status).toBe("published");
    expect(await sectionTypes(ctx, products.id)).toEqual(["services"]);
    const nav = await getNav(ctx);
    const items = nav!.items.map((i) => [i.label, i.target]);
    expect(items).toContainEqual(["Home", `page:${home.id}`]);
    expect(items).toContainEqual(["Products", `page:${products.id}`]);
  });

  it("WR-A04: a slot fill that throws fails as FILL_FAILED with its page key", async (t) => {
    if (!inst) return t.skip();
    const broken: Slot = {
      name: "broken",
      label: "Broken",
      fill: () => {
        throw new Error("template bug");
      },
    };
    const BROKEN: SiteTemplate = {
      id: "broken-test",
      version: 1,
      label: "Broken (test)",
      paths: ["shop"],
      pages: [
        {
          key: "home",
          slug: "home",
          title: () => "Home",
          navLabel: "Home",
          inNav: true,
          slots: [broken],
        },
      ],
    };
    const { orgId } = await complete();
    await pb.collection("organizations").update(orgId, { path: "shop" });
    const ctx = await ownerCtx(orgId);
    const res = await assembleSite(
      ctx,
      ADDON_REGISTRY,
      deps({ templates: [BROKEN] }),
    );
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("FILL_FAILED");
    expect(res.ledger.error).toEqual({ code: "FILL_FAILED", page: "home" });
  });

  it("dry run: returns the report and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const before = await counts(orgId);
    const d = deps();
    const res = await runAssemblyForOrg(orgId, d, { dryRun: true });
    expect(res.status).toBe("done");
    expect(res.dryRun).toBe(true);
    expect(res.report!.pages.map((p) => p.outcome)).toEqual([
      "created",
      "created",
    ]);
    expect(await counts(orgId)).toEqual(before);
    expect(d.mail.sent).toHaveLength(0);
  });
});

describe("assembleSiteAsStaff (R-2, invariant 10)", () => {
  it("support_agent assembles as the impersonating staff member", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await complete();
    const pctx = mintPlatformContext({
      actor: staffUser,
      staffRole: "support_agent",
      ip: "10.0.0.1",
    });
    const d = deps();
    const res = await assembleSiteAsStaff(pctx, orgId, {}, d);
    expect(res.status).toBe("done");
    const audit = await pb.collection("audit_log").getFirstListItem(
      pb.filter("organization = {:o} && action = 'site.assembled'", {
        o: orgId,
      }),
    );
    expect(audit.actor).toBe(staffUser);
    expect(audit.impersonator).toBe(staffUser);
    expect((audit.meta as { job?: string }).job).toBe("assembly");
    expect(sentOf(d.mail, "site.assembled")).toHaveLength(1);
  });

  it("refuses a role outside the matrix, a malformed id and an unknown org", async (t) => {
    if (!inst) return t.skip();
    const bad = mintPlatformContext({
      actor: staffUser,
      staffRole: "billing" as never,
      ip: "10.0.0.1",
    });
    await expect(
      assembleSiteAsStaff(bad, "aaaaaaaaaaaaaaa", {}, deps()),
    ).rejects.toBeInstanceOf(Forbidden);
    const ok = mintPlatformContext({
      actor: staffUser,
      staffRole: "super_admin",
      ip: "10.0.0.1",
    });
    await expect(
      assembleSiteAsStaff(ok, "not an id", {}, deps()),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      assembleSiteAsStaff(ok, "zzzzzzzzzzzzzzz", {}, deps()),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
