// Media chokepoint on the real PocketBase 0.39.11 binary (ONB-04, ONB-05; D47; invariant 1,
// TEN-03; T-06-63..66, T-06-68): upload into media_assets + a temp LocalDiskStore, private
// reads, logo/hero replace, limits, remove / restore, reorder, and the mood board proposal
// stored in org_intake only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { extractPalette, proposeRoles } from "@cds/core/theme";
import type PocketBase from "pocketbase";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  listMedia,
  readMediaVariant,
  removeMedia,
  reorderMedia,
  restoreMedia,
  setMediaAlt,
  uploadImage,
  UploadRejected,
} from "../src/media";
import {
  bandPixels,
  bandPng,
  greenPixels,
  solidPng,
} from "../src/media/__fixtures__/make-fixtures";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantMediaKey } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let store: LocalDiskStore;
let small: Uint8Array;

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name: "Media Co",
      slug: `media-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
      design: { marker: "live theme", roles: { primary: "#123456" } },
    })
  ).id;
  return { org, ctx: ctxAs(org, "owner") };
}

async function rejection(p: Promise<unknown>): Promise<UploadRejected> {
  try {
    await p;
  } catch (err) {
    if (err instanceof UploadRejected) return err;
    throw err;
  }
  throw new Error("expected UploadRejected");
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-media-"));
  store = new LocalDiskStore(root);
  small = await solidPng(30, 20);
});

afterAll(async () => {
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("uploadImage (ONB-04)", () => {
  it("creates the row and three objects; the thumb reads back as WebP", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const { asset, proposal } = await uploadImage(
      ctx,
      await solidPng(3000, 2000),
      "hero",
      { alt: "  Loaves cooling  ", store },
    );
    expect(proposal).toBeUndefined();
    expect(asset).toMatchObject({
      kind: "hero",
      width: 3000,
      height: 2000,
      webWidth: 2560,
      webHeight: 1707,
      mime: "image/png",
      alt: "Loaves cooling",
      url: `/hub/media/${asset.id}/thumb`,
    });
    expect(asset.bytes).toBeGreaterThan(0);
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.organization).toBe(org);
    expect(row.source).toBe("intake");
    expect(row.storage_dir).toBe(`tenants/${org}/media/${asset.id}`);
    expect(row.original_ext).toBe("png");
    for (const name of ["original.png", "web.webp", "thumb.webp"] as const) {
      expect(
        await store.get(tenantMediaKey(org, asset.id, name)),
      ).not.toBeNull();
    }
    const thumb = await readMediaVariant(ctx, asset.id, "thumb", { store });
    expect(thumb.mime).toBe("image/webp");
    expect((await sharp(thumb.bytes).metadata()).format).toBe("webp");
    const orig = await readMediaVariant(ctx, asset.id, "original", { store });
    expect(orig.mime).toBe("image/png");
  });

  it("a second hero replaces the first (one active), restorable", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const first = (await uploadImage(ctx, small, "hero", { store })).asset;
    const second = (await uploadImage(ctx, small, "hero", { store })).asset;
    expect((await listMedia(ctx, "hero")).map((a) => a.id)).toEqual([
      second.id,
    ]);
    expect(
      (await pb.collection("media_assets").getOne(first.id)).removed_at,
    ).not.toBe("");
    await restoreMedia(ctx, first.id, { store });
    expect((await listMedia(ctx, "hero")).map((a) => a.id)).toEqual([first.id]);
  });

  it("refuses the 13th gallery photo with UPL-LIMIT", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    for (let i = 0; i < 12; i++) {
      await uploadImage(ctx, small, "gallery", { store });
    }
    const err = await rejection(uploadImage(ctx, small, "gallery", { store }));
    expect(err.reason).toBe("limit");
    expect(err.message).toBe(
      "You've added 12 photos, the most for now. Remove one to add another.",
    );
    expect(await listMedia(ctx, "gallery")).toHaveLength(12);
  }, 60_000);

  it("refuses a 4th mood board", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    for (let i = 0; i < 3; i++) {
      await uploadImage(ctx, small, "moodboard", { store });
    }
    const err = await rejection(
      uploadImage(ctx, small, "moodboard", { store }),
    );
    expect(err.reason).toBe("limit");
  });

  it("an Editor cannot upload; a Viewer cannot list", async (t) => {
    if (!inst) return t.skip();
    const { org } = await bareOrg();
    await expect(
      uploadImage(ctxAs(org, "editor"), small, "gallery", { store }),
    ).rejects.toThrow(Forbidden);
    await expect(listMedia(ctxAs(org, "viewer"))).rejects.toThrow(Forbidden);
    expect(await listMedia(ctxAs(org, "editor"))).toEqual([]);
  });

  it("refuses a disguised file and an unknown kind without writing anything", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const err = await rejection(
      uploadImage(ctx, new TextEncoder().encode("hello"), "gallery", { store }),
    );
    expect(err.reason).toBe("type");
    await expect(
      uploadImage(ctx, small, "banner" as "gallery", { store }),
    ).rejects.toThrow(InvalidInput);
    expect(
      await pb.collection("media_assets").getFullList({
        filter: pb.filter("organization = {:o}", { o: org }),
      }),
    ).toHaveLength(0);
  });
});

describe("reads, alt, remove / restore (T-06-66)", () => {
  it("org B reading or changing org A's asset is NotFound", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    const { asset } = await uploadImage(a.ctx, small, "gallery", { store });
    await expect(
      readMediaVariant(b.ctx, asset.id, "thumb", { store }),
    ).rejects.toThrow(NotFound);
    await expect(setMediaAlt(b.ctx, asset.id, "Evil")).rejects.toThrow(
      NotFound,
    );
    await expect(removeMedia(b.ctx, asset.id, { store })).rejects.toThrow(
      NotFound,
    );
    await expect(
      reorderMedia(b.ctx, "gallery", [asset.id], { store }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      readMediaVariant(a.ctx, asset.id, "raw" as "thumb", { store }),
    ).rejects.toThrow(NotFound);
  });

  it("a removed asset stays readable (Undo) and restore clears removed_at", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const { asset } = await uploadImage(ctx, small, "gallery", { store });
    await removeMedia(ctx, asset.id, { store });
    expect(await listMedia(ctx, "gallery")).toEqual([]);
    const r = await readMediaVariant(ctx, asset.id, "web", { store });
    expect(r.bytes.length).toBeGreaterThan(0);
    await restoreMedia(ctx, asset.id, { store });
    expect(
      (await pb.collection("media_assets").getOne(asset.id)).removed_at,
    ).toBe("");
    expect((await listMedia(ctx, "gallery")).map((x) => x.id)).toEqual([
      asset.id,
    ]);
  });

  it("setMediaAlt trims, stores, and refuses over 250 characters", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const { asset } = await uploadImage(ctx, small, "gallery", { store });
    await setMediaAlt(ctx, asset.id, "  Our bakery at dawn ");
    expect((await listMedia(ctx, "gallery"))[0]!.alt).toBe(
      "Our bakery at dawn",
    );
    await expect(setMediaAlt(ctx, asset.id, "x".repeat(251))).rejects.toThrow(
      InvalidInput,
    );
    await expect(
      uploadImage(ctx, small, "gallery", { alt: "y".repeat(251), store }),
    ).rejects.toThrow(InvalidInput);
  });

  it("reorders the gallery; a non-permutation is refused", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const a = (await uploadImage(ctx, small, "gallery", { store })).asset;
    const b = (await uploadImage(ctx, small, "gallery", { store })).asset;
    await reorderMedia(ctx, "gallery", [b.id, a.id], { store });
    expect((await listMedia(ctx, "gallery")).map((x) => x.id)).toEqual([
      b.id,
      a.id,
    ]);
    await expect(
      reorderMedia(ctx, "gallery", [b.id], { store }),
    ).rejects.toThrow(InvalidInput);
  });
});

describe("mood board proposal (ONB-05, D47; T-06-68)", () => {
  it("the first mood board stores its proposal in org_intake; organizations.design is untouched", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const before = (await pb.collection("organizations").getOne(org)).design;
    const { proposal } = await uploadImage(ctx, await bandPng(), "moodboard", {
      store,
    });
    expect(proposal).toBeDefined();
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(intake.moodboard_proposal).toEqual(proposal);
    const after = (await pb.collection("organizations").getOne(org)).design;
    expect(after).toEqual(before);
    // A second mood board does not drive the palette.
    const second = await uploadImage(
      ctx,
      await bandPng(greenPixels()),
      "moodboard",
      { store },
    );
    expect(second.proposal).toBeUndefined();
  });

  it("the server palette equals extractPalette on the same raw pixels (PNG, lossless)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const px = bandPixels();
    const { proposal } = await uploadImage(
      ctx,
      await bandPng(px),
      "moodboard",
      {
        store,
      },
    );
    const direct = proposeRoles(extractPalette(px));
    expect(proposal).toEqual(direct);
    expect(proposal!.swatches.length).toBeGreaterThan(1);
  });

  it("reordering mood boards recomputes the proposal from the new first image", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const a = (await uploadImage(ctx, await bandPng(), "moodboard", { store }))
      .asset;
    const b = (
      await uploadImage(ctx, await bandPng(greenPixels()), "moodboard", {
        store,
      })
    ).asset;
    const { proposal } = await reorderMedia(ctx, "moodboard", [b.id, a.id], {
      store,
    });
    expect(proposal).toEqual(proposeRoles(extractPalette(greenPixels())));
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(intake.moodboard_proposal).toEqual(proposal);
    // Removing the first falls back to the next one; removing all clears it.
    const r1 = await removeMedia(ctx, b.id, { store });
    expect(r1.proposal).toEqual(proposeRoles(extractPalette(bandPixels())));
    const r2 = await removeMedia(ctx, a.id, { store });
    expect(r2.proposal).toBeNull();
  });
});
