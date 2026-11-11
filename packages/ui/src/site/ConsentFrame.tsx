// Consent frame, server half (CONT-34, D279; 07-UI-SPEC "Consent"; RESEARCH Pitfall 7;
// 07-14 choices 1 and 2). 07-23 and 07-24 render every third-party frame through this.
//
// Validates the stored source (a link pair through mediaLinkFrom, a map query through
// mapPlaceUrl) and renders nothing when it is invalid. Computes the copy, the no-JS link
// (the provider page, never the frame URL), the final size and the cover (our stored copy
// through mediaSrc), then hands plain data to the click-to-load island. The frame URL is
// never built here: the browser builds it after consent, so no provider host appears in any
// loading attribute of the server HTML.
import {
  MAP_PROVIDER_LABEL,
  PROVIDER_LABELS,
  consentLine,
  mapPlaceUrl,
  mediaLinkFrom,
  type ConsentFrameKind,
  type ConsentFrameSource,
  type MediaLinkCategory,
  type MediaProvider,
} from "@cds/core/content";
import {
  ConsentFrameIsland,
  type ConsentFrameAspect,
} from "./client/ConsentFrameIsland";
import { mediaSrc } from "./items/media";
import type { ResolvedMedia } from "./types";
import { text } from "./urls";

export interface ConsentFrameProps {
  source: ConsentFrameSource;
  kind: ConsentFrameKind;
  title: string;
  /** The stored cover image (video only), from the page's media map. */
  cover?: ResolvedMedia | null;
  /** Map: the address shown on the placeholder. */
  address?: string;
  aspect?: ConsentFrameAspect;
}

// UI-SPEC per-provider frame heights (px); calendars carry theirs on the MediaLink.
const HEIGHTS: Readonly<Partial<Record<MediaProvider, number>>> = {
  spotify: 152,
  soundcloud: 168,
  "apple-podcasts": 176,
  calendly: 704,
  "google-calendar": 600,
};

const CATEGORY: Readonly<
  Record<Exclude<ConsentFrameKind, "map">, MediaLinkCategory>
> = {
  video: "video",
  audio: "audio",
  booking: "embed",
};

export function ConsentFrame({
  source,
  kind,
  title,
  cover,
  address,
  aspect,
}: ConsentFrameProps) {
  const name = text(title);

  if (kind === "map") {
    if (source?.kind !== "map") return null;
    const href = mapPlaceUrl(source.query);
    if (href === null) return null;
    const where = text(address) || text(source.query);
    return (
      <ConsentFrameIsland
        source={{
          kind: "map",
          query: source.query,
          ...(source.key ? { key: source.key } : {}),
        }}
        kind="map"
        title={name || where}
        providerLabel={MAP_PROVIDER_LABEL}
        fallbackHref={href}
        line={consentLine("map", MAP_PROVIDER_LABEL)}
        address={where}
      />
    );
  }

  if (source?.kind !== "link") return null;
  const link = mediaLinkFrom(source.provider, source.id);
  if (!link || link.category !== CATEGORY[kind]) return null;
  const label = PROVIDER_LABELS[link.provider];
  const coverSrc = kind === "video" && cover ? mediaSrc(cover.src) : "";
  // A blank title still names the frame and its button (WR-D02): "YouTube video".
  const linkName = name || `${label} ${kind === "booking" ? "calendar" : kind}`;

  return (
    <ConsentFrameIsland
      source={{ kind: "link", provider: link.provider, id: link.id }}
      kind={kind}
      title={linkName}
      providerLabel={label}
      fallbackHref={link.pageUrl}
      line={consentLine(kind, label)}
      {...(coverSrc ? { cover: { src: coverSrc, alt: text(cover?.alt) } } : {})}
      {...(kind === "video"
        ? { aspect: aspect ?? "16:9" }
        : { height: link.height ?? HEIGHTS[link.provider] ?? 152 })}
    />
  );
}
