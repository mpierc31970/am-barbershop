// previewPageForLink on the real PocketBase 0.39.11 binary (14-16 choices 2 and 3; DOM-07, D22;
// T-14-16-03, T-14-16-04): a valid preview. token returns the draft while the published JSON
// keeps the old content; another org's token and a deleted page are "invalid".
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  type PublishedPage,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import {
  PREVIEW_LINK_MS,
  previewPageForLink,
  signPreviewToken,
} from "../src/dns/preview-links";
import {
  getObjectStore,
  tenantPublishedPageKey,
  type ObjectStore,
} from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps(): PublishDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
  };
}

async function publishedJson(
  orgId: string,
  pageId: string,
): Promise<PublishedPage | null> {
  const bytes = await store.get(tenantPublishedPageKey(orgId, pageId));
  return bytes
    ? (JSON.parse(new TextDecoder().decode(bytes)) as PublishedPage)
    : null;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-preview-links-"));
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

describe("previewPageForLink (DOM-07)", () => {
  it("returns the draft for a valid token; the published JSON keeps the old content", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const pageId = seed.A.page;
    const res = await publishPage(ctx, pageId, deps());
    expect(res.status).toBe("published");
    const before = await publishedJson(ctx.orgId, pageId);
    expect(before).not.toBeNull();

    // An unpublished change.
    await saveSection(ctx, registry, {
      pageId,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Draft only", text: "<p>not live yet</p>" },
    });

    const token = signPreviewToken(ctx.orgId, pageId);
    const out = await previewPageForLink({ orgId: ctx.orgId }, token, registry);
    expect(out.status).toBe("draft");
    if (out.status !== "draft") return;
    expect(out.page.page.id).toBe(pageId);
    expect(JSON.stringify(out.page)).toContain("Draft only");
    expect(out.page.sections.length).toBe(before!.sections.length + 1);

    const after = await publishedJson(ctx.orgId, pageId);
    expect(JSON.stringify(after)).not.toContain("Draft only");
    expect(after).toEqual(before);
  });

  it("an expired token is expired", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const past = Date.now() - PREVIEW_LINK_MS - 1000;
    const token = signPreviewToken(ctx.orgId, seed.A.page, past);
    const out = await previewPageForLink({ orgId: ctx.orgId }, token, registry);
    expect(out).toEqual({ status: "expired" });
  });

  it("refuses another org's token on this site (T-14-16-03)", async (t) => {
    if (!inst) return t.skip();
    // B's token for B's page, presented on A's site.
    const tokenB = signPreviewToken(seed.B.org, seed.B.page);
    expect(
      await previewPageForLink({ orgId: seed.A.org }, tokenB, registry),
    ).toEqual({ status: "invalid" });
    // A token naming A's org but B's page: the read is scoped to A, so B's page is not found.
    const crossed = signPreviewToken(seed.A.org, seed.B.page);
    expect(
      await previewPageForLink({ orgId: seed.A.org }, crossed, registry),
    ).toEqual({ status: "invalid" });
  });

  it("a deleted page is invalid", async (t) => {
    if (!inst) return t.skip();
    const ctx = seed.ctxA;
    const page = await createPage(ctx, {
      title: "Soon gone",
      slug: "soon-gone",
    });
    const token = signPreviewToken(ctx.orgId, page.id);
    expect(
      (await previewPageForLink({ orgId: ctx.orgId }, token, registry)).status,
    ).toBe("draft");
    await pb
      .collection("pages")
      .update(page.id, { deleted_at: new Date().toISOString() });
    expect(
      await previewPageForLink({ orgId: ctx.orgId }, token, registry),
    ).toEqual({ status: "invalid" });
  });
});
