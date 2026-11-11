// @cds/ui/staff/dialogs: the two dialogs every dangerous console action uses (13-09;
// STAFF-06; 13-UI-SPEC "StepUpDialog", "Destructive and irreversible actions"), the provider
// that owns the step-up flow and useStaffAction, the retry-with-same-args hook.
export { STAFF_DIALOG_COPY, STEP_UP_ERROR_CODES } from "./copy";
export { StepUpDialog, type StepUpDialogProps } from "./StepUpDialog";
export {
  CaseDialog,
  type CaseCheckbox,
  type CaseDialogProps,
  type CaseReasonField,
  type CaseValues,
} from "./CaseDialog";
export {
  StaffActionContext,
  StaffActionProvider,
  staffSignInHref,
  stepUpErrorCopy,
  type StaffActionContextValue,
  type StaffActionProviderProps,
  type StaffActionResult,
  type StepUpCode,
} from "./StaffActionProvider";
export {
  rethrowControlFlow,
  useStaffAction,
  type UseStaffActionOptions,
} from "./useStaffAction";
