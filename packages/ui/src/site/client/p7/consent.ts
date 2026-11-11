// @cds/ui/site/client P7 consent (owner 07-14; 07-02 seam).
// Site client area barrel: client islands; never import the rich-text sanitizer
// (edge-boundary test).
export { ConsentController, CookieChoicesLink } from "../ConsentController";
export type {
  ConsentControllerProps,
  CookieChoicesLinkProps,
} from "../ConsentController";
export { CookieBanner } from "../CookieBanner";
export type { CookieBannerProps } from "../CookieBanner";
export { ConsentFrameIsland } from "../ConsentFrameIsland";
export type {
  ConsentFrameAspect,
  ConsentFrameIslandProps,
} from "../ConsentFrameIsland";
export {
  CONSENT_EVENT,
  CONSENT_REOPEN_EVENT,
  consentPending,
  onConsentResolved,
  readConsent,
  reopenConsent,
  writeConsent,
} from "../consent-state";
export type { ConsentEventDetail } from "../consent-state";
// Pop-up media hooks (CONT-21): 07-23's pop-up videos carry POPUP_PLAY_ATTR.
export {
  POPUP_CLOSE_EVENT,
  POPUP_OPEN_EVENT,
  POPUP_PLAY_ATTR,
  playPopupMedia,
  stopPopupMedia,
} from "../popup-media";
export type { PlayPopupMediaOptions } from "../popup-media";
