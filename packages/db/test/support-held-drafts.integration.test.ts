// 12-13: held drafts (D102 mid-edit; COMM-11; T-12-13-01..03). A save refused by a service
// window is parked per person; after the window it applies through the original writer (as
// the draft) or is discarded with a 30 s undo; drafts older than 30 days are pruned.
import "@cds/addon-registry/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound, TargetLocked } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { getFooter } from "../src/content/chrome/footer";
import { recordingInvalidator } from "../src/content/ports";
import {
  listPageVersions,
  publishPage,
  type PublishDeps,
} from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import { getObjectStore, type ObjectStore } from "../src/storage";
import {
  applyHeldDraft,
  discardHeldDraft,
  holdDraft,
  jobPruneHeldDrafts,
  listHeldDrafts,
  undoDiscardHeldDraft,
} from "../src/support/held-drafts";
import { resetLockCacheForTests } from "../src/support/lock";
import { staffCreateServiceWindow } from "../src/support/windows";
import { bootPb, type PbInstance } from "./pb-harness";
import { fixedClock } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };
const savedStorageDir = process.env.CDS_STORAGE_DIR;
let store: ObjectStore;

function deps(): PublishDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { async ping() {} },
    store,
  };
}

beforeAll(async () => {
  process.env.CDS_STORAGE_DIR = mkdtempSync(join(tmpdir(), "cds-held-"));
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb, { now: new Date() });
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
});

let nowMs = Date.now();
beforeEach(() => {
  nowMs = Date.now();
  resetLockCacheForTests({ now: () => new Date(nowMs) });
});

/** A page window on `pageId`, started an hour ago, ending in an hour. */
async function pageWindow(pageId: string): Promise<{ endsAt: number }> {
  const endsAt = nowMs + HOUR;
  await staffCreateServiceWindow(
    seed.staff.agent,
    {
      scope: "page",
      orgId: seed.A.org,
      pageId,
      startsAt: new Date(nowMs - HOUR),
      endsAt: new Date(endsAt),
    },
    {
      clock: fixedClock(new Date(nowMs).toISOString()),
      addons: [],
      notify: {},
    },
  );
  return { endsAt };
}

function sectionChange(pageId: string, heading: string) {
  return {
    kind: "section" as const,
    section: {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading, text: "<p>x</p>" },
    },
  };
}

