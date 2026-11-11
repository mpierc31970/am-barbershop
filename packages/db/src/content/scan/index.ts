// Composite publish scan (13-08; STAFF-23, D248, D295). Barrel: 13-10 adds it to the @cds/db
// barrel; 13-11 adds `scan-on-send` here. Names are unique across @cds/db (export * barrel).
export {
  compositeScanner,
  scannerProviders,
  usesKeywordTextStandIn,
  type CompositeDeps,
} from "./composite";
export { getTextChecker, keywordTextChecker } from "./text";
export { getImageModerator, skippedImageModerator } from "./image";
export {
  getLinkChecker,
  LINKS_UNCHECKED_REASON,
  skippedLinkChecker,
  webRiskLinkChecker,
  type WebRiskDeps,
} from "./link";
export {
  reserveWebRiskLookups,
  WEBRISK_DEFAULT_CAP,
  webRiskMonth,
  webRiskMonthLookups,
  webRiskMonthlyCap,
  type ReserveOptions,
} from "./budget";
export type {
  ImageModerator,
  LinkChecker,
  SubResult,
  SubVerdict,
  TextChecker,
} from "../ports";
export {
  scanOnSend,
  type CampaignScanInput,
  type ScanOnSendDeps,
} from "./scan-on-send";
