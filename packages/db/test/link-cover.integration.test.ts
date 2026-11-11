// Link cover capture on the real PocketBase 0.39.11 binary (07-23; CONT-34, RESEARCH Pitfall 7,
// T-07-23-01/02/03): a YouTube cover is fetched once from the fixed host into the org's own
// media library (source "link"), reused per org and video, and every fetch, type, size, time
// or decode failure leaves no row and no stored object.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Forbidden } from "@cds/core";
import type PocketBase from "pocketbase";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { MEDIA_ALLOWANCE_BYTES } from "../src/media/cdn";
import {
  captureLinkCover,
  getLibraryItem,
  LINK_COVER_MAX_BYTES,
  listLibrary,
} from "../src/media/library";
import { LocalDiskStore } from "../src/storage/local-disk";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const YT = "dQw4w9WgXcQ";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let store: LocalDiskStore;
let jpeg: Uint8Array;

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
      name: "Cover Co",
      slug: `cov-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
}

async function rows(org: string) {
  return pb.collection("media_assets").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
}

function storedFiles(org: string): number {
  try {
    return readdirSync(join(root, "tenants", org), { recursive: true }).length;
  } catch {
    return 0;
  }
}

function okFetch(
  body: Uint8Array | ReadableStream<Uint8Array> = jpeg,
  init: ResponseInit = { headers: { "content-type": "image/jpeg" } },
) {
  return vi.fn(async () => new Response(body as BodyInit, init));
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-linkcover-"));
  store = new LocalDiskStore(root);
  jpeg = new Uint8Array(
    await sharp({
      create: {
        width: 480,
        height: 360,
        channels: 3,
        background: { r: 200, g: 40, b: 40 },
      },
    })
      .jpeg()
      .toBuffer(),
  );
});

afterAll(async () => {
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("captureLinkCover (CONT-34, Pitfall 7)", () => {
  it("fetches the fixed YouTube URL once and stores a library photo with source link", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const fetch = okFetch();
    const r = await captureLinkCover(
      ctxAs(org, "editor"),
      { provider: "youtube", providerId: YT, title: "Spring menu tour" },
      { fetch, store },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reused).toBe(false);
    const row = await pb.collection("media_assets").getOne(r.asset);
    expect(row).toMatchObject({
      organization: org,
      kind: "library",
      source: "link",
      name: `youtube-${YT}.jpg`,
      alt: 'Cover of "Spring menu tour"',
      width: 480,
      height: 360,
    });
    expect(r.thumbUrl).toBe(`/hub/media/${r.asset}/thumb`);
  });

  it("a blank title gives the generic description", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const r = await captureLinkCover(
      ctxAs(org, "owner"),
      { provider: "youtube", providerId: YT, title: "  " },
      { fetch: okFetch(), store },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await getLibraryItem(ctxAs(org, "owner"), r.asset)).alt).toBe(
      "Video cover from YouTube",
    );
  });

  it("reuses the org's earlier copy without fetching; another org gets its own row", async (t) => {
    if (!inst) return t.skip();
    const orgA = await bareOrg();
    const orgB = await bareOrg();
    const first = await captureLinkCover(
      ctxAs(orgA, "owner"),
      { provider: "youtube", providerId: YT, title: "A" },
      { fetch: okFetch(), store },
    );
    const again = okFetch();
    const second = await captureLinkCover(
      ctxAs(orgA, "owner"),
      { provider: "youtube", providerId: YT, title: "A again" },
      { fetch: again, store },
    );
    expect(again).not.toHaveBeenCalled();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.asset).toBe(first.asset);
    expect(second.reused).toBe(true);
    const other = await captureLinkCover(
      ctxAs(orgB, "owner"),
      { provider: "youtube", providerId: YT, title: "B" },
      { fetch: okFetch(), store },
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.asset).not.toBe(first.asset);
    expect((await rows(orgA)).length).toBe(1);
    expect((await rows(orgB)).length).toBe(1);
  });

  it("does not reuse a soft-deleted or removed copy", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const first = await captureLinkCover(
      ctx,
      { provider: "youtube", providerId: YT, title: "" },
      { fetch: okFetch(), store },
    );
    if (!first.ok) throw new Error("capture failed");
    await pb
      .collection("media_assets")
      .update(first.asset, { deleted_at: new Date().toISOString() });
    const second = await captureLinkCover(
      ctx,
      { provider: "youtube", providerId: YT, title: "" },
      { fetch: okFetch(), store },
    );
    if (!second.ok) throw new Error("capture failed");
    expect(second.asset).not.toBe(first.asset);
    await pb
      .collection("media_assets")
      .update(second.asset, { removed_at: new Date().toISOString() });
    const third = await captureLinkCover(
      ctx,
      { provider: "youtube", providerId: YT, title: "" },
      { fetch: okFetch(), store },
    );
    if (!third.ok) throw new Error("capture failed");
    expect(third.reused).toBe(false);
    expect(third.asset).not.toBe(second.asset);
  });

  it("returns none without fetching for providers without a cover, unknown providers and bad ids", async (t) => {
    if (!inst) return t.skip();
    const ctx = ctxAs(await bareOrg(), "owner");
    const fetch = okFetch();
    for (const [provider, providerId] of [
      ["vimeo", "76979871"],
      ["spotify", "track/4cOdK2wGLETKBW3PvgPWqT"],
      ["calendly", "acme/intro"],
      ["myspace", YT],
      ["__proto__", YT],
      ["youtube", "../../etc"],
      ["youtube", "short"],
      [42, YT],
    ] as const) {
      expect(
        await captureLinkCover(ctx, { provider, providerId }, { fetch, store }),
      ).toEqual({ ok: false, reason: "none" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a 404 is unavailable, with no row and no object", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const r = await captureLinkCover(
      ctxAs(org, "owner"),
      { provider: "youtube", providerId: YT },
      { fetch: okFetch(new Uint8Array([1]), { status: 404 }), store },
    );
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(await rows(org)).toHaveLength(0);
    expect(storedFiles(org)).toBe(0);
  });

  it("a thrown fetch (refused redirect) is unavailable", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed: redirect mode is set to error");
    });
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        { fetch, store },
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await rows(org)).toHaveLength(0);
  });

  it("an HTML response is unavailable", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        {
          fetch: okFetch(new TextEncoder().encode("<html></html>"), {
            headers: { "content-type": "text/html" },
          }),
          store,
        },
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await rows(org)).toHaveLength(0);
  });

  it("stops reading past the 2 MiB cap and is unavailable", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    let pulled = 0;
    const chunk = new Uint8Array(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
    });
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        { fetch: okFetch(stream), store },
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(pulled).toBeLessThan(LINK_COVER_MAX_BYTES + 4 * chunk.length);
    expect(await rows(org)).toHaveLength(0);
  });

  it("times out a host that never answers", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        {
          fetch: fetch as unknown as typeof globalThis.fetch,
          store,
          timeoutMs: 50,
        },
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await rows(org)).toHaveLength(0);
  });

  it("bytes sharp cannot decode are unavailable", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const junk = new Uint8Array(4096).fill(7);
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        { fetch: okFetch(junk), store },
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await rows(org)).toHaveLength(0);
    expect(storedFiles(org)).toBe(0);
  });

  it("an org at its allowance gets allowance and no row", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    await pb.collection("media_assets").create({
      organization: org,
      kind: "library",
      status: "ready",
      source: "library",
      storage_dir: `tenants/${org}/media/x`,
      bytes: MEDIA_ALLOWANCE_BYTES - 10,
    });
    expect(
      await captureLinkCover(
        ctxAs(org, "owner"),
        { provider: "youtube", providerId: YT },
        { fetch: okFetch(), store },
      ),
    ).toEqual({ ok: false, reason: "allowance" });
    expect(await rows(org)).toHaveLength(1);
  });

  it("a Viewer is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const fetch = okFetch();
    await expect(
      captureLinkCover(
        ctxAs(await bareOrg(), "viewer"),
        { provider: "youtube", providerId: YT },
        { fetch, store },
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("LibraryItem.hasCaptions (07-23 choice 9)", () => {
  it("is true only for a video with captions.vtt", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const base = {
      organization: org,
      kind: "video",
      status: "ready",
      source: "library",
      storage_dir: `tenants/${org}/media/v`,
      bytes: 10,
      name: "clip.mp4",
    };
    const withCc = await pb
      .collection("media_assets")
      .create({ ...base, captions_path: "captions.vtt" });
    const without = await pb.collection("media_assets").create(base);
    expect((await getLibraryItem(ctx, withCc.id)).hasCaptions).toBe(true);
    expect((await getLibraryItem(ctx, without.id)).hasCaptions ?? false).toBe(
      false,
    );
    const list = await listLibrary(ctx, { filter: "videos" });
    const byId = new Map(list.items.map((i) => [i.id, i]));
    expect(byId.get(withCc.id)?.hasCaptions).toBe(true);
    expect(byId.get(without.id)?.hasCaptions ?? false).toBe(false);
  });
});
