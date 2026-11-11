// @cds/ui/staff/sites: Sites list and site detail (13-33) and the Actions tab (13-43).
export {
  SITE_PATH_LABELS,
  SITE_STATE_BADGE,
  SITE_STATE_GROUP,
  SITES_COPY,
  auditActorLabel,
  formatSiteDate,
  formatSiteDateTime,
  siteBillingLabel,
  siteBillingUnpaid,
  siteDate,
  sitePathLabel,
  sitePlanLabel,
  type SiteStateView,
} from "./copy";
export { SiteFlags, SiteStateBadge } from "./badges";
export {
  SitesTable,
  type SiteListRow,
  type SitesTableProps,
} from "./SitesTable";
export {
  SiteOverview,
  type SiteOverviewActivity,
  type SiteOverviewMember,
  type SiteOverviewProps,
  type SiteOverviewSuspension,
  type SiteOverviewView,
} from "./SiteOverview";
export { CopyIdButton } from "./CopyIdButton";
export {
  SiteAddonsTable,
  type SiteAddonAction,
  type SiteAddonRowView,
  type SiteAddonsTableProps,
} from "./SiteAddonsTable";
export {
  SiteTicketsTable,
  type SiteTicketRowView,
  type SiteTicketsTableProps,
} from "./SiteTicketsTable";
export {
  SiteAuditTable,
  type SiteAuditFilter,
  type SiteAuditRowView,
  type SiteAuditTableProps,
} from "./SiteAuditTable";
// 13-43: the Actions tab (impersonate, open ticket, post to site, stage, suspension).
export { SITE_ACTIONS_COPY } from "./actions-copy";
export {
  IMPERSONATION_REASON_MAX,
  IMPERSONATION_REASON_MIN,
  SiteActions,
  type ImpersonationView,
  type MoveStageAction,
  type SiteActionsCan,
  type SiteActionsHandlers,
  type SiteActionsProps,
  type SiteActionsSuspension,
  type SiteActionsView,
  type StartImpersonationAction,
} from "./SiteActions";
export {
  OPEN_TICKET_BODY_MAX,
  OPEN_TICKET_SUBJECT_MAX,
  OPEN_TICKET_TYPES,
  OpenTicketDialog,
  type OpenTicketAction,
  type OpenTicketDialogProps,
  type OpenTicketInput,
  type OpenTicketType,
} from "./OpenTicketDialog";
export {
  CDS_POST_KINDS,
  CDS_POST_LIMITS,
  CdsPostDialog,
  postCdsDocument,
  type CdsPostDialogProps,
  type CdsPostKind,
  type PostToSiteAction,
  type PostToSiteInput,
} from "./CdsPostDialog";
export {
  LiftSuspensionDialog,
  MarkFixedDialog,
  NOTICE_CATEGORY_IDS,
  SUSPEND_CATEGORY_IDS,
  SUSPENSION_TEXT_LIMIT,
  SuspendOrWarnDialog,
  noticeWhen,
  type NoticeCategoryId,
  type SendNoticeAction,
  type SiteOrgAction,
  type SuspendCategoryId,
  type SuspendNowAction,
  type SuspendOrWarnDialogProps,
  type SuspensionCaseDialogProps,
} from "./SuspensionDialogs";
// 14-43: Site › Offboarding (LIFE-01) and the shared Start offboarding dialog.
export {
  GA4_RUNBOOK,
  OffboardingPanel,
  STAFF_OFFBOARDING_COPY,
  STAFF_OFFBOARDING_REASON_MAX,
  STAFF_OFFBOARDING_REASON_MIN,
  STAFF_OFFBOARDING_TIME_ZONE,
  StartOffboardingButton,
  formatOffboardingDate,
  formatOffboardingWhen,
  offboardingReasonLabel,
  offboardingTimelineItems,
  type OffboardingPanelActions,
  type OffboardingPanelProps,
  type StaffHandbackStatus,
  type StaffHandbackZoneData,
  type StaffOffboardingData,
  type StaffOffboardingOrgAction,
  type StaffOffboardingPanelView,
  type StaffOffboardingReasonAction,
  type StaffOffboardingStartCase,
  type StaffOffboardingStepData,
  type StaffOffboardingStepStatus,
  type StartOffboardingButtonProps,
} from "./OffboardingPanel";
