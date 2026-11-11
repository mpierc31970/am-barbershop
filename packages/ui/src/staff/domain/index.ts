// packages/ui/src/staff/domain/index.ts (P14, DOM-08, DOM-05).
// Owner: 14-38 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
// Staff › Site › Domain presentational components; 14-51 wires them, 14-43 reuses the
// reverse GateReport. Names are unique across the staff sub-barrels.
export {
  DOMAIN_TABLE,
  MOVE_STATUS_TONE,
  RECORD_RESULT_TONE,
  STAFF_DOMAIN_COPY,
  STAFF_DOMAIN_TIME_ZONE,
  STEP_STATUS_TONE,
  formatDomainDate,
  formatDomainWhen,
  staffStepDetailWords,
  type StaffDomainHostData,
  type StaffDomainIncident,
  type StaffDomainMoveData,
  type StaffDomainMoveStatus,
  type StaffDomainOrgAction,
  type StaffDomainOverrideAction,
  type StaffDomainReasonAction,
  type StaffDomainResult,
  type StaffDomainStartMoveAction,
  type StaffDomainStepData,
  type StaffDomainStepKey,
  type StaffDomainStepStatus,
  type StaffDomainSummaryData,
  type StaffDomainTextAction,
  type StaffGateRecordData,
  type StaffGateRecordGroup,
  type StaffGateRecordResult,
  type StaffGateRecordSource,
  type StaffGateRuleData,
  type StaffGateRuleId,
  type StaffGateRuleResult,
  type StaffPostSwitchRecordData,
} from "./copy";
export {
  DomainSummary,
  healthLine,
  type DomainSummaryProps,
} from "./DomainSummary";
export {
  HostsTable,
  hostHttpsWords,
  hostKindWords,
  type HostsTableProps,
} from "./HostsTable";
export {
  MOVE_STEP_ORDER,
  MoveTimeline,
  ZONE_FILE_MAX_BYTES_STAFF,
  moveTimelineItems,
  type MoveTimelineActions,
  type MoveTimelineProps,
} from "./MoveTimeline";
export { PostSwitchAlert, type PostSwitchAlertProps } from "./PostSwitchAlert";
export {
  GateReport,
  isGateProblem,
  type GateReportData,
  type GateReportProps,
} from "./GateReport";
export { GateRuleList, type GateRuleListProps } from "./GateRuleList";
export {
  MoveDomainButton,
  MoveDomainDialog,
  type MoveDomainButtonProps,
  type MoveDomainDialogProps,
} from "./MoveDomainDialog";
