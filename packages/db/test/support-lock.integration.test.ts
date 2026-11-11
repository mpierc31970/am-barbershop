// 12-08: the content lock is a repository write rule (D102, P12-P4; T-12-08-01, T-12-08-02).
// A tenant content write to a target a started service window covers throws TargetLocked in
// commit(); writes outside the allowlist (visitor submits, Support, business info, billing)
// never lock; impersonated staff and system jobs bypass; the lock lifts when the window ends.
// Registers add-on collections before anything reads the composed registry.
import "@cds/addon-registry/server";
import { TargetLocked } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser, withSuperuser } from "../src/client";
import { saveFooter } from "../src/content/chrome/footer";
import { saveSiteSettings } from "../src/content/chrome/settings";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { saveSection } from "../src/content/sections";
import { commit, type Op } from "../src/content/shared";
import { mintOrgContext, type OrgContext } from "../src/context";
import { newRecordId } from "../src/repository";
import {
  assertNotLocked,
  lockTargetsFor,
  resetLockCacheForTests,
} from "../src/support/lock";
import { staffCreateServiceWindow } from "../src/support/windows";
import { bootPb, type PbInstance } from "./pb-harness";
import { fixedClock } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;
let otherPage = "";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };
const HOUR = 3_600_000;
const deps: ContentDeps = {
  sections: registry,
  invalidator: recordingInvalidator(),
  pinger: { async ping() {} },
};

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb, { now: new Date() });
  otherPage = (
    await pb.collection("pages").create({
      organization: seed.A.org,
      slug: "menu",
      title: "Menu",
      status: "draft",
      kind: "builder",
    })
  ).id;
});

afterAll(async () => {
  await inst?.stop();
});

let nowMs = Date.now();
beforeEach(() => {
  nowMs = Date.now();
  resetLockCacheForTests({ now: () => new Date(nowMs) });
});

/** A window started an hour ago, ending in an hour (relative to the pinned lock clock). */
async function window(
  input: Record<string, unknown>,
  who: "agent" | "superAdmin" = "agent",
): Promise<{ id: string; endsAt: number }> {
  const clock = fixedClock(new Date(nowMs).toISOString());
  const endsAt = nowMs + HOUR;
  const made = await staffCreateServiceWindow(
    seed.staff[who],
    {
      startsAt: new Date(nowMs - HOUR),
      endsAt: new Date(endsAt),
      ...input,
    } as never,
    {
      clock,
      addons: [
        { slug: "testimonials", name: "Testimonials" },
        { slug: "credentials", name: "Credentials" },
      ],
      notify: {},
    },
  );
  return { id: made.id, endsAt };
}

async function clear(id: string) {
  await pb
    .collection("service_windows")
    .update(id, { cleared_at: new Date(nowMs - 1000).toISOString() });
}

const text = (pageId: string) => ({
  pageId,
  section_type: "text-only",
  row_layout: "full",
  content: { heading: "Hi", text: "<p>x</p>" },
});

function footer(copyright: string) {
  return {
    show_address: false,
    show_hours: false,
    show_socials: false,
    extra_links: [],
    copyright,
  };
}

async function direct(ctx: OrgContext, ops: Op[]) {
  await withSuperuser((p) =>
    commit(p, ctx, ops, { action: "test.write", targetCollection: "x" }),
  );
}

describe("lockTargetsFor (allowlist)", () => {
  it("maps only lockable collections", async (t) => {
    if (!inst) return t.skip();
    await withSuperuser(async (p) => {
      const targets = await lockTargetsFor(p, [
        { collection: "pages", op: "update", id: seed.A.livePage, body: {} },
        {
          collection: "page_sections",
          op: "create",
          id: newRecordId(),
          body: { page: otherPage },
        },
        { collection: "popups", op: "delete", id: newRecordId() },
        {
          collection: "site_settings",
          op: "update",
          id: newRecordId(),
          body: { footer: {}, nav: {} },
        },
        { collection: "testimonials", op: "delete", id: newRecordId() },
        // Never targets: visitor writes, support, business info, billing, audit.
        { collection: "form_submissions", op: "delete", id: newRecordId() },
        { collection: "form_drafts", op: "delete", id: newRecordId() },
        { collection: "support_threads", op: "delete", id: newRecordId() },
        { collection: "business_profile", op: "delete", id: newRecordId() },
        { collection: "billing_accounts", op: "delete", id: newRecordId() },
        { collection: "audit_log", op: "delete", id: newRecordId() },
      ]);
      expect(targets).toEqual(
        expect.arrayContaining([
          { kind: "page", id: seed.A.livePage },
          { kind: "page", id: otherPage },
          { kind: "content" },
          { kind: "part", key: "footer" },
          { kind: "part", key: "menus" },
          { kind: "addon", slug: "testimonials" },
        ]),
      );
      expect(targets).toHaveLength(6);
    });
  });
});

