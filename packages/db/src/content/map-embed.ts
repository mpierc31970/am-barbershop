// MapEmbed adapter (07-24; CONT-24, D230, D281; CONTEXT Area 2 row 4; T-07-24-02).
//
// Implements the MapEmbed port; the URL shape lives only in core mapFrameUrl (07-14 relay).
// No key (or a malformed one) means the keyless stand-in frame; a valid
// GOOGLE_MAPS_EMBED_KEY switches to the Maps Embed API. A malformed key warns once and is
// ignored: a map never breaks a page (D156 spirit). The key is a browser key restricted to
// the Maps Embed API, so it may reach public HTML (T-07-24-04); it reaches the renderer as
// data (coreData.mapKey), never as a URL.
import {
  MAP_EMBED_KEY_RE,
  mapDirectionsUrl,
  mapFrameUrl,
} from "@cds/core/content";
import type { MapEmbed, MapQuery } from "./p7-ports";

export type MapEmbedAdapter = MapEmbed & {
  /** The validated browser key, or undefined for the keyless frame. */
  readonly frameKey: string | undefined;
};

export function createMapEmbed({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): MapEmbedAdapter {
  const raw = (env.GOOGLE_MAPS_EMBED_KEY ?? "").trim();
  let frameKey: string | undefined;
  if (raw !== "") {
    if (MAP_EMBED_KEY_RE.test(raw)) {
      frameKey = raw;
    } else {
      console.warn(
        "[map] GOOGLE_MAPS_EMBED_KEY is malformed; using the keyless map",
      );
    }
  }
  return Object.freeze({
    keyed: frameKey !== undefined,
    frameKey,
    embedUrl(q: MapQuery): string {
      return mapFrameUrl(q?.query, frameKey) ?? "";
    },
    directionsUrl(destination: string): string {
      return mapDirectionsUrl(destination);
    },
  });
}

let cached: MapEmbedAdapter | null = null;

/** The process-wide adapter over process.env (memoized). */
export function getMapEmbed(): MapEmbedAdapter {
  if (!cached) cached = createMapEmbed({ env: process.env });
  return cached;
}
