// AudioItem: the public render of an audio column item (07-08 seam, filled by 07-23; CONT-27,
// CONT-34). Server component: no next/*, no client hooks.
// - MP3 from the library: the title (body 600) above a native player labelled by it.
// - A Spotify / SoundCloud / Apple Podcasts link: 07-14's ConsentFrame (provider + id only).
// - Anything else: nothing.
import type { AudioColumnItem } from "@cds/core/content";
import { ConsentFrame } from "../ConsentFrame";
import { BODY_CLASS } from "../types";
import { text } from "../urls";
import type { ItemComponentProps } from "./types";
import { audioView } from "./video-logic";

export function AudioItem({
  item,
  media,
}: ItemComponentProps<AudioColumnItem>) {
  const view = audioView(item, media);
  if (!view) return null;
  const title = text(item.title);

  if (view.kind === "link") {
    return (
      <ConsentFrame
        source={{ kind: "link", provider: view.provider, id: view.id }}
        kind="audio"
        title={title}
      />
    );
  }

  const labelId = `audio-${item.id}`;
  return (
    <div>
      {title ? (
        <p
          id={labelId}
          className={`font-semibold text-site-text ${BODY_CLASS}`}
        >
          {title}
        </p>
      ) : null}
      <audio
        controls
        preload="none"
        src={view.src}
        {...(title
          ? { "aria-labelledby": labelId }
          : { "aria-label": "Audio" })}
        className="mt-2 w-full [accent-color:var(--site-primary)]"
      />
    </div>
  );
}
