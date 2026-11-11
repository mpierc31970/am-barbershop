// VideoItem: the public render of a video column item (07-08 seam, filled by 07-23; CONT-17,
// CONT-21, CONT-34, D-UI-P7-34, D278; 07-23 choices 4-7). Server component: no next/*, no
// client hooks.
// - MP4 from the library: the VideoPlayer island (poster, captions, click-to-play, muted
//   in-view autoplay, data-cds-popup-play for pop-ups).
// - Delivery paused (D278): the poster only, as an image frame.
// - A link: 07-14's ConsentFrame with provider + id only, our stored cover, never autoplay.
// - Anything else (processing, foreign, invalid): nothing.
import type { VideoColumnItem } from "@cds/core/content";
import { ConsentFrame } from "../ConsentFrame";
import { VideoPlayer } from "../client/VideoPlayer";
import { text } from "../urls";
import type { ItemComponentProps } from "./types";
import { videoView } from "./video-logic";

export function VideoItem({
  item,
  media,
}: ItemComponentProps<VideoColumnItem>) {
  const view = videoView(item, media);
  if (!view) return null;
  const raw = text(item.title);
  // A blank title still needs an accessible name (WR-D02). ConsentFrame names a link by its
  // provider ("YouTube video"); the MP4 player and poster fall back to "Video".
  const title = raw || "Video";

  if (view.kind === "link") {
    return (
      <ConsentFrame
        source={{ kind: "link", provider: view.provider, id: view.id }}
        kind="video"
        title={raw}
        cover={view.cover}
        aspect={view.shape}
      />
    );
  }

  if (view.kind === "poster") {
    return (
      <div
        role="img"
        aria-label={title}
        className="relative overflow-hidden rounded-site-media bg-site-surface-raised"
        style={{ aspectRatio: view.aspect }}
      >
        <img
          src={view.poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <VideoPlayer
      src={view.src}
      poster={view.poster}
      captions={view.captions}
      {...(view.crossOrigin ? { crossOrigin: view.crossOrigin } : {})}
      mime={view.mime}
      title={title}
      aspect={view.aspect}
      controls={item.controls !== false}
      loop={item.loop === true}
      autoplay={item.autoplay === true}
    />
  );
}
