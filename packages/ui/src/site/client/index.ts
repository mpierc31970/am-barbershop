// @cds/ui/site/client: client islands for the public site (CONT-10, CONT-12, D122, D124).
// Never imports the rich-text sanitizer (tests/edge-boundary.test.ts, T-03-28).
export { CountdownIsland } from "./CountdownIsland";
export type { CountdownIslandProps } from "./CountdownIsland";
export { PopupController } from "./PopupController";
export type {
  PopupControllerConfig,
  PopupControllerProps,
} from "./PopupController";
export { openOverlay, useOverlay, CLOSE_SELECTOR } from "./useOverlay";
export type {
  OpenOverlayOptions,
  OverlayHandle,
  UseOverlayOptions,
} from "./useOverlay";
export {
  useFocusTrap,
  attachFocusTrap,
  cycleFocus,
  focusablesIn,
} from "./useFocusTrap";
export {
  browserStores,
  isFinePointer,
  markSeen,
  readSeen,
  scrollPercent,
  FINE_POINTER_QUERY,
} from "./popup-dom";
export type { PopupStores, StorageLike } from "./popup-dom";
// Banner is plain server-safe markup with no sanitizer path; re-exported here so the hub's
// live banner preview renders the exact public markup from a client component (03-14).
export { Banner } from "../Banner";
export type { BannerProps } from "../Banner";
// SiteThemeScope is hookless, server-safe markup; re-exported so the hub's client previews
// (banner, builder swatches) wrap in the org theme without importing the site barrel (04-12).
export { SiteThemeScope } from "../SiteThemeScope";
export type { SiteThemeScopeProps } from "../SiteThemeScope";

// P7 area barrels (07-02): each owning plan fills only its own file.
export * from "./p7/consent";
export * from "./p7/forms";
export * from "./p7/chrome";
// 10-42: the Pro table island (sort / search / paging; SSR'd inside TableSection only when a
// table turns one of them on).
export {
  TableController,
  TABLE_CONTROLLER_COPY,
  tableNumber,
} from "./TableController";
export type { TableControllerProps } from "./TableController";
// 07-32: the password gate form island (SSR'd by PasswordGate).
export { PasswordGateEnhancer } from "./PasswordGateEnhancer";
export type {
  GateUiStatus,
  PasswordGateEnhancerProps,
} from "./PasswordGateEnhancer";
// 11-31: the cookieless site metrics beacon (mounted by the tenant layout on live hosts).
export { Beacon, FORM_SUBMITTED_EVENT, deviceClass } from "./Beacon";
// 11-32: consent-gated GA4 (mounted by the tenant layout only when the org has a measurement id).
export { GaLoader, GA_SCRIPT_ATTR } from "./GaLoader";
export type { GaLoaderProps } from "./GaLoader";
