// Media library on the real PocketBase 0.39.11 binary (07-12; CONT-14, CONT-19, CONT-27,
// CONT-33; invariant 1; T-07-12-01, -04, -05, -06): library photo uploads (content write,
// private store, widths, name, footprint, needs-description flag, allowance), chunked MP3
// uploads, and the read side (list, describe, resolvers, hub objects, tokenized fallback).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { uploadImage, UploadRejected } from "../src/media";
import { solidPng } from "../src/media/__fixtures__/make-fixtures";
import {
  AllowanceExceeded,
  MEDIA_ALLOWANCE_BYTES,
  USAGE_COPY,
} from "../src/media/cdn";
import {
  abortChunkedUpload,
  appendChunk,
  AUDIO_COPY,
  CHUNK_PART_BYTES,
  finishChunkedUpload,
  startChunkedUpload,
  countMediaNeedingDescription,
  describeMedia,
  getLibraryItem,
  listLibrary,
  listMediaNeedingDescription,
  openHubMediaObject,
  readPublicMedia,
  resolveHubMedia,
  resolvePublicMedia,
  uploadLibraryAudio,
  uploadLibraryImage,
} from "../src/media/library";
import { ALT_REQUIRED_COPY } from "../src/media/library/alt";
import type { MediaDelivery } from "../src/media/ports";
import { appDelivery, openPublicMediaObject } from "../src/media/store";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { clearResolverCache } from "../src/resolve";
import { chunkUploadRoot } from "../src/media/library/chunks";
import { LocalDiskStore } from "../src/storage/local-disk";
import type { RangedObjectStore } from "../src/storage/object-store";
import {
  tenantMediaDerivativeKey,
  tenantMediaKey,
  tenantPublicMediaKey,
} from "../src/storage/keys";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const MB = 1024 * 1024;
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let store: RangedObjectStore;
let publicRoot = "";
let publicStore: RangedObjectStore;

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<string> {
  return (
    await pb.collection("organizations").create({
      name: "Library Co",
      slug: `lib-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
}

async function usedRow(org: string, bytes: number): Promise<void> {
  await pb.collection("media_assets").create({
    organization: org,
    kind: "library",
    status: "ready",
    source: "library",
    storage_dir: `tenants/${org}/media/x`,
    bytes,
  });
}

/** MPEG-1 Layer III 128 kbit/s 44.1 kHz frames behind a small ID3v2 tag. */
export function mp3Bytes(frames: number): Uint8Array {
  const FRAME = 417;
  const out = new Uint8Array(10 + 20 + frames * FRAME);
  out.set([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 20], 0);
  for (let i = 0; i < frames; i += 1) {
    out.set([0xff, 0xfb, 0x90, 0x64], 30 + i * FRAME);
  }
  return out;
}

async function rows(org: string) {
  return pb.collection("media_assets").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-medialib-"));
  store = new LocalDiskStore(root);
  publicRoot = mkdtempSync(join(tmpdir(), "cds-medialib-pub-"));
  publicStore = new LocalDiskStore(publicRoot);
});

afterAll(async () => {
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
  if (publicRoot) rmSync(publicRoot, { recursive: true, force: true });
});

describe("uploadLibraryImage (CONT-14, CONT-19)", () => {
  it("an Editor uploads a library photo into the private store with widths, name and footprint", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "editor");
    const { asset, needsDescription } = await uploadLibraryImage(
      ctx,
      await solidPng(1000, 500),
      { filename: "IMG_2041.JPG", store },
    );
    expect(needsDescription).toBe(true);
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row).toMatchObject({
      kind: "library",
      source: "library",
      status: "ready",
      name: "IMG_2041.JPG",
      alt: "",
      width: 1000,
      web_width: 1000,
    });
    const keys = [
      tenantMediaKey(org, asset.id, "original.png"),
      tenantMediaKey(org, asset.id, "web.webp"),
      tenantMediaKey(org, asset.id, "thumb.webp"),
      tenantMediaDerivativeKey(org, asset.id, "w480"),
      tenantMediaDerivativeKey(org, asset.id, "w960"),
    ];
    let footprint = 0;
    for (const k of keys) {
      const b = await store.get(k);
      expect(b).not.toBeNull();
      footprint += b!.length;
    }
    expect(
      await store.get(tenantMediaDerivativeKey(org, asset.id, "w1600")),
    ).toBeNull();
    expect(row.bytes).toBe(footprint);
  });

  it("with a description it is not flagged", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "owner");
    const r = await uploadLibraryImage(ctx, await solidPng(40, 30), {
      alt: "Loaves cooling",
      store,
    });
    expect(r.needsDescription).toBe(false);
    expect(r.asset.alt).toBe("Loaves cooling");
  });

  it("a Viewer is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "viewer");
    await expect(
      uploadLibraryImage(ctx, await solidPng(40, 30), { store }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("refuses over the 2 GB allowance with USAGE-FULL before processing, leaving nothing", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    await usedRow(org, MEDIA_ALLOWANCE_BYTES - 10);
    const ctx = ctxAs(org, "owner");
    const err = await uploadLibraryImage(ctx, await solidPng(300, 200), {
      store,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllowanceExceeded);
    expect((err as Error).message).toBe(USAGE_COPY.full(MEDIA_ALLOWANCE_BYTES));
    expect(await rows(org)).toHaveLength(1);
  });

  it("re-checks the real footprint under the lock and removes written objects", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    // Noise: the re-encoded original alone is about as big as the upload.
    const png = new Uint8Array(
      await sharp({
        create: {
          width: 600,
          height: 400,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
          noise: { type: "gaussian", mean: 128, sigma: 40 },
        },
      })
        .png()
        .toBuffer(),
    );
    // Room for the upload's bytes, not for its derivatives.
    await usedRow(org, MEDIA_ALLOWANCE_BYTES - png.length);
    const ctx = ctxAs(org, "owner");
    await expect(
      uploadLibraryImage(ctx, png, { store }),
    ).rejects.toBeInstanceOf(AllowanceExceeded);
    expect(await rows(org)).toHaveLength(1);
    expect(await store.list(`dev/tenants/${org}/`)).toEqual([]);
  });

  it("P6 uploadImage also writes widths, the name and the footprint", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const { asset } = await uploadImage(
      ctx,
      await solidPng(700, 500),
      "gallery",
      {
        filename: "bakery/front-window.png",
        store,
      },
    );
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.name).toBe("front-window.png");
    expect(row.status).toBe("ready");
    const w480 = await store.get(
      tenantMediaDerivativeKey(org, asset.id, "w480"),
    );
    expect(w480).not.toBeNull();
    expect(row.bytes).toBeGreaterThan(w480!.length);
  });

  it("P6 uploadImage runs the allowance too", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    await usedRow(org, MEDIA_ALLOWANCE_BYTES);
    await expect(
      uploadImage(ctxAs(org, "owner"), await solidPng(40, 30), "hero", {
        store,
      }),
    ).rejects.toBeInstanceOf(AllowanceExceeded);
  });
});

describe("chunked uploads (CONT-19, Pitfall 1)", () => {
  it("start, three parts in order, finish with the exact bytes; re-sent parts are no-ops", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "editor");
    const size = 20 * MB;
    const start = await startChunkedUpload(ctx, {
      purpose: "audio",
      size,
      filename: "song.mp3",
    });
    expect(start.partBytes).toBe(8388608);
    expect(start.parts).toBe(3);
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) data[i] = (i / 4096) & 0xff;
    const part = (n: number) =>
      data.subarray(
        n * CHUNK_PART_BYTES,
        Math.min(size, (n + 1) * CHUNK_PART_BYTES),
      );
    await appendChunk(ctx, start.uploadId, 0, part(0));
    await expect(
      finishChunkedUpload(ctx, start.uploadId),
    ).rejects.toBeInstanceOf(InvalidInput);
    await appendChunk(ctx, start.uploadId, 1, part(1));
    await appendChunk(ctx, start.uploadId, 2, part(2));
    expect(await appendChunk(ctx, start.uploadId, 1, part(1))).toEqual({
      received: size,
      parts: 3,
    });
    await expect(
      appendChunk(ctx, start.uploadId, 3, new Uint8Array(1)),
    ).rejects.toBeInstanceOf(InvalidInput);
    const done = await finishChunkedUpload(ctx, start.uploadId);
    expect(done.size).toBe(size);
    expect(done.filename).toBe("song.mp3");
    const { readFile } = await import("node:fs/promises");
    expect(Buffer.compare(await readFile(done.path), Buffer.from(data))).toBe(
      0,
    );
    await done.cleanup();
    expect(existsSync(done.path)).toBe(false);
  });

  it("refuses skipped, short, oversized and overflowing parts", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "owner");
    const { uploadId } = await startChunkedUpload(ctx, {
      purpose: "audio",
      size: CHUNK_PART_BYTES + 10,
    });
    await expect(
      appendChunk(ctx, uploadId, 1, new Uint8Array(10)),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      appendChunk(ctx, uploadId, 0, new Uint8Array(100)),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      appendChunk(ctx, uploadId, 0, new Uint8Array(CHUNK_PART_BYTES + 1)),
    ).rejects.toBeInstanceOf(InvalidInput);
    await appendChunk(ctx, uploadId, 0, new Uint8Array(CHUNK_PART_BYTES));
    await expect(
      appendChunk(ctx, uploadId, 1, new Uint8Array(11)),
    ).rejects.toBeInstanceOf(InvalidInput);
    await abortChunkedUpload(ctx, uploadId);
  });

  it("audio over 50 MB is the UPL-AUDIO copy; a bad size is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "owner");
    const err = await startChunkedUpload(ctx, {
      purpose: "audio",
      size: 50 * MB + 1,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect((err as Error).message).toBe(AUDIO_COPY);
    await expect(
      startChunkedUpload(ctx, { purpose: "audio", size: 0 }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("another org's upload id is NotFound; abort removes the folder", async (t) => {
    if (!inst) return t.skip();
    const orgA = await bareOrg();
    const ctxA = ctxAs(orgA, "owner");
    const ctxB = ctxAs(await bareOrg(), "owner");
    const { uploadId } = await startChunkedUpload(ctxA, {
      purpose: "audio",
      size: 100,
    });
    await expect(
      appendChunk(ctxB, uploadId, 0, new Uint8Array(100)),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(finishChunkedUpload(ctxB, uploadId)).rejects.toBeInstanceOf(
      NotFound,
    );
    await abortChunkedUpload(ctxB, uploadId);
    const dir = join(chunkUploadRoot(), orgA, uploadId);
    expect(existsSync(dir)).toBe(true);
    await abortChunkedUpload(ctxA, uploadId);
    expect(existsSync(dir)).toBe(false);
    await abortChunkedUpload(ctxA, uploadId);
  });

  it("a Viewer cannot start an upload", async (t) => {
    if (!inst) return t.skip();
    await expect(
      startChunkedUpload(ctxAs(await bareOrg(), "viewer"), {
        purpose: "audio",
        size: 10,
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("uploadLibraryAudio (CONT-27)", () => {
  async function finishedOf(ctx: OrgContext, bytes: Uint8Array) {
    const { uploadId } = await startChunkedUpload(ctx, {
      purpose: "audio",
      size: bytes.length,
      filename: "Morning talk.mp3",
    });
    await appendChunk(ctx, uploadId, 0, bytes);
    return finishChunkedUpload(ctx, uploadId);
  }

  it("a valid MP3 becomes a ready audio asset in the private store", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "editor");
    const bytes = mp3Bytes(1000);
    const finished = await finishedOf(ctx, bytes);
    const { asset } = await uploadLibraryAudio(ctx, finished, { store });
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row).toMatchObject({
      kind: "audio",
      mime: "audio/mpeg",
      original_ext: "mp3",
      status: "ready",
      duration_s: 26,
      name: "Morning talk.mp3",
      bytes: bytes.length,
    });
    expect(
      await store.get(tenantMediaDerivativeKey(org, asset.id, "audio.mp3")),
    ).not.toBeNull();
    expect(existsSync(finished.path)).toBe(false);
  });

  it("a non-MP3 is UPL-AUDIO and leaves nothing behind", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const finished = await finishedOf(ctx, await solidPng(40, 30));
    const err = await uploadLibraryAudio(ctx, finished, { store }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UploadRejected);
    expect((err as Error).message).toBe(AUDIO_COPY);
    expect(await rows(org)).toHaveLength(0);
    expect(existsSync(finished.path)).toBe(false);
    expect(await store.list(`dev/tenants/${org}/`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// Read side (Task 2)
// ---------------------------------------------------------------------------------------

async function siteOrg(): Promise<{
  org: string;
  site: SiteContext;
  ctx: OrgContext;
}> {
  const org = await bareOrg();
  const hostname = `lib-${Math.random().toString(36).slice(2, 10)}.example.com`;
  await pb.collection("org_hosts").create({
    hostname,
    organization: org,
    kind: "custom",
    primary: true,
  });
  clearResolverCache();
  const site = await siteContextForHost(hostname);
  if (!site) throw new Error("no site");
  return { org, site, ctx: ctxAs(org, "editor") };
}

async function mediaRow(
  org: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  return (
    await pb.collection("media_assets").create({
      organization: org,
      kind: "library",
      status: "ready",
      source: "library",
      original_ext: "png",
      storage_dir: `tenants/${org}/media/x`,
      width: 2000,
      height: 1000,
      web_width: 2000,
      web_height: 1000,
      mime: "image/png",
      alt: "",
      name: "photo.png",
      ...fields,
    })
  ).id;
}

const NOW_ISO = "2026-10-01 10:00:00.000Z";

function tokenParts(url: string): { e: string; t: string } {
  const q = new URL(url, "https://x.example").searchParams;
  return { e: q.get("e") ?? "", t: q.get("t") ?? "" };
}

async function streamText(s: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(s).arrayBuffer()).toString();
}

describe("listLibrary and describe data (CONT-14, CONT-35, D280)", () => {
  it("lists newest first with filters, search, counts and needs-description", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await siteOrg();
    const a = await mediaRow(org, { name: "IMG_2041.JPG" });
    const b = await mediaRow(org, { name: "Bread.png", alt: "Loaves" });
    const v = await mediaRow(org, {
      kind: "video",
      name: "tour.mp4",
      original_ext: "mp4",
    });
    const au = await mediaRow(org, {
      kind: "audio",
      name: "talk.mp3",
      original_ext: "mp3",
    });
    await mediaRow(org, { name: "gone.png", deleted_at: NOW_ISO });
    await mediaRow(org, { kind: "hero", name: "old.png", removed_at: NOW_ISO });
    const viewer = ctxAs(org, "viewer");

    const all = await listLibrary(viewer);
    expect(all.items.map((i) => i.id)).toEqual([au, v, b, a]);
    expect(all.counts).toEqual({ all: 4, images: 2, videos: 1, audio: 1 });
    expect(all.needsDescription).toBe(1);
    expect(all.perPage).toBe(48);

    const img = all.items.find((i) => i.id === a)!;
    expect(img).toMatchObject({
      kind: "image",
      rowKind: "library",
      name: "IMG_2041.JPG",
      needsDescription: true,
      thumbUrl: `/hub/media/${a}/thumb`,
      previewUrl: `/hub/media/${a}/w960`,
      posterUrl: null,
    });
    expect(all.items.find((i) => i.id === v)).toMatchObject({
      kind: "video",
      thumbUrl: `/hub/media/${v}/poster.webp`,
      previewUrl: `/hub/media/${v}/video.mp4`,
      posterUrl: `/hub/media/${v}/poster.webp`,
    });
    expect(all.items.find((i) => i.id === au)).toMatchObject({
      kind: "audio",
      thumbUrl: null,
      previewUrl: `/hub/media/${au}/audio.mp3`,
    });

    expect(
      (await listLibrary(ctx, { filter: "images" })).items.map((i) => i.id),
    ).toEqual([b, a]);
    expect(
      (await listLibrary(ctx, { filter: "audio" })).items.map((i) => i.id),
    ).toEqual([au]);
    const found = await listLibrary(ctx, { q: "  loaves " });
    expect(found.items.map((i) => i.id)).toEqual([b]);
    expect(found.counts.all).toBe(4);
    expect(
      (await listLibrary(ctx, { q: "img_20" })).items.map((i) => i.id),
    ).toEqual([a]);
    expect((await listLibrary(ctx, { perPage: 1000 })).perPage).toBe(100);
    expect((await listLibrary(ctx, { perPage: 0 })).perPage).toBe(1);
  });

  it("never lists another org's rows; getLibraryItem is NotFound across orgs", async (t) => {
    if (!inst) return t.skip();
    const A = await siteOrg();
    const B = await siteOrg();
    const id = await mediaRow(A.org);
    expect((await listLibrary(B.ctx)).items).toEqual([]);
    await expect(getLibraryItem(B.ctx, id)).rejects.toBeInstanceOf(NotFound);
    const del = await mediaRow(A.org, { deleted_at: NOW_ISO });
    expect((await getLibraryItem(A.ctx, del)).deleted).toBe(true);
  });

  it("the describe list: oldest first with suggestions; count matches", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await siteOrg();
    const first = await mediaRow(org, { name: "loaves-cooling.jpg" });
    const second = await mediaRow(org, { name: "IMG_1.JPG" });
    await mediaRow(org, { name: "done.png", alt: "Done" });
    await mediaRow(org, { kind: "video", name: "v.mp4" });
    const list = await listMediaNeedingDescription(ctx);
    expect(list.items).toEqual([
      {
        id: first,
        name: "loaves-cooling.jpg",
        thumbUrl: `/hub/media/${first}/thumb`,
        suggestion: "Loaves cooling",
      },
      {
        id: second,
        name: "IMG_1.JPG",
        thumbUrl: `/hub/media/${second}/thumb`,
        suggestion: "",
      },
    ]);
    expect(list.total).toBe(2);
    expect(await countMediaNeedingDescription(ctx)).toBe(2);
    expect(
      (await listMediaNeedingDescription(ctx, { limit: 1 })).items,
    ).toHaveLength(1);
  });

  it("describeMedia saves many in one write and refuses blanks, long text and foreign ids", async (t) => {
    if (!inst) return t.skip();
    const A = await siteOrg();
    const B = await siteOrg();
    const x = await mediaRow(A.org);
    const y = await mediaRow(A.org, { alt: "Same" });
    const foreign = await mediaRow(B.org);
    const video = await mediaRow(A.org, { kind: "video" });

    await expect(describeMedia(A.ctx, [{ id: x, alt: "   " }])).rejects.toThrow(
      ALT_REQUIRED_COPY,
    );
    await expect(
      describeMedia(A.ctx, [{ id: x, alt: "a".repeat(251) }]),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      describeMedia(A.ctx, [
        { id: x, alt: "Ok" },
        { id: foreign, alt: "Nope" },
      ]),
    ).rejects.toBeInstanceOf(NotFound);
    expect((await pb.collection("media_assets").getOne(x)).alt).toBe("");
    expect((await pb.collection("media_assets").getOne(foreign)).alt).toBe("");
    await expect(
      describeMedia(A.ctx, [{ id: video, alt: "Video" }]),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      describeMedia(ctxAs(A.org, "viewer"), [{ id: x, alt: "Ok" }]),
    ).rejects.toBeInstanceOf(Forbidden);

    const r = await describeMedia(A.ctx, [
      { id: x, alt: " Loaves cooling " },
      { id: y, alt: "Same" },
    ]);
    expect(r.updated).toBe(1);
    expect((await pb.collection("media_assets").getOne(x)).alt).toBe(
      "Loaves cooling",
    );
    expect(await countMediaNeedingDescription(A.ctx)).toBe(0);
  });
});

describe("readPublicMedia and the resolvers (CONT-33, resolution d)", () => {
  it("readPublicMedia returns own ready rows, public fields only", async (t) => {
    if (!inst) return t.skip();
    const A = await siteOrg();
    const B = await siteOrg();
    const ok = await mediaRow(A.org, { name: "secret-name.png" });
    const processing = await mediaRow(A.org, { status: "processing" });
    const foreign = await mediaRow(B.org);
    const rows = await readPublicMedia(A.site, [
      ok,
      ok,
      processing,
      foreign,
      "__proto__",
      "nope",
      "zzzzzzzzzzzzzzz",
      42,
    ]);
    expect(rows.map((r) => r.id)).toEqual([ok]);
    expect(rows[0]).not.toHaveProperty("storage_dir");
    expect(rows[0]).not.toHaveProperty("name");
    expect(rows[0]!.deleted).toBe(false);
  });

  it("resolves promoted images to public URLs with srcset; unpromoted and protected are tokenized", async (t) => {
    if (!inst) return t.skip();
    const { org, site } = await siteOrg();
    const pub = await mediaRow(org, { public_at: NOW_ISO, alt: "Loaves" });
    const priv = await mediaRow(org, {
      width: 700,
      web_width: 700,
      height: 500,
    });
    const out = await resolvePublicMedia(site, [pub, priv], {
      pageId: "page1",
      delivery: appDelivery,
    });
    expect(out[pub]).toEqual({
      id: pub,
      kind: "image",
      alt: "Loaves",
      width: 2000,
      height: 1000,
      src: `/_media/${pub}/w1600`,
      srcSet: `/_media/${pub}/w480 480w, /_media/${pub}/w960 960w, /_media/${pub}/w1600 1600w, /_media/${pub}/w2560 2000w`,
    });
    expect(out[priv]!.src).toMatch(
      new RegExp(`^/_media/${priv}/w2560\\?e=\\d+&t=`),
    );
    expect(out[priv]!.srcSet).toMatch(/w480\?e=\d+&t=[^ ]+ 480w, /);

    const prot = await resolvePublicMedia(site, [pub], {
      pageId: "page1",
      protectedPage: true,
      delivery: appDelivery,
    });
    expect(prot[pub]!.src).toMatch(/\?e=\d+&t=/);
  });

  it("resolves video (poster asset, captions) and audio; deleted flagged, processing absent", async (t) => {
    if (!inst) return t.skip();
    const { org, site } = await siteOrg();
    const cover = await mediaRow(org, { public_at: NOW_ISO });
    const video = await mediaRow(org, {
      kind: "video",
      public_at: NOW_ISO,
      poster_asset: cover,
      captions_path: "captions.vtt",
      width: 1280,
      height: 720,
    });
    const bare = await mediaRow(org, { kind: "video", public_at: NOW_ISO });
    const audio = await mediaRow(org, {
      kind: "audio",
      public_at: NOW_ISO,
      width: 0,
      height: 0,
    });
    const gone = await mediaRow(org, {
      public_at: NOW_ISO,
      deleted_at: NOW_ISO,
    });
    const busy = await mediaRow(org, { kind: "video", status: "processing" });
    const out = await resolvePublicMedia(
      site,
      [video, bare, audio, gone, busy],
      { delivery: appDelivery },
    );
    expect(out[video]).toMatchObject({
      kind: "video",
      src: `/_media/${video}/video.mp4`,
      poster: `/_media/${cover}/w960`,
      captions: `/_media/${video}/captions.vtt`,
      mime: "video/mp4",
    });
    expect(out[cover]).toBeUndefined();
    expect(out[bare]!.poster).toBe(`/_media/${bare}/poster.webp`);
    expect(out[bare]!.captions).toBeUndefined();
    expect(out[audio]).toMatchObject({
      kind: "audio",
      src: `/_media/${audio}/audio.mp3`,
      mime: "audio/mpeg",
    });
    expect(out[gone]!.deleted).toBe(true);
    expect(out[busy]).toBeUndefined();
  });

  it("a paused-video Bunny mode gives a promoted video an empty src (poster only)", async (t) => {
    if (!inst) return t.skip();
    const { org, site } = await siteOrg();
    const video = await mediaRow(org, { kind: "video", public_at: NOW_ISO });
    const fake: MediaDelivery = {
      name: "bunny",
      urlFor: (a, v) => `https://cdn.example/${a.id}/${v}`,
      purge: async () => {},
      deliveryBytes: async () => null,
    };
    const { writePlatformMeta } = await import("../src/platform-meta");
    const { mintSystemContext } = await import("../src/context");
    const sys = mintSystemContext({ job: "test" });
    const now = new Date();
    await writePlatformMeta(
      sys,
      "media:cdn_down_since",
      new Date(now.getTime() - 73 * 3_600_000).toISOString(),
    );
    // Origin fallback links are presigned (pure signing, no network): fake Wasabi config.
    const ENV = {
      WASABI_MEDIA_BUCKET: "cds-media-test",
      WASABI_ACCESS_KEY_ID: "AKIDEXAMPLE",
      WASABI_SECRET_ACCESS_KEY: "secret",
      WASABI_REGION: "us-east-1",
    };
    const saved = Object.fromEntries(
      Object.keys(ENV).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, ENV);
    try {
      const out = await resolvePublicMedia(site, [video], {
        delivery: fake,
        now,
      });
      expect(out[video]!.src).toBe("");
      expect(out[video]!.poster).toContain("poster.webp?");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await writePlatformMeta(sys, "media:cdn_down_since", "");
    }
  });

  it("resolveHubMedia gives hub URLs for own assets, including unpromoted ones", async (t) => {
    if (!inst) return t.skip();
    const A = await siteOrg();
    const B = await siteOrg();
    const id = await mediaRow(A.org, { width: 700, web_width: 700 });
    const out = await resolveHubMedia(A.ctx, [id]);
    expect(out[id]).toMatchObject({
      kind: "image",
      src: `/hub/media/${id}/w2560`,
      srcSet: `/hub/media/${id}/w480 480w, /hub/media/${id}/w2560 700w`,
    });
    expect(await resolveHubMedia(B.ctx, [id])).toEqual({});
  });
});

