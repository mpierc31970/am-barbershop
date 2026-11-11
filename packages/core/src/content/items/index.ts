// Column item public exports (owner 07-08, then 07-14 appends consent).
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports. Named exports only.

// The one media link parser (D281): every embed URL is built here.
export {
  AUDIO_LINK_EMPTY_COPY,
  AUDIO_NOT_ALLOWED_COPY,
  AUDIO_PROVIDERS,
  EMBED_LINK_EMPTY_COPY,
  EMBED_NOT_ALLOWED_COPY,
  EMBED_PROVIDERS,
  LINK_NOT_ALLOWED_COPY,
  PROVIDER_FRAME_HOSTS,
  PROVIDER_LABELS,
  VIDEO_LINK_EMPTY_COPY,
  VIDEO_PROVIDERS,
  mediaLinkFrom,
  parseMediaLink,
  parseMediaLinkFor,
} from "../media-link";
export type {
  AudioProvider,
  EmbedProvider,
  MediaLink,
  MediaLinkCategory,
  MediaLinkResult,
  MediaProvider,
  VideoProvider,
} from "../media-link";

// Item validators and their copy (07-08). validate.ts dispatches to these.
export {
  VIDEO_SHAPES,
  VIDEO_SOURCE_COPY,
  VIDEO_TITLE_COPY,
  validateVideoItem,
} from "./video";
export {
  AUDIO_SOURCE_COPY,
  AUDIO_TITLE_COPY,
  validateAudioItem,
} from "./audio";
export { FORM_ITEM_COPY, validateFormItem } from "./form";
export { EMBED_TITLE_COPY, validateEmbedItem } from "./embed";

// Item walkers (07-04): texts, URLs and refs per kind. db pop-ups use them (07-08).
export {
  columnsItems,
  columnsRefs,
  itemRefs,
  itemTexts,
  itemUrls,
} from "./walk";

// Consent (07-14): one rule for every third-party frame (CONT-34, D279).
export {
  CONSENT_COOKIE,
  CONSENT_FRAME_HOSTS,
  CONSENT_MAX_AGE_S,
  FRAME_ALLOW,
  MAP_EMBED_KEY_RE,
  MAP_PROVIDER,
  MAP_PROVIDER_LABEL,
  consentFrameUrl,
  consentLine,
  consentNeeds,
  consentStatusText,
  cookieText,
  framesIn,
  mapFrameUrl,
  mapPlaceUrl,
  needsConsent,
  parseConsentChoice,
  providerLabel,
} from "./consent";
export type {
  ConsentChoice,
  ConsentFrameKind,
  ConsentFrameSource,
  ConsentFrameUse,
  ConsentNeeds,
  ConsentNeedsInput,
} from "./consent";
