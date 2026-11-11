// packages/ui/src/hub/domain/index.ts (P14, DOM-03, DOM-05).
// Owner: 14-30 → 14-25 → 14-32 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
// 14-30: the shared hub domain vocabulary (14-UI-SPEC "New hub components").
export { DomainStatusLine } from "./DomainStatusLine";
export type { DomainStatusLineProps } from "./DomainStatusLine";
export { DomainConnectForm } from "./DomainConnectForm";
export type { DomainConnectFormProps } from "./DomainConnectForm";
export { RegistrarHint } from "./RegistrarHint";
export type { RegistrarHintProps } from "./RegistrarHint";
export {
  RecordGroupList,
  RECORD_GROUP_ORDER,
  RECORD_VALUE_PREVIEW,
  displayRecordName,
  displayRecordValue,
  orderRecordGroups,
} from "./RecordGroupList";
export type {
  DomainRecordRow,
  RecordGroup,
  RecordGroupListProps,
  RecordGroupMode,
} from "./RecordGroupList";
export { GateFinding } from "./GateFinding";
export type {
  GateFindingProps,
  OwnerFindingKind,
  OwnerGateFinding,
} from "./GateFinding";
export { RegistrarSteps, renderStepText } from "./RegistrarSteps";
export type { RegistrarStepsProps } from "./RegistrarSteps";
export { NameserverPair } from "./NameserverPair";
export type { NameserverPairProps } from "./NameserverPair";
export { SendStepsDialog, SEND_NOTE_MAX } from "./SendStepsDialog";
export type { SendStepsDialogProps } from "./SendStepsDialog";
export { PrimaryHostChoice } from "./PrimaryHostChoice";
export type { PrimaryHost, PrimaryHostChoiceProps } from "./PrimaryHostChoice";
export { DOMAIN_UI_COPY, DOMAIN_STATUS_WORDS } from "./copy";
export type {
  DomainStatusTone,
  RecordChange,
  RecordGroupKey,
  RecordManager,
  RecordStatus,
} from "./copy";
// 14-25: Settings › Email "Sending from your domain" row (ONB-10).
export { SendingDomainStatus, SENDING_UI_COPY } from "./SendingDomainStatus";
export type {
  SendingDomainState,
  SendingDomainStatusProps,
} from "./SendingDomainStatus";
// 14-32: DNS records add/remove dialogs and the 3-step email setup (DOM-03, ONB-10).
export { AddRecordDialog, fullRecordName } from "./AddRecordDialog";
export type {
  AddRecordDialogProps,
  AddRecordInput,
  OwnerRecordType,
} from "./AddRecordDialog";
export { RemoveRecordDialog } from "./RemoveRecordDialog";
export type {
  RemovableRecord,
  RemoveRecordDialogProps,
} from "./RemoveRecordDialog";
export { EmailSetupFlow, presetFieldError } from "./EmailSetupFlow";
export type {
  EmailSetupChoice,
  EmailSetupFlowProps,
  EmailSetupInput,
  EmailSetupPreviewView,
} from "./EmailSetupFlow";
export { RECORDS_UI_COPY } from "./records-copy";
