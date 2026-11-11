// @cds/ui/hub/support/paid (12-10): the paid-service panel (SUPPORT-03) and the incident box
// (COMM-12). Types from @cds/core/support, never @cds/db.
export { CARE_PLAN_HELP_HREF, PAID_COPY, quoteHrefFor } from "./copy";
export {
  PaidServicePanel,
  canChoosePaid,
  isPrimaryChoice,
  type CareUsage,
  type PaidServicePanelProps,
} from "./PaidServicePanel";
export { IncidentBox, type IncidentBoxProps } from "./IncidentBox";
