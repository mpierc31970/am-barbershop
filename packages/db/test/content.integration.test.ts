// Content chokepoint writers on the real PocketBase 0.39.11 binary (CONT-01, CONT-02,
// CONT-07, CONT-11, CONT-12, CONT-31; invariant 1, TEN-03; Pitfall 7 reference IDOR).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { listMemberOrganizations, signInMember } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import {
  createPage,
  getPage,
  listPages,
  SlugReserved,
  SlugTaken,
  updatePage,
} from "../src/content/pages";
import {
  deleteSection,
  listSections,
  reorderSections,
  saveSection,
  setSectionHidden,
  ADDON_REGISTRY_MISSING,
  undoDeleteSection,
} from "../src/content/sections";
import {
  deletePopup,
  getPopup,
  listPopups,
  popupUsage,
  savePopup,
  setPopupEnabled,
} from "../src/content/popups";
import {
  liveTag,
  recordingInvalidator,
  type ContentDeps,
  type ContentScanner,
} from "../src/content/ports";
import { publishPage } from "../src/content/publish";
import { keywordScanner } from "../src/content/scan-standin";
import { getBanner, saveBanner } from "../src/content/site-settings";
import { mintOrgContext, type OrgContext } from "../src/context";
import { envPrefix, getObjectStore } from "../src/storage";
import { fixtureAddonSection } from "../../core/src/content/__fixtures__/fixture-addon";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const registry = composeSectionRegistry(CORE_SECTIONS, [fixtureAddonSection]);
/** An add-on owner lookup that owns nothing (this suite has no add-ons installed). */
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function ctxAs(
  orgId: string,
  actor: string,
  role: OrgContext["role"],
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-content-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

/**
 * 14-21 (CONT-16): pings reach the pinger only for a live org (the eligibility guard), and the
 * seeded orgs have an empty stage. Make org A live for one test; restored when it ends.
 */
async function liveForTest(orgId: string): Promise<void> {
  await pb.collection("organizations").update(orgId, { stage: "live" });
  onTestFinished(async () => {
    await pb.collection("organizations").update(orgId, { stage: "" });
  });
}

describe("pages writer (CONT-30)", () => {
  it("rejects a badly formatted slug", async (t) => {
    if (!inst) return t.skip();
    await expect(
      createPage(seed.ctxA, { title: "About", slug: "About Us" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("rejects a reserved slug with SlugReserved", async (t) => {
    if (!inst) return t.skip();
    const err = await createPage(seed.ctxA, {
      title: "Hub",
      slug: "hub",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlugReserved);
    expect((err as SlugReserved).code).toBe("slug_reserved");
    expect((err as Error).message).toBe(
      "/hub is used by the system. Pick another address.",
    );
  });

  it("a page made before /privacy was reserved still saves, and can move off it (WR-A06)", async (t) => {
    if (!inst) return t.skip();
    const legacy = await createPage(seed.ctxA, {
      title: "Privacy",
      slug: "legacy-privacy",
    });
    // Simulate a pre-P9 page: the slug was legal when it was created.
    await pb.collection("pages").update(legacy.id, { slug: "privacy" });
    const saved = await updatePage(seed.ctxA, legacy.id, {
      title: "Our privacy",
      slug: "privacy",
    });
    expect(saved.title).toBe("Our privacy");
    expect(saved.slug).toBe("privacy");
    const moved = await updatePage(seed.ctxA, legacy.id, {
      slug: "privacy-notes",
    });
    expect(moved.slug).toBe("privacy-notes");
    // Moving onto a reserved slug is still refused.
    await expect(
      updatePage(seed.ctxA, legacy.id, { slug: "terms" }),
    ).rejects.toBeInstanceOf(SlugReserved);
  });

  it("slugs are unique per org, not globally", async (t) => {
    if (!inst) return t.skip();
    const about = await createPage(seed.ctxA, {
      title: "About",
      slug: "about",
    });
    expect(about.status).toBe("draft");
    expect(about.kind).toBe("builder");
    const err = await createPage(seed.ctxA, {
      title: "About 2",
      slug: "about",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlugTaken);
    expect((err as Error).message).toBe(
      "Another page already uses /about. Try /about-2.",
    );
    const b = await createPage(seed.ctxB, { title: "About", slug: "about" });
    expect(b.slug).toBe("about");
    const rowB = await pb.collection("pages").getOne(b.id);
    expect(rowB.organization).toBe(seed.B.org);
  });

  it("a viewer is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const viewer = ctxAs(seed.A.org, seed.A.owner, "viewer");
    await expect(
      createPage(viewer, { title: "V", slug: "viewer-page" }),
    ).rejects.toThrow(Forbidden);
  });

  it("organization in the payload of another org is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    await expect(
      createPage(seed.ctxB, {
        title: "Evil",
        slug: "evil",
        organization: seed.A.org,
      } as unknown as { title: string; slug: string }),
    ).rejects.toThrow(InvalidInput);
  });

  it("updatePage changing the slug marks changes and leaves previous_slugs alone", async (t) => {
    if (!inst) return t.skip();
    const p = await createPage(seed.ctxA, {
      title: "Services",
      slug: "services",
    });
    await pb
      .collection("pages")
      .update(p.id, { has_unpublished_changes: false, previous_slugs: [] });
    const u = await updatePage(seed.ctxA, p.id, { slug: "our-services" });
    expect(u.slug).toBe("our-services");
    expect(u.has_unpublished_changes).toBe(true);
    expect(u.previous_slugs).toEqual([]);
    await expect(
      updatePage(seed.ctxA, p.id, { slug: "about" }),
    ).rejects.toThrow(SlugTaken);
  });

  it("the home page keeps its slug", async (t) => {
    if (!inst) return t.skip();
    await expect(
      updatePage(seed.ctxA, seed.A.page, { slug: "start" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("listPages puts home first, then by title", async (t) => {
    if (!inst) return t.skip();
    await createPage(seed.ctxA, { title: "Contact", slug: "contact" });
    const pages = await listPages(seed.ctxA);
    expect(pages[0]!.slug).toBe("home");
    const rest = pages.slice(1).map((p) => p.title);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    for (const p of pages) expect(p).not.toHaveProperty("password_hash");
  });

  it("getPage of org A's page from ctxB is NotFound", async (t) => {
    if (!inst) return t.skip();
    await expect(getPage(seed.ctxB, seed.A.page)).rejects.toThrow(NotFound);
    await expect(
      updatePage(seed.ctxB, seed.A.page, { title: "Owned" }),
    ).rejects.toThrow(NotFound);
    expect((await getPage(seed.ctxA, seed.A.page)).title).toBe("Home");
  });
});

describe("listMemberOrganizations (hub session)", () => {
  it("returns the owner's org with its primary host", async (t) => {
    if (!inst) return t.skip();
    const password = "pw-content-owner-a-1234";
    await pb
      .collection("users")
      .update(seed.A.owner, { password, passwordConfirm: password });
    const { token } = await signInMember("owner-a@cds.test", password, IP);
    const res = await listMemberOrganizations(token);
    expect(res.userId).toBe(seed.A.owner);
    expect(res.email).toBe("owner-a@cds.test");
    expect(res.organizations).toEqual([
      {
        id: seed.A.org,
        name: "Org A",
        role: "owner",
        status: "active",
        primaryHost: "a.example.com",
      },
    ]);
  });

  it("a staff token is NotFound", async (t) => {
    if (!inst) return t.skip();
    const password = "pw-content-staff-1234";
    const staff = await pb.collection("users").create({
      email: "staff-content@cds.test",
      password,
      passwordConfirm: password,
    });
    // Issue a token before the role, then grant it directly (test-only shortcut).
    const { token } = await signInMember(
      "staff-content@cds.test",
      password,
      IP,
    );
    await pb
      .collection("users")
      .update(staff.id, { staff_role: "support_agent" });
    await expect(listMemberOrganizations(token)).rejects.toThrow(NotFound);
  });
});

describe("section writer (CONT-01, CONT-02, CONT-07)", () => {
  let pageId: string;

  const text = (html: string) => ({
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Hi", text: html },
  });

  beforeAll(async () => {
    if (!inst) return;
    pageId = (
      await createPage(seed.ctxA, { title: "Builder", slug: "builder" })
    ).id;
  });

  it("rejects an unregistered or custom section_type", async (t) => {
    if (!inst) return t.skip();
    for (const section_type of ["custom", "nope"]) {
      await expect(
        saveSection(seed.ctxA, registry, {
          pageId,
          section_type,
          row_layout: "full",
          content: {},
        }),
      ).rejects.toThrow(InvalidInput);
    }
  });

  it("saves and reads back an add-on contributed type (CONT-02)", async (t) => {
    if (!inst) return t.skip();
    const input = {
      pageId,
      section_type: "fixture-quote",
      row_layout: "50-50",
      content: { text: "  A quote  ", extra: "dropped" },
    };
    // No owner lookup at all: a non-core type is refused, never let through (A-WR-04).
    await expect(saveSection(seed.ctxA, registry, input)).rejects.toThrow(
      ADDON_REGISTRY_MISSING,
    );
    // An owner lookup that owns no such add-on: the type saves.
    const row = await saveSection(seed.ctxA, registry, input, NO_OWNERS);
    expect(row.section_type).toBe("fixture-quote");
    expect(row.row_layout).toBe("full");
    expect(row.content).toEqual({ text: "A quote" });
    const rows = await listSections(seed.ctxA, pageId);
    expect(rows.map((r) => r.id)).toContain(row.id);
  });

  it("clamps a hero's row_layout to full", async (t) => {
    if (!inst) return t.skip();
    const row = await saveSection(seed.ctxA, registry, {
      pageId,
      section_type: "hero",
      row_layout: "50-50",
      content: { heading: "Welcome" },
    });
    expect(row.row_layout).toBe("full");
  });

  it("normalize: surplus columns merge into the last one (CONT-07)", async (t) => {
    if (!inst) return t.skip();
    const item = (id: string, textValue: string) => ({
      id,
      kind: "heading",
      text: textValue,
      level: 2,
    });
    const row = await saveSection(seed.ctxA, registry, {
      pageId,
      section_type: "columns",
      row_layout: "50-50",
      content: {
        columns: [
          { id: "c1", items: [item("i1", "one")] },
          { id: "c2", items: [item("i2", "two")] },
          { id: "c3", items: [item("i3", "three"), item("i4", "four")] },
        ],
      },
    });
    const stored = await pb.collection("page_sections").getOne(row.id);
    const cols = (
      stored.content as { columns: { items: { text: string }[] }[] }
    ).columns;
    expect(stored.row_layout).toBe("50-50");
    expect(cols).toHaveLength(2);
    expect(cols[0]!.items.map((i) => i.text)).toEqual(["one"]);
    expect(cols[1]!.items.map((i) => i.text)).toEqual(["two", "three", "four"]);
  });

  it("sanitizes rich text and strips settings to background_variant", async (t) => {
    if (!inst) return t.skip();
    const row = await saveSection(seed.ctxA, registry, {
      pageId,
      ...text('<p onclick="x">hi<script>bad()</script></p>'),
      settings: {
        background_variant: "alternate",
        bg_color: "#f00",
        css_class: "x",
      },
    });
    const stored = await pb.collection("page_sections").getOne(row.id);
    expect((stored.content as { text: string }).text).toBe("<p>hi</p>");
    expect(stored.settings).toEqual({ background_variant: "alternate" });
  });

  it("writes page_slug from the page, marks the page changed and inserts after afterId", async (t) => {
    if (!inst) return t.skip();
    await pb
      .collection("pages")
      .update(pageId, { has_unpublished_changes: false });
    const before = await listSections(seed.ctxA, pageId);
    const anchor = before[0]!;
    const row = await saveSection(seed.ctxA, registry, {
      pageId,
      ...text("<p>after first</p>"),
      afterId: anchor.id,
    });
    const stored = await pb.collection("page_sections").getOne(row.id);
    expect(stored.page_slug).toBe("builder");
    expect(stored.organization).toBe(seed.A.org);
    const page = await pb.collection("pages").getOne(pageId);
    expect(page.has_unpublished_changes).toBe(true);
    const after = await listSections(seed.ctxA, pageId);
    expect(after.map((r) => r.id)).toEqual([
      anchor.id,
      row.id,
      ...before.slice(1).map((r) => r.id),
    ]);
    expect(after.map((r) => r.sort_order)).toEqual(after.map((_, i) => i + 1));
    const top = await saveSection(seed.ctxA, registry, {
      pageId,
      ...text("<p>top</p>"),
      afterId: null,
    });
    expect((await listSections(seed.ctxA, pageId))[0]!.id).toBe(top.id);
  });

  it("updates an existing section in place", async (t) => {
    if (!inst) return t.skip();
    const [first] = await listSections(seed.ctxA, pageId);
    const updated = await saveSection(seed.ctxA, registry, {
      id: first!.id,
      pageId,
      ...text("<p>changed</p>"),
    });
    expect(updated.id).toBe(first!.id);
    expect(updated.sort_order).toBe(first!.sort_order);
    expect((updated.content as { text: string }).text).toBe("<p>changed</p>");
  });

  it("writes no version objects on save (D254)", async (t) => {
    if (!inst) return t.skip();
    const store = getObjectStore();
    const objs = await store.list(
      `${envPrefix()}tenants/${seed.A.org}/versions/`,
    );
    expect(objs).toEqual([]);
  });

  it("reorder needs exactly the page's ids and renumbers 1..n", async (t) => {
    if (!inst) return t.skip();
    const rows = await listSections(seed.ctxA, pageId);
    const ids = rows.map((r) => r.id);
    await expect(
      reorderSections(seed.ctxA, pageId, ids.slice(1)),
    ).rejects.toThrow(InvalidInput);
    await expect(
      reorderSections(seed.ctxA, pageId, [...ids, ids[0]!]),
    ).rejects.toThrow(InvalidInput);
    await expect(
      reorderSections(seed.ctxA, pageId, [...ids.slice(1), seed.A.section]),
    ).rejects.toThrow(InvalidInput);
    const reversed = [...ids].reverse();
    await reorderSections(seed.ctxA, pageId, reversed);
    const after = await listSections(seed.ctxA, pageId);
    expect(after.map((r) => r.id)).toEqual(reversed);
    expect(after.map((r) => r.sort_order)).toEqual(after.map((_, i) => i + 1));
  });

  it("hide keeps the block in the draft with is_published=false", async (t) => {
    if (!inst) return t.skip();
    const [first] = await listSections(seed.ctxA, pageId);
    await setSectionHidden(seed.ctxA, first!.id, true);
    const hidden = await pb.collection("page_sections").getOne(first!.id);
    expect(hidden.is_published).toBe(false);
    await setSectionHidden(seed.ctxA, first!.id, false);
    expect(
      (await pb.collection("page_sections").getOne(first!.id)).is_published,
    ).toBe(true);
  });

  it("delete then undo restores the same id and position", async (t) => {
    if (!inst) return t.skip();
    const rows = await listSections(seed.ctxA, pageId);
    const victim = rows[2]!;
    const deleted = await deleteSection(seed.ctxA, victim.id);
    expect(
      (await listSections(seed.ctxA, pageId)).map((r) => r.id),
    ).not.toContain(victim.id);
    const restored = await undoDeleteSection(seed.ctxA, registry, deleted);
    expect(restored.id).toBe(victim.id);
    const after = await listSections(seed.ctxA, pageId);
    expect(after.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(after.map((r) => r.sort_order)).toEqual(after.map((_, i) => i + 1));
  });

  it("undo only restores an id this org deleted from this page, once (WR-A06)", async (t) => {
    if (!inst) return t.skip();
    const made = await saveSection(seed.ctxA, registry, {
      pageId,
      ...text("<p>undo me</p>"),
    });
    const deleted = await deleteSection(seed.ctxA, made.id);
    // A caller-chosen id that was never deleted here: NotFound, no row created.
    await expect(
      undoDeleteSection(seed.ctxA, registry, {
        ...deleted,
        id: "chosenbycaller1",
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      pb.collection("page_sections").getOne("chosenbycaller1"),
    ).rejects.toThrow();
    // Another org's live section id: the same NotFound, not a uniqueness error (no oracle).
    await expect(
      undoDeleteSection(seed.ctxA, registry, {
        ...deleted,
        id: seed.B.section,
      }),
    ).rejects.toThrow(NotFound);
    // Org B cannot undo org A's delete onto its own page.
    await expect(
      undoDeleteSection(seed.ctxB, registry, { ...deleted, page: seed.B.page }),
    ).rejects.toThrow(NotFound);
    // The real undo works once.
    const back = await undoDeleteSection(seed.ctxA, registry, deleted);
    expect(back.id).toBe(made.id);
    await deleteSection(seed.ctxA, made.id);
    await undoDeleteSection(seed.ctxA, registry, deleted);
    await expect(
      undoDeleteSection(seed.ctxA, registry, deleted),
    ).rejects.toThrow(NotFound);
  });

  it("undo without a registry fails with a clear error (WR-A06)", async (t) => {
    if (!inst) return t.skip();
    await expect(
      undoDeleteSection(seed.ctxA, undefined as never, { id: "x" } as never),
    ).rejects.toThrow("undoDeleteSection needs the composed section registry");
  });

  it("IDOR: another org's page or section is NotFound", async (t) => {
    if (!inst) return t.skip();
    await expect(
      saveSection(seed.ctxB, registry, { pageId, ...text("<p>x</p>") }),
    ).rejects.toThrow(NotFound);
    await expect(
      saveSection(seed.ctxB, registry, {
        id: seed.A.section,
        pageId: seed.B.page,
        ...text("<p>x</p>"),
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      saveSection(seed.ctxA, registry, {
        id: seed.A.section,
        pageId,
        ...text("<p>x</p>"),
      }),
    ).rejects.toThrow(NotFound);
    await expect(listSections(seed.ctxB, pageId)).rejects.toThrow(NotFound);
    await expect(
      setSectionHidden(seed.ctxB, seed.A.section, true),
    ).rejects.toThrow(NotFound);
    await expect(deleteSection(seed.ctxB, seed.A.section)).rejects.toThrow(
      NotFound,
    );
  });
});

function depsWith(scanner?: ContentScanner) {
  const invalidator = recordingInvalidator();
  const pinged: string[][] = [];
  const deps: ContentDeps = {
    sections: registry,
    invalidator,
    ...(scanner ? { scanner } : {}),
    pinger: {
      async ping(urls) {
        pinged.push(urls);
      },
    },
  };
  return { deps, invalidator, pinged };
}

async function flagsFor(targetId: string) {
  return pb.collection("content_flags").getFullList({
    filter: pb.filter("target_id = {:id}", { id: targetId }),
  });
}

const popupButton = (popupId: string) => ({
  columns: [
    {
      id: "col1",
      items: [
        {
          id: "btn1",
          kind: "button",
          text: "Open offer",
          link: "",
          style: "primary",
          action: "popup",
          popup_id: popupId,
        },
      ],
    },
  ],
});

const offer = (extra: Record<string, unknown> = {}) => ({
  name: "Spring offer",
  trigger: "delay",
  delay_seconds: 5,
  frequency: "once-per-visitor",
  show_on: "all-pages",
  enabled: true,
  content: {
    items: [
      {
        id: "t1",
        kind: "text",
        html: '<p onclick="x">Deal<script>x()</script></p>',
      },
    ],
  },
  ...extra,
});

describe("pop-up writer (CONT-11, CONT-31)", () => {
  it("validates, sanitizes, invalidates the live tag and pings once", async (t) => {
    if (!inst) return t.skip();
    await liveForTest(seed.A.org);
    const { deps, invalidator, pinged } = depsWith();
    const { popup, held } = await savePopup(seed.ctxA, deps, offer());
    expect(held).toBe(false);
    expect(popup.enabled).toBe(true);
    const row = await pb.collection("popups").getOne(popup.id);
    expect(row.organization).toBe(seed.A.org);
    expect((row.content as { items: { html: string }[] }).items[0]!.html).toBe(
      "<p>Deal</p>",
    );
    expect(invalidator.tags).toEqual([liveTag(seed.A.org)]);
    expect(pinged).toEqual([["https://a.example.com/"]]);
    expect(await flagsFor(popup.id)).toEqual([]);
    await expect(
      savePopup(seed.ctxA, deps, offer({ name: "" })),
    ).rejects.toThrow(InvalidInput);
  });

  it("selected-pages ids must be the org's own pages (T-03-15)", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    await expect(
      savePopup(
        seed.ctxA,
        deps,
        offer({ show_on: "selected-pages", page_ids: [seed.B.page] }),
      ),
    ).rejects.toThrow(NotFound);
    const ok = await savePopup(
      seed.ctxA,
      deps,
      offer({ show_on: "selected-pages", page_ids: [seed.A.page] }),
    );
    expect(ok.popup.page_ids).toEqual([seed.A.page]);
  });

  it("held saves switched off with a held flag", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    const { popup, held } = await savePopup(
      seed.ctxA,
      deps,
      offer({ name: "Offer __cds_test_held__" }),
    );
    expect(held).toBe(true);
    expect(popup.enabled).toBe(false);
    const flags = await flagsFor(popup.id);
    expect(flags.map((f) => f.verdict)).toEqual(["held"]);
    expect(flags[0]!.organization).toBe(seed.A.org);
    expect(flags[0]!.target_collection).toBe("popups");
    // Switching it on re-screens: it stays off.
    const res = await setPopupEnabled(seed.ctxA, deps, popup.id, true);
    expect(res.held).toBe(true);
    expect((await pb.collection("popups").getOne(popup.id)).enabled).toBe(
      false,
    );
  });

  it("a save the scanner holds during a toggle's scan keeps the pop-up off (WR-A03)", async (t) => {
    if (!inst) return t.skip();
    const { deps: plain } = depsWith();
    const { popup } = await savePopup(
      seed.ctxA,
      plain,
      offer({ name: "Race offer", enabled: false }),
    );
    let calls = 0;
    const racing: ContentScanner = {
      async scan(input) {
        calls += 1;
        if (calls === 1) {
          // A concurrent save lands after the toggle read the clean content.
          const res = await savePopup(seed.ctxA, plain, {
            ...offer({ name: "Race __cds_test_held__", enabled: false }),
            id: popup.id,
          });
          expect(res.held).toBe(true);
          return { verdict: "clean", reasons: [] };
        }
        return keywordScanner.scan(input);
      },
    };
    const { deps } = depsWith(racing);
    const res = await setPopupEnabled(seed.ctxA, deps, popup.id, true);
    expect(calls).toBe(2);
    expect(res.held).toBe(true);
    const row = await pb.collection("popups").getOne(popup.id);
    expect(row.enabled).toBe(false);
    expect(row.name).toBe("Race __cds_test_held__");
  });

  it("unsure saves as requested with an unsure flag", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    const { popup, held } = await savePopup(
      seed.ctxA,
      deps,
      offer({ name: "Offer __cds_test_unsure__" }),
    );
    expect(held).toBe(false);
    expect(popup.enabled).toBe(true);
    expect((await flagsFor(popup.id)).map((f) => f.verdict)).toEqual([
      "unsure",
    ]);
  });

  it("a throwing scanner still saves and flags error (D248)", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith({
      async scan() {
        throw new Error("scanner down");
      },
    });
    const { popup, held } = await savePopup(seed.ctxA, deps, offer());
    expect(held).toBe(false);
    expect(popup.enabled).toBe(true);
    expect((await flagsFor(popup.id)).map((f) => f.verdict)).toEqual(["error"]);
  });

  it("a section button may only open the org's own, existing pop-up", async (t) => {
    if (!inst) return t.skip();
    await expect(
      saveSection(seed.ctxA, registry, {
        pageId: seed.A.page,
        section_type: "columns",
        row_layout: "full",
        content: popupButton(seed.B.popup),
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      saveSection(seed.ctxA, registry, {
        pageId: seed.A.page,
        section_type: "columns",
        row_layout: "full",
        content: popupButton("zzzzzzzzzzzzzzz"),
      }),
    ).rejects.toThrow(NotFound);
  });

  it("delete soft-deletes while a draft button uses it", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    const { popup } = await savePopup(seed.ctxA, deps, offer());
    const page = await createPage(seed.ctxA, {
      title: "Offers",
      slug: "offers",
    });
    const section = await saveSection(seed.ctxA, registry, {
      pageId: page.id,
      section_type: "columns",
      row_layout: "full",
      content: popupButton(popup.id),
    });
    expect(await popupUsage(seed.ctxA, deps, popup.id)).toEqual({
      pages: [{ id: page.id, title: "Offers" }],
      inVersions: false,
      inMenu: false,
      used: true,
    });
    await expect(popupUsage(seed.ctxB, deps, popup.id)).rejects.toThrow(
      NotFound,
    );
    expect(await deletePopup(seed.ctxA, deps, popup.id)).toEqual({
      outcome: "soft",
    });
    const row = await pb.collection("popups").getOne(popup.id);
    expect(row.deleted_at).not.toBe("");
    expect((await listPopups(seed.ctxA)).some((p) => p.id === popup.id)).toBe(
      false,
    );
    const all = await listPopups(seed.ctxA, { includeDeleted: true });
    expect(all.find((p) => p.id === popup.id)?.deleted).toBe(true);
    expect((await getPopup(seed.ctxA, popup.id)).deleted).toBe(true);
    await deleteSection(seed.ctxA, section.id);
    expect(await popupUsage(seed.ctxA, deps, popup.id)).toEqual({
      pages: [],
      inVersions: false,
      inMenu: false,
      used: false,
    });
    expect(await deletePopup(seed.ctxA, deps, popup.id)).toEqual({
      outcome: "hard",
    });
    await expect(pb.collection("popups").getOne(popup.id)).rejects.toThrow();
  });

  it("delete soft-deletes while only a published page's kept version uses it", async (t) => {
    if (!inst) return t.skip();
    const { deps, invalidator } = depsWith();
    const { popup } = await savePopup(seed.ctxA, deps, offer());
    const page = await createPage(seed.ctxA, {
      title: "Kept offers",
      slug: "kept-offers",
    });
    const section = await saveSection(seed.ctxA, registry, {
      pageId: page.id,
      section_type: "columns",
      row_layout: "full",
      content: popupButton(popup.id),
    });
    const res = await publishPage(seed.ctxA, page.id, deps);
    expect(res.status).toBe("published");
    await deleteSection(seed.ctxA, section.id);
    const usage = await popupUsage(seed.ctxA, deps, popup.id);
    expect(usage).toEqual({
      pages: [{ id: page.id, title: "Kept offers" }],
      inVersions: true,
      inMenu: false,
      used: true,
    });
    invalidator.tags.length = 0;
    expect(await deletePopup(seed.ctxA, deps, popup.id)).toEqual({
      outcome: "soft",
    });
    expect(invalidator.tags).toEqual([liveTag(seed.A.org)]);
    expect(
      (await pb.collection("popups").getOne(popup.id)).deleted_at,
    ).not.toBe("");
  });

  it("IDOR: another org's pop-up is NotFound", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    await expect(
      savePopup(seed.ctxB, deps, { ...offer(), id: seed.A.popup }),
    ).rejects.toThrow(NotFound);
    await expect(deletePopup(seed.ctxB, deps, seed.A.popup)).rejects.toThrow(
      NotFound,
    );
    await expect(
      setPopupEnabled(seed.ctxB, deps, seed.A.popup, false),
    ).rejects.toThrow(NotFound);
  });
});

describe("banner writer (CONT-12, CONT-31)", () => {
  it("validates, upserts one row per org and invalidates the live tag", async (t) => {
    if (!inst) return t.skip();
    await liveForTest(seed.A.org);
    const { deps, invalidator, pinged } = depsWith();
    await expect(
      saveBanner(seed.ctxA, deps, { enabled: true, message: "" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveBanner(seed.ctxA, deps, {
        enabled: true,
        message: "Hi",
        link_text: "Go",
        link_url: "javascript:alert(1)",
      }),
    ).rejects.toThrow(InvalidInput);
    const { banner, held } = await saveBanner(seed.ctxA, deps, {
      enabled: true,
      message: "Open late on Fridays",
    });
    expect(held).toBe(false);
    expect(banner.enabled).toBe(true);
    const rows = await pb.collection("site_settings").getFullList({
      filter: pb.filter("organization = {:org}", { org: seed.A.org }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(seed.A.siteSettings);
    expect((await getBanner(seed.ctxA))?.message).toBe("Open late on Fridays");
    expect(invalidator.tags).toEqual([liveTag(seed.A.org)]);
    expect(pinged).toHaveLength(1);
  });

  it("creates the row when the org has none", async (t) => {
    if (!inst) return t.skip();
    const orgC = (
      await pb
        .collection("organizations")
        .create({ name: "Org C", slug: "org-c", status: "active" })
    ).id;
    const ctxC = ctxAs(orgC, seed.A.owner, "owner");
    expect(await getBanner(ctxC)).toBeNull();
    const { deps } = depsWith();
    await saveBanner(ctxC, deps, { enabled: false, message: "Later" });
    expect((await getBanner(ctxC))?.message).toBe("Later");
  });

  it("held keeps the banner off and flags it", async (t) => {
    if (!inst) return t.skip();
    const { deps } = depsWith();
    const { banner, held } = await saveBanner(seed.ctxA, deps, {
      enabled: true,
      message: "Big __cds_test_held__ sale",
    });
    expect(held).toBe(true);
    expect(banner.enabled).toBe(false);
    expect((await getBanner(seed.ctxA))?.enabled).toBe(false);
    const flags = await flagsFor(seed.A.siteSettings);
    expect(flags.map((f) => f.verdict)).toContain("held");
  });
});
