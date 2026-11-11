// Video column item validator (07-08; CONT-17, D219, D279, D281).
//
// Pure and Edge-safe, no sanitizer. Deny by default: a fresh object from known keys, read
// as own properties. Never stores a URL: a pasted link or <iframe> becomes
// `{ provider, provider_id }` through parseMediaLinkFor, and a stored pair is re-validated
// by mediaLinkFrom on every save.
import { InvalidInput } from "../../errors";
import { LINK_NOT_ALLOWED_COPY, type VideoProvider } from "../media-link";
import type { VideoColumnItem, VideoShape } from "../types";
import { oneOf, own, type Raw } from "../validate-helpers";
import { itemLink, itemSource, optionalRefId, requiredTitle } from "./shared";

export const VIDEO_TITLE_COPY =
  "Add a title. Screen readers and search engines use it.";
export const VIDEO_SOURCE_COPY =
  "Choose a video from your media, or paste a link.";

export const VIDEO_SHAPES: readonly VideoShape[] = Object.freeze([
  "16:9",
  "9:16",
  "1:1",
]);

export function validateVideoItem(raw: Raw, id: string): VideoColumnItem {
  const title = requiredTitle(raw, VIDEO_TITLE_COPY);
  const source = itemSource(raw);
  const base = {
    id,
    kind: "video" as const,
    title,
    cover: optionalRefId(own(raw, "cover")),
    shape: oneOf(own(raw, "shape"), VIDEO_SHAPES, "16:9"),
    controls: own(raw, "controls") !== false,
    loop: own(raw, "loop") === true,
  };
  if (source === "link") {
    const link = itemLink(raw, "video", LINK_NOT_ALLOWED_COPY);
    if (!link) throw new InvalidInput(VIDEO_SOURCE_COPY);
    return {
      ...base,
      source,
      asset: "",
      provider: link.provider as VideoProvider,
      provider_id: link.id,
      // Autoplay is muted-only and only for an uploaded video (CONT-17).
      autoplay: false,
    };
  }
  const asset = optionalRefId(own(raw, "asset"));
  if (asset === "") throw new InvalidInput(VIDEO_SOURCE_COPY);
  return {
    ...base,
    source,
    asset,
    provider: "",
    provider_id: "",
    autoplay: own(raw, "autoplay") === true,
  };
}
