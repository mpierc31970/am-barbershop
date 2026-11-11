// Copy for the video, audio and booking calendar item editors (07-23; 07-UI-SPEC "Column
// items", Copywriting Contract). Pure: no React, safe on the server.
import { PROVIDER_LABELS, type MediaLink } from "@cds/core/content";

export const LINK_COVER_FAILED_COPY =
  "We couldn't copy the cover from YouTube. You can choose one below.";
export const COVER_HELPER =
  "We use the video's own cover unless you choose one.";
export const AUTOPLAY_HELPER = "Starts muted. Visitors can turn the sound on.";
export const CAPTIONS_NONE_COPY = "No captions yet";
export const CAPTIONS_ADDED_COPY = "Captions added.";
export const CAPTIONS_REMOVED_COPY = "Captions removed.";
export const CAPTIONS_FILE_NAME = "captions.vtt";
export const MANAGE_IN_MEDIA = "Manage in Media";
export const PASTE_INSTEAD = "Paste a link instead";
export const VIDEO_LINK_LABEL =
  "Paste a link or embed code from YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok";
export const AUDIO_LINK_LABEL =
  "Paste a link from Spotify, SoundCloud or Apple Podcasts";
export const EMBED_LINK_LABEL =
  "Paste your Calendly or public Google Calendar link";

/** "YouTube video found" for a video link, "Spotify found" otherwise. */
export function foundLine(link: MediaLink): string {
  const label = PROVIDER_LABELS[link.provider];
  return link.category === "video" ? `${label} video found` : `${label} found`;
}

/** The provider page link text: "Open on YouTube". */
export function openOnLine(link: MediaLink): string {
  return `Open on ${PROVIDER_LABELS[link.provider]}`;
}

/** The Play preview iframe title: "Preview: YouTube video" / "Preview: Spotify". */
export function PREVIEW_TITLE(link: MediaLink): string {
  return `Preview: ${foundLine(link).replace(/ found$/, "")}`;
}

/** The Media tab, opened at one asset. */
export function mediaTabHref(assetId: string): string {
  return `/hub/website?tab=media&asset=${encodeURIComponent(assetId)}`;
}
