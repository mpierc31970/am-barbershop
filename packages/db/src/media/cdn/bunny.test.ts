// Bunny delivery adapter (07-10, CONT-20, D226): pull-zone URLs, Optimizer params, the
// official HS256 token signer, purge request shape, names-only config errors. Never live:
// every fetch is a vi.fn.
import { createHmac } from "node:crypto";
import { InvalidInput } from "@cds/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaDelivery } from "../ports";
import {
  BUNNY_ENV_VARS,
  BUNNY_OPTIMIZER_FORMAT,
  bunnySign,
  bunnySignedUrlFor,
  createBunnyDelivery,
  mediaCrossOrigin,
  publicObjectKey,
} from "./bunny";

const ENV = {
  BUNNY_PULL_ZONE_HOST: "cdn.example.b-cdn.net",
  BUNNY_TOKEN_KEY: "test-token-key-000000000000000000",
  BUNNY_API_KEY: "test-api-key",
};
const IMG = { id: "asset1", orgId: "orga", kind: "image" as const };
const VID = { id: "vid1", orgId: "orga", kind: "video" as const };
const AUD = { id: "aud1", orgId: "orga", kind: "audio" as const };

const SIGN_URL =
  "https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/w960?width=960&format=auto";
const SIGN_KEY = "test-token-key-000000000000000000";
const SIGN_EXP = 1790000000;
// Computed once with node:crypto (below, independently of bunnySign) and frozen here so a
// later refactor of both cannot drift together.
const SIGN_TOKEN = "HS256-5tdMFmdeLwHvFJ3FlvXWJ9sHXnjzmsBCrwELSU6vPAI";
const SIGN_TOKEN_PATH = "HS256-0w6CNkFTflbZb6iUUFlP582QxuYVw6pacIIpEmA8kQE";