describe("hub objects and the tokenized private fallback", () => {
  it("openHubMediaObject reads own private derivatives with ranges; foreign ids NotFound", async (t) => {
    if (!inst) return t.skip();
    const A = await siteOrg();
    const B = await siteOrg();
    const id = await mediaRow(A.org, { kind: "audio", deleted_at: NOW_ISO });
    await store.put(
      tenantMediaDerivativeKey(A.org, id, "audio.mp3"),
      new TextEncoder().encode("0123456789"),
      "audio/mpeg",
    );
    const obj = await openHubMediaObject(A.ctx, id, "audio.mp3", { store });
    expect(obj.mime).toBe("audio/mpeg");
    expect(obj.size).toBe(10);
    expect(await streamText(await obj.read({ start: 2, end: 4 }))).toBe("234");
    await expect(
      openHubMediaObject(B.ctx, id, "audio.mp3", { store }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      openHubMediaObject(A.ctx, id, "w960", { store }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      openHubMediaObject(A.ctx, id, "original.png", { store }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("an image width not stored yet falls back to web.webp", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await siteOrg();
    const id = await mediaRow(org);
    await store.put(
      tenantMediaKey(org, id, "web.webp"),
      new TextEncoder().encode("web"),
      "image/webp",
    );
    const obj = await openHubMediaObject(ctx, id, "w960", { store });
    expect(await streamText(await obj.read(null))).toBe("web");
  });

  it("a tokenized request for an unpromoted image is served from the private store", async (t) => {
    if (!inst) return t.skip();
    const { org, site } = await siteOrg();
    const id = await mediaRow(org);
    await store.put(
      tenantMediaDerivativeKey(org, id, "w960"),
      new TextEncoder().encode("private-w960"),
      "image/webp",
    );
    const url = appDelivery.urlFor({ id, orgId: org, kind: "image" }, "w960", {
      protected: { pageId: "p1" },
    });
    const { e, t: tok } = tokenParts(url);
    const deps = { store: publicStore, privateStore: store };
    const obj = await openPublicMediaObject(
      site,
      { id, variant: "w960", e, t: tok },
      deps,
    );
    expect(obj.tokenized).toBe(true);
    expect(await streamText(await obj.read(null))).toBe("private-w960");
    await expect(
      openPublicMediaObject(site, { id, variant: "w960" }, deps),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("a promoted asset is served from the public object; untokenized never reads private", async (t) => {
    if (!inst) return t.skip();
    const { org, site } = await siteOrg();
    const id = await mediaRow(org, { public_at: NOW_ISO });
    await publicStore.put(
      tenantPublicMediaKey(org, "image", id, "w960"),
      new TextEncoder().encode("public-w960"),
      "image/webp",
    );
    await store.put(
      tenantMediaDerivativeKey(org, id, "w480"),
      new TextEncoder().encode("private-w480"),
      "image/webp",
    );
    let privateReads = 0;
    const spy = {
      put: store.put.bind(store),
      get: store.get.bind(store),
      delete: store.delete.bind(store),
      list: store.list.bind(store),
      readRange: store.readRange.bind(store),
      stat: async (k: string) => {
        privateReads += 1;
        return store.stat(k);
      },
    };
    const deps = { store: publicStore, privateStore: spy };
    const obj = await openPublicMediaObject(
      site,
      { id, variant: "w960" },
      deps,
    );
    expect(await streamText(await obj.read(null))).toBe("public-w960");
    await expect(
      openPublicMediaObject(site, { id, variant: "w480" }, deps),
    ).rejects.toBeInstanceOf(NotFound);
    expect(privateReads).toBe(0);
  });
});
