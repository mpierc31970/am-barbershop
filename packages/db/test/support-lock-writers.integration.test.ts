// 12-REVIEW CR-A03: the D102 content lock also covers the content writers that build their
// own batch outside commit(): publish, version restore, page delete and page restore. With an
// active page window each refuses a member with TargetLocked and lets impersonated staff through.
// Registers add-on collections before anything reads the composed registry.
import "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TargetLocked } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { deletePage, restoreDeletedPage } from "../src/content/page-delete";
import { createPage } from "../src/content/pages";
import {
  recordingInvalidator,
  type ContentScanner,
  type SearchPinger,
} from "../src/content/ports";
import {
  publishPage,
  restorePageVersion,
  type PublishDeps,
} from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import type { OrgContext } from "../src/context";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { resetLockCacheForTests } from "../src/support/lock";
import { staffCreateServiceWindow } from "../src/support/windows";
import { bootPb, type PbInstance } from "./pb-harness";
import { fixedClock } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;
let storageDir = "";
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const HOUR = 3_600_000;
const registry = composeSectionRegistry(CORE_SECTIONS, []);
const clean: ContentScanner = {
  scan: () => Promise.resolve({ verdict: "clean", reasons: [] }),
};
const pinger: SearchPinger = { ping: () => Promise.resolve() };
const deps = (): PublishDeps => ({
  sections: registry,
  invalidator: recordingInvalidator(),
  scanner: clean,
  pinger,
  store,
});

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-lock-writers-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb, { now: new Date() });
  resetLockCacheForTests({ now: () => new Date() });
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

async function pageWindow(pageId: string): Promise<string> {
  const now = Date.now();
  const made = await staffCreateServiceWindow(
    seed.staff.agent,
    {
      scope: "page",
      orgId: seed.A.org,
      pageId,
      startsAt: new Date(now - HOUR),
      endsAt: new Date(now + HOUR),
    } as never,
    { clock: fixedClock(new Date(now).toISOString()), addons: [], notify: {} },
  );
  resetLockCacheForTests({ now: () => new Date() });
  return made.id;
}

async function clear(id: string) {
  await pb
    .collection("service_windows")
    .update(id, { cleared_at: new Date(Date.now() - 1000).toISOString() });
  resetLockCacheForTests({ now: () => new Date() });
}

async function publishedPage(ctx: OrgContext, slug: string) {
  const page = await createPage(ctx, { title: slug, slug }, store);
  await saveSection(ctx, registry, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: slug, text: "<p>Hello</p>" },
  });
  const res = await publishPage(ctx, page.id, deps());
  if (res.status !== "published") throw new Error("not published");
  return { id: page.id, versionKey: res.versionKey };
}

describe("direct content writers honour the content lock (CR-A03)", () => {
  it("publish, version restore and page delete refuse a member and let impersonated staff through", async (t) => {
    if (!inst) return t.skip();
    const owner = seed.A.ctx.owner;
    const page = await publishedPage(owner, "lock-writers");
    const w = await pageWindow(page.id);

    await expect(publishPage(owner, page.id, deps())).rejects.toThrow(
      TargetLocked,
    );
    await expect(
      restorePageVersion(owner, page.id, page.versionKey, deps()),
    ).rejects.toThrow(TargetLocked);
    await expect(
      deletePage(owner, page.id, { redirectTo: null }, deps()),
    ).rejects.toThrow(TargetLocked);

    const imp = await publishPage(seed.A.impersonatedOwner, page.id, deps());
    expect(imp.status).toBe("published");
    await clear(w);
  });

  it("restoring a deleted page refuses a member while its window is active", async (t) => {
    if (!inst) return t.skip();
    const owner = seed.A.ctx.owner;
    const page = await publishedPage(owner, "lock-restore");
    await deletePage(owner, page.id, { redirectTo: null }, deps());
    const w = await pageWindow(page.id);
    await expect(restoreDeletedPage(owner, page.id, deps())).rejects.toThrow(
      TargetLocked,
    );
    await clear(w);
    const back = await restoreDeletedPage(owner, page.id, deps());
    expect(back.id).toBe(page.id);
  });
});