function independentToken(path: string, signingData: string): string {
  const h = createHmac("sha256", SIGN_KEY);
  h.update(path);
  h.update(String(SIGN_EXP));
  h.update(signingData);
  return (
    "HS256-" +
    h
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("bunnySign (official HS256 format)", () => {
  it("matches the independently computed vector", () => {
    const expected = independentToken(
      "/dev/tenants/orga/media/image/asset1/w960",
      "format=auto&width=960",
    );
    expect(expected).toBe(SIGN_TOKEN);
    expect(bunnySign(SIGN_URL, SIGN_KEY, SIGN_EXP)).toBe(
      `https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/w960?token=${SIGN_TOKEN}&format=auto&width=960&expires=1790000000`,
    );
  });

  it("signs and emits token_path when pathAllowed is set", () => {
    const expected = independentToken(
      "/dev/tenants/orga/",
      "format=auto&token_path=/dev/tenants/orga/&width=960",
    );
    expect(expected).toBe(SIGN_TOKEN_PATH);
    expect(bunnySign(SIGN_URL, SIGN_KEY, SIGN_EXP, "/dev/tenants/orga/")).toBe(
      `https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/w960?token=${SIGN_TOKEN_PATH}&format=auto&token_path=${encodeURIComponent("/dev/tenants/orga/")}&width=960&expires=1790000000`,
    );
  });

  it("a URL with no query gets token then expires", () => {
    const out = bunnySign(
      "https://cdn.example.b-cdn.net/a/b",
      SIGN_KEY,
      SIGN_EXP,
    );
    expect(out).toMatch(
      /^https:\/\/cdn\.example\.b-cdn\.net\/a\/b\?token=HS256-[A-Za-z0-9_-]+&expires=1790000000$/,
    );
  });
});

describe("createBunnyDelivery config", () => {
  it("does not throw at construction; first use names every missing var, never a value", async () => {
    const d = createBunnyDelivery({ env: {} });
    expect(d.name).toBe("bunny");
    let msg = "";
    try {
      d.urlFor(IMG, "w960");
    } catch (err) {
      msg = (err as Error).message;
    }
    for (const v of BUNNY_ENV_VARS) expect(msg).toContain(v);
    await expect(d.purge(["x"])).rejects.toThrow(/BUNNY_PULL_ZONE_HOST/);

    const partial = createBunnyDelivery({
      env: { BUNNY_API_KEY: "test-api-key" },
    });
    try {
      partial.urlFor(IMG, "w960");
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("BUNNY_PULL_ZONE_HOST");
    expect(msg).toContain("BUNNY_TOKEN_KEY");
    expect(msg).not.toContain("BUNNY_API_KEY");
    expect(msg).not.toContain("test-api-key");
  });

  it("rejects a host with a scheme, path or port, naming only the var", () => {
    for (const host of [
      "https://cdn.example.b-cdn.net",
      "cdn.example.b-cdn.net/x",
      "cdn.example.b-cdn.net:443",
      "CDN.EXAMPLE.NET",
    ]) {
      const d = createBunnyDelivery({
        env: { ...ENV, BUNNY_PULL_ZONE_HOST: host },
      });
      expect(() => d.urlFor(IMG, "w960")).toThrow(/BUNNY_PULL_ZONE_HOST/);
      try {
        d.urlFor(IMG, "w960");
      } catch (err) {
        expect((err as Error).message).not.toContain(host);
      }
    }
  });

  it("exposes the three var names, frozen", () => {
    expect(BUNNY_ENV_VARS).toEqual([
      "BUNNY_PULL_ZONE_HOST",
      "BUNNY_TOKEN_KEY",
      "BUNNY_API_KEY",
    ]);
    expect(Object.isFrozen(BUNNY_ENV_VARS)).toBe(true);
    expect(BUNNY_OPTIMIZER_FORMAT).toBe("auto");
  });
});

describe("urlFor", () => {
  const d = createBunnyDelivery({ env: ENV });

  it("image: pull-zone path (07-09 layout) with width then format=auto", () => {
    vi.stubEnv("CDS_ENV", "");
    expect(d.urlFor(IMG, "w960", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/w960.webp?width=960&format=auto",
    );
  });

  it("production has no dev/ segment", () => {
    vi.stubEnv("CDS_ENV", "production");
    expect(d.urlFor(IMG, "w960", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/tenants/orga/media/image/asset1/w960.webp?width=960&format=auto",
    );
  });

  it("non-image variants never get Optimizer params", () => {
    vi.stubEnv("CDS_ENV", "");
    expect(d.urlFor(VID, "video.mp4", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/video/vid1/video.mp4",
    );
    expect(d.urlFor(VID, "poster.jpg", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/video/vid1/poster.jpg",
    );
    expect(d.urlFor(VID, "captions.vtt", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/video/vid1/captions.vtt",
    );
    expect(d.urlFor(AUD, "audio.mp3", { width: 960 })).toBe(
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/audio/aud1/audio.mp3",
    );
  });

  it("image width: absent or out of range -> format only; fractional -> rounded", () => {
    vi.stubEnv("CDS_ENV", "");
    const base =
      "https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/";
    expect(d.urlFor(IMG, "w480")).toBe(`${base}w480.webp?format=auto`);
    expect(d.urlFor(IMG, "thumb", { width: 0 })).toBe(
      `${base}thumb.webp?format=auto`,
    );
    expect(d.urlFor(IMG, "w2560", { width: 9999 })).toBe(
      `${base}w2560.webp?format=auto`,
    );
    expect(d.urlFor(IMG, "w960", { width: Number.NaN })).toBe(
      `${base}w960.webp?format=auto`,
    );
    expect(d.urlFor(IMG, "w960", { width: 640.6 })).toBe(
      `${base}w960.webp?width=641&format=auto`,
    );
  });

  it("bad org/id segments and variants throw InvalidInput", () => {
    for (const bad of ["Asset1", "..", "a/b", ""]) {
      expect(() => d.urlFor({ ...IMG, id: bad }, "w960")).toThrow(InvalidInput);
      expect(() => d.urlFor({ ...IMG, orgId: bad }, "w960")).toThrow(
        InvalidInput,
      );
    }
    expect(() => d.urlFor(IMG, "w999" as never)).toThrow(InvalidInput);
    expect(() => d.urlFor(IMG, "video.mp4")).toThrow(InvalidInput);
    expect(() => d.urlFor({ ...IMG, kind: "doc" as never }, "w960")).toThrow(
      InvalidInput,
    );
  });

  it("protected media delegates to privateDelivery, or throws without one", () => {
    const priv = {
      name: "app",
      urlFor: vi.fn(() => "/_media/asset1/w960?e=1&t=x"),
      purge: async () => {},
      deliveryBytes: async () => null,
    } satisfies MediaDelivery;
    const withPriv = createBunnyDelivery({ env: ENV, privateDelivery: priv });
    const opts = { width: 960, protected: { pageId: "page1" } };
    expect(withPriv.urlFor(IMG, "w960", opts)).toBe(
      "/_media/asset1/w960?e=1&t=x",
    );
    expect(priv.urlFor).toHaveBeenCalledWith(IMG, "w960", opts);
    expect(() => d.urlFor(IMG, "w960", opts)).toThrow(
      /protected media is served by the app route/,
    );
    expect(() => d.urlFor(IMG, "w960", opts)).toThrow(InvalidInput);
  });

  it("publicObjectKey is the 07-09 layout", () => {
    vi.stubEnv("CDS_ENV", "");
    expect(publicObjectKey(IMG, "thumb")).toBe(
      "dev/tenants/orga/media/image/asset1/thumb.webp",
    );
  });
});

describe("purge", () => {
  const K1 = "dev/tenants/orga/media/image/asset1/w960.webp";
  const K2 = "dev/tenants/orga/media/video/vid1/poster.jpg";

  it("one POST per distinct key with a trailing wildcard (WR-A06), AccessKey header, AbortSignal", async () => {
    vi.stubEnv("CDS_ENV", "");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 200 });
      }),
    );
    await createBunnyDelivery({ env: ENV }).purge([K1, K1, K2]);
    expect(calls).toHaveLength(2);
    for (const [i, key] of [K1, K2].entries()) {
      expect(calls[i]!.url).toBe(
        "https://api.bunny.net/purge?url=" +
          encodeURIComponent("https://cdn.example.b-cdn.net/" + key + "*") +
          "&async=true",
      );
      expect(calls[i]!.init.method).toBe("POST");
      expect(new Headers(calls[i]!.init.headers).get("AccessKey")).toBe(
        "test-api-key",
      );
      expect(calls[i]!.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("an injected fetch is used; purge([]) makes no call", async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    await createBunnyDelivery({ env: ENV, fetch: f }).purge([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses non-media keys before any fetch", async () => {
    vi.stubEnv("CDS_ENV", "");
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", f);
    const d = createBunnyDelivery({ env: ENV });
    for (const bad of [
      "dev/tenants/orga/versions/pages/p1/x.json",
      "dev/tenants/orga/forms/x",
      "dev/tenants/orga/exports/a.json",
      "tenants/orga/media/image/asset1/w960.webp", // wrong env prefix for dev
      "dev/tenants/orga/media/image/asset1/../w960.webp",
    ]) {
      await expect(d.purge([K1, bad])).rejects.toThrow(InvalidInput);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("a non-2xx response throws with the status only", async () => {
    vi.stubEnv("CDS_ENV", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    let msg = "";
    try {
      await createBunnyDelivery({ env: ENV }).purge([K1]);
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("401");
    expect(msg).not.toContain("test-api-key");
    expect(msg).not.toContain(K1);
  });
});

describe("deliveryBytes, mediaCrossOrigin, bunnySignedUrlFor", () => {
  it("deliveryBytes resolves null", async () => {
    const d = createBunnyDelivery({ env: ENV });
    await expect(d.deliveryBytes("orga", "2026-09")).resolves.toBeNull();
  });

  it("crossorigin is anonymous for bunny only", () => {
    const app = {
      name: "app",
      urlFor: () => "",
      purge: async () => {},
      deliveryBytes: async () => null,
    } satisfies MediaDelivery;
    expect(mediaCrossOrigin(createBunnyDelivery({ env: ENV }))).toBe(
      "anonymous",
    );
    expect(mediaCrossOrigin(app)).toBeUndefined();
  });

  it("bunnySignedUrlFor signs the plain pull-zone URL", () => {
    vi.stubEnv("CDS_ENV", "");
    const out = bunnySignedUrlFor({
      env: ENV,
      asset: IMG,
      variant: "w960",
      width: 960,
      expires: SIGN_EXP,
    });
    expect(out).toBe(
      bunnySign(
        "https://cdn.example.b-cdn.net/dev/tenants/orga/media/image/asset1/w960.webp?width=960&format=auto",
        SIGN_KEY,
        SIGN_EXP,
      ),
    );
    expect(() =>
      bunnySignedUrlFor({ env: {}, asset: IMG, variant: "w960", expires: 1 }),
    ).toThrow(/BUNNY_TOKEN_KEY/);
  });
});
