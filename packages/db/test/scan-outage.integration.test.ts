// Scanner outage = publish and queue (13-11; STAFF-23, D248) on the real PocketBase 0.39.11
// binary: a provider that cannot answer never blocks a save; the save lands and one
// content_flags row (verdict error, status queued, source scan, rescan_attempts 0) waits for
// review:run (13-29). Held copy still holds and opens a flag for staff.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import { savePopup } from "../src/content/popups";
import {
  recordingInvalidator,
  type ContentScanner,
  type LinkChecker,
  type SearchPinger,
} from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { compositeScanner } from "../src/content/scan";
import { saveSection } from "../src/content/sections";
import type { OrgContext } from "../src/context";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const downLinks: LinkChecker = {
  name: "down",
  check: () => Promise.reject(new Error("provider down")),
};

function deps(scanner?: ContentScanner): PublishDeps {
  const pinger: SearchPinger = { ping: () => Promise.resolve() };
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger,
    store,
    ...(scanner ? { scanner } : {}),
  };
}

let slugN = 0;
async function newPage(ctx: OrgContext, text: string): Promise<string> {
  slugN += 1;
  const page = await createPage(ctx, {
    title: `Outage ${slugN}`,
    slug: `outage-${slugN}`,
  });
  await saveSection(ctx, registry, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Heading", text },
  });
  return page.id;
}

async function flagsFor(targetId: string) {
  return pb.collection("content_flags").getFullList({
    filter: pb.filter("target_id = {:id}", { id: targetId }),
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-scan-outage-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
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

describe("scanner outage (STAFF-23, D248)", () => {
  it("a link checker that rejects publishes the page and queues one error flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, "<p>Opening hours</p>");
    const res = await publishPage(
      ctx,
      pageId,
      deps(compositeScanner({ link: downLinks })),
    );
    expect(res.status).toBe("published");
    const page = await pb.collection("pages").getOne(pageId);
    expect(page.status).toBe("published");
    const flags = await flagsFor(pageId);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      organization: ctx.orgId,
      target_collection: "pages",
      verdict: "error",
      status: "queued",
      source: "scan",
      rescan_attempts: 0,
    });
  });

  it("held text still holds and opens (not queues) its flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = await newPage(ctx, "<p>Buy __cds_test_held__ now</p>");
    const res = await publishPage(
      ctx,
      pageId,
      deps(compositeScanner({ link: downLinks })),
    );
    expect(res.status).toBe("held");
    const flags = await flagsFor(pageId);
    expect(flags.map((f) => [f.verdict, f.status])).toEqual([["held", "open"]]);
  });

  it("a live-save record (pop-up) with a throwing scanner saves and queues (afterLiveSave)", async (t) => {
    if (!inst) return t.skip();
    const throwing: ContentScanner = {
      scan: () => Promise.reject(new Error("scanner down")),
    };
    const { popup, held } = await savePopup(seed.ctxA, deps(throwing), {
      name: "Outage offer",
      trigger: "delay",
      delay_seconds: 5,
      frequency: "once-per-visitor",
      show_on: "all-pages",
      enabled: true,
      content: { items: [{ id: "t1", kind: "text", html: "<p>Deal</p>" }] },
    });
    expect(held).toBe(false);
    expect(popup.enabled).toBe(true);
    const flags = await flagsFor(popup.id);
    expect(flags.map((f) => [f.verdict, f.status, f.source])).toEqual([
      ["error", "queued", "scan"],
    ]);
  });
});
