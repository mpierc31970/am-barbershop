// @cds/ui/staff/tickets (13-07 seam; owned by 13-35, then 13-41 composer, 13-42 ratings + SLA):
// the inbox, ticket header strip, rail, staff thread and the console pollers.
export {
  STAFF_TICKETS_COPY,
  STAFF_TICKET_STATUS_LABELS,
  staffStatusLabel,
} from "./copy";
export {
  StaffThread,
  type StaffThreadMessageView,
  type StaffThreadProps,
} from "./StaffThread";
export {
  INBOX_REFRESH_MS,
  TICKET_POLL_MS,
  TICKET_POLL_RETRIES,
  useTicketPoll,
  useVisibleInterval,
  type TicketPollResult,
  type UseTicketPollOptions,
} from "./useTicketPoll";
export {
  TicketHeaderStrip,
  openAsAdminHref,
  targetText,
  ticketDay,
  type TicketHeaderStripProps,
  type TicketHeaderView,
} from "./TicketHeaderStrip";
export {
  TicketRail,
  staffStatusEnabled,
  type IncidentOption,
  type StaffOption,
  type TicketRailProps,
  type TicketRailView,
} from "./TicketRail";
export {
  InboxView,
  type InboxBulkInput,
  type InboxBulkResult,
  type InboxRowView,
  type InboxViewProps,
} from "./InboxView";
export { inboxHref } from "./inbox-href";
// 13-41: composer, canned picker, placeholder preview and the ticket shortcuts.
export {
  SKIP_PREVIEW_STORAGE_KEY,
  STAFF_COMPOSER_COPY,
  STAFF_COMPOSER_MAX,
  STAFF_DRAFT_PREFIX,
  StaffComposer,
  type ComposerMode,
  type StaffComposerHandle,
  type StaffComposerProps,
  type StaffComposerResult,
  type StaffComposerSendInput,
  type StaffComposerTicket,
} from "./StaffComposer";
export {
  CANNED_MANAGE_HREF,
  CANNED_PICKER_COPY,
  CannedPicker,
  type CannedOption,
  type CannedPickerProps,
} from "./CannedPicker";
export {
  PlaceholderPreview,
  PlaceholderUnknown,
  tryRenderCanned,
  type CannedRender,
  type PlaceholderPreviewProps,
} from "./PlaceholderPreview";
export {
  useInboxShortcuts,
  type InboxShortcutHandlers,
  type UseInboxShortcutsOptions,
} from "./useInboxShortcuts";
// 13-42: Ratings & SLA (STAFF-21).
export {
  RATINGS_REPORT_COPY,
  RatingsReport,
  type FollowUpResult,
  type RatingsAgentView,
  type RatingsCommentView,
  type RatingsFollowUpView,
  type RatingsReportProps,
  type RatingsReportView,
} from "./RatingsReport";
export {
  SLA_CARD_COPY,
  SlaCard,
  type SlaCardProps,
  type SlaMissedView,
} from "./SlaCard";
