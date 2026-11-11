// P7 port contracts (07-02): one fake per port, declared with `satisfies`, each method
// called once. Proves the shapes later plans implement.
import { describe, expect, it } from "vitest";
import type {
  FileScanner,
  MapEmbed,
  MediaDelivery,
  StockPhotoSource,
  VideoTranscoder,
} from "./index";

const delivery: MediaDelivery = {
  name: "app",
  urlFor: (asset, variant, opts) =>
    `/_media/${asset.id}/${variant}${opts?.width ? `?w=${opts.width}` : ""}`,
  purge: async () => {},
  deliveryBytes: async () => null,
} satisfies MediaDelivery;

const transcoder: VideoTranscoder = {
  name: "fake",
  probe: async () => ({
    hasVideoStream: true,
    durationS: 12,
    width: 1920,
    height: 1080,
  }),
  transcode: async () => ({
    durationS: 12,
    width: 1280,
    height: 720,
    bytes: 1024,
  }),
  extractFrame: async () => {},
} satisfies VideoTranscoder;

const scanner: FileScanner = {
  name: "unavailable",
  scan: async () => "error" as const,
} satisfies FileScanner;

const map: MapEmbed = {
  keyed: false,
  embedUrl: (q) =>
    `https://maps.google.com/maps?q=${encodeURIComponent(q.query)}&output=embed`,
  directionsUrl: (d) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}`,
} satisfies MapEmbed;

const stock: StockPhotoSource = {
  name: "unsplash",
  search: async (query: string) => ({
    photos: [
      {
        id: "p1",
        source: "unsplash" as const,
        url: "https://img.example/p1.jpg",
        thumbUrl: "https://img.example/p1-t.jpg",
        width: 800,
        height: 600,
        alt: query,
        creditName: "A. Person",
        creditUrl: "https://unsplash.com/@a",
      },
    ],
    hasMore: false,
  }),
} satisfies StockPhotoSource;

async function* chunks(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

describe("P7 port contracts (07-02)", () => {
  it("MediaDelivery", async () => {
    expect(
      delivery.urlFor({ id: "a1", orgId: "o1", kind: "image" }, "w960", {
        width: 960,
      }),
    ).toBe("/_media/a1/w960?w=960");
    await expect(delivery.purge(["k"])).resolves.toBeUndefined();
    await expect(delivery.deliveryBytes("o1", "2026-10")).resolves.toBeNull();
  });

  it("VideoTranscoder", async () => {
    await expect(transcoder.probe("/in.mov")).resolves.toMatchObject({
      hasVideoStream: true,
    });
    await expect(
      transcoder.transcode({
        inputPath: "/in.mov",
        outputPath: "/out.mp4",
        timeoutMs: 1000,
      }),
    ).resolves.toMatchObject({ bytes: 1024 });
    await expect(
      transcoder.extractFrame({
        inputPath: "/in.mov",
        outputPath: "/poster.jpg",
        atSeconds: 1,
        timeoutMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });

  it("FileScanner fails closed", async () => {
    await expect(scanner.scan(chunks())).resolves.toBe("error");
  });

  it("MapEmbed", () => {
    expect(map.keyed).toBe(false);
    expect(map.embedUrl({ query: "1 Main St" })).toContain("1%20Main%20St");
    expect(map.directionsUrl("1 Main St")).toContain("destination=");
  });

  it("StockPhotoSource", async () => {
    const page = await stock.search("cat", 1);
    expect(page.hasMore).toBe(false);
    expect(page.photos[0]).toMatchObject({ source: "unsplash", alt: "cat" });
  });
});
