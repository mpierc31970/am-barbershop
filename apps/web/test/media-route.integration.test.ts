// /_media/<id>/<variant> on tenant hosts (07-09; CONT-19, CONT-20, CONT-33; T-07-09-01..08)
// against the real PocketBase 0.39.11 binary. The route is called directly with a Request;
// next/headers supplies the middleware's tenant header per case. Objects are written to a
// temp public store (CDS_PUBLIC_STORAGE_DIR) through the guarded getPublicMediaStore().
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  createAppDelivery,
  getPublicMediaStore,
  publicMediaMime,
  tenantPublicMediaKey,
  type PublicMediaKind,
  type PublicMediaVariant,
} from "@cds/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import {
  seedMediaRow,
  updateMediaRow,
} from "../../../packages/db/test/media-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({ header: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
}));

const { GET, HEAD } =
  await import("../app/tenant/[host]/%5Fmedia/[id]/[variant]/route");

const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let inst: PbInstance | null = null;
let seed: TwoOrgs;
let privDir: string;
let pubDir: string;

const HOST_A = "a.example.com";
const HOST_B = "b.example.com";
const NOW = "2026-10-05 04:00:00.000Z";

function bytesOf(n: number, salt = 0): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 7 + salt) % 256);
}

async function put(
  orgId: string,
  kind: PublicMediaKind,
  id: string,
  variant: PublicMediaVariant,
  body: Uint8Array,
): Promise<void> {
  await getPublicMediaStore().put(
    tenantPublicMediaKey(orgId, kind, id, variant),
    body,
    publicMediaMime(variant),
  );
}

async function call(
  path: string,
  opts: {
    host?: string;
    header?: string | null;
    method?: "GET" | "HEAD";
    range?: string;
  } = {},
): Promise<Response> {
  const host = opts.host ?? HOST_A;
  state.header = opts.header === undefined ? host : opts.header;
  const url = new URL(path, `https://${host}`);
  const [, , id, variant] = url.pathname.split("/");
  const headers: Record<string, string> = {};
  if (opts.range) headers.range = opts.range;
  const req = new Request(url, { method: opts.method ?? "GET", headers });
  const ctx = {
    params: Promise.resolve({ host, id: id!, variant: variant! }),
  };
  return opts.method === "HEAD" ? HEAD(req, ctx) : GET(req, ctx);
}

async function body(res: Response): Promise<number[]> {
  return [...new Uint8Array(await res.arrayBuffer())];
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-media-priv-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-media-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
});

afterAll(async () => {
  await inst?.stop();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(privDir, { recursive: true, force: true });
  rmSync(pubDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  state.header = null;
});

describe("/_media public images (CONT-33)", () => {
  it("serves a ready public image with immutable cache headers", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    const img = bytesOf(300);
    await put(seed.A.org, "image", id, "w960", img);
    const res = await call(`/_media/${id}/w960`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
    expect(res.headers.get("content-length")).toBe("300");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(await body(res)).toEqual([...img]);
  });

  it("404s on a foreign org's host and on a host/header mismatch", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    await put(seed.A.org, "image", id, "w960", bytesOf(10));
    expect((await call(`/_media/${id}/w960`, { host: HOST_B })).status).toBe(
      404,
    );
    const mismatch = await call(`/_media/${id}/w960`, { header: HOST_B });
    expect(mismatch.status).toBe(404);
    expect(mismatch.headers.get("cache-control")).toBe("no-store");
    expect((await call(`/_media/${id}/w960`, { header: null })).status).toBe(
      404,
    );
    expect(
      (await call(`/_media/${id}/w960`, { host: "nobody.example.com" })).status,
    ).toBe(404);
  });

  it("404s on bad, disallowed or traversal variants and bad ids", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    await put(seed.A.org, "image", id, "w960", bytesOf(10));
    for (const v of [
      "original.jpg",
      "web",
      "w999",
      "..%2F..%2Fversions",
      "video.mp4",
      "audio.mp3",
    ]) {
      expect((await call(`/_media/${id}/${v}`)).status, v).toBe(404);
    }
    expect((await call(`/_media/notanid/w960`)).status).toBe(404);
    expect((await call(`/_media/${"z".repeat(15)}/w960`)).status).toBe(404);
  });

  it("404s on assets that are not ready", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, {
      public_at: NOW,
      status: "processing",
    });
    await put(seed.A.org, "image", id, "w960", bytesOf(10));
    expect((await call(`/_media/${id}/w960`)).status).toBe(404);
    await updateMediaRow(id, { status: "failed" });
    expect((await call(`/_media/${id}/w960`)).status).toBe(404);
    await updateMediaRow(id, { status: "ready" });
    expect((await call(`/_media/${id}/w960`)).status).toBe(200);
  });

  it("404s when the object is missing", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    expect((await call(`/_media/${id}/w960`)).status).toBe(404);
  });

  it("serves soft-deleted public assets (D275)", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, {
      public_at: NOW,
      deleted_at: NOW,
    });
    await put(seed.A.org, "image", id, "w960", bytesOf(5));
    expect((await call(`/_media/${id}/w960`)).status).toBe(200);
  });
});

