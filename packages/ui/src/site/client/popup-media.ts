// Pop-up media hooks (CONT-21; 07-14 choice 8). No React.
//
// A server PopupHost cannot hand functions to the client controller, so open and close are
// DOM events on the pop-up's <dialog> plus this default media handler:
// - open: every `video[data-cds-popup-play]` inside plays muted and inline; skipped under
//   reduced motion; a rejected play() (autoplay policy) is swallowed.
// - close: every <video> and <audio> inside pauses. A loaded provider frame listens for
//   `cds:popup-close` itself and reloads (ConsentFrameIsland), which stops playback.
// 07-23's VideoItem adds `data-cds-popup-play` to MP4 videos placed in pop-ups; link videos
// never autoplay (D-UI-P7-34).

export const POPUP_OPEN_EVENT = "cds:popup-open";
export const POPUP_CLOSE_EVENT = "cds:popup-close";
export const POPUP_PLAY_ATTR = "data-cds-popup-play";
/** Sent to a loaded provider frame that is now out of sight; it reloads (WR-D03). */
export const MEDIA_STOP_EVENT = "cds:media-stop";

export interface PlayPopupMediaOptions {
  reducedMotion: boolean;
}

export function playPopupMedia(
  dialog: Element,
  { reducedMotion }: PlayPopupMediaOptions,
): void {
  if (reducedMotion) return;
  for (const video of dialog.querySelectorAll<HTMLVideoElement>(
    `video[${POPUP_PLAY_ATTR}]`,
  )) {
    video.muted = true;
    video.playsInline = true;
    try {
      const played = video.play();
      if (played && typeof played.catch === "function") {
        played.catch(() => {});
      }
    } catch {
      // A browser that throws instead of rejecting: nothing to do.
    }
  }
}

export function stopPopupMedia(dialog: Element): void {
  for (const media of dialog.querySelectorAll<HTMLMediaElement>(
    "video, audio",
  )) {
    try {
      media.pause();
    } catch {
      // jsdom and odd browsers: pausing is best effort.
    }
  }
}

/**
 * Stops everything playing inside a tab panel or slide the visitor can no longer see
 * (WR-D03): pauses every <video> and <audio>, and tells each consent frame to reload, which
 * stops a loaded YouTube, Vimeo or Spotify player.
 */
export function stopHiddenMedia(el: Element): void {
  stopPopupMedia(el);
  for (const frame of el.querySelectorAll("[data-cds-consent-frame]")) {
    frame.dispatchEvent(new CustomEvent(MEDIA_STOP_EVENT, { bubbles: false }));
  }
}
