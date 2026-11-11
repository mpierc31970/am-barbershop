// @cds/ui/staff/pipeline (13-34; STAFF-01, STAFF-03, STAFF-04; 13-UI-SPEC "Pipeline"). The
// server-safe building blocks of the Pipeline tabs: the fit case, the slot report, the launch
// checklist and the Pipeline copy. The interactive island (dialogs, Reveal email, the note
// editor) lives in apps/web next to the panels and calls the 13-27 actions.
export {
  FIT_VERDICT_TONE,
  PIPELINE_COPY,
  fitTerms,
  highlightParts,
  type FitVerdictView,
  type PipelineLeadsSince,
  type SlotSourceView,
} from "./copy";
export {
  FitCasePanel,
  type FitCasePanelProps,
  type FitCaseView,
} from "./FitCasePanel";
export {
  SlotReport,
  sortSlots,
  type SlotReportProps,
  type SlotReportRow,
} from "./SlotReport";
export {
  LAUNCH_MOVE_WORDS,
  LaunchChecklist,
  LaunchMoveBadge,
  type LaunchChecklistProps,
  type LaunchChecklistView,
  type LaunchMoveState,
  type LaunchMoveView,
} from "./LaunchChecklist";