describe("/_media ?w= (choice 6)", () => {
  it("serves the smaller canonical width, falls back when missing, 404s otherwise", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    const big = bytesOf(40, 1);
    const small = bytesOf(20, 2);
    await put(seed.A.org, "image", id, "w1600", big);
    await put(seed.A.org, "image", id, "w480", small);
    const r480 = await call(`/_media/${id}/w1600?w=480`);
    expect(r480.status).toBe(200);
    expect(await body(r480)).toEqual([...small]);
    // w960 object is missing: falls back to the path variant
    const r960 = await call(`/_media/${id}/w1600?w=960`);
    expect(r960.status).toBe(200);
    expect(await body(r960)).toEqual([...big]);
    for (const w of ["123", "2560", "1600", "", "480x"]) {
      expect((await call(`/_media/${id}/w1600?w=${w}`)).status, w).toBe(404);
    }
    await put(seed.A.org, "image", id, "thumb", bytesOf(3));
    expect((await call(`/_media/${id}/thumb?w=480`)).status).toBe(404);
  });
});

describe("/_media tokens (CONT-33, D255)", () => {
  it("needs a valid, unexpired token bound to org + asset + variant when not public", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org);
    const other = await seedMediaRow(seed.A.org);
    await put(seed.A.org, "image", id, "w960", bytesOf(8));
    await put(seed.A.org, "image", id, "w480", bytesOf(4));
    await put(seed.A.org, "image", other, "w960", bytesOf(8));
    expect((await call(`/_media/${id}/w960`)).status).toBe(404);

    const ref = { id, orgId: seed.A.org, kind: "image" as const };
    const url = createAppDelivery().urlFor(ref, "w960", {
      protected: { pageId: "page1" },
    });
    const ok = await call(url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(ok.headers.get("x-robots-tag")).toBe("noindex");

    const q = new URL(url, "https://x").search;
    expect((await call(`/_media/${id}/w480${q}`)).status).toBe(404);
    expect((await call(`/_media/${other}/w960${q}`)).status).toBe(404);
    // the token is bound to org A: org B's host never serves it either
    expect(
      (await call(`/_media/${id}/w960${q}`, { host: HOST_B })).status,
    ).toBe(404);
    expect(
      (await call(`/_media/${id}/w960?e=1&t=${"A".repeat(43)}`)).status,
    ).toBe(404);

    const expired = createAppDelivery({
      now: () => Date.now() - 2 * 3600 * 1000,
    }).urlFor(ref, "w960", { protected: { pageId: "page1" } });
    expect((await call(expired)).status).toBe(404);
  });

  it("checks a present token even on a public asset (choice 8)", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, { public_at: NOW });
    await put(seed.A.org, "image", id, "w960", bytesOf(8));
    expect(
      (await call(`/_media/${id}/w960?e=1&t=${"A".repeat(43)}`)).status,
    ).toBe(404);
    const url = createAppDelivery().urlFor(
      { id, orgId: seed.A.org, kind: "image" },
      "w960",
      { protected: { pageId: "p" } },
    );
    const res = await call(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
  });
});

describe("/_media video and Range (CONT-19)", () => {
  it("serves 206 partial content, 416 past the end, 200 whole, HEAD without body", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, {
      kind: "video",
      original_ext: "mp4",
      public_at: NOW,
      duration_s: 3,
    });
    const video = bytesOf(1000, 3);
    await put(seed.A.org, "video", id, "video.mp4", video);

    const part = await call(`/_media/${id}/video.mp4`, { range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(part.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(part.headers.get("content-length")).toBe("100");
    expect(await body(part)).toEqual([...video.slice(0, 100)]);

    const tail = await call(`/_media/${id}/video.mp4`, { range: "bytes=-10" });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect(await body(tail)).toEqual([...video.slice(990)]);

    const bad = await call(`/_media/${id}/video.mp4`, { range: "bytes=1000-" });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */1000");

    const whole = await call(`/_media/${id}/video.mp4`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe("1000");
    expect(await body(whole)).toEqual([...video]);

    const multi = await call(`/_media/${id}/video.mp4`, {
      range: "bytes=0-1,5-6",
    });
    expect(multi.status).toBe(200);

    const head = await call(`/_media/${id}/video.mp4`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("1000");
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.body).toBeNull();

    // an image variant on a video is refused
    expect((await call(`/_media/${id}/w960`)).status).toBe(404);
  });

  it("serves captions only when the row names them", async (t) => {
    if (!inst) return t.skip();
    const id = await seedMediaRow(seed.A.org, {
      kind: "video",
      original_ext: "mp4",
      public_at: NOW,
    });
    await put(
      seed.A.org,
      "video",
      id,
      "captions.vtt",
      new TextEncoder().encode("WEBVTT\n"),
    );
    expect((await call(`/_media/${id}/captions.vtt`)).status).toBe(404);
    await updateMediaRow(id, { captions_path: "captions.vtt" });
    const res = await call(`/_media/${id}/captions.vtt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    // WR-C01: captions are replaced in place behind this URL, so they expire quickly.
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
