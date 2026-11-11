// @cds/ui/hub: the hub primitive set (03-UI-SPEC "Hub primitives", D-UI-1, D311).
// Every P3 hub screen (sign-in, shell, pages, builder, banner, pop-ups) builds from these.
// Hub primitives read only --hub-* tokens and never touch the database client or the sanitizer (invariant 1).
export { Button, buttonClasses } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { TextField, TextArea, Select, fieldAria } from "./fields";
export type {
  TextFieldProps,
  TextAreaProps,
  SelectProps,
  SelectOption,
} from "./fields";
export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";
export { RadioCardGroup } from "./RadioCardGroup";
// P10 (10-05): the /start Monthly / Yearly control, shared with checkout (D-UI-P10-1).
export { SegmentedControl } from "./SegmentedControl";
export type {
  SegmentedControlProps,
  SegmentedOption,
} from "./SegmentedControl";
export type { RadioCardGroupProps, RadioCardOption } from "./RadioCardGroup";
export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";
export { InlineAlert, EmptyState, Skeleton } from "./feedback";
export type {
  AlertTone,
  InlineAlertProps,
  EmptyStateProps,
  SkeletonProps,
} from "./feedback";
export {
  ToastRegion,
  useToast,
  toastDuration,
  pushToast,
  TOAST_MS,
  UNDO_TOAST_MS,
  MAX_TOASTS,
} from "./Toast";
export type { ToastInput } from "./Toast";
export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";
export { Drawer } from "./Drawer";
export type { DrawerProps } from "./Drawer";
export { TabLinks } from "./TabLinks";
export type { TabLink, TabLinksProps } from "./TabLinks";
export { LayoutThumb, layoutRatios, layoutName } from "./LayoutThumb";
export type { LayoutThumbProps } from "./LayoutThumb";
// P5 shared add-on components (05-06; every list add-on reuses these, invariant 4).
export type {
  HubActionResult,
  HowToStepView,
  AddonRecordView,
  BackupReason,
  BackupView,
  AddonPanelData,
  AddonPanelActions,
  AddonPanelProps,
  AddonBlockFormProps,
  ImportCommitResult,
  CsvFile,
} from "./addon-types";
export { AddonCard, ADDON_CARD_COPY } from "./AddonCard";
export type { AddonCardProps, HubLinkComponent } from "./AddonCard";
export { AddonTabHeader, AddonTabLockContext } from "./AddonTabHeader";
export type {
  AddonTabHeaderProps,
  AddonTabLock,
  AddonTabMenuItem,
} from "./AddonTabHeader";
export { TrainingDrawer } from "./TrainingDrawer";
export type { TrainingDrawerProps } from "./TrainingDrawer";
export {
  RecordList,
  OTHER_GROUP,
  groupedOrder,
  planRecordMove,
  recordAnnouncements,
  refusedMoveCopy,
} from "./RecordList";
export type {
  RecordListProps,
  RecordMoveHandle,
  RecordMovePlan,
} from "./RecordList";
export { useReducedMotion, liftClasses } from "./motion";
export { FileDrop, FILE_TOO_BIG_COPY } from "./FileDrop";
export type { FileDropProps } from "./FileDrop";
export {
  CsvImportDialog,
  IMPORT_FAILED_COPY,
  NOTHING_TO_DO_COPY,
  errorsCopy,
  ignoredCopy,
  estimateRows,
} from "./CsvImportDialog";
export type { CsvImportDialogProps } from "./CsvImportDialog";
export {
  BackupsPanel,
  formatBackupDate,
  MAX_BACKUPS,
  BACKUPS_INTRO,
  NO_BACKUPS_COPY,
  RESTORE_FAILED_COPY,
} from "./BackupsPanel";
export type { BackupsPanelProps } from "./BackupsPanel";
// P6 emailed-code step (06-17; Submit and /sign-in share it, D-UI-P6-3, D-UI-P6-12).
export {
  CodeInput,
  CodeStep,
  codeStepBody,
  sanitiseCode,
  CODE_LENGTH,
  CODE_SENT_COPY,
  CODE_STEP_TITLE,
  RESEND_COOLDOWN_SEC,
} from "./CodeInput";
export type { CodeInputProps, CodeStepProps } from "./CodeInput";
// P6 setup building blocks (06-18; 06-UI-SPEC "Setup overview", "Stages").
export { StageRail, StageStatusIcon, STATUS_WORDS } from "./StageRail";
export type {
  StageRailProps,
  StageRailItem,
  StageRailStatus,
} from "./StageRail";
export {
  StillNeededList,
  NOTHING_LEFT_COPY,
  OPTIONAL_VISIBLE,
} from "./StillNeededList";
export type { StillNeededListProps } from "./StillNeededList";
export {
  AutosaveStatus,
  AUTOSAVE_PAUSED_COPY,
  invalidCopy,
  SAVED_SETTLE_MS,
} from "./AutosaveStatus";
export type { AutosaveStatusProps } from "./AutosaveStatus";
export { useAutosave, INVALID_CODE, LOCKED_CODE } from "./useAutosave";
export type {
  Autosave,
  AutosaveFailure,
  AutosaveOptions,
  AutosaveState,
} from "./useAutosave";
// P6 photo and hours editors (06-19; 06-UI-SPEC "Upload field", "Hours editor").
export {
  ImageUpload,
  ACCEPT,
  UPL_COPY,
  PROCESSING_COPY,
  PHOTO_REMOVED_COPY,
  ALT_MISSING_COPY,
  ALT_SAVE_FAILED_COPY,
  ALT_HELPER,
  checkFile,
  formatBytes,
  limitCopy,
  lowResCopy,
  mediaMeta,
  mediaViewFromServer,
} from "./ImageUpload";
export type {
  ImageUploadProps,
  MediaAssetView,
  MediaUploadKind,
} from "./ImageUpload";
export {
  HoursEditor,
  hoursRowErrors,
  timeLabel,
  TIME_OPTIONS,
  COPY_WEEKDAYS_TOAST,
  HOURS_EMPTY_HELPER,
  HOURS_OVERNIGHT_HELPER,
} from "./HoursEditor";
export type { HoursEditorProps } from "./HoursEditor";
// P6 mood board strip (06-21; 06-UI-SPEC "Mood board").
export { PaletteStrip, stripSwatches, PALETTE_STRIP_MAX } from "./PaletteStrip";
export type { PaletteStripProps } from "./PaletteStrip";
// P6 email routing row (06-22; 06-UI-SPEC "Email routing").
export {
  EmailRouteRow,
  RESEND_CONFIRM_COOLDOWN_MS,
  ROUTE_ROW_COPY,
  bounceCopy,
} from "./EmailRouteRow";
export type { EmailRouteRowProps, EmailRouteStatus } from "./EmailRouteRow";

// P7 area barrels (07-02): each owning plan fills only its own file.
export * from "./p7/contacts";
export * from "./p7/media";
export * from "./p7/forms";
export * from "./p7/inbox";
export * from "./p7/history";
export * from "./p7/seo";

// P10 feature locks (10-07; BILL-04, 10-UI-SPEC "Feature locks"): fed a server-computed
// entitlement set, never a client fetch.
export { FeatureGuard, featureBuyHref, lockPanelCopy } from "./FeatureGuard";
export type { FeatureGuardProps } from "./FeatureGuard";
export { FeatureInline, askOwnerCopy } from "./FeatureInline";
export type { FeatureInlineProps } from "./FeatureInline";
