// D278 fallback state machine, the cdn_down_since key, presigned origin links and
// resolveMediaUrl (07-10, CONT-20). No PocketBase and no network: readers, writers and the
// presigner are injected; presignOriginUrl is pure signing.
import { InvalidInput } from "@cds/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mintOrgContext, mintSystemContext } from "../../context";
import type { MediaDelivery } from "../ports";
import {
  CDN_DOWN_SINCE_KEY,
  FALLBACK_VIDEO_CAP_MS,
  ORIGIN_PAGE_MAX_AGE_S,
  currentDeliveryMode,
  deliveryMode,
  readCdnDownSince,
  resolveMediaUrl,
  writeCdnDownSince,
} from "./mode";
import {
  ORIGIN_LINK_TTL_S,
  originConfigFromEnv,
  presignOriginUrl,
} from "./origin";

const H = 3_600_000;
const NOW = new Date("2026-09-29T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * H);

function fake(name: "app" | "bunny") {
  return {
    name,
    urlFor: vi.fn((a: { id: string }, v: string) => `${name}://${a.id}/${v}`),
    purge: async () => {},
    deliveryBytes: async () => null,
  } satisfies MediaDelivery;
}

const IMG = { id: "asset1", orgId: "orga", kind: "image" as const };
const VID = { id: "vid1", orgId: "orga", kind: "video" as const };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deliveryMode (D278, 72 h cap)", () => {
  it("no outage -> cdn", () => {
    expect(deliveryMode(NOW, null)).toBe("cdn");
  });
  it("0 h -> origin", () => {
    expect(deliveryMode(NOW, ago(0))).toBe("origin");
  });
  it("71 h -> origin", () => {
    expect(deliveryMode(NOW, ago(71))).toBe("origin");
  });
  it("72 h exactly -> origin-video-paused", () => {
    expect(deliveryMode(NOW, ago(72))).toBe("origin-video-paused");
  });
  it("73 h -> origin-video-paused", () => {
    expect(deliveryMode(NOW, ago(73))).toBe("origin-video-paused");
  });
  it("future timestamp (clock skew) -> origin; invalid date -> cdn", () => {
    expect(deliveryMode(NOW, ago(-2))).toBe("origin");
    expect(deliveryMode(NOW, new Date("nope"))).toBe("cdn");
  });
  it("cap constant is 72 h", () => {
    expect(FALLBACK_VIDEO_CAP_MS).toBe(72 * H);
    expect(ORIGIN_PAGE_MAX_AGE_S).toBe(1800);
    expect(ORIGIN_PAGE_MAX_AGE_S).toBeLessThan(ORIGIN_LINK_TTL_S);
  });
});