describe("the content lock (D102)", () => {
  it("a page window locks that page's sections, not another page's", async (t) => {
    if (!inst) return t.skip();
    const w = await window({
      scope: "page",
      orgId: seed.A.org,
      pageId: seed.A.livePage,
    });
    const editor = seed.A.ctx.editor;
    await expect(
      saveSection(editor, registry, text(seed.A.livePage), NO_OWNERS),
    ).rejects.toThrow(TargetLocked);
    const ok = await saveSection(editor, registry, text(otherPage), NO_OWNERS);
    expect(ok.id).toBeTruthy();
    // An update of an existing section (no page in the body) is resolved by lookup.
    await clear(w.id);
    const s = await saveSection(
      editor,
      registry,
      text(seed.A.livePage),
      NO_OWNERS,
    );
    const w2 = await window({
      scope: "page",
      orgId: seed.A.org,
      pageId: seed.A.livePage,
    });
    await expect(
      direct(editor, [
        {
          collection: "page_sections",
          op: "update",
          id: s.id,
          body: { hidden: true },
        },
      ]),
    ).rejects.toThrow(TargetLocked);
    // Org B is never reached by org A's window.
    const other = await saveSection(
      seed.B.ctx.owner,
      registry,
      text(seed.B.livePage),
      NO_OWNERS,
    );
    expect(other.id).toBeTruthy();
    await clear(w2.id);
  });

  it("an organization window locks content only: submits, support, business info and billing still write", async (t) => {
    if (!inst) return t.skip();
    const w = await window({ scope: "organization", orgId: seed.A.org });
    const owner = seed.A.ctx.owner;
    await expect(
      saveSection(owner, registry, text(otherPage), NO_OWNERS),
    ).rejects.toThrow(TargetLocked);
    await expect(saveFooter(owner, deps, footer("Locked"))).rejects.toThrow(
      TargetLocked,
    );

    const form = await pb.collection("forms").create({
      organization: seed.A.org,
      name: "Contact",
    });
    // A visitor submit (any org context, even a member's) is never a lock target.
    await direct(owner, [
      {
        collection: "form_submissions",
        op: "create",
        id: newRecordId(),
        body: { organization: seed.A.org, form: form.id, data: { a: 1 } },
      },
    ]);
    // Business info and billing settings stay writable.
    await direct(owner, [
      {
        collection: "organizations",
        op: "update",
        id: seed.A.org,
        body: { name: "Rivera Bakery" },
      },
      {
        collection: "billing_accounts",
        op: "update",
        id: seed.A.billingAccount,
        body: { care_plan: true },
      },
    ]);
    // A support thread (written by the support module, not a content collection).
    await direct(owner, [
      {
        collection: "support_threads",
        op: "create",
        id: newRecordId(),
        body: {
          organization: seed.A.org,
          kind: "ticket",
          number: 9001,
          type: "question",
          subject: "Can I still ask?",
          status: "open",
          opened_by: seed.A.users.owner,
        },
      },
    ]);
    await clear(w.id);
  });

  it("a component window on the footer locks the footer, not the header", async (t) => {
    if (!inst) return t.skip();
    const w = await window({
      scope: "component",
      orgId: seed.A.org,
      component: "footer",
    });
    const admin = seed.A.ctx.admin;
    await expect(saveFooter(admin, deps, footer("Paused"))).rejects.toThrow(
      TargetLocked,
    );
    await saveSiteSettings(admin, deps, {
      language: "en",
      show_translate: false,
      show_search: true,
      allow_ai_crawlers: true,
      share_image: "",
    } as never);
    await clear(w.id);
  });

  it("an add-on window locks that add-on's records, not another add-on's", async (t) => {
    if (!inst) return t.skip();
    const w = await window(
      { scope: "addon", addon: "testimonials" },
      "superAdmin",
    );
    const owner = seed.A.ctx.owner;
    // Reaches only orgs with the add-on active.
    await pb.collection("org_addons").create({
      organization: seed.A.org,
      addon: "testimonials",
      status: "active",
      source: "staff",
    });
    await expect(
      direct(owner, [
        {
          collection: "testimonials",
          op: "create",
          id: newRecordId(),
          body: {
            organization: seed.A.org,
            quote: "Great bread",
            author_name: "Sam",
          },
        },
      ]),
    ).rejects.toThrow(TargetLocked);
    await direct(owner, [
      {
        collection: "credentials",
        op: "create",
        id: newRecordId(),
        body: {
          organization: seed.A.org,
          title: "Food handler",
          issuer: "County",
        },
      },
    ]);
    // Org B does not have testimonials on: not reached.
    await direct(seed.B.ctx.owner, [
      {
        collection: "testimonials",
        op: "create",
        id: newRecordId(),
        body: {
          organization: seed.B.org,
          quote: "Lovely",
          author_name: "Ana",
        },
      },
    ]);
    await clear(w.id);
  });

  it("impersonated staff and system jobs bypass the lock", async (t) => {
    if (!inst) return t.skip();
    const w = await window({ scope: "organization", orgId: seed.A.org });
    const page = seed.A.livePage;
    await expect(
      saveSection(seed.A.ctx.owner, registry, text(page), NO_OWNERS),
    ).rejects.toThrow(TargetLocked);
    const imp = await saveSection(
      seed.A.impersonatedOwner,
      registry,
      text(page),
      NO_OWNERS,
    );
    expect(imp.id).toBeTruthy();
    const job = mintOrgContext({
      orgId: seed.A.org,
      actor: "",
      role: "owner",
      grants: [],
      systemJob: "assembly",
      ip: "127.0.0.1",
    });
    const sys = await saveSection(job, registry, text(page), NO_OWNERS);
    expect(sys.id).toBeTruthy();
    await clear(w.id);
  });

  it("after the window ends the save succeeds", async (t) => {
    if (!inst) return t.skip();
    const w = await window({ scope: "organization", orgId: seed.A.org });
    const editor = seed.A.ctx.editor;
    await expect(
      saveSection(editor, registry, text(otherPage), NO_OWNERS),
    ).rejects.toThrow(TargetLocked);
    // Move the lock clock past the end.
    nowMs = w.endsAt + 1000;
    const ok = await saveSection(editor, registry, text(otherPage), NO_OWNERS);
    expect(ok.id).toBeTruthy();
    await withSuperuser((p) =>
      assertNotLocked(p, editor, [{ kind: "content" }], new Date(nowMs)),
    );
  });
});
