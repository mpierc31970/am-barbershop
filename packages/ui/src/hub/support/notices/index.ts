// @cds/ui/hub/support/notices (12-14): the service notice strip (COMM-11), the locked panel and
// the held-changes panel (D102). Types from @cds/core/support, never @cds/db.
export { NOTICES_COPY } from "./copy";
export {
  NOTICE_STRIPS_SHOWN,
  ServiceNoticeStrip,
  noticesForPath,
  type ServiceNoticeStripProps,
} from "./ServiceNoticeStrip";
export { LockedPanel, type LockedPanelProps } from "./LockedPanel";
export {
  HeldChangesPanel,
  type HeldChangesPanelProps,
} from "./HeldChangesPanel";
