// 07-23: videoView / audioView / embedView decide what may render (CONT-17, CONT-27, CONT-34,
// D278; T-07-23-04/05).
import { describe, expect, it } from "vitest";
import type {
  AudioColumnItem,
  EmbedColumnItem,
  VideoColumnItem,
} from "@cds/core/content";
import type { ResolvedMedia } from "../types";
import { audioView, embedView, VIDEO_ASPECT, videoView } from "./video-logic";

const YT = "dQw4w9WgXcQ";

function video(over: Partial<VideoColumnItem> = {}): VideoColumnItem {
  return {
    id: "v",
    kind: "video",
    title: "Tour",
    source: "media",
    asset: "v1",
    provider: "",
    provider_id: "",
    cover: "",
    shape: "16:9",
    controls: true,
    loop: false,
    autoplay: false,
    ...over,
  };
}

const V1: ResolvedMedia = {
  id: "v1",
  kind: "video",
  src: "/_media/v1/video.mp4",
  poster: "/_media/v1/poster.webp",
  alt: "",
  mime: "video/mp4",
};
const C1: ResolvedMedia = {
  id: "c1",
  kind: "image",
  src: "/_media/c1/w960",
  alt: "Cover",
};

describe("videoView", () => {
  it("an MP4 uses the video's poster, no captions, no crossorigin", () => {
    expect(videoView(video(), { v1: V1 })).toEqual({
      kind: "mp4",
      src: "/_media/v1/video.mp4",
      poster: "/_media/v1/poster.webp",
      captions: "",
      mime: "video/mp4",
      shape: "16:9",
      aspect: "16 / 9",
    });
  });

  it("the item's cover wins over the generated poster", () => {
    const v = videoView(video({ cover: "c1" }), { v1: V1, c1: C1 });
    expect(v).toMatchObject({ kind: "mp4", poster: "/_media/c1/w960" });
  });

  it("captions come through; crossorigin only for an absolute src with captions", () => {
    const withCc = { ...V1, captions: "/_media/v1/captions.vtt" };
    expect(videoView(video(), { v1: withCc })).not.toHaveProperty(
      "crossOrigin",
    );
    const cdn = {
      ...withCc,
      src: "https://cdn.example.net/v1/video.mp4",
      captions: "https://cdn.example.net/v1/captions.vtt",
    };
    expect(videoView(video(), { v1: cdn })).toMatchObject({
      captions: "https://cdn.example.net/v1/captions.vtt",
      crossOrigin: "anonymous",
    });
    expect(
      videoView(video(), {
        v1: { ...V1, src: "https://cdn.example.net/v.mp4" },
      }),
    ).not.toHaveProperty("crossOrigin");
  });

  it("paused delivery shows the poster only, or nothing without one", () => {
    expect(
      videoView(video({ shape: "1:1" }), { v1: { ...V1, src: "" } }),
    ).toEqual({
      kind: "poster",
      poster: "/_media/v1/poster.webp",
      shape: "1:1",
      aspect: "1 / 1",
    });
    expect(
      videoView(video(), { v1: { ...V1, src: "", poster: "" } }),
    ).toBeNull();
  });

  it("a missing, foreign or prototype asset renders nothing", () => {
    expect(videoView(video({ asset: "gone" }), { v1: V1 })).toBeNull();
    expect(videoView(video({ asset: "__proto__" }), { v1: V1 })).toBeNull();
    expect(videoView(video({ asset: "constructor" }), {})).toBeNull();
    expect(videoView(video(), undefined)).toBeNull();
    expect(
      videoView(video(), { v1: { ...V1, kind: "audio" } as ResolvedMedia }),
    ).toBeNull();
  });

  it("unsafe src or poster is treated as empty", () => {
    expect(
      videoView(video(), { v1: { ...V1, src: "javascript:alert(1)" } }),
    ).toMatchObject({ kind: "poster" });
    expect(
      videoView(video(), {
        v1: { ...V1, src: "//evil.example/v.mp4", poster: "" },
      }),
    ).toBeNull();
    expect(
      videoView(video(), { v1: { ...V1, poster: "javascript:x" } }),
    ).toMatchObject({ kind: "mp4", poster: "" });
  });

  it("a link becomes provider + id with the stored cover", () => {
    const v = videoView(
      video({
        source: "link",
        asset: "",
        provider: "youtube",
        provider_id: YT,
        cover: "c1",
        shape: "9:16",
      }),
      { c1: C1 },
    );
    expect(v).toEqual({
      kind: "link",
      provider: "youtube",
      id: YT,
      shape: "9:16",
      aspect: "9 / 16",
      cover: C1,
    });
  });

  it("a bad or non-video link renders nothing", () => {
    expect(
      videoView(
        video({ source: "link", provider: "youtube", provider_id: "x" }),
        {},
      ),
    ).toBeNull();
    expect(
      videoView(
        video({
          source: "link",
          provider: "spotify" as never,
          provider_id: "track/4uLU6hMCjMI75M1A2tKUQC",
        }),
        {},
      ),
    ).toBeNull();
    expect(
      videoView(
        video({
          source: "link",
          provider: "__proto__" as never,
          provider_id: YT,
        }),
        {},
      ),
    ).toBeNull();
  });

  it("an unknown shape falls back to 16:9", () => {
    const v = videoView(video({ shape: "4:3" as VideoColumnItem["shape"] }), {
      v1: V1,
    });
    expect(v).toMatchObject({ shape: "16:9", aspect: VIDEO_ASPECT["16:9"] });
  });
});

describe("audioView and embedView", () => {
  const audio = (over: Partial<AudioColumnItem> = {}): AudioColumnItem => ({
    id: "a",
    kind: "audio",
    title: "Ep 1",
    source: "media",
    asset: "m1",
    provider: "",
    provider_id: "",
    ...over,
  });
  const M1: ResolvedMedia = {
    id: "m1",
    kind: "audio",
    src: "/_media/m1/audio.mp3",
    alt: "",
  };

  it("an MP3 with a safe src", () => {
    expect(audioView(audio(), { m1: M1 })).toEqual({
      kind: "mp3",
      src: "/_media/m1/audio.mp3",
      mime: "audio/mpeg",
    });
    expect(
      audioView(audio(), { m1: { ...M1, src: "javascript:x" } }),
    ).toBeNull();
    expect(audioView(audio({ asset: "__proto__" }), { m1: M1 })).toBeNull();
  });

  it("audio links only", () => {
    expect(
      audioView(
        audio({
          source: "link",
          asset: "",
          provider: "spotify",
          provider_id: "track/4uLU6hMCjMI75M1A2tKUQC",
        }),
        {},
      ),
    ).toEqual({
      kind: "link",
      provider: "spotify",
      id: "track/4uLU6hMCjMI75M1A2tKUQC",
    });
    expect(
      audioView(
        audio({
          source: "link",
          provider: "youtube" as never,
          provider_id: YT,
        }),
        {},
      ),
    ).toBeNull();
  });

  it("embed links only", () => {
    const e = (provider: string, provider_id: string): EmbedColumnItem => ({
      id: "e",
      kind: "embed",
      title: "Book",
      provider: provider as EmbedColumnItem["provider"],
      provider_id,
    });
    expect(embedView(e("calendly", "acme"))).toEqual({
      kind: "link",
      provider: "calendly",
      id: "acme",
    });
    expect(embedView(e("youtube", YT))).toBeNull();
    expect(embedView(e("", ""))).toBeNull();
  });
});
