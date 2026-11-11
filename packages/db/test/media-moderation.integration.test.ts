// Image moderation on upload (13-11; STAFF-23, STAFF-25, D248) on the real PocketBase 0.39.11
// binary: every library and intake photo goes through the ImageModerator before its row
// commits. held -> status `held` (kept, never served) + flag source image; unsure -> flag
// only; rejection or timeout -> flag error / queued; the skipped stand-in never blocks.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { ImageModerator, SubResult } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { uploadImage } from "../src/media";
import { solidPng } from "../src/media/__fixtures__/make-fixtures";
import { uploadLibraryImage } from "../src/media/library";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let store: LocalDiskStore;

function moderator(
  verdict: SubResult["verdict"],
  seen: { orgId: string; urls: string[]; bytes: number }[] = [],
): ImageModerator {
  return {
    name: `fake-${verdict}`,
    check(input) {
      seen.push({
        orgId: input.orgId,
        urls: (input.images ?? []).map((i) => i.url),
        bytes: input.images?.[0]?.bytes?.length ?? 0,
      });
      return Promise.resolve({
        verdict,
        reasons: [`fake: ${verdict}`],
        provider: "fake",
      });
    },
  };
}

const rejecting: ImageModerator = {
  name: "down",
  check: () => Promise.reject(new Error("provider down")),
};

const slow: ImageModerator = {
  name: "slow",
  check: () =>
    new Promise((resolve) =>
      setTimeout(
        () => resolve({ verdict: "held", reasons: [], provider: "slow" }),
        500,
      ),
    ),
};

async function bareOrg(): Promise<OrgContext> {
  const org = (
    await pb.collection("organizations").create({
      name: "Moderation Co",
      slug: `mod-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  return mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

async function flagsFor(assetId: string) {
  return pb.collection("content_flags").getFullList({
    filter: pb.filter("target_id = {:id}", { id: assetId }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-moderation-"));
  store = new LocalDiskStore(root);
});

afterAll(async () => {
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("library photo moderation (STAFF-25)", () => {
  it("the skipped stand-in never blocks: asset ready, no flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const { asset } = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      store,
    });
    expect(asset.status).toBe("ready");
    expect(await flagsFor(asset.id)).toHaveLength(0);
  });

  it("held: asset kept but not usable (status held) and an open image flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const seen: { orgId: string; urls: string[]; bytes: number }[] = [];
    const { asset } = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      store,
      moderator: moderator("held", seen),
    });
    expect(asset.status).toBe("held");
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("held");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.orgId).toBe(ctx.orgId);
    expect(seen[0]!.urls[0]).toContain(`${asset.id}/web.webp`);
    expect(seen[0]!.bytes).toBeGreaterThan(0);
    const flags = await flagsFor(asset.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      organization: ctx.orgId,
      target_collection: "media_assets",
      verdict: "held",
      status: "open",
      source: "image",
    });
  });

  it("unsure: asset usable, flag only", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const { asset } = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      store,
      moderator: moderator("unsure"),
    });
    expect(asset.status).toBe("ready");
    const flags = await flagsFor(asset.id);
    expect(flags.map((f) => [f.verdict, f.status, f.source])).toEqual([
      ["unsure", "open", "image"],
    ]);
  });

  it("a rejecting moderator uploads and queues an error flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const { asset } = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      store,
      moderator: rejecting,
    });
    expect(asset.status).toBe("ready");
    const flags = await flagsFor(asset.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      verdict: "error",
      status: "queued",
      source: "image",
      rescan_attempts: 0,
    });
  });

  it("a slow moderator times out: upload continues, queued flag (T-13-11-02)", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const started = Date.now();
    const { asset } = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      store,
      moderator: slow,
      moderationTimeoutMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(asset.status).toBe("ready");
    const flags = await flagsFor(asset.id);
    expect(flags.map((f) => [f.verdict, f.status, f.reasons])).toEqual([
      ["error", "queued", ["image moderator timed out"]],
    ]);
  });
});

describe("intake photo moderation (STAFF-25)", () => {
  it("a held gallery photo is stored held with an image flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const { asset } = await uploadImage(
      ctx,
      await solidPng(40, 30),
      "gallery",
      {
        store,
        moderator: moderator("held"),
      },
    );
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("held");
    const flags = await flagsFor(asset.id);
    expect(flags.map((f) => [f.verdict, f.source])).toEqual([
      ["held", "image"],
    ]);
  });

  it("the stand-in keeps intake photos ready with no flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await bareOrg();
    const { asset } = await uploadImage(
      ctx,
      await solidPng(40, 30),
      "gallery",
      {
        store,
      },
    );
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("ready");
    expect(await flagsFor(asset.id)).toHaveLength(0);
  });
});