describe("hold, list, discard, prune", () => {
  it("keeps a locked section change for that person only", async (t) => {
    if (!inst) return t.skip();
    await pageWindow(seed.A.livePage);
    const held = await holdDraft(
      seed.A.ctx.editor,
      sectionChange(seed.A.livePage, "Mine"),
    );
    expect(held.kind).toBe("section");
    expect(held.locked).toBe(true);
    expect(held.target).toEqual({ kind: "page", id: seed.A.livePage });
    const row = await pb.collection("held_drafts").getOne(held.id);
    expect(row.user).toBe(seed.A.users.editor);
    expect(row.organization).toBe(seed.A.org);

    const mine = await listHeldDrafts(seed.A.ctx.editor, {
      target: { kind: "page", id: seed.A.livePage },
    });
    expect(mine.map((d) => d.id)).toContain(held.id);
    expect(mine.find((d) => d.id === held.id)!.locked).toBe(true);
    const owners = await listHeldDrafts(seed.A.ctx.owner);
    expect(owners.map((d) => d.id)).not.toContain(held.id);
    expect(await listHeldDrafts(seed.A.impersonatedOwner)).toEqual([]);
  });

  it("refuses viewers and impersonation; org B cannot see or discard", async (t) => {
    if (!inst) return t.skip();
    await expect(
      holdDraft(seed.A.ctx.viewer, sectionChange(seed.A.livePage, "No")),
    ).rejects.toThrow(Forbidden);
    await expect(
      holdDraft(seed.A.impersonatedOwner, sectionChange(seed.A.livePage, "No")),
    ).rejects.toThrow();
    const held = await holdDraft(
      seed.A.ctx.admin,
      sectionChange(seed.A.livePage, "Admin"),
    );
    const bList = await listHeldDrafts(seed.B.ctx.admin);
    expect(bList.map((d) => d.id)).not.toContain(held.id);
    await expect(discardHeldDraft(seed.B.ctx.admin, held.id)).rejects.toThrow(
      NotFound,
    );
    await expect(
      undoDiscardHeldDraft(seed.B.ctx.admin, held.id),
    ).rejects.toThrow(NotFound);
    // A colleague in the same org cannot either.
    await expect(discardHeldDraft(seed.A.ctx.owner, held.id)).rejects.toThrow(
      NotFound,
    );
    // Org B cannot hold a change to org A's page.
    await expect(
      holdDraft(seed.B.ctx.owner, sectionChange(seed.A.livePage, "X")),
    ).rejects.toThrow(NotFound);
  });

  it("refuses a payload over 256 KB", async (t) => {
    if (!inst) return t.skip();
    await expect(
      holdDraft(seed.A.ctx.editor, {
        kind: "page",
        pageId: seed.A.livePage,
        page: { title: "x".repeat(300 * 1024) },
      }),
    ).rejects.toThrow(InvalidInput);
  });

  it("a second hold for the same ref replaces the first", async (t) => {
    if (!inst) return t.skip();
    const first = await holdDraft(seed.A.ctx.owner, {
      kind: "site_part",
      part: "footer",
      value: { copyright: "one" },
    });
    const second = await holdDraft(seed.A.ctx.owner, {
      kind: "site_part",
      part: "footer",
      value: { copyright: "two" },
    });
    expect(second.target).toEqual({ kind: "part", key: "footer" });
    const rows = await pb.collection("held_drafts").getFullList({
      filter: pb.filter("user = {:u} && kind = 'site_part' && ref = 'footer'", {
        u: seed.A.users.owner,
      }),
    });
    expect(rows.map((r) => r.id)).toEqual([second.id]);
    expect(rows.map((r) => r.id)).not.toContain(first.id);
  });

  it("two new sections on the same page are both kept (12-REVIEW WR-A02)", async (t) => {
    if (!inst) return t.skip();
    const one = await holdDraft(
      seed.A.ctx.editor,
      sectionChange(seed.A.livePage, "New one"),
    );
    const two = await holdDraft(
      seed.A.ctx.editor,
      sectionChange(seed.A.livePage, "New two"),
    );
    expect(one.ref).not.toBe(two.ref);
    expect(one.ref.startsWith("new:")).toBe(true);
    const ids = (await listHeldDrafts(seed.A.ctx.editor)).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([one.id, two.id]));
  });

  it("discard then undo within 30 s restores; after 31 s it throws", async (t) => {
    if (!inst) return t.skip();
    const held = await holdDraft(seed.A.ctx.editor, {
      kind: "page",
      pageId: seed.A.livePage,
      page: { title: "Held title" },
    });
    const at = new Date();
    await discardHeldDraft(seed.A.ctx.editor, held.id, at);
    let list = await listHeldDrafts(seed.A.ctx.editor);
    expect(list.map((d) => d.id)).not.toContain(held.id);
    await undoDiscardHeldDraft(
      seed.A.ctx.editor,
      held.id,
      new Date(at.getTime() + 20_000),
    );
    list = await listHeldDrafts(seed.A.ctx.editor);
    expect(list.map((d) => d.id)).toContain(held.id);

    await discardHeldDraft(seed.A.ctx.editor, held.id, at);
    await expect(
      undoDiscardHeldDraft(
        seed.A.ctx.editor,
        held.id,
        new Date(at.getTime() + 31_000),
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("jobPruneHeldDrafts removes a 31-day-old draft", async (t) => {
    if (!inst) return t.skip();
    const held = await holdDraft(seed.B.ctx.owner, {
      kind: "site_part",
      part: "nav",
      value: { items: [] },
    });
    // Not yet: a fresh draft survives today's prune.
    await jobPruneHeldDrafts(new Date());
    expect(
      (await pb.collection("held_drafts").getFullList()).map((r) => r.id),
    ).toContain(held.id);
    const later = new Date(Date.now() + 31 * DAY);
    expect(await listHeldDrafts(seed.B.ctx.owner, { now: later })).toEqual([]);
    const res = await jobPruneHeldDrafts(later);
    expect(res.pruned).toBeGreaterThanOrEqual(1);
    expect(
      (await pb.collection("held_drafts").getFullList()).map((r) => r.id),
    ).not.toContain(held.id);
  });
});

describe("apply through the original writer", () => {
  it("refuses while locked, then writes the draft after the window", async (t) => {
    if (!inst) return t.skip();
    const owner = seed.A.ctx.owner;
    const editor = seed.A.ctx.editor;
    const pageId = (
      await pb.collection("pages").create({
        organization: seed.A.org,
        slug: "services",
        title: "Services",
        status: "draft",
        kind: "builder",
      })
    ).id;
    const section = await saveSection(
      owner,
      registry,
      {
        pageId,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "CDS fix", text: "<p>fixed</p>" },
      },
      NO_OWNERS,
    );
    const published = await publishPage(owner, pageId, deps());
    expect(published.status).toBe("published");

    const { endsAt } = await pageWindow(pageId);
    const held = await holdDraft(editor, {
      kind: "section",
      section: {
        id: section.id,
        pageId,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "My edit", text: "<p>mine</p>" },
      },
    });
    await expect(applyHeldDraft(editor, held.id, deps())).rejects.toThrow(
      TargetLocked,
    );
    expect((await listHeldDrafts(editor)).map((d) => d.id)).toContain(held.id);

    // The window ends (pinned lock clock past ends_at).
    nowMs = endsAt + 1000;
    const after = await listHeldDrafts(editor, {
      target: { kind: "page", id: pageId },
    });
    expect(after.find((d) => d.id === held.id)?.locked).toBe(false);
    const res = await applyHeldDraft(editor, held.id, deps());
    expect(res.kind).toBe("section");

    const row = await pb.collection("page_sections").getOne(section.id);
    expect(row.content.heading).toBe("My edit");
    const page = await pb.collection("pages").getOne(pageId);
    expect(page.has_unpublished_changes).toBe(true);
    const versions = await listPageVersions(owner, pageId, store);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(
      published.status === "published" ? published.versionId : "",
    );
    expect((await listHeldDrafts(editor)).map((d) => d.id)).not.toContain(
      held.id,
    );
    await expect(applyHeldDraft(editor, held.id, deps())).rejects.toThrow(
      NotFound,
    );
  });

  it("an invalid payload throws InvalidInput and keeps the held draft", async (t) => {
    if (!inst) return t.skip();
    const editor = seed.A.ctx.editor;
    // A page no window covers (the about page is still locked by the first test).
    const pageId = (
      await pb.collection("pages").create({
        organization: seed.A.org,
        slug: "contact",
        title: "Contact",
        status: "draft",
        kind: "builder",
      })
    ).id;
    const held = await holdDraft(editor, {
      kind: "section",
      section: {
        pageId,
        section_type: "no-such-block",
        row_layout: "full",
        content: {},
      },
    });
    await expect(applyHeldDraft(editor, held.id, deps())).rejects.toThrow(
      InvalidInput,
    );
    expect((await listHeldDrafts(editor)).map((d) => d.id)).toContain(held.id);
  });

  it("applies a site part through its writer; others cannot apply it", async (t) => {
    if (!inst) return t.skip();
    const owner = seed.B.ctx.owner;
    const held = await holdDraft(owner, {
      kind: "site_part",
      part: "footer",
      value: {
        show_address: false,
        show_hours: false,
        show_socials: false,
        extra_links: [],
        copyright: "Held footer",
      },
    });
    await expect(
      applyHeldDraft(seed.A.ctx.owner, held.id, deps()),
    ).rejects.toThrow(NotFound);
    await expect(
      applyHeldDraft(seed.B.ctx.admin, held.id, deps()),
    ).rejects.toThrow(NotFound);
    await applyHeldDraft(owner, held.id, deps());
    expect((await getFooter(owner))?.copyright).toBe("Held footer");
  });
});
