// @cds/ui/hub/legal: presentational signing and agreement components (09-04; 09-UI-SPEC).
// Controlled and data-free: pages and Server Actions in apps/web (09-17, 09-18, 09-20)
// own state and data. Hub tokens only (--hub-*). No accept-all control (D216).
export {
  SIGNING_COPY,
  TYPED_NAME_MAX,
  TYPED_NAME_MIN,
  normalizeTypedName,
  progressLabel,
  signingReason,
  signingStatement,
  typedNameValid,
} from "./signing-state";
export { LegalProse } from "./LegalProse";
export type { LegalProseProps } from "./LegalProse";
export { PolicyCard } from "./PolicyCard";
export type { PolicyCardProps } from "./PolicyCard";
export { ConsentCard } from "./ConsentCard";
export type { ConsentCardProps } from "./ConsentCard";
export { AcceptProgress } from "./AcceptProgress";
export type { AcceptProgressProps } from "./AcceptProgress";
export { SignaturePanel } from "./SignaturePanel";
export type { SignaturePanelProps } from "./SignaturePanel";
export { AgreementHistoryTable } from "./AgreementHistoryTable";
export type {
  AgreementHistoryRow,
  AgreementHistoryTableProps,
} from "./AgreementHistoryTable";
export { SitePolicyPanel, SITE_POLICY_COPY } from "./SitePolicyPanel";
export type {
  SitePolicyNoticeView,
  SitePolicyPage,
  SitePolicyPanelProps,
  SitePolicyRowView,
} from "./SitePolicyPanel";