describe("cdn_down_since key", () => {
  it("reads empty / null / garbage as null and ISO as a Date", async () => {
    const read = vi.fn<(k: string) => Promise<string | null>>(async () => "");
    expect(await readCdnDownSince(read)).toBeNull();
    expect(read).toHaveBeenCalledWith("media:cdn_down_since");
    expect(await readCdnDownSince(async () => null)).toBeNull();
    expect(await readCdnDownSince(async () => "garbage")).toBeNull();
    const d = await readCdnDownSince(async () => "2026-09-28T01:02:03.000Z");
    expect(d?.toISOString()).toBe("2026-09-28T01:02:03.000Z");
  });

  it("writes ISO or empty string under the key, SystemContext only", async () => {
    expect(CDN_DOWN_SINCE_KEY).toBe("media:cdn_down_since");
    const sys = mintSystemContext({ job: "cdn-probe" });
    const write = vi.fn(async () => {});
    await writeCdnDownSince(sys, ago(1), write);
    expect(write).toHaveBeenLastCalledWith(
      sys,
      "media:cdn_down_since",
      ago(1).toISOString(),
    );
    await writeCdnDownSince(sys, null, write);
    expect(write).toHaveBeenLastCalledWith(sys, "media:cdn_down_since", "");
    const org = mintOrgContext({
      orgId: "orga",
      actor: "u1",
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(
      writeCdnDownSince(org as never, null, write),
    ).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("currentDeliveryMode", () => {
  it("app delivery is always cdn and never reads the key", async () => {
    const read = vi.fn(async () => ago(80));
    expect(await currentDeliveryMode(fake("app"), NOW, read)).toBe("cdn");
    expect(read).not.toHaveBeenCalled();
  });
  it("bunny follows the stored timestamp", async () => {
    expect(
      await currentDeliveryMode(fake("bunny"), NOW, async () => ago(80)),
    ).toBe("origin-video-paused");
    expect(
      await currentDeliveryMode(fake("bunny"), NOW, async () => null),
    ).toBe("cdn");
  });
});

describe("resolveMediaUrl", () => {
  it("cdn mode -> urlFor", async () => {
    const d = fake("bunny");
    const presign = vi.fn(async () => "signed");
    expect(
      await resolveMediaUrl({
        delivery: d,
        mode: "cdn",
        asset: IMG,
        variant: "w960",
        opts: { width: 960 },
        presign,
      }),
    ).toBe("bunny://asset1/w960");
    expect(d.urlFor).toHaveBeenCalledWith(IMG, "w960", { width: 960 });
    expect(presign).not.toHaveBeenCalled();
  });

  it("protected media and app delivery use urlFor in every mode", async () => {
    const presign = vi.fn(async () => "signed");
    for (const mode of ["origin", "origin-video-paused"] as const) {
      expect(
        await resolveMediaUrl({
          delivery: fake("bunny"),
          mode,
          asset: VID,
          variant: "video.mp4",
          opts: { protected: { pageId: "p1" } },
          presign,
        }),
      ).toBe("bunny://vid1/video.mp4");
      expect(
        await resolveMediaUrl({
          delivery: fake("app"),
          mode,
          asset: VID,
          variant: "video.mp4",
          presign,
        }),
      ).toBe("app://vid1/video.mp4");
    }
    expect(presign).not.toHaveBeenCalled();
  });

  it("bunny + origin -> presigned public key with a 1 h TTL", async () => {
    vi.stubEnv("CDS_ENV", "");
    const presign = vi.fn(async (k: string, t: number) => `signed:${k}:${t}`);
    expect(
      await resolveMediaUrl({
        delivery: fake("bunny"),
        mode: "origin",
        asset: VID,
        variant: "video.mp4",
        presign,
      }),
    ).toBe("signed:dev/tenants/orga/media/video/vid1/video.mp4:3600");
    expect(presign).toHaveBeenCalledWith(
      "dev/tenants/orga/media/video/vid1/video.mp4",
      ORIGIN_LINK_TTL_S,
    );
  });

  it("origin-video-paused: video.mp4 resolves null, poster and images presign", async () => {
    vi.stubEnv("CDS_ENV", "");
    const presign = vi.fn(async (k: string) => `signed:${k}`);
    const base = {
      delivery: fake("bunny"),
      mode: "origin-video-paused" as const,
      presign,
    };
    expect(
      await resolveMediaUrl({ ...base, asset: VID, variant: "video.mp4" }),
    ).toBeNull();
    expect(
      await resolveMediaUrl({ ...base, asset: VID, variant: "poster.jpg" }),
    ).toBe("signed:dev/tenants/orga/media/video/vid1/poster.jpg");
    expect(
      await resolveMediaUrl({ ...base, asset: IMG, variant: "w960" }),
    ).toBe("signed:dev/tenants/orga/media/image/asset1/w960.webp");
    expect(presign).toHaveBeenCalledTimes(2);
  });
});

describe("presignOriginUrl / originConfigFromEnv", () => {
  const cfg = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "test-secret-not-real",
    region: "eu-central-2",
    bucket: "cds-platform-media",
  };
  const AT = new Date("2026-09-29T00:00:00Z");
  const KEY = "dev/tenants/orga/media/image/asset1/w960.webp";

  it("builds a path-style SigV4 query-signed GET link", async () => {
    vi.stubEnv("CDS_ENV", "");
    const out = await presignOriginUrl(cfg, KEY, 3600, AT);
    const u = new URL(out);
    expect(u.host).toBe("s3.eu-central-2.wasabisys.com");
    expect(u.pathname).toBe(
      "/cds-platform-media/dev/tenants/orga/media/image/asset1/w960.webp",
    );
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-Date")).toBe("20260929T000000Z");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(out).not.toContain("test-secret-not-real");
    expect(await presignOriginUrl(cfg, KEY, 3600, AT)).toBe(out);
  });

  it("refuses any key outside tenants/<org>/media/<kind>/", async () => {
    vi.stubEnv("CDS_ENV", "");
    for (const bad of [
      "dev/tenants/orga/versions/pages/p1/x.json",
      "dev/tenants/orga/exports/a.json",
      "dev/tenants/orga/media/site/share.png",
    ]) {
      await expect(presignOriginUrl(cfg, bad, 3600, AT)).rejects.toThrow(
        InvalidInput,
      );
    }
  });

  it("names every missing var, never a value", () => {
    let msg = "";
    try {
      originConfigFromEnv({});
    } catch (err) {
      msg = (err as Error).message;
    }
    for (const v of [
      "WASABI_MEDIA_BUCKET",
      "WASABI_ACCESS_KEY_ID",
      "WASABI_SECRET_ACCESS_KEY",
      "WASABI_REGION",
    ])
      expect(msg).toContain(v);
    try {
      originConfigFromEnv({ WASABI_SECRET_ACCESS_KEY: "s3cr3t-value" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).not.toContain("s3cr3t-value");
    expect(
      originConfigFromEnv({
        WASABI_MEDIA_BUCKET: "m",
        WASABI_ACCESS_KEY_ID: "a",
        WASABI_SECRET_ACCESS_KEY: "s",
        WASABI_REGION: "eu-central-2",
      }),
    ).toEqual({
      bucket: "m",
      accessKeyId: "a",
      secretAccessKey: "s",
      region: "eu-central-2",
    });
  });
});
