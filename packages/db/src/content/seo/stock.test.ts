// 07-30 Task 2: Unsplash / Pexels adapters behind StockPhotoSource (CONT-28, T-07-30-06/07).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPexelsSource,
  createUnsplashSource,
  getStockPhotoSource,
} from "./stock";

type Call = { url: string; headers: Record<string, string> };

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const UNSPLASH_BODY = {
  total_pages: 3,
  results: [
    {
      id: "abc_123",
      width: 4000,
      height: 3000,
      alt_description: "loaves of bread",
      urls: {
        regular: "https://images.unsplash.com/photo-1?w=1080",
        small: "https://images.unsplash.com/photo-1?w=400",
      },
      user: { name: "Ana Silva", links: { html: "https://unsplash.com/@ana" } },
    },
    {
      id: "evil",
      urls: {
        regular: "https://evil.example/x.jpg",
        small: "https://evil.example/y.jpg",
      },
      user: { name: "X", links: { html: "https://unsplash.com/@x" } },
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("Unsplash source", () => {
  it("searches with the client id, maps results and drops foreign hosts", async () => {
    const { fn, calls } = fakeFetch(UNSPLASH_BODY);
    const src = createUnsplashSource({ accessKey: "KEY1", fetch: fn });
    const page = await src.search("  bakery  ", 2);
    expect(calls[0]?.url).toBe(
      "https://api.unsplash.com/search/photos?query=bakery&page=2&per_page=24",
    );
    expect(calls[0]?.headers.Authorization).toBe("Client-ID KEY1");
    expect(calls[0]?.headers["Accept-Version"]).toBe("v1");
    expect(page.photos).toHaveLength(1);
    expect(page.photos[0]).toMatchObject({
      id: "abc_123",
      source: "unsplash",
      url: "https://images.unsplash.com/photo-1?w=1080",
      alt: "loaves of bread",
      creditName: "Ana Silva",
      creditUrl:
        "https://unsplash.com/@ana?utm_source=cds_platform&utm_medium=referral",
    });
    expect(page.hasMore).toBe(true);
  });

  it("registerUse pings the download endpoint for a valid id only", async () => {
    const { fn, calls } = fakeFetch({});
    const src = createUnsplashSource({ accessKey: "KEY1", fetch: fn });
    await src.registerUse!("abc_123");
    expect(calls[0]?.url).toBe(
      "https://api.unsplash.com/photos/abc_123/download",
    );
    await expect(src.registerUse!("../x")).rejects.toThrow();
    await expect(src.registerUse!("a/b")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("a non-2xx is an empty page and a log without the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fn } = fakeFetch({ errors: ["nope"] }, 401);
    const src = createUnsplashSource({ accessKey: "SECRETKEY", fetch: fn });
    expect(await src.search("x", 1)).toEqual({ photos: [], hasMore: false });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).toContain("[stock]");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRETKEY");
  });

  it("a timeout is an empty page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      })) as unknown as typeof fetch;
    const src = createUnsplashSource({
      accessKey: "K",
      fetch: hang,
      timeoutMs: 10,
    });
    expect(await src.search("x", 1)).toEqual({ photos: [], hasMore: false });
  });
});

describe("Pexels source", () => {
  it("sends the raw key and maps photos", async () => {
    const { fn, calls } = fakeFetch({
      next_page: "https://api.pexels.com/v1/search?page=2",
      photos: [
        {
          id: 42,
          width: 100,
          height: 80,
          alt: "Bread",
          photographer: "Bo Lee",
          photographer_url: "https://www.pexels.com/@bo",
          src: {
            large: "https://images.pexels.com/photos/42/a.jpeg?h=650",
            medium: "https://images.pexels.com/photos/42/a.jpeg?h=350",
          },
        },
      ],
    });
    const page = await createPexelsSource({ apiKey: "PK", fetch: fn }).search(
      "bread",
      1,
    );
    expect(
      calls[0]?.url.startsWith("https://api.pexels.com/v1/search?query=bread"),
    ).toBe(true);
    expect(calls[0]?.headers.Authorization).toBe("PK");
    expect(page.photos[0]).toMatchObject({
      id: "42",
      source: "pexels",
      creditName: "Bo Lee",
    });
    expect(page.hasMore).toBe(true);
  });
});

describe("getStockPhotoSource", () => {
  it("is null without keys or when off", () => {
    expect(getStockPhotoSource({})).toBeNull();
    expect(
      getStockPhotoSource({
        CDS_STOCK_PHOTOS: "off",
        UNSPLASH_ACCESS_KEY: "k",
      }),
    ).toBeNull();
  });

  it("prefers Unsplash, then Pexels", () => {
    expect(getStockPhotoSource({ UNSPLASH_ACCESS_KEY: "k" })?.name).toBe(
      "unsplash",
    );
    expect(getStockPhotoSource({ PEXELS_API_KEY: "k" })?.name).toBe("pexels");
    expect(
      getStockPhotoSource({
        CDS_STOCK_PHOTOS: "pexels",
        UNSPLASH_ACCESS_KEY: "u",
        PEXELS_API_KEY: "p",
      })?.name,
    ).toBe("pexels");
  });

  it("an explicit choice without its key is null with one log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      getStockPhotoSource({
        CDS_STOCK_PHOTOS: "unsplash",
        PEXELS_API_KEY: "p",
      }),
    ).toBeNull();
    expect(log).toHaveBeenCalledWith("[stock] missing key");
  });
});
