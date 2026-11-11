// Intake chokepoint barrel (ONB-01, ONB-02, ONB-13; invariant 1). shared.ts stays internal.
export {
  getBusinessProfile,
  saveBusinessProfile,
  readAlertProfileFacts,
  setSensitivePractice,
  SENSITIVE_PRACTICE_AUDIT,
  getSendingView,
  setSendingLocalPart,
  SENDING_LOCAL_PART_AUDIT,
} from "./business-profile";
export type {
  AlertProfileFacts,
  BusinessProfile,
  SensitivePracticeSetting,
  SendingState,
  SendingView,
} from "./business-profile";
export {
  getOrgIntake,
  markStageSaved,
  saveIntakeAnswers,
  dismissFirstVisit,
} from "./org-intake";
export type { OrgIntake, AddonIntakeConfig } from "./org-intake";
export {
  listTeam,
  saveTeamMember,
  removeTeamMember,
  reorderTeam,
  PHOTO_COPY,
} from "./team";
export type { TeamMember, SavedTeamMember } from "./team";
export {
  listServices,
  saveService,
  deleteService,
  reorderServices,
} from "./services";
export type { Service, SavedService } from "./services";
export { REORDER_COPY } from "./shared";
export {
  previewCoreImport,
  commitCoreImport,
  exportCoreCsv,
  coreCsvTemplate,
} from "./list-import";
export type { CoreListKind, CoreImportMode } from "./list-import";
export {
  listEmailRoutes,
  addEmailRoute,
  changeDefaultRoute,
  resendRouteConfirmation,
  removeEmailRoute,
  setNewsletterSender,
  describeRouteConfirm,
  confirmEmailRoute,
  recordBounce,
  ROUTE_COPY,
} from "./email-routes";
export type { EmailRoute } from "./email-routes";
export {
  saveAddonIntakeFields,
  previewAddonIntakeImport,
  commitAddonIntakeImport,
  saveAddonIntakeRecord,
  removeAddonIntakeRecord,
  ADDON_INTAKE_COPY,
} from "./addon-intake";
export type { AddonIntakeImportMode } from "./addon-intake";
export { getIntakeSnapshot } from "./snapshot";
export { getIntakeForAssembly } from "./assembly";
export type { AssembledValue, AssemblyIntake } from "./assembly";
export {
  sendToCds,
  IntakeIncomplete,
  INTAKE_INCOMPLETE_COPY,
  ALREADY_SENT_COPY,
} from "./send";
