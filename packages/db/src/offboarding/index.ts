// packages/db/src/offboarding/index.ts: offboarding barrel.
// Owner: 14-02 (P14-P1, 14-EXECUTOR-BRIEF "Module seams"). Fixed: module owners fill bodies, never this file.
// Names must stay unique across modules (export * collisions fail typecheck).
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  NOTICE_DAYS,
  OFFBOARDING_STEPS,
  OFFBOARDING_STEP_TITLES,
  OFFBOARDING_SYSTEM_STEPS,
  OVERDUE_REMINDER_DAYS,
  STAY_HANDED_BACK,
  cancelOffboarding,
  leavingNeedsYou,
  offboardingView,
  requestOffboardingCode,
  startOffboarding,
} from "./offboardings";
export type {
  AdvanceOffboardingsResult,
  CancelOffboardingResult,
  OffboardingDeps,
  OffboardingOwnerStep,
  OffboardingReasonCategory,
  OffboardingStatus,
  OffboardingStepKey,
  OffboardingStepStatus,
  OffboardingStepView,
  OffboardingSystemStep,
  OffboardingView,
  StartOffboardingInput,
} from "./offboardings";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  GA4_TRANSFER_RUNBOOK,
  MOVE_DNS_FIRST,
  assertHandbackDone,
  authorizeOffboarding,
  completeOffboardingStep,
  offboardingChecklist,
  recordHandbackDone,
  requestOffboardingDownload,
} from "./steps";
export type {
  OffboardingChecklist,
  OffboardingChecklistLine,
  OffboardingChecklistStep,
  OffboardingManifestInput,
  OffboardingTickStep,
} from "./steps";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  HANDBACK_CHECKS_PER_MINUTE,
  HANDBACK_DELETE_AFTER_DAYS,
  checkHandbackDestination,
  chooseHandbackDestination,
  confirmHandbackSwitched,
  groupHandbackRecords,
  handbackView,
  handbackZoneFile,
  resetHandbackLimitsForTests,
} from "./handback";
export type {
  AdvanceHandbacksResult,
  HandbackDeps,
  HandbackDestinationKind,
  HandbackGroups,
  HandbackStatus,
  HandbackView,
  HandbackZoneView,
} from "./handback";
export * from "./staff";
