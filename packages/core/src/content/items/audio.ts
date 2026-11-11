// Audio column item validator (07-08; CONT-27, D281).
//
// Pure and Edge-safe, no sanitizer. Deny by default; never stores a URL: a pasted Spotify,
// SoundCloud or Apple Podcasts link becomes `{ provider, provider_id }`.
import { InvalidInput } from "../../errors";
import { AUDIO_NOT_ALLOWED_COPY, type AudioProvider } from "../media-link";
import type { AudioColumnItem } from "../types";
import { own, type Raw } from "../validate-helpers";
import { itemLink, itemSource, optionalRefId, requiredTitle } from "./shared";

export const AUDIO_TITLE_COPY = "Add a title for this audio.";
export const AUDIO_SOURCE_COPY =
  "Choose an MP3 from your media, or paste a link.";

export function validateAudioItem(raw: Raw, id: string): AudioColumnItem {
  const title = requiredTitle(raw, AUDIO_TITLE_COPY);
  const source = itemSource(raw);
  if (source === "link") {
    const link = itemLink(raw, "audio", AUDIO_NOT_ALLOWED_COPY);
    if (!link) throw new InvalidInput(AUDIO_SOURCE_COPY);
    return {
      id,
      kind: "audio",
      title,
      source,
      asset: "",
      provider: link.provider as AudioProvider,
      provider_id: link.id,
    };
  }
  const asset = optionalRefId(own(raw, "asset"));
  if (asset === "") throw new InvalidInput(AUDIO_SOURCE_COPY);
  return {
    id,
    kind: "audio",
    title,
    source,
    asset,
    provider: "",
    provider_id: "",
  };
}
