// Video, audio and booking calendar item views (07-23; CONT-17, CONT-27, CONT-34, D278, D279).
// One decision per item: what may render. Provider URLs are never built here; ConsentFrame
// owns that (D279). Our own media (MP4, MP3, posters, covers, captions) passes mediaSrc, so a
// `javascript:`, protocol-relative or backslash URL never reaches an attribute.
import {
  mediaLinkFrom,
  type AudioColumnItem,
  type EmbedColumnItem,
  type MediaProvider,
  type VideoColumnItem,
} from "@cds/core/content";
import type { ResolvedMedia } from "../types";
import { mediaSrc, resolveMedia } from "./media";

export type VideoShape = "16:9" | "9:16" | "1:1";

export const VIDEO_ASPECT: Readonly<Record<VideoShape, string>> = Object.freeze(
  {
    "16:9": "16 / 9",
    "9:16": "9 / 16",
    "1:1": "1 / 1",
  },
);

type MediaMap = Readonly<Record<string, ResolvedMedia>> | undefined;

export type VideoView =
  | {
      kind: "mp4";
      src: string;
      poster: string;
      captions: string;
      mime: string;
      shape: VideoShape;
      aspect: string;
      crossOrigin?: "anonymous";
    }
  | { kind: "poster"; poster: string; shape: VideoShape; aspect: string }
  | {
      kind: "link";
      provider: MediaProvider;
      id: string;
      shape: VideoShape;
      aspect: string;
      cover: ResolvedMedia | null;
    };

export type AudioView =
  | { kind: "mp3"; src: string; mime: string }
  | { kind: "link"; provider: MediaProvider; id: string };

export type EmbedView = { kind: "link"; provider: MediaProvider; id: string };

function shapeOf(value: unknown): VideoShape {
  return value === "9:16" || value === "1:1" ? value : "16:9";
}

/** MP4 (ready), poster only (delivery paused), a consented link, or nothing. */
export function videoView(
  item: VideoColumnItem,
  media: MediaMap,
): VideoView | null {
  const shape = shapeOf(item.shape);
  const aspect = VIDEO_ASPECT[shape];
  const cover = resolveMedia(media, item.cover, "image");

  if (item.source === "link") {
    const link = mediaLinkFrom(item.provider, item.provider_id);
    if (!link || link.category !== "video") return null;
    return {
      kind: "link",
      provider: link.provider,
      id: link.id,
      shape,
      aspect,
      cover,
    };
  }

  const video = resolveMedia(media, item.asset, "video");
  if (!video) return null;
  const poster = (cover ? mediaSrc(cover.src) : "") || mediaSrc(video.poster);
  const src = mediaSrc(video.src);
  if (src === "") {
    return poster === "" ? null : { kind: "poster", poster, shape, aspect };
  }
  const captions = mediaSrc(video.captions);
  return {
    kind: "mp4",
    src,
    poster,
    captions,
    // Our delivery always serves the compressed MP4 (D220).
    mime: "video/mp4",
    shape,
    aspect,
    ...(captions !== "" && src.startsWith("https://")
      ? { crossOrigin: "anonymous" as const }
      : {}),
  };
}

/** An MP3 from the library, a consented audio link, or nothing. */
export function audioView(
  item: AudioColumnItem,
  media: MediaMap,
): AudioView | null {
  if (item.source === "link") {
    const link = mediaLinkFrom(item.provider, item.provider_id);
    if (!link || link.category !== "audio") return null;
    return { kind: "link", provider: link.provider, id: link.id };
  }
  const audio = resolveMedia(media, item.asset, "audio");
  if (!audio) return null;
  const src = mediaSrc(audio.src);
  return src === "" ? null : { kind: "mp3", src, mime: "audio/mpeg" };
}

/** A consented booking calendar link, or nothing. */
export function embedView(item: EmbedColumnItem): EmbedView | null {
  const link = mediaLinkFrom(item.provider, item.provider_id);
  if (!link || link.category !== "embed") return null;
  return { kind: "link", provider: link.provider, id: link.id };
}
